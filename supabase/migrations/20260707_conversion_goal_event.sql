-- C5 (measurement half): the structured, MEASURABLE twin of the free-text
-- conversion_goal. The free-text goal steers the LLM; this one is what we can
-- actually count in PostHog:
--   { "type": "click_text",    "value": "Start free trial" }  -- $autocapture clicks whose $el_text matches
--   { "type": "pageview_path", "value": "/checkout" }         -- $pageview on that exact path
--
-- handleRollbackCheck (api/agent/run.js) measures a deploy±2d before/after
-- goal-conversion rate (sessions with ≥1 goal event / all sessions) and records
-- it as impact_metrics metric_type='goal_conversion_rate'. Measurement ONLY —
-- bounce remains the sole rollback trigger.
--
-- Validated in handleUpdateSettings (type allowlist, value 1–120 chars,
-- pageview_path must be site-relative). Nullable; NULL = bounce-only measurement.
--
-- Apply via the Supabase SQL editor (this repo does not auto-run migrations).

ALTER TABLE public.agent_subscriptions
  ADD COLUMN IF NOT EXISTS conversion_goal_event jsonb;
