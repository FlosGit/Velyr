-- ════════════════════════════════════════════════════════════════════════════
-- agent_runs status CHECK — add the 3 Shopify-direct rollback statuses (Stage 3)
--
-- The Shopify-direct write/rollback safety path introduces three terminal/interim
-- statuses on agent_runs.status, which is guarded by agent_runs_status_check — so the
-- writes would be rejected (and the run zombied) until the constraint allows them:
--
--   shopify_rollback_pending  — the 48h bounce/revenue check recommended a rollback;
--                               awaiting the merchant's Telegram YES/NO (parallels the
--                               GitHub revert-PR 'waiting_approval', but no PR exists).
--   shopify_rolled_back       — the merchant approved; prior_content was re-upserted /
--                               the created file deleted on the live theme.
--   shopify_concurrency_abort — the apply was ABORTED because the merchant edited the
--                               theme between analysis and write (checksum mismatch);
--                               nothing was overwritten.
--
-- Idempotent: drop-if-exists then re-add. The existing values are reproduced verbatim
-- from 20260624_shopify_approval_statuses.sql + 20260616 — nothing is dropped or
-- reordered. Applied manually via the Supabase SQL Editor (repo file is the record).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_runs
  drop constraint if exists agent_runs_status_check;

alter table public.agent_runs
  add constraint agent_runs_status_check
  check (status = any (array[
    'pending','running','waiting_approval','approved','rejected','deployed','failed','rolled_back',
    'skipped_setup_pending','skipped_cost_cap','skipped_repo_unavailable','skipped_unsupported_framework',
    'skipped_no_data','skipped_insufficient_graph','skipped_low_confidence',
    'find_mismatch','find_ambiguous',
    'shopify_preview','shopify_needs_reconsent','shopify_not_configured','shopify_token_failed',
    'shopify_theme_read_failed','shopify_github_preview',
    'shopify_awaiting_approval','shopify_deployed','shopify_rejected',
    -- Stage 3: Shopify-direct rollback safety
    'shopify_rollback_pending','shopify_rolled_back','shopify_concurrency_abort'
  ]::text[]));
