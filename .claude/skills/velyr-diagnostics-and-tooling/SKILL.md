---
name: velyr-diagnostics-and-tooling
description: How to MEASURE Velyr instead of eyeballing it — the SQL query pack for run/DNA/impact/spend/ranker data, the local test harnesses, and the remote observability reads. Load when you need data to answer a question: "how many runs failed", "is the ranker falling back", "what did this run cost", "did the fix measurably win", "is the GC running", when verifying a hypothesis with production data, or before/after running any test or verification harness (email preview, Shopify dev-store verify, puppeteer shots). NOT for symptom-first triage (velyr-debugging-playbook), evidence standards (velyr-validation-and-qa), or deploying (velyr-run-and-operate).
---

# Velyr diagnostics and tooling

Measure, don't eyeball. This skill has three parts: the **SQL query pack** (`queries/diagnostics.sql` in this skill directory) with an interpretation guide per query, the **local tool inventory** (what each script proves and needs), and the **remote observability reads**.

**Terms used once:** *edge fn* = the Supabase Edge Function `supabase/functions/agent-run/` (Deno) that executes the weekly pipeline. *Pass 1 / Pass 2* = the two LLM calls (component ranking / fix generation). *DNA* = `agent_business_dna`, the persistent per-fix outcome log. *Matched-window* = the deploy±2d before/after comparison in `impact_metrics`.

## Running prod queries

Read-only diagnosis against the production DB is established practice, but **announce it in your reply before doing it**, and run one query at a time:

```bash
npx supabase db query "<one SELECT from queries/diagnostics.sql>" --linked --output json
```

Prerequisite (one-time, usually already done): CLI logged in + `npx supabase link --project-ref <ref> --yes`. The project ref is `mtqctjgecbscjmottauv` (verified in-repo at `shopify.app.toml:16`). Anything that WRITES to prod is **OPERATOR (ask Florian)**.

## Query pack index and interpretation

File: `queries/diagnostics.sql` (all read-only; schema verified 2026-07-11 — DDL-backed tables are cited to their migration, base tables are code-derived and say so inline).

| # | Question | Healthy shape | Red flag means |
|---|----------|---------------|----------------|
| Q1 | Zombie runs? | 0 rows | An isolate was hard-killed mid-run (wall-clock/OOM). The 60-min stale sweep (daily cron + `trigger_run` pre-check) will mark it `failed`; a row here between sweeps also explains a blocked "Run now". See velyr-debugging-playbook §1. |
| Q2 | What are runs doing right now? | Recent rows end `current_step='done'` | A run parked at `finding_biggest_issue` with old `created_at` = stuck in Pass 2 (cross-check Q9 `updated_at`). `error_message` is populated on `failed`. |
| Q3 | 30d status mix | Mostly `deployed`/`shopify_deployed`/`waiting_approval` + honest skips | Rising `failed` = infra problem; rising `find_mismatch` = Pass 2 emitting non-matching find strings (B4 self-heal already retried once). |
| Q4 | Why are runs skipping? | Occasional, varied | A dominant skip status is actionable: `skipped_no_data` → PostHog partition/traffic; `skipped_insufficient_graph` → sparse-gate (MIN_GRAPH_NODES=3, plain-html always trips it); `skipped_cost_cap` → wallet cap hit; `skipped_setup_pending` → Setup-PR unanswered. |
| Q5 | Fix win-rate | `measured_win` + `survived` dominate; few `rollback` | Many `pending` older than 7d = `promotePendingDNA` not resolving (runs not in `deployed`/`shopify_deployed`, or the daily cron failing). The query normalizes legacy `success` → `survived`. |
| Q6 | Which fix types win | Signal concentrated in a few types | `owner_rejected` clusters on one fix_type = the agent repeatedly proposes something the owner hates; that's prompt-bias material (velyr-fix-quality-campaign). |
| Q7 | Did run X measurably help? | One `*_bounce_rate` row, improvement ≥ 0 | No rows = either <48h since deploy, under the 100-sessions/side floor, or the run never deployed. NEVER substitute `agent_runs.bounce_rate_before/after` as a pair — mixed windows. |
| Q8 | Is goal measurement live? | Grows once owners set a conversion goal | 0 rows with goals configured = `conversion_goal_event` unset or the goal query failing (it's additive/best-effort by design). |
| Q9 | Spend + last-LLM-call tracer | cost_eur well under the €20 cap | `updated_at` is the **stuck-run clock**: ranker usage recorded but no Pass-2 usage + no `writing_fix` checkpoint + no failure = isolate died inside Pass 2. |
| Q10 | Ranker falling back? | `heuristic_nodes` = 0 | `rankReason LIKE 'heuristic score%'` = Pass 1 LLM call failed and the run degraded to heuristic ranking (loud `ranker_pass1_fallback` log in the edge fn). Persistent fallback = check OpenRouter/model config. |
| Q11 | Do merged fixes render? | `visible` dominates | `not_visible` = merged but never rendered (customer CI/redeploy missed — the owner was Telegram-notified); `not_assessable` clusters = screenshot quality problem. |
| Q12 | Approvals waiting | Short queue, young | Old `waiting_approval` rows = owner not responding (nudge is a product question, not a bug). `telegram_message_id` null = the approval message failed to send — check Telegram triage. |
| Q13 | Emails sending? | One `welcome` per sub, `weekly_digest` per ISO week | Rows are *claims that survived* (claim released on failed send). Missing expected rows = Mailjet env absent (Vercel-only) or `email_opt_out` set. |
| Q14 | GC alive? | dedupe oldest <7d; few rate-limit windows | Old rows piling up = the daily `enforce_subscriptions` cron isn't completing its GC section. |

## Local tool inventory

All verified runnable on 2026-07-11 (Windows, Git Bash). Safe = no network side effects.

| Tool | Command | Proves | Needs / caveats |
|------|---------|--------|-----------------|
| Pure-lib suites | `node --test "api/_lib/*.test.mjs"` | 7 suites green: badge-install (21 asserts), posthog-inject (11), route-scope (37), run-reconcile (5 branches), shopify-rollback (27), trial-fingerprint (37), win-card (15) | QUOTE the glob — bare `node --test api/_lib/` fails here. Safe. |
| Liquid validator suite | `node scripts/test-liquid-blocks.mjs` | 27 asserts on `liquid-block-validate.ts` logic | Safe. |
| Blog parity gate | `node scripts/assert-blog-parity.mjs` | dist crawler-fallback HTML ≡ blog JSON ≡ inline payload | Reads `dist/` — needs a prior build. Run after `npx vite build` **plus prerender output**; normally only meaningful in the full deploy chain. NEVER run `npm run build` locally to feed it (prod IndexNow ping). |
| HogQL gate | `node scripts/assert-hogql-safe.mjs` | every ```sql/hogql``` block in `content/blog/*.md` uses only allowlisted functions/$-properties | Reads `content/` only — safe standalone. |
| Email preview | `node scripts/email-preview.mjs` | Renders all 4 lifecycle templates to `.email-preview/*.html`; no network, no env needed (placeholder HMAC injected) | The `--send you@x.com` flag does a **real Mailjet send** — OPERATOR (ask Florian). Reads `.env.local` if present. |
| Shopify dev-store harness | `SHOPIFY_SHOP=… SHOPIFY_TOKEN=… SHOPIFY_THEME_ID=… node scripts/shopify-dv-verify.mjs` | The **six** GraphQL shape checks (per the script header): (1) `themeFilesUpsert` effect (job may be null = synchronous), (2) checksum re-query, (3) body-union read, (4) `themeFilesDelete`, (5) async `themeDuplicate` + `waitForThemeReady`, (6) theme delete | MUTATES a store (one throwaway snippet + one throwaway theme). DEV STORE ONLY, needs `read_themes,write_themes` token — OPERATOR (ask Florian). Steps 5+6 gate `AGENT_SHOPIFY_PREVIEW_THEMES`. |
| Landing UX asserts | `node scripts/assert.mjs` | Reduced-motion visibility + landing invariants via headless Chrome against `http://localhost:4173/` | Needs `npm run preview` serving a build, and Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`. Safe (local). |
| Screenshot helper | `node scripts/shoot.mjs` (`SHOT_URL` overrides target) | Renders pages to `shots/` for visual comparison | Same Chrome + preview-server needs. Safe (local). |
| Blog generator | `scripts/generate-articles.mjs` | — | Owned by velyr-docs-and-writing (own `GEN_MODEL` env; calls OpenRouter). |

## Remote observability reads (document-only — announce first)

| Read | Command | Interpretation |
|------|---------|----------------|
| Edge fn deploy times | `npx supabase functions list` | `updated_at` is **epoch milliseconds**. Correlate with `git log` to rule a redeploy in/out of a behavior change. |
| Supabase secrets | `npx supabase secrets list --project-ref mtqctjgecbscjmottauv` | Values come back SHA-256-hashed — you can confirm a secret is SET and whether its hash CHANGED, never its value. (No `--linked` flag on this subcommand.) |
| Edge fn logs | Supabase dashboard only | No CLI tail exists in this repo's workflow (UNVERIFIED beyond project notes, 2026-07-11). |
| PostHog traffic sanity | PostHog UI, the shared project | All customers share one project; filter events by `properties.$host = '<customer domain>'`. A customer with zero $host-tagged events = their snippet/loader isn't live → the agent's analytics block is skipped by design. |

## Tracer techniques

- **Last-LLM-call clock:** `agent_llm_usage.updated_at` (Q9). Ranker recorded + nothing after = death inside Pass 2.
- **Progress trail:** `agent_runs.current_step` (Q2). The step vocabulary is in the Q2 comment; there is no screenshot checkpoint — the dashboard's "step 8 Taking before screenshot" label is UI drift.
- **Audit trail:** the Telegram chat history is a timestamped record of every approval message, decision, and alert.
- **Deploy-vs-behavior drift:** `git log --oneline -10` (Vercel side, ships on push) vs `npx supabase functions list` (edge side, ships only on manual deploy). Behavior "not matching the code" usually means the edge fn wasn't redeployed.

## When NOT to use this skill

- You have a **symptom** and want the triage path → **velyr-debugging-playbook** (it consumes these tools in a fixed order).
- You want to know **what counts as sufficient evidence** to ship → **velyr-validation-and-qa**.
- You want to **deploy, apply migrations, or operate crons** → **velyr-run-and-operate**.
- You're improving the fix win-rate itself → **velyr-fix-quality-campaign** (its Phase 0 baseline is built from Q3–Q11 here).

## Provenance and maintenance

Facts here were verified 2026-07-11. Re-verify before trusting:

- Query-pack schema: `grep -n "impact_metrics\|agent_business_dna\|current_step" api/agent/run.js supabase/functions/agent-run/index.ts | head -30` (column drift) and `ls supabase/migrations/` (new DDL).
- Status vocabulary: `grep -A30 "agent_runs_status_check" supabase/migrations/20260630_shopify_rollback_statuses.sql` (superseded by any newer status migration).
- Test-suite counts: `node --test "api/_lib/*.test.mjs"` and `node scripts/test-liquid-blocks.mjs`.
- Skip statuses actually written: `grep -o "'skipped_[a-z_]*'" supabase/functions/agent-run/index.ts | sort -u`.
- rankReason storage: `grep -n "rankReason" supabase/functions/agent-run/index.ts` (nodes jsonb, edge index.ts:4253 as of 2026-07-11).
- MEASURED_WIN_MIN_PP / stale threshold: `grep -n "MEASURED_WIN_MIN_PP\|STALE_RUN_THRESHOLD_MS" api/agent/run.js`.
- dv-verify env + checks: `head -30 scripts/shopify-dv-verify.mjs`.
- email-preview send flag: `grep -n "\-\-send" scripts/email-preview.mjs`.
