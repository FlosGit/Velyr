---
name: velyr-debugging-playbook
description: >-
  Symptom→triage playbook for Velyr's live failure modes. Load when something is
  BROKEN or behaving strangely: an agent run is stuck or failed, dashboard shows a
  frozen step, screenshots come back black/missing, Telegram messages error
  ("can't parse entities") or never arrive, Shopify calls 401/403, PostHog
  analytics are missing/empty, lifecycle emails don't send, "Run now" is blocked,
  onboarding/OAuth fails, a billing/Stripe/checkout/trial/dunning symptom appears
  ("customer paid but is still gated", subscription webhook errors), `npm run
  build` fails, or a deployed fix "didn't take effect". Each symptom has a first
  discriminating check, interpretation, and fix pointer. NOT for feature work
  (velyr-agent-pipeline-reference) or shipping process (velyr-change-control).
---

# Velyr Debugging Playbook

Triage discipline: find your symptom below, run the **first discriminating check**, and let its output pick the branch. Don't jump to a fix that pattern-matches a past incident — several past multi-day investigations were prolonged by plausible-but-wrong causes (see velyr-failure-archaeology for the full stories).

**Operator split**: anything prod-MUTATING (setting a run `failed`, redeploying, touching secrets) is **OPERATOR (ask Florian)**. Read-only prod DB queries are established diagnosis practice via:

```bash
npx supabase db query "<sql>" --linked --output json
```

(CLI must be logged in and linked once: `supabase link --project-ref mtqctjgecbscjmottauv --yes` — project ref per project notes, 2026-07-09.) Announce before running prod queries. The reusable SQL lives in **velyr-diagnostics-and-tooling** — reference it, don't re-derive.

## Symptom index

| # | Symptom | First check |
|---|---------|-------------|
| 1 | Run stuck on a dashboard step | `agent_runs.current_step` + `agent_llm_usage.updated_at` |
| 2 | Black / missing screenshots | What URL was shot + does the `screenshots` bucket exist |
| 3 | Telegram "can't parse entities" / send fails | Is an interpolated value unescaped? |
| 4 | Shopify 401 / 403 | Which call failed: refresh grant vs theme I/O |
| 5 | Analytics missing / all-null metrics | `agent_connections.posthog_host_filter` |
| 6 | Run ends `find_mismatch` / `find_ambiguous` | Did the self-heal retry run? |
| 7 | Lifecycle emails not sending | Env gate, then `email_log` |
| 8 | "Run now" blocked (409/429/402) | Which guard returned the status code |
| 9 | Onboarding / GitHub OAuth fails | Which defense layer rejected |
| 10 | `npm run build` fails | Which step of the chain failed |
| 11 | Fix shipped but prod behavior unchanged | Was the edge function redeployed? |
| 12 | Billing: checkout / trial / can't-subscribe / dunning | Which Stripe webhook event, and did it write the sub row |

---

## 1. Run stuck on a dashboard step ("step 8", "Taking before screenshot", any frozen step)

The dashboard step is **derived UI, not ground truth**. The edge function only checkpoints a subset of steps into `agent_runs.current_step`; each checkpoint covers a *range* of UI steps that the timeline walks through while waiting (`CURRENT_STEP_TO_ID` at `src/pages/AgentDashboard.jsx:305`, `CURRENT_STEP_RANGE` at `:332`).

Checkpoints the edge fn actually writes (verified by grep over `supabase/functions/agent-run/index.ts`, as of 2026-07-12): `fetching_repo`, `pulling_analytics`, `mapping_funnel`, `ranking_components`, `reading_deep_context`, `finding_biggest_issue`, `writing_fix`, `sending_notification`, `done` (**nine** values; the full ordered table lives in velyr-agent-pipeline-reference). **There is no `taking_screenshot` checkpoint** — the UI step "Taking before screenshot" (8th item) renders while `current_step = finding_biggest_issue` (range `[6,7]`); the dashboard step map also carries other ids the edge fn never writes (e.g. `scanning_competitors`, `opening_pr`). **A run "stuck at step 8" is really stuck in LLM Pass 2.** (Incident 2026-07-09.)

Discriminating checks, in order:

```sql
-- (a) what does the run row actually say?
select id, status, current_step, created_at from agent_runs
order by created_at desc limit 5;

-- (b) when did the last LLM call finish? (monthly aggregate row,
--     upserted after every call — edge index.ts:2375; column from
--     migration 20260520_agent_llm_usage.sql)
select subscription_id, period, updated_at from agent_llm_usage
order by updated_at desc limit 5;
```

```bash
# (c) rule out a mid-run redeploy (updated_at is epoch ms)
npx supabase functions list
```

Interpretation:
- Ranker usage recorded but no Pass-2 usage, no `writing_fix` checkpoint, no `failed` status, no Telegram → the isolate was **hard-killed** (wall-clock/CPU/OOM). Every normal error path runs the catch that marks the run `failed`, so silence = hard kill.
- A hard-killed isolate leaves a zombie `status='running'` row. Sweeps: `cleanupStaleRuns` twins (`api/agent/run.js:330` ↔ `supabase/functions/agent-run/index.ts:5525`; threshold `STALE_RUN_THRESHOLD_MS`, default 60 min) run at the start of every edge run, in the daily `enforce_subscriptions` cron (`run.js:413`), and as a `trigger_run` pre-check (`run.js:2290`) — shipped in commit 509d852, so a zombie no longer bricks the manual-run button until Monday.
- Immediate manual remediation (don't wait for a sweep): **OPERATOR (ask Florian)** — set the run `failed` (same field values `cleanupStaleRuns` writes) and `agent_subscriptions.last_manual_run_at = NULL` to refund the daily cooldown. Ready-made SQL: velyr-run-and-operate → "Zombie-run remediation".

Edge function logs are viewable in the Supabase dashboard only (no CLI tail; project notes, 2026-07-09).

## 2. Black or missing screenshots

Settled battle — read the archaeology entry before touching capture parameters. Root cause of the historical multi-day incident: shooting a `fileToRoutePath`-derived **non-route** (`/home`) on a client-rendered SPA → the empty shell rendered as a solid dark frame. The capture params were never the cause.

Rules that must hold (verify, don't re-tune):
- Fix screenshots are captured from `conn.website_url` (site root) — `startFixScreenshots(conn.website_url, …)` at `supabase/functions/agent-run/index.ts:4404` and `:4751`. The only non-root shots are the second "ranked page" group, gated on the route being PostHog-real.
- Capture config is deliberate and documented inline at `index.ts:2748–2770`: `wait_until=load`, `delay=8`, `cache=false`, **no** `response_type`, **no** `wait_for_selector`, fetch abort 35s. Each of those was a proven red herring in the original incident — changing them will not fix a black frame.
- Uploads require a **PUBLIC** Supabase Storage bucket named `screenshots` (`index.ts:2777–2785`). If it's missing or private, every upload fails and the URL is silently null (capture is non-blocking by design).

Discriminating check: fetch the failing `screenshot_before/after` URL. 404/permission error → bucket problem. Renders a dark empty page → the URL that was shot isn't a real route (check `website_url` on the connection).

## 3. Telegram send fails / "can't parse entities"

Every message in `api/webhooks/telegram.js` is sent `parse_mode: 'HTML'` (`:58`), and every interpolated value (LLM output, file paths, error strings) must be wrapped in `escapeHtml()` — the edge copy is at `supabase/functions/agent-run/index.ts:1051` and there are **five** Node copies (`telegram.js:40`, `run.js`, `stripe.js`, `shopify-approval.js`, `email.js`); full inventory in velyr-architecture-contract. Patch all copies, not just the two nearest. A stray `<`/`&`/`"` in an unescaped interpolation is the classic cause; legacy `Markdown` parse mode (no reliable escaping) is only acceptable for static or numbers-only messages.

Discriminating check: find the failing send, confirm every `${…}` inside the message string passes through `escapeHtml`. If the message never arrives at all with no API error: verify the chat binding (`agent_connections.telegram_chat_id` + `verification_code_id` — an unbound chat is treated as unauthorized).

## 4. Shopify 401 / 403

Two distinct classes — identify which call failed first:

| Failing call | Classification (verified) | Meaning |
|---|---|---|
| Token **refresh grant** | HTTP **400 OR 401** → `needs_reconsent`; everything else (5xx/429/other) → transient `refresh_failed` — `api/_lib/shopify-token-refresh.js:81` ↔ edge `index.ts:605` | Dead/revoked/already-used refresh token → merchant must reconnect. Don't retry forever. |
| Theme I/O (read/upsert/duplicate/delete) | 401 **or** 403 → `{ ok:false, reason:'unauthorized' }` — `api/_lib/shopify-theme-io.js:64,96,135,171,195,219,243` | Token expired/invalid **or** the token is non-expiring. |

Background facts:
- The access token lives ~1h; at YES-approval time it is usually already expired, so the Vercel side refreshes before writing (`applyShopifyDirectWrite` / `executeShopifyDirectRollback`).
- The OAuth token exchange MUST be form-encoded with the **literal string** `expiring=1` — a JSON body silently yields a NON-expiring token, and non-expiring tokens are rejected on every Admin API call post-2026-04-01 (this surfaced as a step-7 403 during onboarding). Documented inline at `supabase/functions/shopify-oauth/index.ts:357–366`.

## 5. Analytics missing / metrics all null

Check `agent_connections.posthog_host_filter` first:

- **Null/empty** → every PostHog query is skipped by design (warn + null metrics, run continues with funnel discovery only): edge `index.ts:1463`, rollback comparison `api/agent/run.js:1167`. The one-time setup that fills it (`setupPostHogForConnection`) is gated on `posthog_host_filter` being null — NOT on `posthog_project_id` (`index.ts:1792`).
- **Set but zero events** → you're probably looking at the wrong PostHog project/region. Prod is the **US cloud** shared project `412701` (us.posthog.com); a dead EU-cloud "Default project" once caused a "analytics vanished" scare (project notes, 2026-07-07). Check instance/region before anything else.
- velyr.io's own analytics are **consent-gated**: PostHog init waits for the cookie banner, decision stored in `localStorage['velyr_consent']` (`index.html:112–123`). Declined consent = no events from that visitor, working as intended.

## 6. Run ends `find_mismatch` / `find_ambiguous`

The whitespace-normalized find guard produces structured failures (`supabase/functions/agent-run/index.ts:270–336`): 0 matches → `find_mismatch` (with closest lines), >1 match → `find_ambiguous` (with snippets). One self-heal retry exists: `repairFindText` (`:3753`) / `attemptFindRepair` (`:3791`), invoked on all three pipeline paths (`:4514`, `:4851`, `:5376`) and validated by re-running the same guards. Multi-file fixes are all-or-nothing: a find failure on ANY file fails the whole fix before the branch is cut — no orphan branches or partial edits.

If these statuses recur for one subscription, inspect `analysis_result` on the failed runs (persisted on find-failure) for what Pass 2 keeps getting wrong; the fix is prompt/signal work (velyr-fix-quality-campaign), not guard loosening.

## 7. Lifecycle emails not sending

Send gate first (`api/_lib/email.js:41–43`): requires `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, **and** `AGENT_APPROVAL_TOKEN_SECRET` (signs unsubscribe links, `:67-68`) — all **Vercel-only** env; unset ⇒ silent skip with a console warning. Then:

```sql
select email_type, period_key, sent_at from email_log
where subscription_id = '<sub>' order by sent_at desc limit 10;
```

- Claim semantics (`email.js:333–347`): INSERT the claim first (unique on `subscription_id + email_type + period_key`), send, then delete the claim only if the send **failed**; a duplicate claim raises `23505` → `already_sent`. So a **row that persists** means the send succeeded (the row is the sent-marker). A **released claim leaves no row**, which is why a genuinely-unsent mail normally shows no row — a lingering row alongside an unsent mail means the failure path didn't release (investigate the send error).
- No row, no send → check `agent_subscriptions.email_opt_out` (honored on every send) and the drip age-windows (bounded on both ends — accounts older than the window are deliberately never mailed).

Supabase Auth's own signup/reset emails are separate (Supabase-dashboard SMTP config), not Mailjet.

## 8. "Run now" blocked

`handleTriggerRun` guard order (`api/agent/run.js:2264–2318`, `MANUAL_RUN_COOLDOWN_MS` = 24h):

| Response | Guard | Remedy |
|---|---|---|
| 409 "agent is paused" | `sub.status === 'paused'` (`:2279`) | Resume first |
| 402 | `subscription_status` not in `active`/`trialing` (`:2282`) | Billing state, not a bug |
| 409 "run already in progress" | in-flight statuses `running`, `waiting_approval`, `shopify_awaiting_approval`, `shopify_rollback_pending` (`:2303`) | Respond to the pending approval; a zombie `running` row is swept by the pre-check at `:2290` — if it still blocks, the row is younger than 60 min or genuinely live |
| 429 + `Retry-After` | 24h cooldown on `last_manual_run_at` (`:2311–2318`) | Wait, or OPERATOR resets `last_manual_run_at` |

Note the dispatch itself is fire-and-forget (2s abort, `:2321–2344`) — a 200 from `trigger_run` means "dispatched", not "run succeeded". If nothing happens after a 200, go to symptom 1.

## 9. Onboarding / GitHub OAuth failures

The flow is a chain of independent rejections — identify WHICH layer said no before changing anything. Order (each must pass): state HMAC + expiry → single-use nonce (`github_oauth_states`) → code exchange → cookie HMAC + expiry → `cookie.authUserId === JWT user.id` → `installationId ∈ cookie.installations` → `repoFullName ∈ installation's repos` → `complete_onboarding` RPC's own `auth.uid()` check.

`api/github/oauth-callback.js` renders human-readable HTML error pages (helper at `:54`) — the page text names the failing condition; Vercel function logs carry the console.error. For `?action=finalize` failures: the Telegram verification code is consumed atomically and its stamped `auth_user_id` must match the caller (legacy NULL-stamped codes pass once — known parked hole). For 429s on `verify_telegram_code`: the per-user rate limiter (10/60s) — a 503 there means the limiter RPC itself errored (it fails closed by design).

## 10. `npm run build` fails

Chain (in `package.json`): `vite build` → `scripts/prerender.mjs` → `scripts/assert-blog-parity.mjs` → `scripts/assert-hogql-safe.mjs`. Match the error to the step:

- **vite build** — includes the blog gate (`scripts/lib/blog.mjs` `loadArticles`: required frontmatter, `related:` slug resolution, near-duplicate dedupe). Fix the article, not the gate.
- **prerender / parity / HogQL asserts** — route meta or blog JSON drift; see velyr-docs-and-writing for the blog system.

**Never run `npm run build` locally for verification** — `prerender.mjs` POSTs a production IndexNow recrawl ping (hardcoded key, no env gate). Local gate = `npx vite build` only. If you're debugging the prerender/assert steps themselves, that's the one justified case — accept that the ping fires, or stub it out locally without committing.

## 11. Fix shipped but prod behavior unchanged

Three deploy surfaces ship separately; the classic miss is the edge function:

```bash
npx supabase functions list   # updated_at is epoch ms — compare to your change time
git log --oneline -5          # what actually got pushed
```

- Edited `supabase/functions/agent-run/*`? It deploys via `npx supabase functions deploy agent-run --project-ref …` (**OPERATOR**), never via git push.
- Edited a migration? It's applied manually in the Supabase SQL Editor (**OPERATOR**) — the repo file alone changes nothing.
- Edited a format-locked twin on one side only? Behavior diverges by runtime — check the twin inventory in velyr-architecture-contract.

## 12. Billing: checkout, trial, subscribe, or dunning problems

Billing lives in the Stripe webhook (`api/webhooks/stripe.js`) and `api/stripe.js`, not the agent pipeline. First check **which event** fired and whether it wrote the subscription row.

| Symptom | Likely cause | Check |
|---|---|---|
| Paid but agent still gated | `checkout.session.completed` didn't upsert, or wrote the wrong row | Handler at `stripe.js:162`; upsert keys on **`user_id`** (`onConflict: 'user_id'`, `:202`). Note the schema split: the Stripe webhook keys on `user_id`, the agent keys on `auth_user_id` (both hold the Supabase auth UUID) — a known weak point (velyr-architecture-contract). |
| `subscription_status` looks wrong | Stripe state maps through `STATE_MAP` (`:193/:216`) | Row's `subscription_status` should be the mapped Stripe status; agent run-eligibility needs `active`/`trialing` (a 402 on "Run now" is this, not a bug). |
| Trial won't start / first run never fired | `start_trial` didn't flip `subscription_status`, so `maybeDispatchFirstRun` never dispatched | velyr-run-and-operate → first-run path; a fresh onboarding row is `status:'active'`, `subscription_status:NULL` until the trial is created. |
| Second free trial denied | `trial_fingerprints` ledger hit → `subscription_status='trial_denied'` | By design (deletion-surviving); a paid checkout overwrites it. See velyr-architecture-contract + velyr-failure-archaeology. |
| Subscription not cancelling after period end | Dunning runs in the daily `enforce_subscriptions` cron | `run.js:399–401` cancels `cancel_at_period_end=true` rows past `current_period_end`; `:645` calls Stripe. |

Events handled (`stripe.js`): `checkout.session.completed`, `customer.subscription.created/updated/trial_will_end/deleted`, `invoice.payment_failed/succeeded`. Deeper billing architecture is in CLAUDE.md; this row set is for triage only.

## Where logs live

| Surface | Where | Notes |
|---|---|---|
| Vercel functions (`api/`) | Vercel dashboard → Logs | Cron + webhook + user actions |
| Supabase edge fn (`agent-run`) | Supabase dashboard → Edge Functions → Logs | Dashboard-only; no CLI tail (project notes, 2026-07-09) |
| DB state | `npx supabase db query … --linked` | Read-only diagnosis; announce first |
| Customer-facing audit trail | Telegram chat history | Approval messages, alerts, summaries |

## When NOT to use this skill

- Understanding pipeline internals to build features → **velyr-agent-pipeline-reference**
- The full story behind a settled incident (root cause, red herrings, commits) → **velyr-failure-archaeology**
- The SQL query pack + measurement tools these checks reference → **velyr-diagnostics-and-tooling**
- Deploy/remediation command anatomy → **velyr-run-and-operate**
- Shipping the fix you found → **velyr-change-control**

## Provenance and maintenance

All file:line anchors verified 2026-07-11; line numbers drift — re-anchor on the symbol names.

- Step mapping: `grep -n "CURRENT_STEP_RANGE" src/pages/AgentDashboard.jsx`
- Checkpoints written: `grep -n "current_step: '" supabase/functions/agent-run/index.ts` (a new `taking_screenshot` checkpoint would obsolete symptom 1's drift note)
- Stale sweep twins: `grep -rn "STALE_RUN_THRESHOLD_MS" api supabase/functions`
- Refresh classification: `grep -n "authFailure" api/_lib/shopify-token-refresh.js supabase/functions/agent-run/index.ts`
- Theme-I/O 401/403: `grep -n "unauthorized" api/_lib/shopify-theme-io.js`
- Host-filter skip: `grep -n "posthog_host_filter" supabase/functions/agent-run/index.ts api/agent/run.js`
- Email gate: `grep -n "AGENT_APPROVAL_TOKEN_SECRET" api/_lib/email.js`
- Manual-run guards: `grep -n "MANUAL_RUN_COOLDOWN_MS\|in-flight" api/agent/run.js`
- Escape twins: `grep -rn "function escapeHtml" api supabase/functions`
- PostHog project id / region and the Supabase project ref are operator-side facts (project notes 2026-07-07/09) — re-confirm with Florian if they matter to your diagnosis.
