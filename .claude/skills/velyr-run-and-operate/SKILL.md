---
name: velyr-run-and-operate
description: Operator runbook for shipping and running Velyr in production — the three deploy surfaces (Vercel git-push, Supabase edge function CLI deploy, manual SQL migrations) with exact commands and ordering, the cron schedule and its auth, manual/first agent runs, the full /api/agent/run action list, prod observability (edge logs, prod DB reads, functions list), platform webhook/config inventory, and zombie-run remediation. Load when deploying ANYTHING, applying a migration, asking "how does this ship" or "where does this run", setting up a webhook, checking prod logs or secrets, triggering/pausing agent runs, or verifying that code changes actually reached production.
---

# Velyr: Run and Operate

How Velyr ships and runs in production. **Velyr has no CI and no automated deploy pipeline for two of its three surfaces** — knowing which surface a file belongs to, and who pushes the button, is the core operational skill here.

## The operator model

Claude sessions **prepare and verify**; Florian (the operator) **executes anything that mutates production**: git pushes, edge-function deploys, SQL in the Supabase SQL Editor, secrets changes, dashboard toggles. Structure every ops task as:

1. **Session prepares** — exact command / SQL / diff, plus what to expect.
2. **OPERATOR executes** — hand it over explicitly ("ready for you to run: …").
3. **Session verifies** — read-only checks afterwards (queries, `functions list`, behavior).

Read-only prod DB queries for diagnosis are established practice (see "Prod observability"), but announce before running them.

## The three deploy surfaces

A single logical change can span all three. **They ship separately — never assume one push deployed everything.**

| Surface | What lives there | How it ships | Type-check gate |
|---|---|---|---|
| Vercel | `src/` frontend, `api/` serverless functions, `vercel.json` | `git push` to `main` → Vercel auto-deploys — **OPERATOR** | none (only `npx vite build` locally) |
| Supabase Edge Functions | `supabase/functions/agent-run/`, `supabase/functions/shopify-oauth/` | `npx supabase functions deploy <name> --project-ref mtqctjgecbscjmottauv` — **OPERATOR** | Deno type-check happens AT deploy (only gate; no local Deno toolchain) |
| Supabase Postgres | `supabase/migrations/*.sql` | Applied **manually** in the Supabase SQL Editor — **OPERATOR**. The repo file is the *record* of what was run, not an automated pipeline | none |

Notes (verified 2026-07-11):

- There is **no `supabase/config.toml`** in the repo (`supabase/` contains only `functions/` and `migrations/`), so edge deploys need `--project-ref` or a one-time `npx supabase link --project-ref mtqctjgecbscjmottauv --yes`. The project ref is verifiable in-repo: it appears in `shopify.app.toml` (`redirect_urls = ["https://mtqctjgecbscjmottauv.supabase.co/functions/v1/shopify-oauth"]`).
- **"Code is fixed but prod behavior unchanged"** almost always means the edge function wasn't redeployed. Check `npx supabase functions list` — `updated_at` is epoch milliseconds (last deploy time).

### Multi-surface deploy order: SQL → edge fn → Vercel

Readers are written to degrade gracefully when a column is missing, but **dashboard/API writes 500 until the column exists** (precedent: the `focus_page_path` / `user_verdict` rollout — saves failed until the migration ran). So: migration first, then the edge function, then the Vercel push.

### Migration checklist

1. Write the `.sql` file into `supabase/migrations/` named `YYYYMMDD_<topic>.sql`. House style: a header comment explaining WHY, idempotent statements (`drop constraint if exists` → `add constraint`), and a note when it was applied.
2. **For any `ADD CONSTRAINT`: audit for violators first** — `ADD CONSTRAINT` fails if existing rows violate it. Precedent in `supabase/migrations/20260620_agent_connections_single_type_check.sql`, which embeds its own audit query:
   ```sql
   SELECT subscription_id, github_repo_name, shopify_shop_domain
   FROM public.agent_connections
   WHERE github_repo_name IS NOT NULL AND shopify_shop_domain IS NOT NULL;
   ```
   Run the audit (read-only), clean violators per-row (OPERATOR), then apply.
3. New `agent_runs` statuses must be added to the `agent_runs_status_check` CHECK **before** code that writes them ships (see the 20260624/20260630 migrations for the drop-and-recreate full-array pattern).
4. OPERATOR pastes the SQL into the Supabase SQL Editor and runs it.
5. Session verifies: query `information_schema` or the target table via the read-only CLI (below).

## Cron map (verified against `vercel.json`, 2026-07-11)

| Schedule (UTC) | Path | Runs where | Purpose |
|---|---|---|---|
| Mon 09:00 | `/api/agent/run` (no mode) | fire-and-forget → edge fn | Weekly full run (fan-out: one `single_run` invocation per subscription) |
| Mon 08:00 | `?mode=weekly_summary` | inline in Vercel | Telegram + email weekly digest |
| Wed 09:00 | `?mode=midweek` | inline in Vercel | Midweek analytics pulse |
| Wed 10:00 | `?mode=rollback_check` | inline in Vercel | 48h-window bounce comparison → rollback proposals |
| Daily 00:00 | `?mode=enforce_subscriptions` | inline in Vercel | Subscription enforcement, stale-run sweep, GC, drip emails, 48h visual verification |

The mode-less full run POSTs to the edge function with a 2s `AbortController` and returns without awaiting; **AbortError = the request WAS sent** (the edge run continues via `EdgeRuntime.waitUntil`); only a non-abort error means dispatch failed → the handler returns 502 (`api/agent/run.js` full-run block; shared helper `api/_lib/edge-dispatch.js`).

### Cron auth — CLAUDE.md is stale here

CLAUDE.md says cron requests carry "`x-vercel-cron` or `x-cron-secret`". **The code no longer trusts `x-vercel-cron`** (`api/agent/run.js:701–705`: treated as unprovable defense-in-depth and removed). `authorizeCron` (`api/agent/run.js:156–175`) accepts, constant-time-compared:

- `x-cron-secret: $AGENT_CRON_SECRET` — for external schedulers / manual curl, **or**
- `Authorization: Bearer $CRON_SECRET` — Vercel's native pattern: when the `CRON_SECRET` env var is set on the project, Vercel attaches this header to cron invocations automatically.

If **neither** env var is configured the endpoint refuses everything with 500. A manual cron-mode invocation is prod-mutating — **OPERATOR** only:

```bash
curl -X POST "https://velyr.io/api/agent/run?mode=rollback_check" -H "x-cron-secret: $AGENT_CRON_SECRET"
```

## Agent run paths beyond cron

- **Dashboard "Run now"** → `POST /api/agent/run?action=trigger_run` (user JWT). Guards, in order (`handleTriggerRun`, `api/agent/run.js:2265–2330`): 409 if paused → 402 unless `subscription_status ∈ {active, trialing}` → `cleanupStaleRuns()` pre-sweep (so a zombie `running` row can't block; incident 2026-07-09) → 409 if a run is in-flight (`running`, `waiting_approval`, `shopify_awaiting_approval`, `shopify_rollback_pending`) → 429 + `Retry-After` if a manual run happened in the last 24h (`MANUAL_RUN_COOLDOWN_MS`). Cron and auto runs deliberately do NOT consume the daily allowance.
- **First run after onboarding** → `maybeDispatchFirstRun` in `api/stripe.js:22–33`, fired from `start_trial` (both the fresh-trial path and an idempotent recovery path); no-ops if any run exists for the subscription. Monday's cron is the backstop.
- **Follow-up run after a PostHog-setup decision** → `startFollowupRun` (`api/_lib/edge-dispatch.js`) — refunds the manual-run cooldown if dispatch fails.

## Full `/api/agent/run?action=` inventory (verified 2026-07-11)

| Auth class | Actions |
|---|---|
| Public, no auth | `public-timeline` (gated on `is_public`), `win_badge`, `win_card` (SVG embeds, `is_public`-gated) |
| Public, HMAC token | `email_opt_out` (`sub` + `token` HMAC minted by `api/_lib/email.js`; GET for humans, POST for RFC 8058) |
| User JWT (Bearer) | `update-settings`, `reenable_snippet`, `trigger_run`, `dna_verdict`, `install_badge`, `approve_run`, `reject_run`, `pause`, `resume`, `delete` |
| Cron secret | `?mode=midweek` / `rollback_check` / `weekly_summary` / `enforce_subscriptions`, and the mode-less full run |

All of these live in ONE file (`api/agent/run.js`) deliberately — Vercel Hobby's 12-function cap. Never split them out (see velyr-architecture-contract).

## Prod observability

| What | How | Notes |
|---|---|---|
| Read-only prod DB | `npx supabase db query "<sql>" --linked --output json` | Requires the one-time `link` above. **Announce before running; SELECT only** — any mutating SQL is OPERATOR-in-SQL-Editor. Useful queries live in velyr-diagnostics-and-tooling. |
| Last edge deploy time | `npx supabase functions list` | `updated_at` is epoch ms. Correlate with `git log` to detect "edited but never deployed". |
| Supabase secrets | `npx supabase secrets list --project-ref mtqctjgecbscjmottauv` | Values come back SHA-256-hashed (compare against `printf '%s' "value" | sha256sum`). This subcommand takes `--project-ref`, not `--linked`. OPERATOR/announced. |
| Edge function logs | Supabase dashboard → Edge Functions → agent-run → Logs | Dashboard-only per project practice (UNVERIFIED in-repo, project notes 2026-07-11). |
| Vercel function logs | Vercel dashboard (CLI not installed as of 2026-07-11) | Covers the inline cron modes + webhooks. |
| LLM-call tracer | `agent_llm_usage.updated_at` | Tells you when the last LLM call finished — see velyr-debugging-playbook. |

## Platform config inventory (operator-owned)

Sessions rarely touch these but must know they exist and where they point:

- **Telegram webhook** → `POST /api/webhooks/telegram` with `secret_token` = `TELEGRAM_WEBHOOK_SECRET`. Setup curl documented in `.env.example:41–43` (`https://api.telegram.org/bot{TOKEN}/setWebhook`).
- **GitHub App** → webhook subscribes to Pull requests events → `POST /api/webhooks/github`, HMAC via `GITHUB_WEBHOOK_SECRET` (`.env.example:30–35`; App permissions: Contents R/W, Pull requests R/W, Metadata R).
- **Stripe webhook** → `POST /api/webhooks/stripe`, signed with `STRIPE_WEBHOOK_SECRET`.
- **Shopify app** → `shopify.app.toml` (client_id `749e9adc…`, `scopes = "read_themes,write_themes"`, OAuth redirect to the Supabase `shopify-oauth` edge function, webhooks api_version 2026-04).
- **Supabase Auth SMTP** — signup/reset/magic-link emails; configured in the Supabase dashboard, entirely separate from Mailjet lifecycle emails.
- **PostHog** — ONE shared project for all customers, partitioned by `$host` (project id 412701, US cloud — project notes 2026-07-11); the "dead clicks autocapture" project toggle must stay enabled for the `$dead_click` signal.
- **Supabase Storage** — a **PUBLIC bucket named `screenshots` must exist** or every screenshot upload silently returns null (`api/_lib/screenshot.js:49`, edge `index.ts:2777`). Create-once SQL (from project notes, 2026-07-11 — OPERATOR):
  ```sql
  insert into storage.buckets (id, name, public) values ('screenshots','screenshots', true)
  on conflict (id) do update set public = true;
  ```

## Artifact and data conventions

- **`screenshots` bucket** — one PNG per capture, `crypto.randomUUID().png`; public URLs stored in `agent_runs.screenshot_before/after`; GC'd by the daily cron (180d, cross-referenced against live rows).
- **`dist/`** — build output, gitignored.
- **`shots/`** — committed design/reference JPEGs (tracked in git).
- **`product-hunt/`, `social/`, `velyr-leadscan/` output files, `VELYR_OVERVIEW.md`** — untracked working artifacts as of 2026-07-11 (see velyr-growth-ops for their runbooks).

## Zombie-run remediation

Diagnosis path lives in velyr-debugging-playbook (symptom: run stuck, "Run now" blocked). Once confirmed stale (status `running`, older than 60 min, no live isolate):

1. Normally **no manual action needed** — the daily `enforce_subscriptions` cron and the `trigger_run` pre-check both run `cleanupStaleRuns` (since commit 509d852).
2. If it must be cleared NOW — **OPERATOR** in the SQL Editor (same values `cleanupStaleRuns` writes):
   ```sql
   update agent_runs set status = 'failed'
   where id = '<run-id>' and status = 'running';
   update agent_subscriptions set last_manual_run_at = null where id = '<sub-id>';
   ```
3. Session verifies: the dashboard unblocks; re-query the run row.

## When NOT to use this skill

- Deciding **whether/how a change should ship** (gates, staging discipline, non-negotiables) → **velyr-change-control**.
- Local dev setup, `npx vite build`, the IndexNow trap → **velyr-build-and-env**.
- Something is broken and you're triaging → **velyr-debugging-playbook**.
- You need SQL/tools to measure behavior → **velyr-diagnostics-and-tooling**.

## Provenance and maintenance

Facts verified against the repo on 2026-07-11. Re-verify before trusting:

- Cron entries: `cat vercel.json`
- Cron auth (x-vercel-cron distrust): `grep -n "authorizeCron\|x-cron-secret\|CRON_SECRET" api/agent/run.js | head`
- Action inventory: `grep -n "action === '" api/agent/run.js`
- trigger_run guards: `grep -n "MANUAL_RUN_COOLDOWN_MS\|cleanupStaleRuns" api/agent/run.js`
- First-run dispatch: `grep -n "maybeDispatchFirstRun" api/stripe.js`
- No config.toml: `ls supabase/`
- Project ref in-repo: `grep -n "supabase.co" shopify.app.toml`
- Screenshots bucket requirement: `grep -rn "PUBLIC bucket" api/_lib/screenshot.js supabase/functions/agent-run/index.ts`
- Edge deploy freshness: `npx supabase functions list` (OPERATOR/announced)
- Stale-run threshold: `grep -n "STALE_RUN_THRESHOLD_MS" api/agent/run.js supabase/functions/agent-run/index.ts`
