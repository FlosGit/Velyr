---
name: velyr-validation-and-qa
description: What counts as evidence in the Velyr repo and how to produce it. Load when writing or adding tests, deciding whether a change is verified enough to ship, answering "how do I test this" / "is this tested", citing or changing an acceptance threshold (bounce floors, rollback pp, spend cap), or BEFORE claiming "this works" / "verified" in any report. Covers the verification ladder, the full test-suite inventory, the house test pattern (pure-core/IO-shell), and the named-constant threshold discipline.
---

# Velyr — Validation and QA

How this repo proves things. There is **no CI, no linter, no type checker, and no test runner in `package.json`** (as of 2026-07-11). Verification is a ladder of explicit commands, and "verified" always means *you ran the command and can show the output* or *you read the code at a cited file:line*.

Terms used once: **edge fn** = the Deno function `supabase/functions/agent-run/` (deployed via Supabase CLI, not git push). **Twin** = a format-locked duplicate of logic across the Node/Deno boundary (inventory: velyr-architecture-contract). **OPERATOR** = a step Florian executes, not a Claude session.

## 1. The verification ladder

Run the cheapest rung that can catch your mistake; state which rungs you ran. Every rung's command is copy-pasteable from the repo root (Git Bash).

| # | Rung | Command | Proves | Cannot prove |
|---|------|---------|--------|--------------|
| 1 | Syntax | `node --check api/agent/run.js` (any JS file) | File parses as ESM | Runtime behavior, imports resolving |
| 2 | Frontend/compile + blog gate | `npx vite build` | SPA compiles; blog articles pass the gate (required frontmatter, `related:` slugs resolve, near-dup dedupe) via `scripts/vite-plugin-blog.mjs` `generateBundle` → `loadArticles()` | Anything about `api/` or the edge fn; visual correctness |
| 3 | Pure-lib tests | `node --test "api/_lib/*.test.mjs"` (**quoted glob** — bare `node --test api/_lib/` fails on this setup) | The 8 pinned behavior sets below | Handler wiring, DB schema, network I/O |
| 4 | Liquid validator tests | `node scripts/test-liquid-blocks.mjs` | Theme block-validation logic (27 assertions) | Real-theme edge cases beyond the provable-only rules |
| 4b | HTML validator tests | `node scripts/test-html-validate.mjs` | W3 shell-validation logic (19 assertions) | Full HTML parsing; the comparative old-vs-new logic in index.ts's `validateHtmlEdit` |
| 5 | Deno type-check | `npx supabase functions deploy agent-run --project-ref <ref>` — **OPERATOR** | Edge fn type-checks (this is the ONLY Deno gate; no local toolchain) | Logic correctness |
| 6 | Dev-store harness | `SHOPIFY_SHOP=… SHOPIFY_TOKEN=… SHOPIFY_THEME_ID=… node scripts/shopify-dv-verify.mjs` — **OPERATOR, dev store only, never a merchant store** | The six live Shopify GraphQL shapes (upsert effect, checksum re-query, read body, delete, themeDuplicate, themeDelete). Steps 5+6 must both pass before `AGENT_SHOPIFY_PREVIEW_THEMES` may be enabled | Anything about a real merchant's theme |
| 7 | Prod observation | Telegram messages, dashboard, read-only DB query (announce first; see velyr-diagnostics-and-tooling) | The deployed system's actual behavior | — |

**Never run `npm run build` locally** — it pings production IndexNow (see velyr-change-control). `npx vite build` is the local gate.

**Blind spots — say so when relevant:** no automated tests cover the edge-fn logic (rung 5 is types only), frontend behavior, `api/` handler wiring, or LLM prompt quality. A change there is "verified" only up to compile/type level plus whatever manual or prod observation you did.

## 2. Test-suite inventory (all green as of 2026-07-11)

Run all: `node --test "api/_lib/*.test.mjs" && node scripts/test-liquid-blocks.mjs`. **Keep-green duty:** every one of these must pass before any commit that touches their modules.

| Suite | Module under test | Assertions | Pins |
|-------|-------------------|-----------:|------|
| `api/_lib/badge-install.test.mjs` | `badge-install.js` | 21 | Marker-wrapped badge blocks (html + jsx variants), hostile-slug sanitization to `[a-z0-9-]`, injection lands before `</body>`, re-inject idempotence |
| `api/_lib/posthog-inject.test.mjs` | `supabase/functions/agent-run/posthog-inject.mjs` (shared dependency-free ESM — the Node test imports the SAME file the Deno edge fn runs) | 11 | Marker-block-aware self-heal decision `decidePostHogInjection` (fresh inject / healthy noop / broken-loader re-propose) |
| `api/_lib/route-scope.test.mjs` | `route-scope.js` (pure) | 37 | File→route-scope resolution for theme + React/Next files; guard (a): one site-wide file poisons the set; guard (b): scoped population below floor → `rate: null`; sessionize/bounce math; never trust a non-route mapping |
| `api/_lib/run-reconcile.test.mjs` | `run-reconcile.js` | 5 tests | The A1 branches: deployed(rollback)→`rolled_back`+DNA `rollback`; deployed(fix)→`deployed`+DNA `pending`; CAS-loss→noop; rejected(rollback)→stays `deployed`; rejected(fix)→`rejected`+DNA `rollback` |
| `api/_lib/shopify-rollback.test.mjs` | `shopify-rollback.js` (pure) | 27 | `classifyConcurrency` (checksum mismatch → abort), `planRollbackOps` (modified→re-upsert prior, created→delete), `confirmApplied`, `normalizePendingWrite` |
| `api/_lib/trial-fingerprint.test.mjs` | `trial-fingerprint.js` (pure) | 37 | `canonicalizeHost`, HMAC fingerprint stability, `computeTrialFingerprints` shapes |
| `api/_lib/win-card.test.mjs` | `win-card.js` (pure) | 15 | `escapeXml` (all five XML chars + nullish), SVG builders escape hostile input, honest no-win fallback line |
| `scripts/test-liquid-blocks.mjs` | `supabase/functions/agent-run/liquid-block-validate.ts` logic | 27 | Provable-only Liquid block pairing, `{% schema %}` JSON parse, `{% liquid %}` tag opt-out |
| `scripts/test-html-validate.mjs` | `supabase/functions/agent-run/html-validate.ts` logic (W3) | 19 | Orphan open-comment, script/style count balance, JSON-LD parse, inline-script extraction (src/ld+json/commented-out excluded, module flag) |

## 3. How to add a test (house pattern)

The house style is **pure-core / IO-shell**: extract the decision logic into a pure module in `api/_lib/` (precedents: `route-scope.js`, `shopify-rollback.js`, `run-reconcile.js`, `win-card.js`, and the cross-runtime `posthog-inject.mjs`), test the pure part exhaustively, keep the I/O caller thin. No test framework, no mocking library. Two established shapes:

**(a) Pure module — assertion counter** (most suites):

```js
// api/_lib/my-module.test.mjs — run: node api/_lib/my-module.test.mjs
import { myPureFn } from './my-module.js'

let passed = 0
const failures = []
function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`)
}

eq('describes the behavior pinned', myPureFn('input'), { ok: true })

if (failures.length) {
  console.error(`my-module tests: ${failures.length} FAILED, ${passed} passed\n`)
  for (const f of failures) console.error(`  ✕ ${f}\n`)
  process.exit(1)
}
console.log(`my-module tests: all ${passed} passed`)
```

Non-zero exit on failure is what integrates it with `node --test` (each file = one test). Name it `*.test.mjs` under `api/_lib/` and the existing glob picks it up — no registration step.

**(b) Unavoidable Supabase interaction — tiny hand-rolled chainable mock** (see `run-reconcile.test.mjs`): a ~30-line object whose `from().update().eq().select()` chain records operations and returns configured CAS results. Copy that mock rather than adding a mocking dependency.

Rules: test files import production modules directly (relative paths — the posthog-inject test reaches into `supabase/functions/` for the shared ESM); never add devDependencies for testing; hostile-input cases (XSS-ish strings) are expected for anything that renders or injects.

## 4. Acceptance-threshold inventory

Thresholds are **named constants**, env-overridable where operational, **twinned when read on both runtimes**, and success criteria are stated *before* shipping — outcomes are measured, never judged by eye. Verified locations (as of 2026-07-11):

| Constant | Value | Where | Meaning |
|----------|------:|-------|---------|
| `MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION` | 100/side (env-overridable) | `api/agent/run.js:1228` | Below this per window → `insufficient_data`, no attribution, no rollback |
| `ROLLBACK_BOUNCE_PP_THRESHOLD` | 15 pp | `api/agent/run.js:1087` ↔ **twin** `supabase/functions/agent-run/receipt-builder.ts:52` | Bounce +15pp in matched windows → rollback proposal |
| `MEASURED_WIN_MIN_PP` | 5 pp | `api/agent/run.js:216` | 7d DNA promotion: ≥5pp bounce improvement = `measured_win`, else `survived`. Within-noise band at `run.js:1698-1704` hardcodes the 15 — keep in sync with the rollback threshold |
| `NO_DATA_THRESHOLDS.MIN_UNIQUE_VISITORS_7D` | 5 | edge `index.ts:388` | Engagement/no-data gate: <5 sessions/7d = no analytics signal |
| `NO_DATA_THRESHOLDS.MIN_REPO_FILES` | 2 | edge `index.ts:389` | Import-graph floor for the no-data skip |
| `MIN_GRAPH_NODES` (`AGENT_MIN_GRAPH_NODES`) | 3 | `component-ranker.ts:55` | Sparse-graph gate — below it Pass 1 skips (why plain-html always skips) |
| `STALE_RUN_THRESHOLD_MS` | 60 min (env-overridable) | `api/agent/run.js:331` ↔ **twin** edge `index.ts:5526` | Zombie `running` row sweep |
| `MONTHLY_SPEND_CAP_EUR` (`AGENT_MONTHLY_SPEND_CAP_EUR`) | €20.00 | edge `index.ts:101` | Per-subscription monthly LLM wallet cap |

When adding a threshold: name it, put the default in code, decide env-override, check whether both runtimes read it (→ twin + "keep in sync" comment), and record the intended pass/fail criterion in the PR/commit text before the data comes in.

## 5. Golden / certified inventory

- **Dev-store harness** (`scripts/shopify-dv-verify.mjs`): the certification gate for Shopify write paths. Exercises the actual production helpers in `api/_lib/shopify-theme-io.js` against a throwaway snippet + throwaway theme duplicate. `job` from `themeFilesUpsert` is OPTIONAL (small upserts complete synchronously with `job = null`) — the harness asserts the write EFFECT, never `job.id`. OPERATOR-only, dev store only.
- **Byte-identical bar for pure refactors**: performance/parallelism refactors must keep output byte-identical — precedent: commit `7db9fc4` ("Parallelize RA2/RA4 GitHub fetches (concurrency 8), keeping output byte-identical"). If you can't demonstrate identical output, it's a behavior change and goes through full gates.
- **Independent adversarial review** for big change waves: assign separate reviewer agents to break the claims before shipping (recipe: velyr-proof-and-analysis-methods).

## 6. Evidence standards for reports

- "Verified" = command ran + output shown, or code read at file:line. Anything else is "expected/unverified" — label it.
- Claims about production behavior require a production observation (Telegram/dashboard/DB read), not code reading alone.
- Marketing/user-facing claims require the claims↔code truth-pass (velyr-docs-and-writing owns the 5-surface procedure).
- If tests fail, report the failure verbatim — never ship on a red suite, never mark work complete with a failing rung.

## When NOT to use this skill

- Looking for the diagnostic SQL pack or measurement tools → **velyr-diagnostics-and-tooling**.
- Deciding the ship process, staging, deploy order → **velyr-change-control**.
- First-principles analysis recipes (root-cause discipline, matched-window math, truth-pass) → **velyr-proof-and-analysis-methods**.
- Triage of a live failure → **velyr-debugging-playbook**.

## Provenance and maintenance

Facts verified against the repo on 2026-07-11. Re-verify with:

- Suite list + pass state: `node --test "api/_lib/*.test.mjs" && node scripts/test-liquid-blocks.mjs`
- Assertion counts: `node api/_lib/<name>.test.mjs` (each prints its count)
- Threshold values/lines: `grep -rn "MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION\|ROLLBACK_BOUNCE_PP_THRESHOLD\|MEASURED_WIN_MIN_PP\|MIN_UNIQUE_VISITORS_7D\|MIN_GRAPH_NODES\|STALE_RUN_THRESHOLD_MS\|MONTHLY_SPEND_CAP_EUR" api supabase --include="*.js" --include="*.ts"`
- Blog-gate wiring: `grep -n "loadArticles\|generateBundle" scripts/vite-plugin-blog.mjs`
- Dev-store harness contract: `head -30 scripts/shopify-dv-verify.mjs`
- Still no test script in package.json: `grep -n "test" package.json`
