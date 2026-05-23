-- ════════════════════════════════════════════════════════════════════════════
-- Stage 4 — drop scan/report product leftovers (removed in S0a).
--
-- APPLICATION HISTORY (this project applies migrations manually via the Supabase
-- SQL Editor; this file is the repo record of what was run):
--   1. Initial cascade drop of the orphaned tables + both full_scan columns.
--   2. full_scan_purchased was RE-ADDED (default false) immediately, because the
--      Stage 4A audit found AgentDashboard.jsx still SELECTed it — dropping it
--      first broke the dashboard's agent_subscriptions read.
--   3. This commit removes the AgentDashboard.jsx reads (the hasFullScan state,
--      the .select() field, and the dead "Full Scan unlocked → /premium" banner).
--   4. After this commit deploys, the final `full_scan_purchased` drop is run
--      manually (the last statement below).
--
-- All statements are idempotent (IF EXISTS), so re-running the whole file is safe
-- and matches the end state regardless of how far step-by-step application got.
-- ════════════════════════════════════════════════════════════════════════════

-- Orphaned product tables (no code reads/writes them; created manually outside
-- migrations, so any dependent objects go with CASCADE).
drop table if exists public.premium_reports cascade;
drop table if exists public.reports          cascade;

-- Vestigial billing columns from the removed €9 full-scan product. No write path
-- remains (the Stripe webhook no longer touches them); no RLS policy names them.
-- _at is dropped here; full_scan_purchased is dropped only AFTER the frontend
-- deploy that removes its last reader (Stage 4B) — see history note above.
alter table public.agent_subscriptions
  drop column if exists full_scan_purchased_at;

alter table public.agent_subscriptions
  drop column if exists full_scan_purchased;
