---
name: velyr-failure-archaeology
description: The chronicle of every major Velyr investigation, dead end, rejected fix, and settled battle — symptom, root cause, evidence, status. Load BEFORE auditing the codebase, proposing improvements or refactors, investigating a bug that feels familiar, or re-litigating a design decision. Triggers include "why is it like this", "known issue", "has this happened before", "audit the agent", "improve the pipeline", "this looks like a bug", backlog grooming, or any urge to re-tune screenshots, batching, or DNA outcomes.
---

# Velyr Failure Archaeology

Chronicle of settled investigations. Purpose: **no one re-fights a settled battle**. Before proposing an improvement or diagnosing "a gap", check this file — several past sessions re-proposed already-shipped work from stale notes (see entry 7).

Status vocabulary: **RESOLVED (commit)** = fixed, verified; **PARKED** = deliberately deferred, with the unpark condition; **OPEN** = real, unfixed, unclaimed.

## Index

| # | Battle | Status |
|---|--------|--------|
| 1 | Black screenshots — SPA non-route, not ScreenshotOne params | RESOLVED (3b7654b) |
| 2 | `rolled_back` status was unreachable (rollback reconciled as fix) | RESOLVED (2026-07-06 wave) |
| 3 | PostHog Setup-PR npm import broke customer builds | RESOLVED (2026-06-30) |
| 4 | "Analytics vanished" — dual PostHog account/region | RESOLVED (2026-07-07) |
| 5 | Stuck run at dashboard "step 8" — zombie `running` row | RESOLVED (509d852) |
| 6 | Ranker starvation — silent heuristic fallback | RESOLVED (ba63599) |
| 7 | Monday-run wall-clock — fan-out already exists, don't re-propose | RESOLVED (b8ae78d) |
| 8 | DNA `success` rewarded innocuous edits | RESOLVED (0383897) |
| 9 | C11 owner-question dead end-to-end despite working parts | RESOLVED (d796ede) |
| 10 | GC hazards: reference-blind deletes, wrong column, NUL byte | RESOLVED (d796ede, ecd876b) |
| 11 | `themeDuplicate` is async — writes fail while `processing` | RESOLVED (086e3bb) |
| 12 | `write_themes` exemption denied → granted | RESOLVED (ticket 68049335) |
| 13 | OpenRouter slug: dot, not dash | RESOLVED (2026-06-23) |
| 14 | Local `npm run build` pings production IndexNow | OPEN by design — behavioral rule |
| 15 | "Cormorant Garant" font typo | RESOLVED (2026-07-18 — remainder fixed) |
| 16 | Blog "Discovered, currently not indexed" — thin internal linking | RESOLVED (2026-06-23) |
| 17 | Audit waves 2026-07-04 → 2026-07-10 — do not re-audit | RESOLVED |
| 18 | Parked list (schema split, OAuth race, …) — M2-B/M5 double-fire RESOLVED (e4f1f55) | PARKED (each with unpark condition) |
| 19 | Trial-abuse ledger — why it exists, what must never touch it | RESOLVED (4c14998) |

---

## 1. The black-screenshot saga

- **Symptom:** every agent "before" screenshot solid black (`#0a0a0a`), no error anywhere. Multi-day investigation.
- **Root cause (ONE):** `captureScreenshot` shot a URL derived from `file_to_edit` via `fileToRoutePath`, which mapped `src/pages/Home.jsx` → `/home`. On a client-rendered Vite SPA only `/` is a real route — `/home` loaded the empty dark shell. The camera was fine; the URL was wrong.
- **Fix:** screenshot `conn.website_url` (site root) directly. A second page group (2026-07-08) may shoot a ranked component's page, but **only** when the route is PostHog-real (`topPages` views > 0) — never a derived guess alone.
- **Evidence:** commit 3b7654b (2026-06-06) "screenshot the site root, not a fileToRoutePath-derived route that 404s on SPAs". Final config twins: `api/_lib/screenshot.js:28` ↔ `supabase/functions/agent-run/index.ts:2755` — `wait_until: 'load'`, `delay: '8'`, `cache: false`, no `response_type`, no `wait_for_selector`.
- **Fenced red herrings** (all were real improvements, NONE was the cause — do not re-tune these chasing image bugs): `cache=true`→`false`; removing `response_type=json` (stale CDN `cache_url`); removing `wait_for_selector '#root > *'` (false-timed-out in their headless); `networkidle0/2`→`load` (PostHog/font sockets never settle).
- **Hard dependency:** a **PUBLIC** Supabase Storage bucket named `screenshots` must exist, or every upload silently nulls the image.
- **Status: RESOLVED.**

## 2. `rolled_back` was unreachable (A1, the biggest 2026-07-06 finding)

- **Symptom:** no run ever reached status `rolled_back`, even after approved rollbacks. The status existed in the CHECK and the dashboard styling — dead.
- **Root cause:** the Telegram/GitHub reconcile treated an approved rollback PR like a fix PR (→ `deployed`). Rollback identity was never checked.
- **Fix:** `api/_lib/run-reconcile.js` branches on `run.rollback_reason === 'metrics_dropped'` (`run-reconcile.js:26` approve → `rolled_back`; `:84` reject → back to `deployed` with `rollback_reason: 'rollback_declined'`). Unified DNA lifecycle: `pending` written at approval, resolved to `rollback` at rollback-approval, promoted at 7d by `promotePendingDNA`; the 48h check itself no longer writes DNA. Tested in `api/_lib/run-reconcile.test.mjs`.
- **Lesson:** a status that exists in migrations and UI can still be unreachable — verify lifecycles end-to-end, not per-artifact.
- **Status: RESOLVED** (2026-07-06 wave, branch `audit-fixes-2026-07`, merged to main).

## 3. PostHog Setup-PR npm import broke customer builds

- **Symptom:** customers who approved the analytics Setup-PR got broken deploys after auto-merge.
- **Root cause:** the old snippet injected `import posthog from 'posthog-js'`. On any repo with a committed lockfile the dependency machinery injected the import **without** a resolvable package → Rollup/Webpack build failure. The edge function does GitHub-API file writes only — **it can never run a package manager**, so a consistent lockfile is impossible by construction.
- **Fix (2026-06-30):** script-tag CDN loader only. `buildPostHogLoaderJS` (`supabase/functions/agent-run/index.ts:1855`) + per-framework `resolveSnippetTarget` (`index.ts:1870`; modes: HTML `<head>`, `next/script` client component for App Router, `pages/_document` for Pages Router). Every manual-paste fallback also emits the `<script>` loader.
- **Rule:** the agent must NEVER emit an npm import it can't also install. Same class of constraint as: the edge fn cannot fix lockfiles, run codegen, or execute customer build steps.
- **Status: RESOLVED.**

## 4. Dual PostHog account / region confusion

- **Symptom:** analytics "vanished" / queries empty while the site clearly had traffic.
- **Root cause:** TWO PostHog accounts existed — production is **US cloud, project 412701** (us.posthog.com); an EU-cloud "Default project" (171704) was a dead duplicate that looked plausible in the UI. (UNVERIFIED in-repo — project notes, 2026-07-07; the EU duplicate was deleted then.)
- **Rule:** if analytics disappear, check the **instance/region and project id first**, before touching query code. Reads are also skipped by design when `agent_connections.posthog_host_filter` is null — that's a config gap, not a bug.
- **Status: RESOLVED** (duplicate deleted 2026-07-07).

## 5. Stuck run at dashboard "step 8" (2026-07-09 incident)

- **Symptom:** manual run frozen at dashboard step 8 "Taking before screenshot"; "Run now" bricked afterward.
- **Root causes (two):** (a) UI drift — the edge fn writes no screenshot checkpoint; step 8 maps from `finding_biggest_issue`, i.e. the run was actually stuck in **LLM Pass 2**. (b) The isolate was hard-killed (wall-clock/CPU/OOM), leaving a `running` row that the in-flight guard treated as live, blocking `trigger_run` until the Monday sweep — with the 24h cooldown already consumed.
- **Diagnosis tracers that worked:** `agent_llm_usage.updated_at` (ranker recorded, no Pass-2 usage ⇒ died inside Pass 2); no `failed` status ⇒ the catch never ran ⇒ hard kill, not an exception; `npx supabase functions list` (updated_at = epoch ms) rules out a mid-run redeploy.
- **Fix:** commit 509d852 — `cleanupStaleRuns` now also runs in the daily Vercel `enforce_subscriptions` cron and as a `trigger_run` pre-check. Twins: `api/agent/run.js:330` ↔ `supabase/functions/agent-run/index.ts:5525`; threshold `STALE_RUN_THRESHOLD_MS` default 60 min in both.
- **Status: RESOLVED** (structural). Live triage recipe → velyr-debugging-playbook.

## 6. Ranker starvation — silent heuristic fallback

- **Symptom:** Pass-1 LLM ranking silently degraded to the heuristic fallback on exactly the larger sites where ranking matters.
- **Root cause:** `MAX_TOKENS_RANKER` default 600 — the ranked/skipped/unsure JSON for a ~50-node graph overflowed 600 output tokens (verified in commit message ba63599). Also: Pass 1 previously saw no conversion evidence.
- **Fix (ba63599, 2026-07-05):** token cap 600→2000; new `buildRankerSignalContext` feeds Pass 1 the same conversion evidence Pass 2 gets, on all three pipeline paths; loud `ranker_pass1_fallback` structured log on every fallback (`index.ts:4418`, `:4765`, `:5261`).
- **Detection today:** fallback runs are queryable — `agent_site_network.nodes` (jsonb) items carry `rankReason`; heuristic runs read `'heuristic score…'` (`index.ts:4253` writes it). The sparse-graph gate is separate and deliberate: graphs with fewer than `AGENT_MIN_GRAPH_NODES` (default 3, `component-ranker.ts:55`) always skip LLM ranking. (Until 2026-07-15 that meant `plain-html` sites never produced fixes; the W4 sparse-shell exception now lets plain-html graphs through WITHOUT LLM ranking when `AGENT_HTML_EDIT` + `AGENT_SPARSE_SHELL_FIX` are on, feeding the W3 editable-shell path. All other frameworks still skip below the gate.)
- **Status: RESOLVED.**

## 7. Monday-run wall-clock → fan-out (DO NOT RE-PROPOSE BATCHING)

- **History:** the full Monday run once processed all subscriptions serially inside one edge isolate; screenshot capture sat serially on the same path (the original WallClockTimeout culprit).
- **Fixes:** item 3a (2026-07-05) moved screenshots to budgeted pre-Pass-1 parallel capture (`AGENT_FIX_SCREENSHOT_BUDGET_MS`, default 20s, miss ⇒ Pass 2 runs without images). B3 (b8ae78d) added `fanOutSingleRuns` (`index.ts:5645`): one `{intent:'single_run', subscriptionId}` self-invocation per eligible subscription, each with its own isolate and wall-clock; `AGENT_FULLRUN_FANOUT` defaults **on** (`index.ts:5712`); per-subscription advisory lock + spend cap make duplicate dispatch idempotent; inline escape hatch `AGENT_FULLRUN_FANOUT=false`.
- **The settled-battle warning:** on 2026-07-08 a session re-proposed "per-connection batching" from stale notes — it was already built. **Check `handleFullRun` before proposing any scaling work on the weekly run.**
- **Status: RESOLVED.**

## 8. DNA `success` split into `measured_win` vs `survived`

- **Symptom:** the Business DNA loop rewarded changes merely for not being rolled back — innocuous edits accumulated as "successes" and biased future prompts.
- **Fix (0383897, 2026-07-05):** 7-day promotion resolves `pending` → `measured_win` (matched-window bounce improved ≥ `MEASURED_WIN_MIN_PP`, 5pp) or `survived` (alive, no measured improvement — weak signal only). Legacy `success` rows normalize to `survived` in **every** reader; never write `success` again.
- **Status: RESOLVED.**

## 9. C11 owner-question: parts worked, loop didn't

- **Symptom:** the "agent asks one sharp question when stuck" feature shipped, but no answer ever reached a future prompt.
- **Root cause (three independent breaks):** question solicited in the wrong response shape; the Telegram `note` command couldn't attach to `skipped_low_confidence` runs; an answer that did land was stored with `outcome:'negative'` — i.e. as an anti-pattern.
- **Fix (d796ede):** skip-shape solicits `question_for_owner`; `note` attaches to skipped runs; answers stored `outcome:'neutral'` + `metric_type:'manual'` → rendered as an OWNER CONTEXT prompt block and counted by the no-data gate.
- **Lesson (load-bearing):** **verify feedback loops end-to-end** — a loop of three individually-correct components can still be globally dead. The same lesson re-appeared in entry 2.
- **Status: RESOLVED.**

## 10. GC hazards

- **Symptoms/causes (2026-07-07):** (a) screenshot-storage GC could delete screenshots still referenced by runs — the reference query was unpaginated and error-blind (a partial read looked like "unreferenced"); (b) `agent_site_network` GC filtered on a non-existent `created_at` column (real column: `captured_at` — see `api/agent/run.js:468,472`) and threw daily; (c) `gcKeepNewestPerGroup` (`run.js:276`) had a stray NUL byte in its group-key separator (fixed in ecd876b).
- **Fixes:** paginate-to-exhaustion, delete only on a proven-complete reference sweep; `gcKeepNewestPerGroup` keeps paused subscriptions' newest baseline row.
- **Lesson:** GC must fail CLOSED (delete nothing on any read error), and column names in GC code go stale silently — they run at 00:00 UTC where nobody watches.
- **Status: RESOLVED** (d796ede + ecd876b).

## 11. `themeDuplicate` is asynchronous

- **Symptom:** C3 preview-theme writes/deletes failed with "can't delete until it has finished uploading" on the dev store.
- **Root cause:** Shopify's `themeDuplicate` returns while the duplicate is still `processing: true` (files copying). Any write/delete against it fails until processing flips.
- **Fix (086e3bb):** `waitForThemeReady` (`api/_lib/shopify-theme-io.js:185`) polls the `processing` flag (30s timeout, 2.5s interval); the preview handler persists `preview_theme_id` + `preview_staged` **before** staging so a timed-out tap resumes the same duplicate instead of leaking themes. Theme-level helpers pin Admin API 2026-07, separate from the file-level 2026-04 pin.
- **Status: RESOLVED** (dev-store-verified via `scripts/shopify-dv-verify.mjs`, all six GraphQL-shape checks per the script header).

## 12. `write_themes` protected-scope exemption

- **History:** the Shopify-direct path was built but dead — Shopify initially denied the `write_themes` protected-scope exemption (ticket 68049335; UNVERIFIED in-repo — project notes). The exemption was later granted; both Shopify paths are live and marketed as equals since 2026-07-01.
- **Why it matters:** don't treat old "path is dead pending exemption" notes as current; conversely, the Shopify-via-GitHub path exists precisely because it needs **no** `write_themes` — keep both paths' framing straight (details: CLAUDE.md "Shopify-via-GitHub" / "Shopify-direct" sections).
- **Status: RESOLVED** (granted).

## 13. OpenRouter model slug: dot, not dash

- **Symptom:** a model bump was set to `anthropic/claude-sonnet-4-6` (native Anthropic dash ID) by reasoning from Anthropic conventions.
- **Root cause:** OpenRouter's canonical slugs for Claude 4.x use a **dot**: `anthropic/claude-sonnet-4.6`. The dash form is aliased (so it may "work"), but `/models` lists only the dot form.
- **Rule:** before any model switch, ground-truth against `GET https://openrouter.ai/api/v1/models` (public), and re-check `LLM_INPUT_EUR_PER_M` / `LLM_OUTPUT_EUR_PER_M` against the new pricing. The model is env-driven since 2026-07-11: `AGENT_LLM_MODEL` on BOTH surfaces (Supabase secret + Vercel env).
- **Status: RESOLVED** (convention learned 2026-06-23).

## 14. Local `npm run build` pings production IndexNow

- **Fact:** `scripts/prerender.mjs` (the second step of `npm run build`) fires `submitToIndexNow` with a **hardcoded** key and host (`src/utils/indexNow.js:12` — key `a8425d52…`, host velyr.io, no env gate). Any local full build tells Bing/Yandex to recrawl live velyr.io.
- **Rule:** local verification is `npx vite build` ONLY (it still runs the blog gate); the full chain belongs to the Vercel deploy.
- **Status: OPEN by design** — it is a behavioral rule, not a bug to fix silently. (An env gate was never added; if you add one, route it through velyr-change-control.)

## 15. "Cormorant Garant" font typo

- **Symptom:** the brand serif was requested app-wide as `Cormorant Garant` — a font that does not exist — so serif headings silently fell back to generic serif.
- **State as of 2026-07-18:** fully eradicated. The last remainder — the crawler-fallback markup in `index.html` (6×) and its generator `scripts/prerender.mjs` (4×) — was fixed together on 2026-07-18 (they must always change together or the generated HTML re-introduces the typo).
- **Trap:** dashboard surfaces (and the landing's dashboard mock) deliberately use **Instrument Serif** — never "fix" those to Cormorant.
- **Status: RESOLVED.** Regression check: any `Cormorant Garant` hit outside `.claude/` history docs is a regression.

## 16. Blog "Discovered, currently not indexed"

- **Symptom:** GSC flagged all 71 blog URLs as discovered-not-indexed, plus 1 "canonical conflict".
- **Root cause:** thin **contextual** internal linking — 36/60 articles had <3 inbound article→article links (8 at zero). The flat index/category hub links don't count. Canonicals were technically correct everywhere; the "conflict" is a duplicate-**intent** pair (two sample-size-calculator articles, same formula and cluster), not duplicate text (max shingle overlap 9.7%, below the dedupe gate).
- **Fix (2026-06-23):** 72 genuinely-topical same-cluster `related:` entries across 39 articles → all 60 ≥3 inbound (all 60 articles carry `related:` today — verified). Duplicate-intent remedy deferred pending the exact GSC URL.
- **Rule:** internal-link health = contextual `related:`/in-body links; re-measure via `loadArticles()` counting distinct sources per slug.
- **Status: RESOLVED** (linking); PARKED (intent-pair differentiation).

## 17. The audit-wave ledger (do not re-audit)

All findings below shipped and were re-verified. Re-auditing them wastes a session and historically produced duplicate proposals.

| Wave | Scope | Evidence |
|------|-------|----------|
| 2026-07-04/05 ranked plan (8 items) | ranker signal, honest measurement (matched windows, route-scoped rollback, DNA split), visual grounding screenshots, multi-file fixes, preview surfaces, silence-breaking, theme safety, hygiene | commits ba63599..c72d637 |
| 2026-07-06/07 audit wave | A1–A20 confirmed bugs + B-hardening + C1–C12 features; post-audit re-verification by 4 independent review agents found 6 more, all fixed | branches `audit-fixes-2026-07`, `audit-followups-2026-07`, feature branches; main through b2b07f9 |
| 2026-07-10 landing-truth pass | 5 copy contradictions + UTC countdown bug | 7880e5f, 6706ab3, b854ae6 |

Established facts from those waves that keep saving audit time: **guardrails are prompt-only** (no post-parse enforcement — copy must never claim rejection-before-reach); **rollback is checked Wednesdays 10:00 UTC** over deploy±48h windows (never promise "within 48 hours"); **competitor scans are weekly** (never "the moment"); **plain-html sites always skipped** at the sparse gate until the W4 sparse-shell exception (2026-07-15; other frameworks below the gate still skip); the first run fires at `start_trial`, and nothing starts on `trialDenied`.

## 18. PARKED items (deliberate, with unpark conditions)

| Item | What | Unpark when |
|------|------|-------------|
| Schema split | Stripe webhook keys `user_id` (`api/webhooks/stripe.js:202`), agent keys `auth_user_id`; `subscription_id` text-vs-uuid inconsistency | A deliberate unification project; touches billing — high blast radius |
| OAuth routing race | **RESOLVED 2026-07-18**: `App.jsx` captures the hash at MODULE EVALUATION (`INITIAL_AUTH_HASH`, synchronous — supabase-js's strip is async and cannot have run yet) and routes from the capture; the live hash is only used for what to keep in the URL. All four landings preserved. Residual guidance: if a 2nd OAuth provider using PKCE (`?code=`) is added, the hash heuristic won't see it — extend the capture or move to `onAuthStateChange` then | — |
| Legacy null codes | **RESOLVED 2026-07-18**: the null-allow was removed in both `finalize` and `verify_telegram_code` — every mint path stamps `auth_user_id` (bare `/start` refused; token always carries the id), and pre-B3 NULL codes expired under the 30-min TTL long ago | — |
| Vue App Router | Snippet Setup-PR unsupported for vue-vite/sveltekit etc. — manual-paste Telegram fallback only (TODO at `supabase/functions/agent-run/index.ts:2634`) | Framework-specific entry-point detection |
| Fingerprint gaps | Email fingerprint type reserved but unrecorded (plus-addressing, PII); subdomain bypass accepted (no PSL dependency) | Only if trial abuse is observed in practice |
| Shopify apply-confirm (b) | Future stronger confirm must BRANCH on `themeFilesUpsert` job: small upserts complete synchronously with `job = null` (`api/_lib/shopify-approval.js:157,176` persist `up.jobId ?? null`) → confirm via checksumMd5 re-query, never poll-assume | If option-(b) confirmation is built |

**Formerly parked, now RESOLVED — do not re-report:** **M2 Part B + M5** (verified 2026-07-18): resolved **migration-free** in e4f1f55 (2026-07-02) — `applyShopifyDirectWrite` / `executeShopifyDirectRollback` atomically CAS-claim the run into the EXISTING `'running'` status before any theme write (loser of a concurrent YES bails on 0 rows), token-refresh failure un-claims back to the waiting status, and a crash mid-write is stale-swept `running`→`failed` (honest) with `applied_write` already persisted as the recovery basis. The old re-verification grep for `shopify_applying|shopify_writing` was testing the WRONG design — the shipped fix deliberately avoided new statuses; that stale test kept this listed as parked for two weeks (entry-7 lesson, again). L3 slug TOCTOU: the UNIQUE index exists (`supabase/migrations/20260702_public_slug_unique.sql`) and `handleUpdateSettings` catches 23505 → 409 (`api/agent/run.js:2191-2194`). B3 code-binding: `telegram_start_token` stamps `auth_user_id` at `/start`. Token-refresh 401: both 400 and 401 map to `needs_reconsent` in both twins.

## 19. Trial-abuse ledger — why, and what must never touch it

- **Hole it closes (4c14998, 2026-07-04):** account delete wiped everything and Stripe idempotency keys are per auth UUID — delete-and-re-signup earned unlimited free trials.
- **Design:** `trial_fingerprints` stores HMAC hashes (website host / repo / shop / chat id), keyed with `AGENT_APPROVAL_TOKEN_SECRET`. Denied signups get `subscription_status='trial_denied'` (inert free-text; paid checkout overwrites). Fails OPEN on infra errors.
- **Invariants:** the table must NEVER be added to the delete handler's childTables (guard comment at `api/agent/run.js:665`) and never gain an FK to users/subscriptions — deletion-survival is the whole point. Rotating `AGENT_APPROVAL_TOKEN_SECRET` orphans every ledger row **and** kills every already-sent one-click-unsubscribe link (§7 UWG problem) — treat that secret as load-bearing in two unrelated systems.
- **Support remedy** for a legit false positive: compute the hash with `api/_lib/trial-fingerprint.js` helpers and delete that row (OPERATOR).
- **Status: RESOLVED** (shipped; migration applied 2026-07-04).

---

## When NOT to use this skill

- You're triaging a live failure **right now** → `velyr-debugging-playbook` (it links back here for background).
- You want to improve fix quality going forward → `velyr-fix-quality-campaign`.
- You need the current invariants/twins, not their history → `velyr-architecture-contract`.
- You need the pipeline's present-day mechanics → `velyr-agent-pipeline-reference`.

## Provenance and maintenance

Written 2026-07-11 from git history, code, and project notes. Facts marked UNVERIFIED come from project notes of the dated session and have no in-repo artifact.

Re-verification one-liners (run from repo root):

- Commit evidence: `git log -1 --format="%h %ad %s" --date=short <hash>` for 3b7654b, 0383897, d796ede, ecd876b, 086e3bb, 509d852, 4c14998, ba63599, c72d637, 7880e5f, b854ae6.
- Screenshot config twins unchanged: `grep -n "wait_until" api/_lib/screenshot.js supabase/functions/agent-run/index.ts`
- Rollback reconcile branch: `grep -n "metrics_dropped" api/_lib/run-reconcile.js`
- Fan-out still default-on: `grep -n "AGENT_FULLRUN_FANOUT" supabase/functions/agent-run/index.ts`
- Stale-sweep twins: `grep -n "STALE_RUN_THRESHOLD_MS" api/agent/run.js supabase/functions/agent-run/index.ts`
- M2-B/M5 resolved via 'running'-claim: `grep -n "status: 'running'" api/_lib/shopify-approval.js` (2 hits = the CAS claims exist; commit e4f1f55)
- L3 still resolved: `grep -n "23505" api/agent/run.js` + `ls supabase/migrations | grep public_slug`
- Font typo remainder: `grep -rln "Cormorant Garant" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.claude .` (expect: `index.html` + `scripts/prerender.mjs` only; any `src/` hit is a regression)
- Vue TODO still open: `sed -n '2630,2638p' supabase/functions/agent-run/index.ts`
- Fingerprint childTables guard: `grep -n "trial_fingerprints" api/agent/run.js`
- Blog related arrays: `grep -l "related:" content/blog/*.md | wc -l` (expect 60)
