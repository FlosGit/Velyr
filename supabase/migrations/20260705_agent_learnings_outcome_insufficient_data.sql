-- The 48h rollback check records an honest "couldn't measure" outcome
-- (outcome='insufficient_data', api/agent/run.js handleRollbackCheck) when
-- either bounce window is under the session floor. The original CHECK
-- (positive/negative/neutral/pending) predates that path, so every such
-- insert has failed silently since Stage 3.5 — the honest outcome never
-- landed, AND the row doubles as the idempotency marker, so unmeasurable
-- runs were re-queried by every rollback_check cron until they aged out of
-- the 10-day lookback. Applied manually via the Supabase SQL Editor (this
-- file is the repo record of what was run, not an automated pipeline).

alter table public.agent_learnings
  drop constraint agent_learnings_outcome_check;

alter table public.agent_learnings
  add constraint agent_learnings_outcome_check
  check (outcome = any (array[
    'positive'::text,
    'negative'::text,
    'neutral'::text,
    'pending'::text,
    'insufficient_data'::text
  ]));
