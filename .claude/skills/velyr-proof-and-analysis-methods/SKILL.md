---
name: velyr-proof-and-analysis-methods
description: "The analysis discipline that turns a hunch into an accepted result in the Velyr repo — eight proof methods, each as a recipe with a worked example from this project's history. Load when: investigating a root cause ('is this really the cause?'), auditing claims vs code (truth-pass), designing an experiment or measurement, evaluating bounce/impact math, reviewing a risky or concurrent-write change, verifying twin parity, or before asserting 'this works' / 'prove it' / 'how do we know'. NOT for the concrete fix-quality campaign (velyr-fix-quality-campaign), test mechanics (velyr-validation-and-qa), or the incident chronicle itself (velyr-failure-archaeology)."
---

# Velyr Proof & Analysis Methods

The evidence bar in this repo: **one mechanism must explain all observations (including the negatives), predictions come before measurements, and every claim traces to code at file:line or a command you actually ran.** These eight methods are how that bar has been met historically. Each is a recipe + a worked example from this repo.

Jargon used below: **twin** = a format-locked duplicate declaration across the Node (Vercel `api/`) and Deno (Supabase edge fn) runtimes, which cannot share modules. **pp** = percentage points. **CAS** = compare-and-swap (atomic conditional update).

---

## 1. The claims↔code truth-pass

Use when marketing copy, docs, or a report asserts product behavior.

**Recipe:**
1. Enumerate the claims from all five marketing surfaces (`src/Home.jsx`, `index.html` meta/JSON-LD, `public/llms.txt`, `src/data/faqs.js`, `scripts/prerender.mjs` ROUTES — procedure home: velyr-docs-and-writing).
2. For each claim, locate the *enforcing mechanism* in code, or prove none exists.
3. Produce a verdict table: `claim | surface | code says (file:line) | verdict | fix`.
4. **A claim without an enforcing mechanism is either a copy bug or a feature request — never leave it ambiguous.** Fix the copy or file the feature; don't ship the ambiguity.

**Worked example (2026-07-10 landing-truth pass, commits `7880e5f` + `6706ab3`):** five confirmed contradictions, including: copy implied guardrail violations are "rejected before they reach you", but brand guardrails are **prompt-only** — `guardrailsContext` is assembled at `supabase/functions/agent-run/index.ts:3552` and interpolated into the Pass-2 prompt at `:3636`; no post-parse enforcement exists. Copy also implied rollback "within 48 hours", but the rollback check is a **Wednesday 10:00 UTC cron** (`vercel.json`) over deploy±48h *measurement windows* with a 10-day lookback (`ROLLBACK_LOOKBACK_MS`, `api/agent/run.js:1106`). Both stated cadences won; the copy changed.

---

## 2. One-mechanism root-cause discipline

Use for any investigation. The standard: **a root cause must derive every observation, including why the failure did NOT appear elsewhere.** A candidate fix from which you cannot derive the full symptom set is a red herring — even if it's a genuine improvement.

**Recipe:**
1. Reproduce, or collect the full observation set (positives and negatives).
2. List candidate mechanisms.
3. For each candidate, derive its predictions: what else *must* be true if this is the cause?
4. Run the cheapest discriminating experiment that separates the candidates.
5. Only then fix. If you applied an improvement mid-investigation, explicitly log it as "improvement, not the cause".

**Worked example (black-screenshot saga, resolved 2026-06-06, commit `3b7654b`):** agent screenshots were solid black. Four plausible fixes were applied (`cache=false`, dropping `response_type=json`, removing `wait_for_selector`, `networkidle→load`) — all real improvements, **none the cause**; the images stayed black. The real mechanism: the capture shot a `fileToRoutePath`-derived URL (`/home`) that is not a route on a client-rendered SPA, so the empty `#0a0a0a` shell rendered — which derives *all* observations: black image, no error anywhere, and root `/` working fine. Fix: always shoot the site root. The four red herrings are fenced in velyr-failure-archaeology; do not re-tune them when chasing image problems.

---

## 3. Matched-window measurement math

Use when touching or interpreting any bounce/impact number. All code anchors verified 2026-07-11.

- **Bounce rate as implemented:** sessions are grouped by `properties.$session_id` from PostHog `$pageview` rows; bounce = single-pageview sessions / total sessions, rounded to whole % (`bounceFromSessions`, `api/_lib/route-scope.js:156-165`).
- **Matched windows:** before = deploy−2d → deploy instant, after = deploy instant → deploy+2d (`api/agent/run.js:1205-1207`). The split is the exact deploy **instant**, not the calendar day — date-granularity once leaked pre-change hours into the "after" bucket and biased the delta (comment at `run.js:1200-1204`). Windows must be the same length on both sides or weekday/seasonality confounds masquerade as effects.
- **pp vs % discipline:** deltas are stated in percentage points (`bounceDelta = bounceAfter - bounceBefore`, fire when `>= ROLLBACK_BOUNCE_PP_THRESHOLD` = 15pp, `run.js:1087,1306`; twin statement in `receipt-builder.ts:48`). Never say "15%" for a 15pp move.
- **Floors:** `MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION` = 100 per side (`run.js:1228`, env-overridable). Below the floor the rate is `null` and the run records `insufficient_data` (`run.js:1272-1297`) — **never guess, never extrapolate**. Rationale in-code: at 11 sessions one bouncer moves the rate 9pp.
- **Route scoping:** `resolveAffectedScope` (`api/_lib/route-scope.js:98-120`) — if **any** touched file is site-wide-class (layouts, sections, snippets, components, unmappable), the whole comparison is site-wide; scoped only when *every* file confidently maps to a route, max 5 matchers. A thin scoped sample falls back to site-wide. Ambiguity must resolve broad: measuring the wrong narrow population is worse than measuring broad (module contract, `route-scope.js:8-12`).
- **Never render `agent_runs.bounce_rate_before/after` as a pair** — they come from mixed windows. The matched-window pair lives in `impact_metrics` (written at `run.js:1322-1325`); the dashboard/public-timeline switch to it was commit `c30d230`.
- **Win bar:** DNA promotion to `measured_win` requires improvement ≥ `MEASURED_WIN_MIN_PP` = 5pp on a matched-window metric (`run.js:216,252`); anything less that stays deployed is `survived`.

---

## 4. Twin-parity verification

Use whenever editing logic that exists on both runtimes.

**Recipe:**
1. Find the twin: `grep -rni "keep in sync" api supabase scripts src` (15 hits as of 2026-07-11; the authoritative inventory lives in velyr-architecture-contract).
2. Edit **both** declarations in the same change.
3. Prove parity: put the two declarations side by side and diff them semantically; for pure functions, run both against the same fixture when feasible (Node side is directly runnable; edge side logic can often be pasted into a scratch `.mjs`).
4. Remember: the edge side is **inert until `supabase functions deploy`** — code parity in the repo is not behavior parity in prod.

**Worked example:** `refreshShopifyToken` classifies refresh-grant rejections as `authFailure = res.status === 400 || res.status === 401 → needs_reconsent`, everything else transient — byte-equivalent logic at `api/_lib/shopify-token-refresh.js:81-84` and `supabase/functions/agent-run/index.ts:605-606`, with deliberately different signatures (Node takes `supabase` as a parameter). The original bug: only 400 was classified, so a dead token returning 401 retried forever instead of prompting reconsent.

---

## 5. Concurrency and CAS reasoning

Use for any at-least-once surface: webhooks, crons, double-taps, retried sends.

**Recipe:** enumerate the interleavings (two identical messages; message + cron; crash between step k and k+1), then check each against the house patterns:

| Pattern | Implementation | Anchor |
|---|---|---|
| CAS status flip | `update(...).eq('id', id).eq('status', expectedStatus).select('id')` → zero rows = lost the race = `noop` | `api/_lib/run-reconcile.js:27-115` |
| Claim-first, send-second | insert into `email_log` (unique triple) → `23505` = `already_sent`; **release the claim on send failure** so tomorrow retries | `api/_lib/email.js:338-364` |
| Advisory lock + TTL | `agent_run_locks` RPC, atomic check+set, TTL default 15 min, fails **open** (better to run than block forever) | edge `index.ts` `acquireRunLock` (~:5555) |
| Optimistic concurrency | re-query `checksumMd5` at YES-time; mismatch or null analysis-time checksum → `shopify_concurrency_abort`, nothing overwritten; created-file collisions also abort | `api/_lib/shopify-approval.js:79-128` |
| Dedupe ledger | `telegram_webhook_dedupe` on `update_id`; GC'd daily | migration `20260520_agent_run_locks_dedupe_binding.sql` |

**Worked example (the M2 double-fire analysis):** two concurrent YES messages on a `shopify_awaiting_approval` run can both enter `applyShopifyDirectWrite` — the clean fix (an interim `shopify_applying` CAS status) needs a manual `agent_runs_status_check` migration and is **PARKED** (verified 2026-07-11: no `shopify_applying`/`shopify_writing` exists anywhere in code or migrations). The residual risk was *derived, then accepted as bounded*: the theme write is idempotent + checksum-guarded (no corruption possible); the loser merely flips an already-deployed run to a wrong status. That is the method — enumerate the interleavings, bound the worst case, and either fix or document the accepted bound. Note the deliberate asymmetry: forward writes use `strictNullChecksum: true`, rollback stays lenient (`shopify-approval.js:94` vs `:239`) — restoring known-good content is worth more risk than clobbering unknown content.

---

## 6. Adversarial refutation

Big changes get review passes whose *job is to break the claims* before ship.

**Recipe:**
1. Write down the change's claims as falsifiable statements ("a decline stamps X, never Y", "GC can never delete a referenced screenshot").
2. Hand a reviewer (independent agent or fresh session) the **claims, not the diff narrative** — the narrative smuggles in the author's assumptions.
3. The reviewer must return, per claim, either a concrete failure scenario (inputs/state → wrong outcome) or a verified pass with evidence.
4. Failure scenarios get fixed or explicitly accepted-as-bounded (method 5); "looks fine" is not an outcome.

**Worked example (2026-07-07 post-audit review, fixes in `d796ede` + `ecd876b`):** independent review passes over the just-shipped audit wave (4 agents, per project notes 2026-07-11) found real bugs the authors missed: the screenshot GC could delete still-referenced screenshots (unpaginated, error-blind reference query), the site-network GC queried a non-existent `created_at` column and erred daily, the C2 dashboard rollback buttons were inverted, and the C11 owner-question loop was non-functional **end-to-end** despite every component "working". The lesson baked into the method: review feedback *loops* end-to-end, not components in isolation.

---

## 7. Hypothesis-predicts-numbers

Use before running any diagnostic and before shipping any experiment.

**Recipe:**
1. State the hypothesis and the mechanism behind it.
2. **Before** running anything, write down: the exact query/command you will run (use the pack in velyr-diagnostics-and-tooling), the value/shape you expect if the hypothesis is true, and what you expect if it is false.
3. Run it. A result that fits neither prediction means your model of the system is wrong — stop and rebuild the model; do not rationalize post hoc.
4. A hypothesis compatible with any outcome is not a hypothesis. Rewrite it until it can lose.

This is the evidence bar the fix-quality campaign enforces for prompt/ranker changes (see velyr-fix-quality-campaign): predicted movement in named metrics (skip rate, `measured_win` share, `not_visible` rate) stated before deploy, measured after N weeks against `impact_metrics`/`agent_business_dna` — success is never judged by eye.

---

## 8. Live-API ground-truthing

Never reason about an external system from an adjacent system's conventions. For provider behavior, **one real call against a throwaway/dev resource beats any document.**

**Worked examples:**
- **OpenRouter slugs use a dot** (`anthropic/claude-sonnet-4.6`), not the Anthropic-native dash ID — a bump was once mis-set by reasoning from the native convention. Ground truth: `GET https://openrouter.ai/api/v1/models` (public). The convention is now pinned in-code at `index.ts:77-81`.
- **Pricing verified live, not from docs:** the edge fn comment records "verified against live GET /models 2026-07-05 for claude-sonnet-4.6: $3/$15 per M" (`index.ts:84`); the constants are env-tunable (`LLM_INPUT_EUR_PER_M`/`LLM_OUTPUT_EUR_PER_M`, defaults 3.0/15.0, `index.ts:89-92`) and must be re-checked on any model switch.
- **`themeDuplicate` is async** — discovered on a dev store, not in Shopify's docs: a fresh duplicate stays `processing: true` and writes/deletes fail until `waitForThemeReady` (commit `086e3bb`; harness `scripts/shopify-dv-verify.mjs`). The C3 preview flag stayed OFF until the dev-store harness passed.

**Recipe:** identify the exact API/behavior assumption → find or create a zero-risk probe (public endpoint, dev store, dry-run flag) → run it → record the date + result next to the code that depends on it (OPERATOR runs probes that need credentials or mutate anything).

---

## When NOT to use this skill

- You want the **concrete, decision-gated plan** for improving fix win-rate → `velyr-fix-quality-campaign` (it applies methods 3 and 7).
- You need **test mechanics** — suites, assertion patterns, the verification ladder → `velyr-validation-and-qa`.
- You want the **history** of a specific incident these examples reference → `velyr-failure-archaeology`.
- Something is broken **right now** and you need triage order → `velyr-debugging-playbook`.

## Provenance and maintenance

All file:line anchors verified 2026-07-11; anchor on the named functions/constants if lines drift.

- Truth-pass anchors: `git log -1 7880e5f 6706ab3` · guardrails: `grep -n "guardrailsContext" supabase/functions/agent-run/index.ts`
- Screenshot saga: `git log -1 3b7654b`
- Measurement constants: `grep -n "MEASURED_WIN_MIN_PP\|ROLLBACK_BOUNCE_PP_THRESHOLD\|MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION\|ROLLBACK_LOOKBACK_MS" api/agent/run.js` · scoping rules: `api/_lib/route-scope.js` header comment · pure tests: `node --test "api/_lib/route-scope.test.mjs"`
- Twin list: `grep -rni "keep in sync" api supabase scripts src --include="*.js" --include="*.ts" --include="*.mjs"`
- Token classification twins: `grep -n "authFailure" api/_lib/shopify-token-refresh.js supabase/functions/agent-run/index.ts`
- CAS/claim patterns: `grep -n "claimed" api/_lib/run-reconcile.js` · `grep -n "23505" api/_lib/email.js` · `grep -n "strictNullChecksum" api/_lib/shopify-approval.js`
- M2 still parked: `grep -rn "shopify_applying\|shopify_writing" api supabase` (empty = still parked)
- Adversarial-review fixes: `git log -1 d796ede ecd876b`
- Model/pricing pins: `sed -n '77,92p' supabase/functions/agent-run/index.ts`
- Volatile: the "4 independent review agents" count and the OpenRouter-slug incident narrative are project notes (2026-07-11); the code comments and commits they explain are in-repo.
