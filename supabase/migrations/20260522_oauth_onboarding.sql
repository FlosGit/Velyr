-- ════════════════════════════════════════════════════════════════════════════
-- OA1 — GitHub OAuth + ownership-verified onboarding: schema + RPC.
--
-- This migration is ADDITIVE ONLY. It does not rename or drop any existing
-- column, table, constraint, or policy. RLS is intentionally NOT touched here —
-- the interim browser-write policies on agent_connections / telegram_verification
-- _codes (see 20260520_agent_rls_policies.sql) stay in place for now and are
-- retired in OA5, once complete_onboarding() is the only browser-driven write
-- path into agent_connections.
--
-- New OAuth state model is STATELESS at the trust layer: the OAuth `state`
-- parameter is a signed token (GITHUB_OAUTH_STATE_SECRET, verified in the Vercel
-- callback route). The github_oauth_states table below exists ONLY as a
-- short-lived single-use nonce registry for replay protection — it is never the
-- source of trust, and the browser never touches it (service-role only).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Step 1: additive columns on agent_subscriptions ─────────────────────────
-- All nullable, all idempotent. github_installation_verified_at and
-- onboarding_completed_at are non-null ONLY after the ownership-verified RPC
-- runs, so downstream code can treat "verified_at is not null" as the single
-- source of truth for "this subscription completed verified onboarding".
alter table public.agent_subscriptions
  add column if not exists github_oauth_user_id            bigint,
  add column if not exists github_oauth_login              text,
  add column if not exists github_installation_verified_at timestamptz,
  add column if not exists onboarding_completed_at         timestamptz;

-- ─── Step 2: github_oauth_states — single-use OAuth nonce registry ───────────
-- Service-role only. Inserted on /initiate, read + stamped (consumed_at) on the
-- OAuth callback. RLS is enabled with NO policy for anon/authenticated, so the
-- browser client cannot see or write this table at all.
create table if not exists public.github_oauth_states (
  state_token  text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz
);

create index if not exists idx_github_oauth_states_created_at
  on public.github_oauth_states(created_at);

alter table public.github_oauth_states enable row level security;

-- Browsers never touch this table. The service-role key bypasses RLS, so the
-- absence of any permissive policy denies anon/authenticated entirely.
revoke all on public.github_oauth_states from anon, authenticated;

-- ─── Step 3: defensive unique index for the RPC's ON CONFLICT target ─────────
-- agent_connections is treated as one-row-per-subscription everywhere in the
-- codebase (every query is .eq('subscription_id', …).single()), but the table
-- was created outside these migrations, so we cannot assume a unique constraint
-- backs subscription_id. complete_onboarding()'s `ON CONFLICT (subscription_id)`
-- REQUIRES one to exist, or it errors at runtime. Create it idempotently here.
-- See product-decision flag OA1-A.
create unique index if not exists agent_connections_subscription_id_key
  on public.agent_connections(subscription_id);

-- ─── Step 4: complete_onboarding RPC ─────────────────────────────────────────
-- SECURITY DEFINER, but it re-derives the caller from auth.uid() and refuses to
-- write unless the target subscription's auth_user_id matches the caller. The
-- browser passes a verified installation_id (proven server-side in the OAuth
-- callback, OA3/OA4); this RPC is the ONLY browser-reachable write path that
-- sets github_installation_verified_at, so verified_at can no longer be forged
-- client-side once the interim policies are retired in OA5.
create or replace function public.complete_onboarding(
  p_subscription_id uuid,
  p_installation_id bigint,
  p_github_user_id  bigint,
  p_github_login    text,
  p_repo_owner      text,
  p_repo_name       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user         uuid := auth.uid();
  v_subscription_owner uuid;
begin
  if v_auth_user is null then
    raise exception 'not authenticated';
  end if;

  select auth_user_id into v_subscription_owner
  from agent_subscriptions
  where id = p_subscription_id;

  if v_subscription_owner is null then
    raise exception 'subscription not found';
  end if;

  if v_subscription_owner != v_auth_user then
    raise exception 'subscription does not belong to authenticated user';
  end if;

  -- write verified onboarding state
  update agent_subscriptions
  set
    github_oauth_user_id            = p_github_user_id,
    github_oauth_login              = p_github_login,
    github_installation_verified_at = now(),
    onboarding_completed_at         = now()
  where id = p_subscription_id;

  -- upsert agent_connections with the verified installation
  insert into agent_connections (
    subscription_id, github_installation_id, github_repo_owner, github_repo_name, created_at
  ) values (
    p_subscription_id, p_installation_id, p_repo_owner, p_repo_name, now()
  )
  on conflict (subscription_id) do update set
    github_installation_id = excluded.github_installation_id,
    github_repo_owner      = excluded.github_repo_owner,
    github_repo_name       = excluded.github_repo_name;
end;
$$;

grant execute on function public.complete_onboarding(uuid, bigint, bigint, text, text, text)
  to authenticated;
