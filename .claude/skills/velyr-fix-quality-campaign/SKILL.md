---
name: velyr-fix-quality-campaign
description: >
  The executable, decision-gated campaign for Velyr's hardest live problem:
  making the weekly agent fix measurably WIN more often. Load when asked to
  "improve the agent's fixes", "raise the win-rate", "why does the agent skip
  so much", "why are fixes shallow/timid", "make the agent smarter", "improve
  Pass 2 / the ranker / the prompts", or when planning ANY agent-quality work.
  Contains the baseline measurement protocol, the loss autopsy, a ranked
  solution menu with predict-then-measure obligations, and the fenced wrong
  paths. NOT for pipeline mechanics (velyr-agent-pipeline-reference), broken
  behavior (velyr-debugging-playbook), or long-horizon research
  (velyr-research-frontier).
---

# Velyr Fix-Quality Campaign

**Goal:** raise the rate at which the agent's weekly fixes produce a *measured*
conversion improvement — never "the fixes look better". Success is a number
from a query, decided before the change ships.

**Non-negotiable frame:** every change this campaign produces ships through
**velyr-change-control** (staged workflow, operator deploys the edge function,
prompt changes are experiments). This skill never routes around approval,
migration, or deploy discipline.

**Prod-data convention:** all queries here are READ-ONLY, run one at a time via
`npx supabase db query "<sql>" --linked --output json`, and you announce before
running them. `Qn` references are the numbered queries in
`.claude/skills/velyr-diagnostics-and-tooling/queries/diagnostics.sql` — use
those verbatim instead of rewriting them.

## Definitions (one line each)

| Term | Meaning |
|---|---|
| Pass 2 | The fix-writing LLM call (`callAIForFix`, edge `index.ts`) — returns one primary edit (+ ≤2 `additional_edits`) or `{skip}` |
| Business DNA | `agent_business_dna` — one outcome row per approved fix: `pending` → `measured_win` \| `survived` \| `rollback` (legacy `success` reads as `survived`) |
| measured_win | Matched-window bounce improved ≥ `MEASURED_WIN_MIN_PP` = **5pp** at the 7-day promotion (`promotePendingDNA`, `api/agent/run.js:216,223` as of 2026-07-11) |
| survived | Still deployed at 7d with no measured improvement — deliberately weak signal (the old `success` label rewarded innocuous edits) |
| Global Win Library | Cross-tenant fix_type×outcome counts injected as prompt block [14] (`getGlobalWinLibrary`, edge `index.ts:3106`) — 365d window, excludes `fix_type='other'` and owner-rejected rows, needs ≥2 resolved outcomes per line, ≤10 lines, empty → block says "no cross-site outcome data yet" |
| Ranker fallback | Pass 1 degraded to heuristic scoring — `ranker_pass1_fallback` warn log (edge `index.ts:4418/4765/5261`), visible as `rankReason like 'heuristic score%'` in `agent_site_network.nodes` |
| Owner note | Telegram `note <reason>`: **both** note kinds carry `metric_type='manual'` — only `outcome` branches: a rejected run → `outcome='negative'` (never-do-again), a skipped run → `outcome='neutral'` = OWNER CONTEXT (`api/webhooks/telegram.js:909-919`). So filter on `outcome`, not `metric_type`, to separate the two. |

## 0. Objective and metrics

Primary metric — **resolved win-rate**:

```
win_rate = measured_win / (measured_win + survived + rollback)
```

over `agent_business_dna` with legacy `success` counted as `survived` (Q5 gives
the distribution; Q6 splits it per `fix_type`).

Secondary metrics (each has a query):

| Metric | Query | Healthy direction |
|---|---|---|
| Skip-rate composition | Q4 (30d skip breakdown incl. `find_mismatch`/`find_ambiguous`) vs Q3 (all statuses) | fewer `skipped_low_confidence`/`skipped_no_data` relative to deployed |
| Rejection rate + reasons | Q3 for `rejected`/`shopify_rejected` counts; §CAMPAIGN-SQL A for the owner's stated reasons | falling, and reasons should stop repeating |
| visual_check `not_visible` rate | Q11 | ~0 — a merged fix that never rendered is a deploy-pipeline problem, not a content problem (`api/agent/run.js:966,1017`) |
| `find_mismatch` incidence | Q4 rows `find_mismatch`/`find_ambiguous` | ~0 after the B4 self-heal retry; a rise = Pass 2 emitting non-verbatim `find` strings |
| Ranker-fallback rate | Q10 | 0 heuristic nodes; any fallback means Pass 1 signal starvation, fix upstream first |

**Sample-size rule (gates every phase):** with a handful of customers, N is
tiny. A win-rate over <20 resolved outcomes moves double-digit percentage
points on a single run — treat it as a direction, not a measurement, and say so
in every report. Never tune prompts against a metric that one run can flip.

## Phase 0 — Baseline (read-only)

1. Announce, then run **Q5, Q6, Q3, Q4, Q10, Q11, Q8** (one at a time).
2. Record the baseline table in your report: resolved DNA rows, win_rate,
   skip composition, fallback count, visual verdicts, goal-metric coverage.

**Decision gates — branch on what you actually see:**

| Observation | Meaning | Branch |
|---|---|---|
| Resolved DNA rows (Q5 minus `pending`) **< ~20** | Win-rate is statistically meaningless | → **Phase 0b** (grow the sample + instrumentation) before ANY prompt/ranker tuning |
| Skip statuses (Q4 total) **>** deployed-ish statuses (Q3: `deployed`+`shopify_deployed`+`waiting_approval`) | The bottleneck is upstream of fix quality — the agent rarely gets to write a fix | → Menu items **(a)** and **(d)**; also check Q10 (fallback) and per-skip-status causes (Q4 `sample_skip_reason`) |
| `rollback ≈ 0` AND `measured_win ≈ 0` with mostly `survived` | Fixes are too timid/innocuous — the exact pathology the `measured_win`/`survived` split was built to expose (comment at `api/agent/run.js:218-222`) | → Menu items **(b)** then **(c)**: push Pass 2 toward higher-leverage `change_type`s with prior evidence |
| `not_visible` > 0 in Q11 | Fixes merge but never render (missed redeploy, wrong file) | → This is a delivery bug, not fix quality: velyr-debugging-playbook first |
| Heuristic nodes > 0 in Q10 | Pass 1 ranked blind | → Fix the signal starvation (item (a)) before judging Pass-2 output |

## Phase 0b — Instrumentation & sample growth (when N is too small)

More resolved, *measured* outcomes per week beats any prompt tweak. Check each
lever (campaign SQL in §CAMPAIGN-SQL B):

1. **Analytics coverage:** every active subscription needs
   `agent_connections.posthog_host_filter` set — without it the run skips
   analytics AND the 48h check records `insufficient_data` and stops measuring
   forever (`api/agent/run.js:1165-1195`). Any active sub with a NULL filter is
   a lost measurement every week.
2. **Goal measurement adoption:** `agent_subscriptions.conversion_goal_event`
   (jsonb `{type: click_text|pageview_path, value}`, migration
   `20260707_conversion_goal_event.sql`) adds a `goal_conversion_rate`
   impact row per fix (Q8 shows coverage). Measurement-only — never a rollback
   trigger.
3. **Owner-question answer rate:** skips may carry `question_for_owner`; the
   answer arrives via `note` and becomes OWNER CONTEXT that counts toward the
   no-data gate. Unanswered questions = free signal left on the table — surface
   them to the operator for a nudge, don't build anything.
4. **Visual-check coverage:** deployed runs older than ~48h with
   `visual_check IS NULL` mean the daily cron lacks `OPENROUTER_API_KEY` on
   Vercel or shots are missing (it skips silently) — verify before trusting
   Q11.

Exit Phase 0b when the levers are exhausted; re-baseline after ≥2 more Mondays.

## Phase 1 — Loss autopsy (read-only)

Build a loss table: `run id | category | evidence | mechanism hypothesis`.
Categories and where the evidence lives:

| Category | Pull |
|---|---|
| **Rollbacks** (`rolled_back`/`shopify_rolled_back`, DNA `outcome='rollback'`) | `analysis_result->>'hypothesis'`, `->>'change_type'`, `->'expected_metric'` + Q7 for the run's impact rows + DNA `notes` |
| **Not rendered** (`visual_check->>'verdict'='not_visible'`) | Q11 + the run's `pages_fixed` — mechanism is usually "merchant merged but host never redeployed" vs "edit in a file the page doesn't render" |
| **Owner rejections** | §CAMPAIGN-SQL A — the `negative` learning's `summary` is the owner's own words; recurring themes are prompt-block [12] material that evidently isn't landing |
| **Skips with unanswered questions** | Q4 `sample_owner_question` + §CAMPAIGN-SQL B.3 |

**Gate (from velyr-proof-and-analysis-methods):** each loss gets ONE mechanism
that explains all its observations — including why the guards/screenshots/
prompt rules didn't catch it. "The model was dumb" is not a mechanism. Only
mechanisms you can state become Phase 2 inputs.

## Phase 2 — Solution menu (ranked for the tiny-N reality)

Every item carries a **theory obligation**: BEFORE building, write down (i) the
mechanism from Phase 1 it addresses, (ii) the predicted metric delta as a
number, (iii) the exact query that will show it, (iv) the measurement horizon.
A proposal without a predicted number is not ready to build.

**(a) Signal improvements — cheapest, first when data-starved.**
Mechanism class: Pass 1/2 reasoning from thin evidence.
Levers: host-filter coverage, `conversion_goal` + `conversion_goal_event`
adoption (the free-text goal becomes the OWNER CONVERSION GOAL trusted prompt
block; the event makes it measurable), focus-pin usage. All are data/config
work — no deploy risk. Predicted effect: `skipped_no_data` count in Q4 falls;
Q8 coverage rises.

**(b) DNA / Win-Library prior strengthening.**
Mechanism class: the model has no evidence about which fix types win, so it
plays safe (`survived` pile-up). The library needs ≥2 resolved outcomes per
fix_type line before it says anything (edge `index.ts:3128`) — at tiny N the
block is mostly silent. Levers: everything in Phase 0b (more resolved rows),
plus operator DNA verdicts (dashboard confirm/reject) since `user_verdict=
'rejected'` rows are excluded from the prior. Predicted effect: Q6 gains lines
with n≥2; block [14] stops reading "no cross-site outcome data yet".

**(c) Pass-2 prompt-block changes — only with mechanisms in hand.**
The prompt is 14 per-UUID-sealed untrusted blocks + trusted blocks OUTSIDE the
sentinels (guardrails, OWNER CONVERSION GOAL, OWNER PRIORITY, screenshot rule)
+ the JSON schema with `problem_title`, `change_type` (closed taxonomy),
`expected_metric.magnitude_pp`, honesty fields, `backlog`, and the skip shape
(edge `index.ts:3603-3662`, verified 2026-07-11). Rules for edits:
- One change per experiment; predict its queryable effect first.
- Never weaken the visual-claim rule, the honesty fields, or the injection
  defense (per-block UUID sentinels — see velyr-architecture-contract).
- Blocks [11] (already fixed), [12] (recently rejected), [13] (locate
  failures), [14] (win library) are feedback loops — prefer making their
  *content* richer over adding new instructions.
- Escape-hatch precedent: env-flag new behavior where feasible
  (`AGENT_FULLRUN_FANOUT=false` style), since the edge fn has no staging
  environment.

**(d) Ranker improvements.**
Mechanism class: the right component never reaches Pass 2. Check Q10 first —
a fallback means Pass 1 got no usable signal (fix (a) instead). Real levers:
the Pass-1 signal digest content and the focus-pin bias. Predicted effect:
fewer `skipped_low_confidence`, different `pages_fixed` distribution.

**(e) FENCED — already shipped, do not rebuild:** multi-file
`additional_edits` (≤2), App Router support, three screenshot viewports +
ranked-page group, B4 find-repair retry, device-split engagement, rage/dead
clicks. Verify in velyr-agent-pipeline-reference before proposing anything in
this space.

**(f) Verification tightening.**
Mechanism class: wins happen but aren't credited, or losses ship undetected.
Levers: visual-check coverage (0b.4), preview adoption (C4 GitHub previews /
C3 `AGENT_SHOPIFY_PREVIEW_THEMES`), and — a cheap, high-value analysis —
**calibration**: `analysis_result->'expected_metric'->>'magnitude_pp'` is the
model's own predicted effect size; compare it against realized Q7 improvements
per run. Systematic over-prediction is evidence for (c)-style honesty tuning
and costs nothing to measure.

## Fenced wrong paths (do not walk these)

| Path | Why it's fenced |
|---|---|
| Re-auditing the 2026-07-04/05/06/07/10 waves | All shipped + verified — see velyr-failure-archaeology entry 17 |
| "Per-connection batching" for the Monday run | Exists: `fanOutSingleRuns` (edge `index.ts:5645`), default on — this exact re-proposal already happened once |
| Reintroducing A/B testing (naming or surfaces) | Product decision: removed (item 8a); Velyr measures before/after, never A/B |
| Re-tuning screenshot params chasing image quality | Settled root cause: shoot only real routes (SPA `/home` incident) — the params are innocent |
| Casual model switches | `AGENT_LLM_MODEL` exists on BOTH surfaces; a switch is an experiment: predict-then-measure, re-check `LLM_INPUT/OUTPUT_EUR_PER_M`, verify the OpenRouter DOT slug live |
| Claiming guardrail enforcement | Guardrails are prompt-only (edge `index.ts:3552`); no copy or skill may say "rejected before they reach you" unless someone builds a real post-parse check |
| Restructuring the untrusted-data sentinels | They are the injection defense (per-block UUIDs, `index.ts:3593-3606`); owner-trusted blocks sit outside deliberately — understand before touching |

## Phase 3 — Validation & promotion protocol

1. **Ship** via velyr-change-control: staged workflow; edge-fn changes deploy
   via `npx supabase functions deploy agent-run` — OPERATOR (ask Florian).
2. **Clock:** DNA resolves at 7 days (`promotePendingDNA`); the rollback/impact
   check runs Wednesdays 10:00 UTC over deploy±2d windows with a 100-sessions/
   side floor. One experiment cycle ≈ **2–3 weeks**; don't peek-and-tune.
3. **Judge** only against the pre-registered prediction and minimum sample
   (state both in the shipping PR/commit message).
4. **Retire honestly:** if the predicted delta hasn't appeared after the stated
   horizon → revert (or flag off) and record the outcome as a new entry in
   velyr-failure-archaeology. A silent dead experiment is a doc bug.
5. **Propagate:** update velyr-agent-pipeline-reference (and this skill's
   constants) as part of the same change if the shipped code moved them.

## When NOT to use this skill

- Something is **broken** (stuck run, black screenshots, 401s) →
  velyr-debugging-playbook.
- You need to know **how the pipeline works** → velyr-agent-pipeline-reference.
- You want the **measurement math itself** (windows, floors, pp discipline) →
  velyr-proof-and-analysis-methods.
- Ideas **beyond** raising the current win-rate (calibration learning loops,
  low-traffic inference, pre-merge visual verification) →
  velyr-research-frontier.
- Shipping mechanics → velyr-change-control / velyr-run-and-operate.

## CAMPAIGN-SQL (queries the diagnostics pack doesn't carry)

```sql
-- A: Owner rejections with their stated reasons (loss-autopsy input).
-- agent_learnings insert shape verified at api/webhooks/telegram.js:910-919.
select r.id as run_id, r.status, r.created_at,
       r.analysis_result->>'problem_title' as title,
       r.analysis_result->>'change_type'   as change_type,
       l.summary as owner_reason
from agent_runs r
left join agent_learnings l
  on l.run_id = r.id and l.outcome = 'negative' and l.metric_type = 'manual'
where r.status in ('rejected','shopify_rejected')
order by r.created_at desc
limit 30;

-- B.1: Analytics coverage — active subs missing the PostHog host filter
-- (posthog_host_filter read at api/agent/run.js:1165; every NULL = unmeasured fixes).
select s.id, s.status, s.subscription_status, c.posthog_host_filter
from agent_subscriptions s
join agent_connections c on c.subscription_id = s.id
where s.status = 'active'
  and s.subscription_status in ('active','trialing')
  and (c.posthog_host_filter is null or c.posthog_host_filter = '');

-- B.2: Goal adoption — who has a goal text and/or a measurable goal event
-- (columns: migrations 20260706_conversion_goal.sql + 20260707_conversion_goal_event.sql).
select id,
       conversion_goal is not null       as has_goal_text,
       conversion_goal_event is not null as has_goal_event
from agent_subscriptions
where status = 'active';

-- B.3: Unanswered owner questions on skipped runs (free signal on the table).
select r.id, r.created_at, r.analysis_result->>'question_for_owner' as question
from agent_runs r
where r.status = 'skipped_low_confidence'
  and r.analysis_result->>'question_for_owner' is not null
  and not exists (
    select 1 from agent_learnings l
    where l.run_id = r.id and l.outcome = 'neutral' and l.metric_type = 'manual')
order by r.created_at desc;

-- F: Calibration — the model's predicted effect vs the realized measurement.
select r.id,
       (r.analysis_result->'expected_metric'->>'magnitude_pp')::numeric as predicted_pp,
       im.metric_type,
       round((im.value_before - im.value_after)::numeric, 1)            as realized_pp
from agent_runs r
join impact_metrics im on im.run_id = r.id
where im.metric_type in ('site_wide_bounce_rate','route_scoped_bounce_rate')
order by r.created_at desc
limit 30;
```

## Provenance and maintenance

All facts verified against the repo on **2026-07-11**. Re-verify before
relying on:

- Win bar + promotion: `grep -n "MEASURED_WIN_MIN_PP" api/agent/run.js` (5pp, line ~216)
- Win-Library bounds: `grep -n "r.n >= 2\|slice(0, 10)\|neq('fix_type', 'other')" supabase/functions/agent-run/index.ts` (~3106-3142)
- Prompt block structure + schema: `grep -n "VELYR_UNTRUSTED_DATA\|problem_title\|change_type" supabase/functions/agent-run/index.ts` (~3593-3662)
- Note semantics: `grep -n "isRejection" api/webhooks/telegram.js` (~909)
- Skip statuses list: diagnostics pack Q4 header ↔ migration `20260630_shopify_rollback_statuses.sql`
- Ranker fallback log: `grep -n "ranker_pass1_fallback" supabase/functions/agent-run/index.ts` (3 call sites)
- Fan-out (fence): `grep -n "fanOutSingleRuns" supabase/functions/agent-run/index.ts` (~5645)
- Diagnostics pack path/numbering: `ls .claude/skills/velyr-diagnostics-and-tooling/queries/`
- Base-table columns used in CAMPAIGN-SQL are code-derived (base tables predate
  the repo's migration record): re-grep the cited lines if a query errors on a
  missing column.
