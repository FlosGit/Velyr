-- ════════════════════════════════════════════════════════════════════════════
-- Manual run trigger ("Run now" button) — daily-limit bookkeeping
--
-- Adds last_manual_run_at to agent_subscriptions. Set by the authenticated
-- `?action=trigger_run` handler in api/agent/run.js on a successful manual run
-- dispatch. Two consumers:
--   1. trigger_run enforces a 24h cooldown PER SUBSCRIPTION (max one manual run
--      per day; the scheduled cron runs + the post-onboarding auto-run do NOT
--      touch this column, so they don't consume the daily allowance).
--   2. The dashboard reads it (via the existing owner-scoped SELECT) to render a
--      proactive "next manual run available in Xh" state and disable the button.
--
-- No new RLS needed: agent_subscriptions is already owner-readable, and only the
-- service role writes this column. Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_subscriptions
  add column if not exists last_manual_run_at timestamptz;
