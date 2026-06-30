-- ════════════════════════════════════════════════════════════════════════════
-- agent_connections.connection_source — first-class connection-type discriminator
--
-- Until now, processConnection routed on connection SHAPE: a row with
-- shopify_shop_domain set and github_repo_name NULL took the pure-Shopify
-- Admin-API path (processShopifyConnection); everything else took the GitHub
-- PR flow. That implicit rule is fragile — this column makes the intent explicit
-- so the run pipeline can branch on connection_source instead of inferring it.
--
-- Values:
--   'github'         — GitHub repo connection (the existing default; includes the
--                      Shopify-via-GitHub theme path, which IS a GitHub connection).
--   'shopify_direct' — pure-Shopify Admin-GraphQL connection, no GitHub repo.
--
-- NOT NULL DEFAULT 'github' backfills every existing row to the historical
-- assumption, so existing connections keep working unchanged. The explicit
-- backfill below then re-labels the live pure-Shopify rows. Idempotent
-- (ADD COLUMN / CHECK guarded by IF NOT EXISTS / pg_constraint lookup).
--
-- No new theme-id column: the Shopify path already uses shopify_main_theme_id.
-- GitHub-specific columns (github_repo_name / github_repo_owner /
-- github_installation_id) are ALREADY nullable, so a shopify_direct row leaving
-- them NULL needs no schema change. The existing agent_connections_single_type_check
-- (20260620) already forbids a row having BOTH github_repo_name and
-- shopify_shop_domain set, which keeps connection_source unambiguous.
--
-- No RLS change: agent_connections is service-role-written; the browser cannot
-- write it (interim RLS retired in 20260522_retire_interim_oauth_rls.sql).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_connections
  add column if not exists connection_source text not null default 'github';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_connections_connection_source_check'
  ) then
    alter table public.agent_connections
      add constraint agent_connections_connection_source_check
      check (connection_source in ('github','shopify_direct'));
  end if;
end $$;

-- Re-label existing live pure-Shopify connections (shop domain set, no GitHub
-- repo). The DEFAULT already handled GitHub rows; this only touches direct rows.
update public.agent_connections
  set connection_source = 'shopify_direct'
  where shopify_shop_domain is not null
    and github_repo_name is null
    and connection_source <> 'shopify_direct';
