---
name: velyr-research-frontier
description: "Open research problems where Velyr could advance the state of the art, framed around one north star: an autonomous CRO agent that PROVABLY wins. Load when asked 'what should we work on next', doing long-horizon planning or differentiation strategy, exploring capabilities beyond the current pipeline ('can the agent learn?', 'could it verify its own fixes?', 'multi-week strategy?'), or evaluating a research-flavored idea. Every item is OPEN/CANDIDATE with a falsifiable milestone — nothing here is built. NOT for current-quarter fix-quality work (velyr-fix-quality-campaign) or live problems (velyr-debugging-playbook)."
---

# Velyr Research Frontier

**North star:** an autonomous CRO agent that **provably wins** — weekly fixes whose positive
impact is demonstrated by measurement, at a rate that can be stated with statistical honesty
and defended to a skeptic. Velyr's moat is not the LLM (commodity) but the **closed loop
around it**: honest measurement (`impact_metrics`, matched windows, floors), an outcome
ledger (`agent_business_dna`), cross-tenant priors (Global Win Library), and a discipline of
never faking certainty (`insufficient_data`, honest skips).

Every item below is labeled **OPEN** or **CANDIDATE**. None is built. None is a commitment.
Anything that becomes work routes through `velyr-fix-quality-campaign` (baseline first) and
`velyr-change-control` (staged, operator-deployed). The evidence bar for claiming a result is
`velyr-proof-and-analysis-methods` — in particular *hypothesis-predicts-numbers*: write the
milestone query before writing code.

**Terms used below** (one-line versions; details in `velyr-agent-pipeline-reference`):
- **DNA outcome** — per-fix ledger row in `agent_business_dna`; `pending` resolves after 7 days
  to `measured_win` (matched-window bounce improved ≥5pp — `MEASURED_WIN_MIN_PP`,
  `api/agent/run.js:216`), `survived` (live, no measured improvement), or `rollback`.
- **Matched window** — deploy-instant ±2d before/after comparison written to `impact_metrics`
  (`metric_type` = `site_wide_bounce_rate` | `route_scoped_bounce_rate` | `goal_conversion_rate`).
- **Floor** — `MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION` (default 100/side, `api/agent/run.js:1228`);
  below it the outcome is `insufficient_data`, never a guess (`run.js:1277-1297`).

Line anchors below are **as of 2026-07-11**; anchor on function/constant names when they drift.

---

## Item 1 — The provable-win-rate loop (the core)  · OPEN

**Problem.** Turn "we shipped fixes and some seemed good" into "over the trailing period, the
agent's fixes won at X% with a defensible interval, per fix type." No one can currently state
Velyr's win rate with statistical standing — the sample is tiny and no surface aggregates it.

**Why current SOTA fails** *(assessment as of the 2026-01 knowledge cutoff)*: agentic
coding tools (PR bots, Devin/Copilot-Workspace-class) stop at "PR merged, CI green" — they do
not measure post-deploy behavioral impact at all. Experimentation/CRO platforms (Optimizely/
VWO-class) measure rigorously but ship nothing autonomously into the customer's codebase.
Nobody closes code-authorship → deploy → causal measurement → learning in one loop.

**Velyr's asset (verified).** The loop's plumbing already exists end to end:
`promotePendingDNA` (`run.js:223`) resolves outcomes against `impact_metrics`
(`run.js:234-236`); the Global Win Library aggregates per-`fix_type` outcomes cross-tenant
(`supabase/functions/agent-run/index.ts:3106-3142`); Pass 2 already emits a **prediction**
— `expected_metric: { metric, direction, magnitude_pp, caveat }` (`index.ts:3453`) — so the
raw material for a win-rate *and* a forecast-vs-actual record accrues on every run.

**First three steps in this repo:**
1. Write the baseline report query (read-only): resolved DNA outcomes by `outcome` ×
   `fix_type` over trailing 6 months, joined to `impact_metrics` deltas — start from the
   diagnostics pack (`velyr-diagnostics-and-tooling`, DNA + impact queries) and save the
   result as the campaign baseline artifact.
2. Add a "win record" section to the weekly summary (`handleWeeklySummary`, `api/agent/run.js`)
   that states n, wins, and *explicitly refuses* a rate below a minimum n (honest-fail voice).
3. Start persisting forecast-vs-actual: `expected_metric.magnitude_pp` already lands in
   `analysis_result`; add a read-only calibration query (predicted pp vs realized
   `impact_metrics` delta per run) — no schema change needed.

**You have a result when…** you can produce, from `agent_business_dna` + `impact_metrics`
alone, a trailing win-rate over **n ≥ 30 resolved outcomes** with a binomial 95% CI whose
**lower bound ≥ 10%** measured wins. Falsified if, at n ≥ 30, the CI's lower bound sits at 0
— then the agent demonstrably does not win yet and the campaign menu (not this frontier)
is the work.

---

## Item 2 — Low-traffic causal inference  · OPEN

**Problem.** Most Velyr customers are small; many runs die at the 100-sessions/side floor and
resolve `insufficient_data`. Get *honest* effect estimates below the floor — without ever
faking certainty. The floor discipline is a feature; the waste of below-floor data is not.

**Why current SOTA fails** *(knowledge-cutoff assessment)*: classical A/B methodology simply
answers "underpowered"; sequential tests (mSPRT etc.) and Bayesian shrinkage exist in the
literature but experimentation products apply them to *randomized* traffic splits — Velyr has
no randomization (before/after only), and off-the-shelf methods don't address matched-window
observational comparisons at n<100 with weekday confounds.

**Velyr's asset (verified).** Clean raw material and an honest null: per-session pageview rows
already fetched for both windows (`handleRollbackCheck`), pure aggregation seam
(`api/_lib/route-scope.js` — contract at lines 1-17: ambiguity MUST resolve site-wide),
`insufficient_data` as a first-class recorded outcome (`run.js:1277-1297`), and multiple
weeks of history per site to pool weekday-matched baselines from.

**First three steps in this repo:**
1. Quantify the waste (read-only): fraction of rollback-check runs landing
   `insufficient_data` (query `agent_learnings` by outcome) — if it's small, park this item.
2. Prototype offline: a pure function next to `route-scope.js` (same pure-core style,
   `velyr-validation-and-qa` pattern) computing a shrunk effect estimate + credible interval
   from the two session sets, unit-tested on synthetic fixtures with known effects.
3. Backtest against history: for past runs where BOTH the floor-passing estimate and the
   method's estimate are computable, compare signs (read-only script).

**You have a result when…** the method produces an estimate (with interval) for **≥50% of
currently-insufficient runs**, AND on a backtest of **≥20 runs** where the floored estimate
exists its sign agrees **≥80%** of the time. Hard constraint: `insufficient_data` remains the
reported outcome whenever the method's own interval spans zero — the discipline never bends.
Falsified if sign agreement ≈ coin-flip.

---

## Item 3 — Cross-tenant transfer without leakage  · CANDIDATE

**Problem.** Every customer's outcomes should make every other customer's agent smarter —
without any site's data crossing tenants. Today the transfer channel is deliberately crude.

**Why current SOTA fails** *(knowledge-cutoff assessment)*: federated/privacy-preserving
learning is studied for model weights and ad measurement, not for "which conversion-fix
archetypes win on which page classes"; agent products generally have no outcome ledger to
transfer from at all.

**Velyr's asset (verified).** A working, privacy-bounded prior already ships in every prompt:
`getGlobalWinLibrary` (`index.ts:3106-3142`) — counts only, `fix_type` × outcome, 365d,
excludes `fix_type='other'` and owner-rejected rows, **never counts `pending`**, requires
**n ≥ 2 per line** ("a single resolved outcome is an anecdote, not a prior"), caps at 10
lines. The invariant to preserve is architectural (see `velyr-architecture-contract`):
nothing site-identifying crosses tenants.

**First three steps in this repo:**
1. Check the prior is non-degenerate (read-only): run the Win Library aggregation as SQL —
   if fewer than 3 lines survive the n≥2 filter, the bottleneck is Item 1's sample, not
   richer features; park.
2. Design the feature axes on data that already exists: `fix_type` (in DNA),
   page class (derivable from `pages_fixed` via the route-scope classifier), device split
   (in `impact_metrics`-adjacent engagement data) — write the anonymization argument down
   BEFORE any code, and have it adversarially reviewed (`velyr-proof-and-analysis-methods`
   method 6).
3. Extend the aggregation behind a shadow flag: emit the enriched block to logs only (not
   the prompt) for N weeks and inspect for any leakage or degenerate cells.

**You have a result when…** the enriched prior changes Pass-1/Pass-2 choices (measurable:
selected `change_type` distribution shifts vs a counts-only control period) AND the
enriched-prior cohort's measured-win rate beats the counts-only baseline by **≥10pp over
≥20 resolved outcomes per arm**. Falsified if choices shift but outcomes don't improve.
Blocked-by: Item 1's n≥30 baseline (you cannot detect a 10pp lift without it).

---

## Item 4 — Closed-loop visual verification (pre-YES)  · CANDIDATE

**Problem.** Today the agent finds out a change never visually rendered **48 hours after
deploy** (post-hoc vision check). Move the check *before* the owner's YES: the agent verifies
its own change renders as claimed, on a preview, and says so in the approval message.

**Why current SOTA fails** *(knowledge-cutoff assessment)*: code agents validate with tests
and type checks; visual-regression tooling (Percy-class) exists but requires the *customer*
to have set it up. An agent that self-verifies rendering on an ephemeral preview and reports
"I looked at it, here's the diff" as part of an approval request is not standard practice.

**Velyr's asset (verified).** All three ingredients exist separately: CI preview resolution
per PR (`handlePreview`, `api/webhooks/telegram.js:744` — resolves the head-SHA deployment
via the GitHub Deployments API, `telegram.js:767`, and sends a before/after ScreenshotOne
pair); Shopify throwaway preview themes (`?preview_theme_id` flow, `telegram.js:803-882`,
flag-gated `AGENT_SHOPIFY_PREVIEW_THEMES`); and a vision-LLM verdict pass with a
write-once jsonb result (`visual_check`, `api/agent/run.js:903-1014`). Today they only run
on-demand (button tap) or post-hoc (daily cron).

**First three steps in this repo:**
1. Measure the miss rate (read-only): distribution of `visual_check.verdict` — how often is
   `not_visible` actually occurring? If ~never, this item is insurance, not leverage; park.
2. Spec the seam: the pre-YES check is the existing `handlePreview` capture + the existing
   visual-check prompt, chained; write the design note including budget (it must not delay
   the approval message — follow the item-3a precedent: start capture early, race a budget).
3. Prototype on the GitHub path only (previews are free there when the customer's host
   auto-deploys PRs), behind a new `AGENT_*` flag with the escape-hatch pattern
   (`velyr-config-and-flags` checklist).

**You have a result when…** over **10 consecutive deployed runs** with the flag on, every
approval message carries a render-verified statement (or an honest "could not verify"), and
the post-hoc 48h `not_visible` rate in that cohort is **0**. Falsified if pre-YES verification
passes changes that the 48h check still flags `not_visible`.

---

## Item 5 — Multi-week compounding strategy  · CANDIDATE

**Problem.** The agent currently picks one fix per week, independently. Sites need *arcs*:
fix the leak, then the step behind it, then measure the compound. Make the agent maintain a
persistent, re-ranked, per-site roadmap whose steps build on measured results.

**Why current SOTA fails** *(knowledge-cutoff assessment)*: planning agents exist, but
grounding a multi-week plan in *measured outcomes of its own previous steps* (not simulated
feedback) is rare; CRO agencies do this manually — it's exactly the labor Velyr sells against.

**Velyr's asset (verified).** The substrate exists: Pass 2 already returns a ranked `backlog`
(max 3, persisted in `analysis_result` on fix AND skip runs — `index.ts:3463-3467`, sanitized
`:3719-3723`, persisted `:4455/:4801/:5332`), the owner can pin one item (`focus_page_path`,
one-shot consume `:3679`), the owner can inject context (`question_for_owner` → `note`,
`:3462`), and per-fix measured deltas land in `impact_metrics`. What's missing is memory
*across* weeks: the backlog is regenerated each run, not maintained.

**First three steps in this repo:**
1. Measure backlog churn (read-only): across consecutive runs per subscription, how much of
   `analysis_result.backlog` recurs vs churns? High recurrence = the model already "has" a
   plan and only persistence is missing; high churn = the plan idea needs grounding first.
2. Design the ledger: a persisted roadmap (likely a new table — manual-migration discipline,
   `velyr-run-and-operate`) holding backlog items + status + measured delta of the fix that
   addressed them.
3. Feed last week's roadmap into Pass 2 as a sealed prompt block (same pattern as the
   RECENTLY-REJECTED block) so the model must either advance the arc or explicitly re-rank
   with a reason.

**You have a result when…** for at least one site, **3 consecutive deployed fixes** execute a
declared arc (each fix's `hypothesis` references the roadmap item), each with its own
matched-window measurement, and the arc's cumulative measured delta is stated. Falsified if
roadmap-following picks measurably underperform independent weekly picks over a quarter.

---

## Item 6 — Self-calibrating confidence  · CANDIDATE

**Problem.** Pass 2 emits `confidence` (`low|medium|high`), `confidence_reason`,
`blind_spots`, and a numeric `expected_metric.magnitude_pp` (`index.ts:3453-3456`) — but
nothing ever checks whether those self-assessments correlate with real outcomes. An agent
that knows when it doesn't know ships fewer bad fixes and skips better.

**Why current SOTA fails** *(knowledge-cutoff assessment)*: LLM verbalized-confidence
calibration is an active research area with generally poor out-of-the-box calibration;
almost no deployed agent closes the loop against *measured business outcomes* (as opposed to
benchmark correctness), because almost none has an outcome ledger.

**Velyr's asset (verified).** The predictions are already persisted per run
(`analysis_result`), and the realized outcomes land in `impact_metrics` + DNA independently
— a natural forecast-vs-actual dataset accruing at zero marginal cost.

**First three steps in this repo:**
1. Build the calibration table (read-only SQL): per deployed run — stated `confidence`,
   `expected_metric.magnitude_pp`, realized matched-window delta, DNA outcome.
2. Report reliability: win rate by confidence bucket; predicted vs realized pp scatter.
   (This is also Item 1 step 3 — do it once.)
3. If signal exists, feed it back cheaply first: a sealed prompt block stating the model's
   own historical calibration ("your 'high confidence' fixes won X/Y") — prompt-only, flag-
   gated, before any thresholding logic.

**You have a result when…** over **≥20 deployed runs** with measurable outcomes, either
predicted-vs-realized pp correlates (Spearman **≥ 0.4**) or a confidence-based ship/skip cut
would have improved the measured-win rate by **≥5pp at equal ship volume** (computed
retrospectively). Falsified if confidence buckets show indistinguishable win rates — then
stated confidence is noise and should be dropped from prompts and UI rather than displayed.

---

## Item 7 — Breadth with provable safety  · CANDIDATE

**Problem.** The fix pipeline edits React/JSX and Liquid with hard guarantees (Babel parse;
provable-only Liquid block validation). Extending to more frameworks (Vue SFC, Svelte) is
only worth doing at the same guarantee level — a build broken by the agent costs more trust
than ten fixes earn.

**Why current SOTA fails** *(knowledge-cutoff assessment)*: code agents generally rely on
"CI will catch it" — unacceptable here because the merge is owner-gated, not CI-gated, and
many customer repos have no CI. Validator-backed, provable-only pre-flight checks per
language are the uncommon part.

**Velyr's asset (verified).** The template exists twice: the Babel syntax check on the
JS/JSX path, and `liquid-block-validate.ts` (header contract, lines 1-18: **conservative,
provable-only** — flags only what is *certainly* an error, opts out where it cannot reason,
e.g. `{% liquid %}` tags). Note the current edge: frameworks outside
`['nextjs-app','nextjs-pages','vite-react','cra']` already run the *analysis* pipeline but
get manual-paste analytics setup rather than auto-PRs (`index.ts:2630-2638`; the in-code
TODO at `:2634` — Vue App Router entry-point detection — is about that snippet path).

**First three steps in this repo:**
1. Measure demand (read-only): count connections by `repo-mapper` framework classification
   (`site_structure_preview.framework` + run receipts) — if no Vue/Svelte customers exist,
   park; breadth without demand is vanity.
2. Write the validator FIRST (before any prompt work): a provable-only Vue SFC block/section
   parser in the `liquid-block-validate.ts` mold, node-tested like
   `scripts/test-liquid-blocks.mjs`.
3. Extend the Pass-2 edit-type constraint (the framework-aware guard from audit item A3)
   only after the validator is green.

**You have a result when…** a new framework has: a provable-only validator with a green test
suite, **≥5 deployed fixes**, and **0 agent-caused build breaks** (verify via owner reports +
`visual_check`/rollback records). Falsified by a single broken customer build — that
framework reverts to analysis-only until the validator gap is closed.

---

## How a frontier item becomes work

1. Pick ONE item; re-verify its "asset" anchors still hold (Provenance below).
2. Write the falsifiable milestone **first**, including the exact query/method that will
   measure it (`velyr-proof-and-analysis-methods`, hypothesis-predicts-numbers).
3. Run the read-only baseline (most items' step 1) — several items self-park on the data.
4. Ship the smallest step behind a flag via `velyr-change-control` (staged workflow;
   OPERATOR deploys; thresholds as named constants per `velyr-validation-and-qa`).
5. Measure over the stated horizon; promote, iterate, or retire — and record the outcome in
   `velyr-failure-archaeology` either way. A retired idea with a documented reason is a
   result, not a failure.

Ordering note: **Item 1 gates most others.** Items 3 and 6 are statistically meaningless
before Item 1's n≥30 baseline exists; Item 2 grows that sample; Items 4, 5, 7 are
independent of it but still start with a read-only demand/miss-rate check.

## When NOT to use this skill

- Improving the agent's fix quality **now**, with current infrastructure → `velyr-fix-quality-campaign` (run its Phase 0 before ANY frontier item).
- Understanding how the pipeline works → `velyr-agent-pipeline-reference`.
- Something is broken → `velyr-debugging-playbook`.
- The evidence bar / experiment method → `velyr-proof-and-analysis-methods`.
- Actually shipping anything from here → `velyr-change-control` (no exceptions).

## Provenance and maintenance

All line anchors as of 2026-07-11; re-verify before relying on them:

- DNA promotion + win bar: `grep -n "MEASURED_WIN_MIN_PP\|promotePendingDNA" api/agent/run.js`
- Floors + insufficient_data: `grep -n "MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION\|insufficient_data" api/agent/run.js`
- Global Win Library bounds: `grep -n "getGlobalWinLibrary\|anecdote, not a prior" supabase/functions/agent-run/index.ts`
- Pass-2 prediction/confidence/backlog fields: `grep -n "expected_metric\|confidence_reason\|backlog?:" supabase/functions/agent-run/index.ts`
- Focus-pin consume: `grep -n "clearFocusPage" supabase/functions/agent-run/index.ts`
- Preview surfaces: `grep -n "handlePreview\|preview_theme_id" api/webhooks/telegram.js`
- Visual check writer: `grep -n "visual_check" api/agent/run.js`
- Route-scope contract: `sed -n '1,17p' api/_lib/route-scope.js`
- Liquid validator contract: `sed -n '1,18p' supabase/functions/agent-run/liquid-block-validate.ts`
- Snippet framework gate + Vue TODO: `grep -n "SNIPPET_SUPPORTED\|App Router for Vue" supabase/functions/agent-run/index.ts`
- SOTA characterizations are the author's assessment as of the 2026-01 knowledge cutoff — re-assess before citing externally.
