-- ════════════════════════════════════════════════════════════════════════════
-- Multi-hosting: record which platform deploys the customer's repo
--
-- Velyr's agent works purely through GitHub PRs — it merges and the customer's
-- host auto-deploys. It does NOT call any hosting API, so this column is
-- informational/future-proofing only (no run-path code reads it yet). Onboarding's
-- new platform-selection step writes it via api/onboarding.js?action=finalize.
--
-- NOT NULL DEFAULT 'vercel' backfills every existing row (the historical
-- assumption), so existing connections keep working unchanged. Idempotent.
-- No RLS change: agent_connections is service-role-written; the browser cannot
-- write it (interim RLS retired in 20260522_retire_interim_oauth_rls.sql).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_connections
  add column if not exists hosting_provider text not null default 'vercel';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_connections_hosting_provider_check'
  ) then
    alter table public.agent_connections
      add constraint agent_connections_hosting_provider_check
      check (hosting_provider in ('vercel','netlify','render','railway','cloudflare_pages'));
  end if;
end $$;
