-- ════════════════════════════════════════════════════════════════════════════
-- Stage 4.5: agent_site_network
--
-- Stores the RA2 import graph + RA3 rankings per run. The frontend
-- SiteNetwork component reads from this table via the browser (anon/authed)
-- client, so RLS is required here the same as every other agent_* table.
--
-- Design decisions:
--   - nodes/edges NOT NULL default '[]' so generated node_count is never null.
--   - unique(run_id) makes best-effort inserts idempotent on retry.
--   - Both FKs ON DELETE CASCADE: run deletion cascades the snapshot;
--     subscription deletion cascades all snapshots via both FKs.
--   - SECURITY DEFINER prune trigger scoped strictly to new.subscription_id.
--   - RLS SELECT policy copied verbatim from the Step 3 pattern in
--     20260520_agent_rls_policies.sql (agent_runs, agent_learnings, etc.).
--     The OR + ::uuid cast matches the reference exactly — both user_id and
--     auth_user_id hold the same person's Supabase auth UUID (see ownership
--     model note in that migration).
--   - No INSERT/UPDATE/DELETE policy for authenticated users; the edge
--     function writes via service-role, which bypasses RLS.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Table ───────────────────────────────────────────────────────────────────
create table if not exists public.agent_site_network (
  id              uuid        primary key default gen_random_uuid(),
  subscription_id uuid        not null references public.agent_subscriptions(id) on delete cascade,
  run_id          uuid        not null references public.agent_runs(id)          on delete cascade,
  captured_at     timestamptz not null default now(),
  framework       text,
  nodes           jsonb       not null default '[]'::jsonb,
  edges           jsonb       not null default '[]'::jsonb,
  node_count      integer     generated always as (jsonb_array_length(nodes)) stored,
  constraint agent_site_network_run_id_unique unique (run_id)
);

create index if not exists idx_site_network_sub
  on public.agent_site_network(subscription_id, captured_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.agent_site_network enable row level security;
revoke all on public.agent_site_network from anon;

-- SELECT: authenticated users see only their own subscription's snapshots.
-- Policy shape and subquery copied verbatim from Step 3 of
-- 20260520_agent_rls_policies.sql.
create policy agent_site_network_select_own on public.agent_site_network
  for select to authenticated
  using (subscription_id in (
    select id from public.agent_subscriptions
    where user_id::uuid = auth.uid() or auth_user_id = auth.uid()
  ));

-- ─── Prune trigger ───────────────────────────────────────────────────────────
-- Keeps at most 3 rows per subscription on every insert.
-- SECURITY DEFINER to write through RLS; the subquery WHERE clause is
-- hard-scoped to new.subscription_id so it cannot touch other subscriptions.
create or replace function public.prune_site_network()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.agent_site_network
  where id in (
    select id
    from   public.agent_site_network
    where  subscription_id = new.subscription_id
    order  by captured_at desc
    offset 3
  );
  return new;
end;
$$;

create trigger trg_prune_site_network
  after insert on public.agent_site_network
  for each row execute function public.prune_site_network();
