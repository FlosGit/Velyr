-- ════════════════════════════════════════════════════════════════════════════
-- agent_connections.shopify_connected_branch — connected-branch override (SG3b)
--
-- Applied directly via the Supabase SQL Editor on 2026-06-20; this file reconciles
-- the repo to the live DB. Idempotent: ADD COLUMN IF NOT EXISTS, so re-running (or
-- applying to a fresh environment) is a no-op once present.
--
-- Shopify's GitHub theme integration can map the live theme to ANY branch. A
-- Shopify-via-GitHub connection has only GitHub access (no Shopify token), so the
-- connected branch cannot be auto-detected from Shopify — it is stored here as an
-- OPTIONAL override. NULL (the default) means "use the GitHub default branch",
-- which is the common case and what every existing/non-theme connection keeps.
--
-- Read by createPR (supabase/functions/agent-run/index.ts) and the rollback revert
-- PR path (api/agent/run.js) to resolve a theme run's base branch as
--   conn.shopify_connected_branch ?? <repo default branch>.
-- Written by the `set branch <name>` / `unset branch` Telegram command
-- (api/webhooks/telegram.js), which validates the branch exists before saving.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_connections
  add column if not exists shopify_connected_branch text;

comment on column public.agent_connections.shopify_connected_branch is
  'Shopify-via-GitHub: the branch Shopify syncs to the live theme. NULL = use the repo default branch. Set via the Telegram `set branch <name>` command (validated to exist before save).';
