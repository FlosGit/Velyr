-- ════════════════════════════════════════════════════════════════════════════
-- Velyr diagnostics query pack (as of 2026-07-11)
--
-- All queries are READ-ONLY. Run ONE query at a time against prod via:
--   npx supabase db query "<paste one query>" --linked --output json
-- (CLI must be logged in and linked once: `npx supabase link --project-ref <ref> --yes`.
--  Announce before running prod queries; never run anything mutating without
--  the operator.)
--
-- Schema provenance: agent_llm_usage / agent_site_network / email_log /
-- rate_limit_hits / telegram_webhook_dedupe / the agent_runs status CHECK /
-- agent_learnings + agent_business_dna outcome vocabularies are defined in
-- supabase/migrations/*.sql (repo-verified DDL). The BASE tables agent_runs /
-- agent_subscriptions / agent_connections / impact_metrics predate the repo's
-- migration record — their columns below are derived from code usage
-- (api/agent/run.js, api/_lib/*.js, supabase/functions/agent-run/index.ts)
-- and were all seen referenced in code on 2026-07-11.
-- Interpretation guides for every query: see ../SKILL.md.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Q1: Zombie runs (hard-killed isolates) ────────────────────────────────────
-- cleanupStaleRuns' criteria: status='running' AND created_at older than 60 min
-- (STALE_RUN_THRESHOLD_MS, twins api/agent/run.js:330 ↔ edge index.ts:5525).
-- Healthy: 0 rows. Any row = an isolate died mid-run (or a run is genuinely
-- >60 min, which the sweep will mark failed anyway).
select id, subscription_id, status, current_step, run_type, created_at,
       now() - created_at as age
from agent_runs
where status = 'running'
  and created_at < now() - interval '60 minutes'
order by created_at;

-- ── Q2: Recent runs per subscription (progress trail) ─────────────────────────
-- current_step values written by the edge fn: fetching_repo → pulling_analytics
-- → mapping_funnel → ranking_components → reading_deep_context →
-- finding_biggest_issue → writing_fix → sending_notification → done.
-- There is NO screenshot checkpoint (dashboard "step 8" = Pass 2 in progress).
select id, subscription_id, status, current_step, run_type,
       created_at, completed_at, error_message
from agent_runs
order by created_at desc
limit 30;

-- ── Q3: 30-day run-status distribution ────────────────────────────────────────
-- Full status vocabulary = the 28-value agent_runs_status_check
-- (supabase/migrations/20260630_shopify_rollback_statuses.sql).
select status, count(*) as n
from agent_runs
where created_at > now() - interval '30 days'
group by status
order by n desc;

-- ── Q4: Skip breakdown (why is the agent not shipping fixes?) ─────────────────
-- Skip statuses: skipped_setup_pending, skipped_cost_cap,
-- skipped_repo_unavailable, skipped_unsupported_framework, skipped_no_data,
-- skipped_insufficient_graph, skipped_low_confidence (+ find_mismatch /
-- find_ambiguous as guard failures).
select status,
       count(*) as n,
       max(created_at) as most_recent,
       -- Pass-2 skips carry the model's reason + optional question_for_owner
       max(analysis_result->>'skip_reason')       as sample_skip_reason,
       max(analysis_result->>'question_for_owner') as sample_owner_question
from agent_runs
where created_at > now() - interval '30 days'
  and (status like 'skipped_%' or status in ('find_mismatch','find_ambiguous'))
group by status
order by n desc;

-- ── Q5: Business-DNA outcome distribution (the fix win-rate) ──────────────────
-- Vocabulary (migration 20260705_business_dna_outcome_vocabulary.sql):
-- pending → measured_win | survived | rollback. Legacy 'success' rows read as
-- 'survived'. promotePendingDNA (api/agent/run.js) resolves pending after 7d.
select coalesce(nullif(outcome,'success'),'survived') as outcome_normalized,
       count(*) as n
from agent_business_dna
group by 1
order by n desc;

-- ── Q6: DNA outcomes per fix_type (what kinds of fixes actually win) ──────────
-- fix_type = Pass 2's change_type (closed CHANGE_TYPES taxonomy, edge
-- index.ts ~3422). This is the per-tenant view of what the Global Win Library
-- aggregates cross-tenant.
select fix_type,
       count(*) filter (where outcome = 'measured_win')                 as measured_win,
       count(*) filter (where outcome in ('survived','success'))        as survived,
       count(*) filter (where outcome = 'rollback')                     as rollback,
       count(*) filter (where outcome = 'pending')                      as pending,
       count(*) filter (where user_verdict = 'rejected')                as owner_rejected
from agent_business_dna
group by fix_type
order by measured_win desc, survived desc;

-- ── Q7: Matched-window impact for one run ─────────────────────────────────────
-- impact_metrics columns (code-derived: api/agent/run.js:1322,1355):
-- run_id, subscription_id, metric_type, value_before, value_after, measured_at.
-- metric_type ∈ site_wide_bounce_rate | route_scoped_bounce_rate |
-- goal_conversion_rate | legacy bounce_rate. NEVER pair
-- agent_runs.bounce_rate_before/after instead (mixed windows).
select run_id, metric_type, value_before, value_after,
       round((value_before - value_after)::numeric, 1) as improvement_pp,
       measured_at
from impact_metrics
where run_id = '<RUN_ID>'
order by measured_at desc;

-- ── Q8: goal_conversion_rate coverage (is C5 measurement live?) ───────────────
select count(distinct subscription_id) as subs_with_goal_metric,
       count(*) as goal_metric_rows,
       max(measured_at) as most_recent
from impact_metrics
where metric_type = 'goal_conversion_rate';

-- ── Q9: LLM spend per subscription per month (wallet cap) ─────────────────────
-- Table DDL: migrations 20260520_agent_llm_usage.sql +
-- 20260524_agent_llm_usage_token_columns.sql. period is 'YYYY-MM' (UTC).
-- Cap: €20/month default (MONTHLY_SPEND_CAP_EUR, override
-- AGENT_MONTHLY_SPEND_CAP_EUR). updated_at doubles as the
-- "last LLM call finished" tracer for stuck-run diagnosis.
select subscription_id, period, input_tokens, output_tokens,
       round(cost_eur, 4) as cost_eur, updated_at
from agent_llm_usage
order by period desc, cost_eur desc
limit 24;

-- ── Q10: Ranker-fallback detection (is Pass 1 degrading to heuristics?) ───────
-- agent_site_network (migration 20260528): nodes is a jsonb ARRAY; each node
-- carries rankReason (edge index.ts:4253). The Pass-1 fallback stamps reasons
-- beginning 'heuristic score' (loud ranker_pass1_fallback log). A prune
-- trigger keeps only the newest 3 snapshots per subscription.
select sn.subscription_id, sn.run_id, sn.captured_at, sn.framework,
       count(*) filter (where n->>'rankReason' like 'heuristic score%') as heuristic_nodes,
       count(*) filter (where n->>'rankReason' is not null)             as ranked_nodes
from agent_site_network sn
cross join lateral jsonb_array_elements(sn.nodes) as n
group by sn.subscription_id, sn.run_id, sn.captured_at, sn.framework
order by sn.captured_at desc
limit 20;

-- ── Q11: 48h visual-check verdicts (do merged fixes actually render?) ─────────
-- visual_check jsonb (migration 20260708_visual_check.sql):
-- { verdict: visible|not_visible|not_assessable, detail, model, checked_at }.
-- NULL = not yet checked (writer re-asserts IS NULL → written exactly once).
select visual_check->>'verdict' as verdict, count(*) as n
from agent_runs
where visual_check is not null
group by 1
order by n desc;

-- ── Q12: Pending approvals with age (is someone waiting on a YES?) ────────────
select id, subscription_id, status, run_type, telegram_message_id,
       created_at, now() - created_at as waiting_for
from agent_runs
where status in ('waiting_approval','shopify_awaiting_approval','shopify_rollback_pending')
order by created_at;

-- ── Q13: Lifecycle-email log (idempotency claims) ─────────────────────────────
-- email_log (migration 20260711_email_lifecycle.sql): one row per CLAIMED send
-- (claim-first; released again on a failed provider call, so rows ≈ successful
-- sends). email_type ∈ welcome|setup_reminder|tips|weekly_digest;
-- period_key 'once' for drip, ISO week for digests.
select email_type, period_key, count(*) as n, max(sent_at) as most_recent
from email_log
group by email_type, period_key
order by most_recent desc
limit 20;

-- ── Q14: Housekeeping-table growth (is the daily GC running?) ─────────────────
-- Both tables are GC'd by the daily enforce_subscriptions cron
-- (telegram_webhook_dedupe: rows >7d; rate_limit_hits: old windows).
select 'telegram_webhook_dedupe' as tbl, count(*) as rows, min(received_at) as oldest
from telegram_webhook_dedupe
union all
select 'rate_limit_hits', count(*), min(window_start)
from rate_limit_hits;
