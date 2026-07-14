---
name: velyr-change-control
description: How changes are classified, staged, verified, and shipped in the Velyr repo. Load BEFORE making any non-trivial code change, and always before committing, staging files, or proposing a deploy — triggers include "implement X", "ship this", "commit", "create a migration", "add a status", "update the landing copy", or any change touching more than one deploy surface (Vercel api/, Supabase edge function, SQL). Contains the staged-workflow discipline, the non-negotiables with their incidents, and pre-ship checklists per change class.
---

# Velyr Change Control

How a change becomes safe to ship here. Velyr is a solo-founder production SaaS with real paying/trialing customers; there is no CI, no staging environment, and no test coverage for most surfaces — **process discipline is the safety net**. The operator (Florian) executes everything prod-mutating himself: commits are made only when he says so, pushes/deploys/SQL are his. Your job as a session is to prepare changes so they are verifiable and reviewable, then stop at the gate.

Terms used once and reused: **edge fn** = the Supabase Edge Function `supabase/functions/agent-run/` (Deno; deploys via Supabase CLI, NOT git push). **Twin** = one of the format-locked duplicate declarations that exist because Node (`api/`) and Deno (edge fn) cannot share modules; each carries a "keep in sync" comment. **Surface** = an independently deployed part of the system.

## 1. Classify the change first

Every change falls into one or more of these classes. Classification decides the verification gate and who deploys what (deploy mechanics live in `velyr-run-and-operate`).

| Class | Files | Verification gate | Deploys via | Notes |
|---|---|---|---|---|
| Frontend | `src/**`, `index.html`, `public/**` | `npx vite build` | git push → Vercel (OPERATOR) | Never `npm run build` locally (see non-negotiable A) |
| Vercel API | `api/**` | `node --test "api/_lib/*.test.mjs"` for pure libs + `node --check <file>` | git push → Vercel (OPERATOR) | 12-function cap: new routes are usually new `?action=` branches, not new files |
| Edge fn | `supabase/functions/**` | Type-checked ONLY at deploy (no local Deno toolchain) | `npx supabase functions deploy <name>` (OPERATOR) | Does NOT ship on git push — a merged commit changes nothing until deployed |
| SQL migration | `supabase/migrations/*.sql` | Read-review only | Manually pasted into Supabase SQL Editor (OPERATOR) | The repo file is the record of what was run, not a pipeline |
| Marketing claims | `src/Home.jsx`, `index.html`, `public/llms.txt`, `src/data/faqs.js`, `ROUTES` in `scripts/prerender.mjs` | All five surfaces swept together | git push (OPERATOR) | Procedure home: `velyr-docs-and-writing` |
| Blog/SEO | `content/blog/*.md`, `scripts/lib/blog.mjs` | `npx vite build` (runs the blog plugin's parity gates) | git push (OPERATOR) | Full parity asserts only run in the deploy build |

Multi-surface changes (one logical feature spanning SQL + edge fn + Vercel) are the highest-risk class — see non-negotiable C for ordering.

## 2. The staged implementation workflow

This is the confirmed-complete working discipline for any sizable change (as of 2026-07-11). Follow it by default; deviate only if Florian says otherwise.

1. **Propose numbered stages before writing code.** Often a read-only "Stage 0" audit first (report findings with `file:line`, no edits). When the task is ambiguous, STOP and propose an approach instead of guessing.
2. **Stop after every stage** and wait for an explicit "continue".
3. **At each stop show:** the `git diff`, plus a short **flags** list — deviations from the plan, risks accepted, and values you chose (constants, defaults, copy).
4. **Verify each stage** with `npx vite build` (compile gate) and the relevant test suites. NEVER `npm run build` (non-negotiable A).
5. **Stage files individually** with explicit paths: `git add api/_lib/foo.js src/pages/Bar.jsx`. Never `git add -A`, never `git add .`. Never stage `.env*` or any auth/credential material (`client_secret.json`, `youtube_auth.py` exist untracked in this repo root — leave them).
6. **Commit only when told.** Leave unrelated pre-existing working-tree changes untouched — the tree routinely carries uncommitted side-project files (leadscan output, social assets).
7. **Anchor edits on content, never line numbers** — line numbers drift as you edit. Before removing any component, grep it for `useEffect`/`fetch`/`supabase`/`subscribe`: unmounting kills its effects, and a "duplicate" card can own a fetch another surface depends on.

Commit message convention (verified against `git log`, e.g. 58d8326, 4edc315): imperative title ≤ ~72 chars, a body explaining what/why in full sentences, and the footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (adjust the model name to the session's own).

## 3. Non-negotiables

Each rule exists because of a real incident. Do not route around them; if a task seems to require it, stop and flag.

| # | Rule | Rationale / incident |
|---|---|---|
| A | **Never run `npm run build` for local verification — use `npx vite build`.** | `scripts/prerender.mjs:328` calls `submitToIndexNow(...)` with a hardcoded key/host (`src/utils/indexNow.js`: key `a8425d52…`, host `velyr.io`, no env gate). A local build POSTs a production recrawl request to api.indexnow.org against whatever is live. The full chain belongs to the Vercel deploy build only. |
| B | **Marketing claims live in five synced surfaces — never edit one alone.** | Stale "credit card required" trial copy survived in FAQ/index.html/llms.txt after the product changed (fixed b854ae6); a full claims↔code truth pass (7880e5f) found five more contradictions days before launch. Sweep `src/Home.jsx`, `index.html`, `public/llms.txt`, `src/data/faqs.js`, `scripts/prerender.mjs` ROUTES together. Procedure: `velyr-docs-and-writing`. |
| C | **Multi-surface deploy order is SQL → edge fn → Vercel.** | Code reading a new column degrades gracefully, but dashboard *writes* to a missing column 500 (e.g. the focus-pin/DNA-verdict feature, commit f557d52 + migration `20260703_focus_page_dna_verdict.sql`: saves fail until the columns exist). Ship the migration record in the same commit; remind the OPERATOR of the order — each surface deploys separately, never "bundled". |
| D | **Format-locked twins are edited in pairs.** | Node and Deno bundles can't share modules, so logic that must match exists twice with "keep in sync" comments (inventory + exact list: `velyr-architecture-contract`). Editing one side silently diverges behavior across the cron/webhook boundary. `grep -rn "keep in sync" api supabase/functions` before touching any of them. |
| E | **A new `agent_runs.status` value needs the `agent_runs_status_check` CHECK extended by manual migration BEFORE the code ships.** | The CHECK is drop-and-recreate with the full status array (see `supabase/migrations/20260624_shopify_approval_statuses.sql`, extended again in `20260630_shopify_rollback_statuses.sql`). Code writing an unlisted status gets a constraint violation at runtime — this is exactly why the `shopify_applying`/`shopify_writing` hardening items were deferred rather than shipped codefirst. |
| F | **Honest-fail principle.** | Unknown framework → skip, don't guess; unverifiable metrics → "insufficient data", not a fabricated number; skip statuses are named honestly (`skipped_low_confidence`, not "success"). Never add a surface that renders success it cannot prove. |
| G | **A/B testing is removed — never reintroduce surfaces, naming, or implications.** | The product measures before/after, it does not A/B test. `agent_ab_tests` survives only as dormant data in the account-deletion purge list (`api/agent/run.js:672`). Copy must never imply A/B. |
| H | **Brand guardrails are prompt-only.** | `agent_brand_guardrails` is injected into the Pass-2 prompt (`supabase/functions/agent-run/index.ts:3552`) with NO post-parse enforcement. No copy or claim may say changes are "rejected before they reach you" unless someone actually builds that check. |
| I | **Nothing routes around the approval gate.** | Every fix/rollback/theme write goes live only via Telegram YES or the dashboard `approve_run` twin. Never add an auto-merge, auto-apply, or "just deploy it" path. |
| J | **Migrations are manual.** | `supabase/migrations/*.sql` files are the record of what was (or must be) pasted into the Supabase SQL Editor. Never assume a migration file implies it ran; when writing one, tell the OPERATOR it needs applying and in what order. |

## 4. What to show Florian at the gate

Before he commits/pushes/deploys, present:

- The staged diff (`git diff --staged` after individual `git add`s) or per-stage `git diff`.
- The **flags** list (deviations, risks, chosen values).
- Verification evidence: which gates ran and their output (`npx vite build` exit, test counts).
- A **deploy map** for multi-surface changes: which migration to paste, whether `npx supabase functions deploy agent-run` is needed, whether a Vercel env var / Supabase secret must be set (env catalog: `velyr-config-and-flags`).
- Anything that contradicts CLAUDE.md — CLAUDE.md is the doc of record and must be updated in the same change (see `velyr-docs-and-writing`).

## 5. Pre-ship checklists

**Frontend change**
- [ ] `npx vite build` passes
- [ ] No marketing claim touched — or all five surfaces swept (non-negotiable B)
- [ ] No count-up/reveal animation re-fires on the dashboard's 30s poll (fire once per value-key)
- [ ] Fonts: dashboard surfaces use Instrument Serif; landing serif is Cormorant Garamond (the misspelling "Cormorant Garant" is a known repo-wide bug being fixed file-by-file — don't reintroduce it)

**Vercel API change**
- [ ] `node --test "api/_lib/*.test.mjs"` green (7 suites as of 2026-07-11)
- [ ] New endpoint fits the 12-function cap (prefer a new `?action=` on an existing route; `api/_lib/` files don't count)
- [ ] Any Telegram message interpolating uncontrolled values uses `parse_mode: 'HTML'` + `escapeHtml()`
- [ ] Twin check: `grep -rn "keep in sync" api supabase/functions` on every touched file

**Edge fn change**
- [ ] Twin check (as above)
- [ ] Remind OPERATOR: ships only via `npx supabase functions deploy agent-run` — deploy is also the only type-check
- [ ] No npm imports added to customer-facing snippets (the PostHog Setup-PR must inject a CDN script-tag loader — an npm import broke customer builds because the edge fn can't run a package manager)

**SQL migration**
- [ ] File added under `supabase/migrations/` with date-prefixed name
- [ ] Status CHECKs use the drop-and-recreate full-array pattern
- [ ] OPERATOR told: apply manually, and in what order relative to code deploys (non-negotiable C)
- [ ] If adding a constraint: audit existing rows for violators first (`agent_connections_single_type_check` could only be applied after a zero-violator audit)

## When NOT to use this skill

- Diagnosing a live failure → `velyr-debugging-playbook`.
- "Has this been tried/fixed before?" → `velyr-failure-archaeology`.
- Which invariants/twins exist and why → `velyr-architecture-contract`.
- How the RA1–RA7 pipeline works internally → `velyr-agent-pipeline-reference`.
- What an env var/flag does and where it lives → `velyr-config-and-flags`.
- Setting up a working environment → `velyr-build-and-env`.
- Exact deploy/operate commands and cron anatomy → `velyr-run-and-operate`.
- Measuring instead of eyeballing (SQL packs, harnesses) → `velyr-diagnostics-and-tooling`.
- What counts as evidence / adding tests → `velyr-validation-and-qa`.
- Editing docs of record or marketing copy → `velyr-docs-and-writing`.
- Leadscan/social/Product Hunt work → `velyr-growth-ops`.

## Provenance and maintenance

Verified against the repo on 2026-07-11. Re-verify before relying on:

- Build chain still pings IndexNow: `grep -n submitToIndexNow scripts/prerender.mjs src/utils/indexNow.js`
- npm scripts unchanged: `grep -A3 '"scripts"' package.json`
- Test suite count: `node --test "api/_lib/*.test.mjs" 2>&1 | tail -5`
- Guardrails still prompt-only: `grep -n guardrailsContext supabase/functions/agent-run/index.ts`
- Status CHECK pattern / latest array: `ls supabase/migrations | grep -i status` then read the newest
- Twin inventory drift: `grep -rln "keep in sync" api supabase/functions`
- A/B remnant still purge-list-only: `grep -rn agent_ab_tests api supabase/functions`
- Commit footer convention: `git log -3 --format=%B`
