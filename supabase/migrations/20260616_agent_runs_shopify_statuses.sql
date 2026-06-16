-- ════════════════════════════════════════════════════════════════════════════
-- agent_runs status CHECK — add the 5 Shopify statuses
--
-- Applied directly via the Supabase SQL Editor on 2026-06-16; this file
-- reconciles the repo to the live DB. Idempotent: drop-if-exists then add, so
-- re-running (or applying to a fresh environment) lands on the same 22-value
-- constraint without erroring.
--
-- The Shopify branch in supabase/functions/agent-run/index.ts writes 5 new
-- terminal statuses (shopify_preview + 4 failure modes). agent_runs.status is
-- guarded by agent_runs_status_check, so those writes would be rejected (and the
-- run zombied in 'running') until the constraint allows them. The existing 17
-- values are reproduced VERBATIM from the live pg_get_constraintdef output —
-- nothing is dropped or reordered.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_runs
  drop constraint if exists agent_runs_status_check;

alter table public.agent_runs
  add constraint agent_runs_status_check
  check (status = any (array[
    -- ── existing 17 (verbatim from the live constraint) ──────────────────────
    'pending'::text,
    'running'::text,
    'waiting_approval'::text,
    'approved'::text,
    'rejected'::text,
    'deployed'::text,
    'failed'::text,
    'rolled_back'::text,
    'skipped_setup_pending'::text,
    'skipped_cost_cap'::text,
    'skipped_repo_unavailable'::text,
    'skipped_unsupported_framework'::text,
    'skipped_no_data'::text,
    'skipped_insufficient_graph'::text,
    'skipped_low_confidence'::text,
    'find_mismatch'::text,
    'find_ambiguous'::text,
    -- ── new: Shopify branch terminal statuses ────────────────────────────────
    'shopify_preview'::text,             -- interim preview persisted (no PR/write)
    'shopify_needs_reconsent'::text,     -- refresh token dead/expired → reconnect
    'shopify_not_configured'::text,      -- SHOPIFY_API_KEY/SECRET missing
    'shopify_token_failed'::text,        -- transient token refresh failure
    'shopify_theme_read_failed'::text    -- theme GraphQL read failed (after retry)
  ]));
