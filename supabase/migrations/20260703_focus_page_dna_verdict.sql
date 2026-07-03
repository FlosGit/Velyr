-- Dashboard actions (2026-07-03):
--  1) "Fix in next run" (Funnel tab): the owner pins one page; the next weekly
--     run biases the Pass-1 ranker context + the Pass-2 fix prompt toward it,
--     then consumes (clears) the pin after Pass 2 so it can't dominate every
--     following week. Written by api/agent/run.js handleUpdateSettings, read +
--     cleared by supabase/functions/agent-run (loadFocusPage/clearFocusPage).
--  2) DNA confirm / reject (DNA tab): the owner can confirm a learning or mark
--     it wrong. 'rejected' entries are excluded from the agent's prompt context
--     (loadBusinessDNA); 'confirmed' entries are labelled owner-confirmed.
--     Written by api/agent/run.js handleDnaVerdict (Bearer-auth, scoped to the
--     caller's subscription).
-- Applied manually via the Supabase SQL Editor (this file is the repo record).
-- Apply BEFORE deploying the Vercel/edge code that writes these columns.

ALTER TABLE agent_subscriptions
  ADD COLUMN IF NOT EXISTS focus_page_path text;

ALTER TABLE agent_business_dna
  ADD COLUMN IF NOT EXISTS user_verdict text
    CHECK (user_verdict IN ('confirmed', 'rejected')),
  ADD COLUMN IF NOT EXISTS user_verdict_at timestamptz;
