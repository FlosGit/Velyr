-- ════════════════════════════════════════════════════════════════════════════
-- Stage 3: site_structure_preview
--
-- First-connect structure preview. Written by the edge function's new
-- `discover_structure` intent — RA1 only (git.getTree + framework detection,
-- NO AI, NO conversion verdicts). The onboarding build-finale screen polls this
-- row and animates the real tree wave-by-wave; edges are folder-hierarchy only
-- (the real import wiring lands on the first weekly run, written to
-- agent_site_network, which supersedes this preview).
--
-- One row per subscription (upserted) — no growth, no prune trigger needed.
--
-- Held to the agent_site_network bar:
--   - nodes/edges JSONB NOT NULL default '[]' so the generated node_count
--     column can never receive null.
--   - RLS SELECT policy is the verbatim Step-3 pattern from
--     20260520_agent_rls_policies.sql (the user_id::uuid OR auth_user_id cast is
--     correct — both columns hold the same Supabase auth UUID).
--   - anon revoked; no browser INSERT/UPDATE/DELETE (edge function writes via
--     service-role, which bypasses RLS).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.site_structure_preview (
  id              uuid        primary key default gen_random_uuid(),
  subscription_id uuid        not null unique
                    references public.agent_subscriptions(id) on delete cascade,
  status          text        not null default 'mapping',   -- mapping | ready | partial | error
  framework       text,
  nodes           jsonb       not null default '[]'::jsonb,
  edges           jsonb       not null default '[]'::jsonb,
  truncated       boolean     not null default false,        -- big-repo graceful: partial tree
  error_message   text,
  node_count      integer     generated always as (jsonb_array_length(nodes)) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.site_structure_preview enable row level security;
revoke all on public.site_structure_preview from anon;

-- SELECT: authenticated users see only their own subscription's preview.
-- Verbatim Step-3 subquery from 20260520_agent_rls_policies.sql.
create policy site_structure_preview_select_own on public.site_structure_preview
  for select to authenticated
  using (subscription_id in (
    select id from public.agent_subscriptions
    where user_id::uuid = auth.uid() or auth_user_id = auth.uid()
  ));
