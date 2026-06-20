-- ════════════════════════════════════════════════════════════════════════════
-- agent_connections — mixed-row guard: a connection is EITHER GitHub OR pure-Shopify
-- (SG4a item 1)
--
-- ⚠️ DO NOT APPLY BLIND. ADD CONSTRAINT fails if any existing row already has BOTH
-- github_repo_name AND shopify_shop_domain set. Run the violator audit FIRST:
--
--   SELECT subscription_id, github_repo_name, shopify_shop_domain
--   FROM public.agent_connections
--   WHERE github_repo_name IS NOT NULL AND shopify_shop_domain IS NOT NULL;
--
-- Only apply this migration once that audit returns ZERO rows (clean each violator
-- per-row first — the SG2 test row 3310b4ac was already cleaned, others may exist).
--
-- WHY: processConnection routes on connection shape — a GitHub repo
-- (github_repo_name set) takes the two-pass LLM PR flow; a pure-Shopify connection
-- (shopify_shop_domain set, github_repo_name NULL) takes processShopifyConnection.
-- A row with BOTH set routes unpredictably (this cost real debugging time in SG2).
--
-- The constraint forbids ONLY the both-non-null case. A not-yet-configured /
-- read-only connection may legitimately have BOTH NULL — that stays allowed.
-- (A Shopify-via-GitHub theme connection is a GitHub connection: github_repo_name
-- set, shopify_shop_domain NULL — so it satisfies the constraint.)
--
-- Applied directly via the Supabase SQL Editor on <DATE> after a zero-violator
-- audit; this file reconciles the repo to the live DB. Idempotent: drop-if-exists
-- then add.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_connections
  drop constraint if exists agent_connections_single_type_check;

alter table public.agent_connections
  add constraint agent_connections_single_type_check
  check (not (github_repo_name is not null and shopify_shop_domain is not null));
