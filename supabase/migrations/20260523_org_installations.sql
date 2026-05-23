-- ════════════════════════════════════════════════════════════════════════════
-- Stage 3B — GitHub organization installation support.
--
-- The OAuth callback previously admitted only personal installs (account.id ===
-- github_user_id). Org installs are now accepted (GitHub already scopes
-- /user/installations to installations the user can access — member-level, no
-- extra org-admin gate; Stage 3 decision 1). The subscription:user model stays
-- 1:1 — the org is just WHOSE account the installation lives under, captured as
-- additive identity metadata on agent_subscriptions (no RLS / ownership change).
--
-- ADDITIVE ONLY. No column/table/policy is dropped except the old
-- complete_onboarding signature, which is replaced by a wider one (3 new
-- defaulted params) so there is no ambiguous overload.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Step 1: installation account identity (alongside github_oauth_* cols) ───
alter table public.agent_subscriptions
  add column if not exists installation_account_type  text,    -- 'User' | 'Organization'
  add column if not exists installation_account_login text,
  add column if not exists installation_account_id    bigint;

-- ─── Step 2: complete_onboarding gains the installation account identity ─────
-- Drop the old 6-arg signature first so the 9-arg version (last 3 defaulted) is
-- the sole overload. Ownership check is UNCHANGED — subscription owner must be
-- the authenticated caller; org-ness does not relax it.
drop function if exists public.complete_onboarding(uuid, bigint, bigint, text, text, text);

create or replace function public.complete_onboarding(
  p_subscription_id uuid,
  p_installation_id bigint,
  p_github_user_id  bigint,
  p_github_login    text,
  p_repo_owner      text,
  p_repo_name       text,
  p_installation_account_type  text   default null,
  p_installation_account_login text   default null,
  p_installation_account_id    bigint default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user          uuid := auth.uid();
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

  update agent_subscriptions
  set
    github_oauth_user_id            = p_github_user_id,
    github_oauth_login              = p_github_login,
    github_installation_verified_at = now(),
    onboarding_completed_at         = now(),
    installation_account_type       = p_installation_account_type,
    installation_account_login      = p_installation_account_login,
    installation_account_id         = p_installation_account_id
  where id = p_subscription_id;

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

grant execute on function public.complete_onboarding(uuid, bigint, bigint, text, text, text, text, text, bigint)
  to authenticated;
