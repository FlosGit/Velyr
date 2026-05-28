-- ════════════════════════════════════════════════════════════════════════════
-- PostHog Setup-PR feature: auto-open a GitHub PR to add the Velyr analytics
-- snippet, replacing the manual Telegram-paste flow for supported frameworks.
--
-- New columns on agent_connections:
--   posthog_snippet_installed_at  — set when snippet is confirmed present
--   posthog_snippet_declined      — user said NO twice (or foreign NO)
--   posthog_snippet_retry_count   — tracks one-retry-allowed logic for setup_posthog
--
-- New column on agent_runs:
--   run_type  — 'conversion_fix' (default) | 'setup_posthog' |
--               'setup_posthog_foreign_choice'
--
-- Index on (subscription_id, run_type, status) for the dedupe check in
-- maybeRunSnippetSetup before opening a new Setup-PR.
--
-- Idempotent (IF NOT EXISTS / DEFAULT guards). Apply manually via the
-- Supabase SQL Editor per the established migration workflow.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.agent_connections
  ADD COLUMN IF NOT EXISTS posthog_snippet_installed_at timestamptz,
  ADD COLUMN IF NOT EXISTS posthog_snippet_declined     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posthog_snippet_retry_count  int     NOT NULL DEFAULT 0;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS run_type text NOT NULL DEFAULT 'conversion_fix';

CREATE INDEX IF NOT EXISTS agent_runs_subscription_type_status_idx
  ON public.agent_runs (subscription_id, run_type, status);
