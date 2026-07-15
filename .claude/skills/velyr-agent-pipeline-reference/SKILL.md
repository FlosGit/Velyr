---
name: velyr-agent-pipeline-reference
description: Implementation-depth reference for Velyr's weekly agent pipeline (the Supabase edge function agent-run). Load when working on ANY part of the run pipeline — orchestration/fan-out, RA1-RA7 stages, repo-mapper, import-graph, component-ranker (Pass 1), deep-reader, callAIForFix (Pass 2), prompts/sealed blocks, CHANGE_TYPES, screenshots, createPR guards, find_mismatch self-heal, receipt-builder, processConnection/processShopifyConnection/processGithubThemeConnection, skip statuses, Business DNA / Global Win Library / focus pin / learning loops, wallet cap, or checkpoint steps. NOT for live-failure triage (velyr-debugging-playbook) or how to ship changes (velyr-change-control).
---

# Velyr Agent Pipeline Reference

Deep implementation reference for the weekly conversion-fix pipeline inside `supabase/functions/agent-run/`. CLAUDE.md gives the summary; this file gives the data shapes, budgets, prompt anatomy, guard order, and failure paths you need to modify the pipeline safely.

All `file:line` anchors are **as of 2026-07-11**; lines drift, function names are the stable handle. Everything below was verified against the code on that date.

**Terms used once:** *edge fn* = the Deno function `supabase/functions/agent-run/index.ts` (5,736 lines) + its modules, deployed via `npx supabase functions deploy agent-run` (never git push). *Run* = one row in `agent_runs`. *Pass 1* = the LLM component ranker (RA3). *Pass 2* = the LLM fix generator (RA5, `callAIForFix`). *Theme run* = `mapResult.framework === 'shopify-liquid'` (either Shopify path). *Twin* = a format-locked duplicate declaration across the Deno/Node bundle boundary (inventory: see velyr-architecture-contract).

---

## 1. Orchestration: how a run starts, locks, and dies

### Dispatch chain

| Step | Function (index.ts) | Facts |
|---|---|---|
| Monday cron | Vercel `/api/agent/run` (no mode) | Fire-and-forget POST to the edge fn, 2s abort, returns immediately |
| Full run | `handleFullRun` (:5708) | `cleanupStaleRuns()` first. Fan-out unless `AGENT_FULLRUN_FANOUT` is the string `'false'` (default ON) |
| Fan-out | `fanOutSingleRuns` (:5645) | One self-POST `{intent:'single_run', subscriptionId}` per eligible sub. Batches of `AGENT_FANOUT_BATCH` (default 5), pause `AGENT_FANOUT_PAUSE_MS` (default 1000ms). 2s AbortController per dispatch — an AbortError still counts as dispatched (the 202 handler does the work via waitUntil) |
| Inline escape hatch | `processConnectionsInline` (:5682) | Worker pool, `AGENT_RUN_CONCURRENCY` default 3, all under ONE isolate wall-clock. Kept so fan-out can be reverted without redeploy |
| Single run | `handleSingleRun` (:5595) | Also the path for post-onboarding auto-run and the dashboard "Run now". Runs `cleanupStaleRuns()`, re-checks eligibility, takes the lock, calls `processConnection`, releases in `finally`. Never throws |

**Eligibility filter** (identical in `handleFullRun` and `handleSingleRun`): `agent_connections` joined `agent_subscriptions!inner` where `status = 'active'` AND `subscription_status IN ('active','trialing')`. `handleSingleRun` uses `.order('id', descending).limit(1)` — NOT `.maybeSingle()` — because a subscription with two connection rows made `maybeSingle` error and silently skip that customer every Monday (fix B3).

**Advisory lock:** `acquireRunLock` (:5555) → RPC `agent_run_lock_acquire`, TTL `RUN_LOCK_TTL_MS` default 15 min. **Fails OPEN** (missing RPC/timeout ⇒ run anyway). Release self-heals via TTL if the release write times out.

**Stale-run sweep:** `cleanupStaleRuns` (:5525) marks `status='running'` rows older than `STALE_RUN_THRESHOLD_MS` (default 60 min) as `failed` with message `Stuck in status=running past stale threshold — likely killed mid-flight`. Cross-runtime twin in `api/agent/run.js` (daily cron + `trigger_run` pre-check) — criteria, message, and threshold must stay in sync.

**DB writes:** everything status-critical goes through `dbWrite()` (:37) — a `Promise.race` timeout wrapper, `DB_WRITE_TIMEOUT_MS` default 10s, throws on `{error}`. Best-effort writes `.catch()` into a warn instead.

### Checkpoints (`agent_runs.current_step`)

Written in this order on the plain-GitHub path: `fetching_repo` → `pulling_analytics` → `mapping_funnel` → `ranking_components` → `reading_deep_context` → `finding_biggest_issue` → `writing_fix` → `sending_notification` → `done`. The Shopify paths write a subset (`ranking_components`, `finding_biggest_issue`; the GitHub-theme path also `fetching_repo`, `writing_fix`, `sending_notification`).

**Gotcha:** there is NO screenshot checkpoint. The dashboard (`CURRENT_STEP_RANGE` in `src/pages/AgentDashboard.jsx`) renders extra UI steps; a run "stuck at step 8 / taking screenshot" is actually stuck in Pass 2 (`finding_biggest_issue`). See velyr-debugging-playbook.

### Wallet cap (per-subscription LLM spend)

| Constant | Value / env | Where |
|---|---|---|
| `MONTHLY_SPEND_CAP_EUR` | €20.00, `AGENT_MONTHLY_SPEND_CAP_EUR` | index.ts:101 |
| `LLM_PRICING_EUR_PER_M` | INPUT 3.0 / OUTPUT 15.0, `LLM_INPUT_EUR_PER_M` / `LLM_OUTPUT_EUR_PER_M` | :89 (verified vs live OpenRouter 2026-07-05 for sonnet-4.6) |
| `LLM_CAPS.MAX_TOKENS_ANALYSIS` | 8000 (`LLM_MAX_TOKENS_ANALYSIS`) — Pass 2 (raised from 6000 on 2026-07-15 for Opus-class verbosity) | :59 |
| `LLM_CAPS.MAX_TOKENS_RANKER` | 3000 (`LLM_MAX_TOKENS_RANKER`) — Pass 1 (600 caused silent heuristic fallback via `finish_reason: length`; 2000 was the Sonnet value, raised 2026-07-15) | :68 |
| `LLM_CAPS.MAX_TOKENS_ROAST` | 1500 | :60 |
| `LLM_CAPS.MAX_PROMPT_BYTES` | 512,000 (`LLM_MAX_PROMPT_BYTES`) — `assertPromptSize` throws, run aborts rather than send | :72 |
| `LLM_MODEL` | `AGENT_LLM_MODEL` env, default `anthropic/claude-sonnet-4.6` (OpenRouter DOT slug) | :81 |
| `LLM_TIMEOUT_MS` / `LLM_TIMEOUT_IMAGES_MS` | 120s / 160s (`AGENT_LLM_TIMEOUT_MS` / `AGENT_LLM_TIMEOUT_IMAGES_MS`) — Opus-tuned 2026-07-15, were hardcoded 45s/90s (Sonnet-era) | after :82 |

- Cap is enforced **once per run** in `processConnection`'s pre-flight (:4961): over cap ⇒ status `skipped_cost_cap` + one Telegram (`notifyCapExceeded`). Individual calls record usage (`recordLLMUsage` → RPC `agent_llm_usage_increment`, fail-soft) but do not re-check mid-run.
- `getMonthlySpend` **fails open** when `agent_llm_usage` is missing (migration stance: never block the agent on a missing accounting table).
- `callLLMCapped` (:3320): OpenRouter POST, images ride as `image_url` blocks (plain string content when none — byte-identical legacy wire format). Timeout `LLM_TIMEOUT_IMAGES_MS` with images, `LLM_TIMEOUT_MS` without; `postOpenRouterWithRetry` (:3293) retries ONCE after 2s on network error / 429 / 5xx (plain 4xx returned as-is) — EXCEPT a timeout on a long-budget call (`timeoutMs ≥ 60s`), which throws immediately (2026-07-15: a slow Opus generation is not transient, and a same-length second attempt would double the isolate's wall-clock burn; the callers own the cheaper degradation paths). `finish_reason === 'length'` self-heals ONCE with a doubled-cap retry (`llm_length_retry` slog, both attempts wallet-recorded, 2026-07-15); a second truncation throws the "raise the cap" error instead of surfacing as opaque invalid-JSON.

---

## 2. The three pipeline paths (fork points in `processConnection`, :4924)

Order of operations before any fork: (1) first-run PostHog domain setup if `posthog_host_filter` is null (`setupPostHogForConnection` — DB write + Telegram snippet, no PostHog API call); (2) insert `agent_runs` row `status='running'`; (3) spend-cap pre-flight; (4) `maybeRunMonthlyRoast` (first Monday of month AND `last_roast_at` not same-month; fires on EVERY path — bug A10).

| Path | Fork condition | Handler | Output |
|---|---|---|---|
| Shopify-direct | `connection_source === 'shopify_direct'` OR legacy shape (`shopify_shop_domain` set, no `github_repo_name`). Signals disagreeing ⇒ `slog warn connection_source_shape_mismatch`, still routes Shopify-direct if EITHER says so | `processShopifyConnection` (:4272) | Staged `pending_write` + `shopify_awaiting_approval`; live write happens only on YES (Vercel side) |
| Shopify-via-GitHub | after RA1's getTree, BEFORE the unsupported skip: `isShopifyThemeRepo(repoTree)` (repo-mapper.ts:587 — strong marker `layout/theme.liquid` OR `config/settings_schema.json`, AND all three dirs `templates/`+`sections/`+`snippets/`). If `shopify_connected_branch` differs from default, RA1 re-maps on that branch (failed re-map falls back — risks find_mismatch, never a wrong-branch write) | `processGithubThemeConnection` (:4673) | Real PR (theme-aware `createPR`) + plain `waiting_approval` |
| Plain GitHub | everything else | rest of `processConnection` | PR + `waiting_approval` |

Both Shopify paths reuse the SAME ranker and SAME `callAIForFix` via adapters (§5.1). `funnelAnalysis` is honestly `null` on both (no URL-page map for Liquid).

---

## 3. Stage reference (RA1–RA4)

### RA1 — `repo-mapper.ts` (`discoverFrameworkAndStructure`)

- **One recursive `git.getTree`** (+ package.json, + tsconfig if present ≈ 2–3 API calls). Truncated trees (>100k entries / 7MB) are logged (`repo_tree_truncated`) and proceed — downstream gates backstop.
- **Framework union** (repo-mapper.ts:33): `vite-react | cra | nextjs-app | nextjs-pages | remix | astro | sveltekit | vue-vite | nuxt | plain-html | unsupported | shopify-liquid`. Classification (`classifyFramework`, :194): `next` dep + root layout ⇒ `nextjs-app` (a bare `app/` dir is NOT enough — `findAppRouterDir` requires `app/layout.*` or `src/app/layout.*`); `next` without ⇒ `nextjs-pages`; then remix/astro/sveltekit/nuxt/vue-vite/vite-react/cra by dependency; no framework dep + root `index.html` ⇒ `plain-html`; else `unsupported` (honest fail — run becomes `skipped_unsupported_framework`).
- **Entry points**: static candidate lists per framework (`ENTRY_CANDIDATES`, :219) filtered against the tree — EXCEPT `nextjs-app`, which uses `discoverAppRouterEntries` (:251): every `app/**/{page,layout}.{tsx,jsx,ts,js}`, skipping `_private` and `@slot` segments and `route.*`; hybrid repos add non-colliding `pages/**` routes (**app wins** on a `fileToRoutePath` collision); shallow-first sort, capped at `AGENT_APP_ROUTER_MAX_ENTRIES` (default 25). Zero entry points ⇒ `unsupported` ("no entry point found").
- **Monorepo**: detection order `pnpm-workspace.yaml` → `package.json` workspaces → `turbo.json` → `nx.json`. Selection: single web app wins; else name priority `web, app, site, marketing, landing` on the workspace basename; else most-recent-commit tie-break (one `listCommits` per candidate); still ambiguous ⇒ `unsupported`.
- **CSS approach** (`detectCssApproach`, :327), first match: tailwind config file → any `.module.css` → `styled-components` dep → `@emotion/*` dep → any `.css` = `plain-css` → `unknown`.
- **MapResult** fields: `framework, isMonorepo, workspaces, selectedWorkspacePath, siteRoot, entryPoints, tsConfigPaths` (no `extends` following), `cssApproach, tailwindConfigPath, globalStylesPath, unsupportedReason, tsStrict, repoTree`. The tree is threaded explicitly — **never cached at module scope** (isolate is shared across customers under the inline pool).
- `detectLintInfo` (:567): eslint config presence + `tsStrict` — detection only, never run; feeds the receipt's "verify your CI" lines.

### RA2 — `import-graph.ts` (`buildImportGraph`)

- BFS from `mapResult.entryPoints`. Bounds: `AGENT_GRAPH_MAX_DEPTH` default 3, `AGENT_GRAPH_MAX_FILES` default **50** (comment: 30 fired on Velyr's own repo). `truncatedAt: 'depth' | 'count' | null` is reported in the receipt.
- One `getBlob` per file (SHAs from the tree; `getContent` fallback only for tree-truncation misses, logged). **Frontier batches of 8** (`GRAPH_FETCH_CONCURRENCY`), results processed in dequeue order so node order and the count cutoff are byte-identical to sequential traversal (item 8b).
- Node = `{path, depth, size, componentName, jsxElements (capitalized tags), cssPath (sibling .module.css/.module.scss/.css), framework, firstChars}`. `firstChars` = first **400 chars** after stripping the import/export-from header — this IS the content cache Pass 1 ranks on; content is otherwise discarded.
- Parse: Babel AST (`errorRecovery: true`) for JS/TS family; regex fallback for `.svelte/.astro/.vue` and unparseable JS. Import resolution order: relative → tsconfig path alias → bare `@/` = siteRoot convention → bare specifier = external (skipped silently). Unresolvable ⇒ `unresolved[]` with reason (receipt-visible). `SKIP_RE` drops tests/stories/`.d.ts`/node_modules/dist/build/.next/etc.

### RA3 — `component-ranker.ts` (`rankComponentsForConversion`) — Pass 1

Three layers, in order:

1. **Sparse-graph gate** (before any LLM spend): `nodes.length < MIN_GRAPH_NODES()` (`AGENT_MIN_GRAPH_NODES`, default **3**) ⇒ `insufficient_graph: true` ⇒ run status `skipped_insufficient_graph`. **W4 exception (2026-07-15):** the plain-GitHub call site passes `opts.sparseOk` when `framework === 'plain-html'` AND `AGENT_HTML_EDIT` is on AND `AGENT_SPARSE_SHELL_FIX` is on (both default on) — a below-gate graph (≥1 node) is then included in full WITHOUT LLM ranking (`source: 'heuristic'`, reason `sparse graph (N nodes) — included without LLM ranking (shell-fix path)` — deliberately NOT the `heuristic score` prefix, so Q10's fallback metric stays clean) and the run proceeds to the W3 editable-shell path. Before W4, plain-html sites always skipped here (1-node graph) — which made W3 unreachable for exactly the sites it targeted.
2. **LLM Pass 1**: graph summary (30KB byte-bounded, deepest nodes dropped first; 300-char snippets) + the signal context, wrapped in ONE untrusted-data sentinel. `ownerDirectives` (focus-pin hint + conversion goal) ride **OUTSIDE** the sentinel — inside it, the model is told to ignore them (that bug was real). Returns `ranked` (≤ `LLM_RANKED_CAP` 7) / `skipped` / `unsure`, every path validated against the node set. Call/parse failure ⇒ **deterministic heuristic fallback** (`heuristicRank`: depth 0/1/other = 100/50/10, +200 name match, +20 button/form/a JSX, −30 >50KB) with `pass1_fallback: true` + `fallback_reason`, logged loudly as slog event `ranker_pass1_fallback`.
3. **Conversion-vocabulary safety override**: `SANITY_RE` (hero|landing|cta|signup|pricing|checkout|cart|buy|form|newsletter|… word-boundary) matched against the **tokenized** name (PascalCase/snake/kebab split, so `NewsletterSignup` matches but `Information` doesn't match "form"). Matches are force-included with `source: 'forced'`, after LLM picks, final cap `FINAL_RANKED_CAP` 10.

`RankedItem.source` is `'llm' | 'forced' | 'heuristic'` — a fallback run is queryable from the persisted site-network snapshot (rank reason `heuristic score …`).

**Signal context** (`buildRankerSignalContext`, index.ts:3365 — shared by all three paths): 7-day pageviews/sessions/bounce/mobile% + top pages; per-page scroll depth with `[mob/desk]` split; top clicked elements (+`mobileShare`); rage-clicks; dead clicks; funnel pages + biggest drop-off (null on theme paths); DNA whatWorks/neverDoAgain/OWNER CONTEXT (each capped 400 chars); Global Win Library block.

### RA4 — `deep-reader.ts` (`readDeepContext`)

- Budget `AGENT_DEEP_CONTEXT_BYTES` default **400,000 bytes** total; per-file cap `LLM_MAX_FILE_BYTES` default **60 KB** with a loud truncation marker.
- **Supporting reads first** (small, Pass-2-critical, fetched concurrently): tailwind `theme:` block (≤5KB), global styles (first 200 lines), `index.html` head + first 100 body lines, `public/llms.txt`, and the **siteRoot** `package.json` deps (monorepo root manifest is just plumbing).
- Then ranked components in rank order + sibling CSS, prefetched at concurrency 8 while the **budget walk stays strictly in rank order** (prompt bytes identical to sequential; over-budget prefetches are discarded).
- **W3 (2026-07-14): root `index.html` promotion.** On `vite-react`/`plain-html` (kill-switch `AGENT_HTML_EDIT=false`), the FULL root `index.html` is appended as the **last** editable component (never starves a ranked component's budget; dedupe covers plain-html where it's already the graph entry) and the head-extract supporting read is skipped (`indexHtml: null` — no duplicate bytes, drops out of block [3] and the receipt's supporting list). This makes the page shell (cookie banner, meta, inline styles) fixable — the PR-#10 class of unreachable root causes.
- Honest fail: `skippedDueToBudget[]` + `skippedUnreadable[]` — both rendered in the receipt.

---

## 4. Pass 2 — `callAIForFix` (index.ts:3470)

### Prompt anatomy

System prompt: "elite web conversion optimization expert … MUST be honest about what you analyzed". User message starts with the injection-defense preamble, then **14 sealed blocks**, each wrapped in its own `<VELYR_UNTRUSTED_DATA id="<fresh uuid>">` (per-block ids so one injected block can't close a shared sentinel):

| # | Block | Source |
|---|---|---|
| 1 | Framework summary | MapResult |
| 2 | Package dependencies | deepContext.packageJsonDeps |
| 3 | Styles / global context (tailwind theme, global styles, index.html, llms.txt) | deepContext |
| 4 | Ranked components **full source** — "the ONLY files you may edit" | deepContext.components |
| 5 | Real analytics + engagement lines (scroll/clicks/rage/dead, device-split) | getPostHogAnalytics |
| 6 | Funnel (or "not available") | buildFunnelAnalysis (null on theme paths) |
| 7 | Business DNA (WHAT WORKS / NEVER DO AGAIN / OWNER CONTEXT) | loadBusinessDNA ∥ fetchBusinessDNA |
| 8 | Competitors | fetchCompetitorData |
| 9 | Performance (PageSpeed mobile score, LCP/CLS/TBT) | getPageSpeedScore |
| 10 | Revenue/visitor (Stripe, 30d) | getStripeRevenuePerVisitor |
| 11 | ALREADY FIXED — DO NOT REPEAT (5 newest deployed/waiting, incl. shopify twins — A4) | getPreviousRuns (:1684) |
| 12 | RECENTLY REJECTED BY THE OWNER (3 newest rejected/shopify_rejected) | getRecentlyRejectedProblems (:1702) |
| 13 | ATTEMPTED BUT COULD NOT LOCATE (3 newest find_mismatch/find_ambiguous) | getRecentFindFailures (:1716) |
| 14 | GLOBAL WIN LIBRARY (cross-customer prior) | getGlobalWinLibrary (:3106) |

**Outside every sentinel** (trusted, server-validated): brand guardrails (`fetchBrandGuardrails` — prompt-only, no post-parse enforcement exists), OWNER CONVERSION GOAL (`conversion_goal`, trimmed+capped 300), OWNER PRIORITY (focus pin — "biases, never forces"), and the screenshot context.

**Screenshot context & visual-claim rule:** when images attached, the prompt names each attached viewport and enforces: a #1 problem resting on a visual/layout claim MUST be verified in the attached screenshots and cited in `hypothesis`; if the screenshots don't show it, pick a different problem or skip. **Since 2026-07-14** the rule additionally requires every visual claim to name the exact viewport where it was confirmed (a 360×640-only finding must not be generalized to "mobile") and encodes fixed-overlay semantics (a dismissible banner covers content only until dismiss/scroll — "completely hidden" needs the pixel overlap AND a dismissal-aware hypothesis). When NO screenshots reached the model, an explicit block forbids purely-visual premises outright. (Never silence — the no-image case is an instruction, not an omission.) The shot list is built by the shared `fixShotList` so the verify-gate reviewer sees byte-identical viewport labels.

**Coherence constraint (2026-07-14):** a CONSTRAINTS bullet requires `code_change` to fix the STATED problem — same issue in title/problem and diff. If the root cause lives outside the editable list: re-frame honestly around a fixable problem, or skip; either way the unreachable item goes into `backlog` (+ optionally `question_for_owner`). Enforced downstream by the verify-gate (§5.0).

### Response schema (post-parse sanitization in the same function)

`FixResult` (:3428): `skip?/reason?`, `problem_title` (asked ≤60, hard-capped **80**, malformed ⇒ dropped, display falls back to `problem`), `problem`, `change_type`, `hypothesis`, `ranked_higher_than`, `file_to_edit`, `code_change {find, replace}`, `additional_edits` (≤2), `expected_metric {metric, direction, magnitude_pp, caveat}`, `confidence`+`confidence_reason`, `blind_spots[]`, `rollback_signal`, `question_for_owner` (C11 — surfaced only on a skip via `notifyOwnerQuestion`; answered with the Telegram `note` command), `backlog` (≤3 `{page_path, problem, expected_impact}` — persisted on fix AND skip; the dashboard "Next up" card).

Sanitization rules (all in :3681–3742):
- Code-fence strip is **leading/trailing only** (a global ``` strip once corrupted valid JSON containing fences).
- Required fields on a non-skip: `problem`, `file_to_edit`, `code_change.find`, and `typeof code_change.replace === 'string'` (NOT truthiness — `replace: ""` is a legal pure deletion; a missing replace would splice the literal string `"undefined"` into customer code).
- `change_type`: validated against the closed **`CHANGE_TYPES`** taxonomy (:3422): `cta_visibility, cta_copy, headline_value_prop, trust_signals, pricing_clarity, mobile_layout, form_friction, navigation, performance, content_clarity, visual_hierarchy, other`. Unknown ⇒ `'other'` on a fix; dropped entirely on a skip. It becomes `agent_business_dna.fix_type` at approval (copied verbatim by `run-reconcile.js` / `shopify-approval.js` on the Vercel side) and keys both DNA grouping and the Global Win Library — **extend the list, never accept free-form values**.
- `backlog`: path must match `^\/[a-zA-Z0-9\-._~/]*$`, fields trimmed/capped, max 3, malformed entries dropped.
- `additional_edits`: max 2, well-formed, deduped against the primary and each other; malformed entries dropped (primary stands alone), never fatal.
- **Focus pin is consumed here** — `clearFocusPage` runs after the LLM call, **even on a skip** (consideration counts); a run dying before Pass 2 keeps the pin.
- Image-bearing call failure ⇒ ONE retry **without images** (screenshotContext swapped for the no-image instruction) so a screenshot can never cost the weekly fix.

Edit-type constraint in the prompt (A3): theme runs may only target `.liquid` / template `.json`; all other runs only the JS/TS family — plus, when deep-reader promoted it (W3), the root `index.html` (with an explicit prohibition on removing the PostHog loader or consent logic — restyle/reposition only). A standalone stylesheet stays explicitly forbidden (style changes go inside the component), because createPR would hard-fail it anyway.

---

## 5. From fix to approval

### 5.0 Verify-gate — `applyVerifyGate` (all three paths, 2026-07-14)

Between the ranked-list guard and the first write (PR branch / theme staging) on ALL THREE paths, `applyVerifyGate` runs `verifyProposedFix`: ONE adversarial vision call (`callLLMCapped`, label `fix_verify`, max_tokens 1000 — NOT lower: `finish_reason==='length'` throws, and under fail-open a truncated verdict would silently disable the gate on claim-heavy proposals) over four per-UUID-sealed blocks (STATED PROBLEM / HYPOTHESIS / CONFIDENCE REASON / PROPOSED EDITS — Pass-2 output is transitively untrusted) plus the SAME screenshots via `fixShotList`. Three questions: (1) does the diff plausibly fix the stated problem, (2) is every visual claim confirmed in a named-viewport screenshot (dismissible-overlay semantics included), (3) does the prose describe only edits that exist. Refute ONLY on those concrete grounds; `not_assessable` alone never refutes; uncertain ⇒ pass. Born from PR #10 (problem/diff mismatch + hallucinated screenshot confirmation + prose describing a nonexistent edit).

- **pass** ⇒ `fixResult.verify = verdict` rides `analysis_result` on the shipped fix (P1 denominator).
- **refute** ⇒ honest skip: REUSES `skipped_low_confidence` (no migration), `error_message: 'Fix refuted by verify-gate: …'`, `analysis_result: {skip, reason, refuted_fix, verify, backlog}` (loss-autopsy artifact; discriminator `analysis_result->'verify'->>'verdict'`), Telegram `notifyFixRefuted` (honest wording — NOT notifyInsufficientData) + `notifyOwnerQuestion`. On the Shopify-direct path the gate sits BEFORE locate/apply, so a refuted fix never becomes `pending_write`.
- **error** (call failed / unparseable) ⇒ **fail-open** with `fix_verify_failed_open` warn log — a verifier outage never kills the fix week; log events `fix_verify_call_failed` / `fix_verify_unparseable` / `fix_verify_image_retry` (one retry without images, mirroring Pass 2).
- Runs BEFORE createPR ⇒ before the B4 find-repair; a repaired fix is deliberately NOT re-verified (repair only re-anchors `find` verbatim).
- Kill-switch: `AGENT_FIX_VERIFY=false` (default ON, `(env ?? 'true') !== 'false'`). Edge-only — no Vercel twin.

### 5.1 Screenshot pipeline (item 3a + item 2)

- `captureScreenshot` (:2734) — ScreenshotOne with the settled post-incident config: `format=png, cache=false, wait_until=load, delay=8, navigation_timeout=20, timeout=30`, fetch abort 35s, **no** `response_type`, **no** `wait_for_selector`, **no** ad/cookie blocking (blocks PostHog and blanks SPAs). Bytes upload to the **PUBLIC Supabase Storage bucket `screenshots`** under `<uuid>.png`; failure ⇒ null, run continues. Do not re-tune these params chasing black frames — the root cause was shooting a non-route (see velyr-failure-archaeology).
- `startFixScreenshots` (:2811) fires BEFORE Pass 1 so capture latency overlaps LLM latency. Target = validated focus-pin path, else site root — **never** a `fileToRoutePath`-derived guess. Three viewports: desktop 1280×800, mobile 390×844 @2x, small mobile 360×640 @2x.
- `startRankedPageShots` (:2834, **plain-GitHub path only**, started after ranking): the top-ranked file's `fileToRoutePath` route, only if PostHog-real (`topPages` views > 0) and different from the primary page; desktop + 390 mobile.
- `awaitShotsForModel` (:2878): ONE shared deadline `AGENT_FIX_SCREENSHOT_BUDGET_MS` (default 20,000ms). Primary group misses the budget ⇒ **Pass 2 runs with no images at all**; the ranked group races only the *leftover* budget (additive — can only cost itself). The promises keep running; the desktop shot is later awaited as the `screenshot_before` artifact (GitHub path) or attached post-persist via `attachBeforeScreenshot` (both Shopify paths — deliberately AFTER the approval persist + Telegram, still a true "before" since nothing ships pre-YES).
- `screenshotReceiptNote` (:2914) records honestly which images actually reached Pass 2, including the none-reached case.

### 5.2 Guard chain — `createPR` (:3854, GitHub paths)

Order per file, for **every** edit (primary + additional), **all before the branch is cut** (no orphan branches, no partial interdependent edits):

1. `isForbiddenEditPath` (:441, denylist `FORBIDDEN_EDIT_PATHS` :410 — `.github/`, `.env*`, `package.json` + all lockfiles, `vercel.json`/`netlify.toml`/`wrangler.toml`, framework configs, `tsconfig*`, babel configs, Docker, `.gitignore`, `.npmrc`, `Makefile`, key files, `supabase/migrations/` + `supabase/functions/` (self-modification), `.husky/`, `config/settings_*.json`) ⇒ **throw** → generic `failed`.
2. Extension guard: `VERIFIABLE_EDIT_EXTENSIONS` = js/mjs/cjs/jsx/ts/tsx; theme runs additionally liquid/json; W3 additionally allows `.html` ONLY for the exact root/workspace `index.html` on `vite-react`/`plain-html` runs (`AGENT_HTML_EDIT` kill-switch — keep in sync with deep-reader's promotion) ⇒ throw on anything else. (The per-path ranked-list guard upstream is a UNION of ranked paths and deep-read components on the plain-GitHub path — that union is what admits the promoted index.html.)
3. Base branch resolved ONCE: theme run with `connectedBranch` ⇒ that branch, else repo default — governs the file re-fetch, the branch cut, AND the PR base (must agree or a merged PR never syncs — SG3b).
4. Re-fetch each file at the base branch; `validateFindReplaceSafe` (:317): exact-unique fast path, else **whitespace-normalized** match mapped back to real bytes (`actualFind`) — the splice always replaces actual file content, never the model's copy. 0 matches ⇒ `find_mismatch` (+3 closest lines); >1 ⇒ `find_ambiguous` (+snippets). These return as **distinct statuses**, never generic `failed` (frequency monitoring depends on the split).
5. Syntax check on the spliced content: Babel parse for JS/TS; `validateThemeSyntax` (:242) for liquid/json — JSON.parse for `.json`; for `.liquid` layer 1 `liquidDelimitersBalanced` (:212, flags dropped-opens only, deliberately never stray-closes) then layer 2 `validateLiquidBlocks` (`liquid-block-validate.ts` — provable-only block pairing + `{% schema %}` JSON; `{% liquid %}` opts the file out; tested by `node scripts/test-liquid-blocks.mjs`); for the editable `index.html` (W3) `validateHtmlEdit` — COMPARATIVE (rejects only regressions the edit introduced): provable shell checks (`html-validate.ts`: orphan open-comment, script/style count balance, JSON-LD parses; tested by `node scripts/test-html-validate.mjs`), Babel on inline `<script>` bodies the edit touched, and PostHog-marker survival (marker in old but not new ⇒ reject — the agent must never blind its own measurement). Failure ⇒ throw.
6. Only then: branch `agent/fix-<timestamp>-<uuid8>`, one commit per file, PR titled `🤖 Agent: <problem>` with the receipt as body.

**B4 self-heal** (find_mismatch ONLY — ambiguous is deliberately not retried): `attemptFindRepair` (:3791) fetches the failing file's current content (connected branch on the theme path), `repairFindText` (:3753) makes one focused capped LLM call (`find_repair`, 2000 tokens, file content capped 60,000 chars) that must return the verbatim unique `find` or `{"impossible": true}`; the repaired fix re-runs the FULL guard chain via a second `createPR`. The retry's result is reported as the latest truth, and the attempt is persisted in `analysis_result` so block [13] carries it next run.

### 5.3 Shopify-direct staging (`processShopifyConnection`, :4272)

- Token: `refreshShopifyToken` first; failure statuses `shopify_needs_reconsent` / `shopify_not_configured` / `shopify_token_failed`. Theme read (`readShopifyTheme`, Admin GraphQL `2026-04`, globs templates/sections/snippets, ≤`SHOPIFY_THEME_MAX_PAGES` 10 pages) gets ONE refresh-and-retry on 401; still failing ⇒ `shopify_theme_read_failed`.
- PostHog gate: `!posthog_snippet_installed_at && !posthog_snippet_declined` ⇒ `maybeProposeShopifyPostHogSetup` (approval-gated inject into `layout/theme.liquid`; run ends `skipped_setup_pending`, `run_type: 'setup_posthog'`).
- Adapters: `shopifyGraph` (:910) — flat nodes (depth 0, `jsxElements: []`, firstChars 400, componentName = basename); `shopifyDeepContext` (:948) — rank-order walk under the SAME env budgets (`AGENT_DEEP_CONTEXT_BYTES` / `LLM_MAX_FILE_BYTES`), `packageJsonDeps: '{}'`.
- Staging: per edit, find the file in the already-read bytes, `applyCodeChangeToContent` (same whitespace-normalized guard; reconstructs the FULL new file because `themeFilesUpsert` overwrites whole files), inline B4 repair, then `validateThemeSyntax` on the staged content (item 4 closed this gap). Any missing file ⇒ `shopify_theme_read_failed`; find problems ⇒ same `find_mismatch`/`find_ambiguous` statuses.
- Persist **first**: `shopify_awaiting_approval` with `analysis_result.pending_write = {themeId, files: [{filename, op:'modified', newContent, priorContent, checksumMd5}]}` (priorContent = rollback basis; checksumMd5 = optimistic-concurrency basis) — **nothing touches the live theme before YES** (the write is `applyShopifyDirectWrite` on the Vercel side). Then the Telegram approval message (find/replace preview capped 600 chars, companion-edit note, inline keyboard; 🔍 Preview button only when `AGENT_SHOPIFY_PREVIEW_THEMES === '1'`), message_id attached best-effort, before-screenshot last.

### 5.4 Shopify-via-GitHub (`processGithubThemeConnection`, :4673)

`readThemeFilesFromGithub` (:4634): tree-filtered by `SHOPIFY_KEEP_RE = /^(templates|sections|snippets)\//`, capped `SHOPIFY_GITHUB_MAX_FILES` (default 300), blob pool of 8, `checksumMd5: null` (PR path needs no concurrency hash). Then identical context/ranker/Pass 2, and a **real PR** through the theme-aware `createPR` (connectedBranch threaded via `ReceiptCtx`), landing in plain `waiting_approval` — same reconcile machinery as any GitHub fix. `sendTelegramNotification` is called **without** the C4 preview button here (`withPreview` defaults false; only the plain-GitHub call site passes `true`, :5453).

### 5.5 Receipt — `receipt-builder.ts` (`buildReceipt`)

Pure function; PR body sections: Hypothesis / Problem / Why this fix (`ranked_higher_than`) / Expected outcome (pp + caveat) / Confidence / **What I did and didn't inspect** (files read deeply + supporting; considered-but-not-deep = ranker skipped+unsure; forced-included by the safety override; not analyzed due to depth/count/budget/unreadable; unresolved imports; behavioral-signals note; live-screenshots note) / Known blind spots / Rollback / Environment checks (Babel ✓ or honest can't-parse; lint detected-not-run; TS strict not checked) / footer with run ID. The rollback line states the REAL trigger — `ROLLBACK_BOUNCE_PP_THRESHOLD = 15` (receipt-builder.ts:52, format-locked twin of `api/agent/run.js`) — and labels the AI's `rollback_signal` as a hypothesis that never gates anything.

---

## 6. Learning loops

| Loop | Reader (edge) | Writer | Semantics |
|---|---|---|---|
| Previous fixes | `getPreviousRuns` :1684 → block [11] | pipeline itself | 5 newest `deployed / waiting_approval / shopify_deployed / shopify_awaiting_approval` problems |
| Rejected | `getRecentlyRejectedProblems` :1702 → [12] | reconcile on NO/close | 3 newest `rejected / shopify_rejected` |
| Locate failures | `getRecentFindFailures` :1716 → [13] | B4 persists `analysis_result` on find-failures | 3 newest `find_mismatch / find_ambiguous` |
| Legacy DNA + owner context | `fetchBusinessDNA` :1726 (agent_learnings, 20 newest) | Vercel rollback check; Telegram `note` | `positive` = wins, `negative` = never-again, `neutral` + `metric_type='manual'` = OWNER CONTEXT (C11 answers — must never enter wins/losses; the old `negative` storage inverted answers into anti-patterns). All-empty ⇒ null (A5: `insufficient_data` rows alone must not defeat the no-data gate). Owner context DOES count as signal |
| Business DNA | `loadBusinessDNA` :3052 (agent_business_dna, 50 newest) | **Vercel only** — pending at approval (`run-reconcile.js` / `shopify-approval.js`), resolved by `promotePendingDNA` (`api/agent/run.js:223`) after 7d: `measured_win` if matched-window bounce improved ≥ `MEASURED_WIN_MIN_PP` = 5pp (run.js:216), else `survived`; `rollback` at rollback approval. The edge-side writer was deleted (item 8a) | `user_verdict='rejected'` rows excluded from the prompt entirely; `'confirmed'` labelled owner-confirmed; legacy `success` reads as `survived` and is rendered as explicit weak signal |
| Global Win Library | `getGlobalWinLibrary` :3106 → [14] + ranker context | derived | Cross-tenant aggregate: 365d, ≤3000 rows, excludes `fix_type='other'` and owner-rejected; `pending` never counted; a line needs **n ≥ 2** resolved outcomes; ≤10 lines sorted by wins; counts only, never notes/paths/URLs. Per-isolate memoized (fan-out = one query per subscription isolate). Empty/error ⇒ block omitted |
| Focus pin | `loadFocusPage` :3151 (validates `/`-prefix, ≤200 chars) | dashboard `update-settings` | Biases ranker (ownerDirectives) + Pass 2 (OWNER PRIORITY); ONE-SHOT — `clearFocusPage` after the Pass-2 call even on skip; pre-Pass-2 death keeps it |
| Conversion goal | `subRow.conversion_goal` (300-cap) | dashboard | Ranker directive + OWNER GOAL block; `conversion_goal_event` drives the Vercel-side `goal_conversion_rate` impact metric (measurement only, never a rollback trigger) |
| No-data gate | `NO_DATA_THRESHOLDS` :387 | — | Skip only when ALL of: <5 unique visitors/7d, no DNA (incl. owner context), no competitor rows, graph <2 files ⇒ `skipped_no_data` |

---

## 7. Run status taxonomy (written by the edge fn)

| Status | Trigger |
|---|---|
| `running` | row insert at run start |
| `skipped_cost_cap` | monthly spend ≥ cap at pre-flight |
| `skipped_repo_unavailable` | `repoPreflight` failed (repo gone / not writable) |
| `skipped_unsupported_framework` | RA1 `unsupported` |
| `skipped_setup_pending` | PostHog Setup-PR opened / snippet setup pending (also `run_type: 'setup_posthog'` on the Shopify propose) |
| `skipped_no_data` | no-data gate; also empty theme file set on both Shopify paths |
| `skipped_insufficient_graph` | ranker sparse gate (< 3 nodes) |
| `skipped_low_confidence` | Pass 2 returned `{skip}` (carries `backlog` + optional `question_for_owner`) — **double-duty since 2026-07-14**: also a verify-gate refute (deliberate reuse, no migration); split the two via `analysis_result->'verify'->>'verdict'` (refutes carry `verify` + `refuted_fix`) |
| `find_mismatch` / `find_ambiguous` | find guard failed after the B4 retry; `analysis_result` persisted |
| `shopify_needs_reconsent` / `shopify_not_configured` / `shopify_token_failed` | token refresh outcomes (Shopify-direct) |
| `shopify_theme_read_failed` | theme read failed / staged file missing from read bytes |
| `waiting_approval` | GitHub PR open (plain + via-GitHub theme) |
| `shopify_awaiting_approval` | staged `pending_write` persisted (Shopify-direct) |
| `failed` | any uncaught throw (shared catch :5469 — honest Telegram to the customer's own chat, never the operator's) |

Post-approval statuses (`deployed`, `rejected`, `rolled_back`, `shopify_deployed`, `shopify_rejected`, `shopify_rolled_back`, `shopify_concurrency_abort`) are written by the **Vercel** side (webhook/dashboard reconcile). New statuses require extending the `agent_runs_status_check` CHECK constraint by manual migration FIRST — see velyr-change-control.

---

## 8. Post-run surfaces (one line each)

- **Approval message**: `sendTelegramNotification` (:3974) — HTML mode, `approvalKeyboard` inline ✅/❌ (+🔍 Preview on plain GitHub / flag-gated Shopify); message_id persisted so YES resolves the exact run.
- **48h rollback check**: Vercel `mode=rollback_check` (Wednesdays 10:00 UTC) — route-scoped when confident, site-wide fallback; threshold twin ROLLBACK_BOUNCE_PP_THRESHOLD=15pp; see `api/agent/run.js handleRollbackCheck`.
- **48h visual verification**: daily Vercel cron, vision-LLM before/after check writing `agent_runs.visual_check`; needs `OPENROUTER_API_KEY` on Vercel.
- **Weekly summary / midweek**: Vercel inline modes; monthly roast is edge-side (`maybeRunMonthlyRoast`, first Monday + same-month dedupe).

---

## When NOT to use this skill

- Something is broken in production right now → **velyr-debugging-playbook** (symptom→triage; uses this file for background).
- You want to raise the fix win-rate / change prompts as a campaign → **velyr-fix-quality-campaign**.
- You need the invariants/twin inventory/trust model → **velyr-architecture-contract**.
- Measurement math (matched windows, floors, pp semantics) → **velyr-proof-and-analysis-methods**.
- Deploying the edge fn / running migrations → **velyr-run-and-operate**; process/gates → **velyr-change-control**.

---

## Provenance and maintenance

Verified against the repo on **2026-07-11** (edge fn 5,736 lines). Line anchors drift — re-locate by function name. One-line re-verification commands (Git Bash, repo root):

```bash
# Function/line index of the edge fn (re-anchor everything above)
grep -nE "^(const|async function|function|export (async )?function) " supabase/functions/agent-run/index.ts
# CHANGE_TYPES taxonomy
grep -n -A6 "const CHANGE_TYPES" supabase/functions/agent-run/index.ts
# Checkpoint values + status writes
grep -n "current_step" supabase/functions/agent-run/index.ts
grep -nE "status: '(skipped|failed|running|waiting|shopify|find)[a-z_]*'" supabase/functions/agent-run/index.ts
# Budgets / caps / thresholds
grep -nE "AGENT_(GRAPH_MAX|DEEP_CONTEXT|APP_ROUTER|MIN_GRAPH|FIX_SCREENSHOT|MONTHLY_SPEND|FULLRUN_FANOUT|FANOUT)" supabase/functions/agent-run/*.ts
grep -n "MEASURED_WIN_MIN_PP\|ROLLBACK_BOUNCE_PP_THRESHOLD" api/agent/run.js supabase/functions/agent-run/receipt-builder.ts
# Framework union + theme detection
grep -n -A4 "export type Framework" supabase/functions/agent-run/repo-mapper.ts
grep -n -A9 "export function isShopifyThemeRepo" supabase/functions/agent-run/repo-mapper.ts
# Ranker gates/caps
grep -nE "MIN_GRAPH_NODES|LLM_RANKED_CAP|FINAL_RANKED_CAP|SANITY_RE" supabase/functions/agent-run/component-ranker.ts
```

Volatile facts most likely to drift: the default model slug (`AGENT_LLM_MODEL`), pricing constants, `AGENT_SHOPIFY_PREVIEW_THEMES` flag state, Shopify Admin API version pins (`2026-04` file-level in index.ts:689; theme-level `2026-07` lives in `api/_lib/shopify-theme-io.js`), and any new sealed prompt blocks appended after [14].
