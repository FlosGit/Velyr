# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server at http://localhost:5173
npm run build     # Production build
npm run preview   # Preview production build locally
```

Deployment is via Vercel. API endpoints in `/api/` are Vercel Serverless Functions. There is no test suite, no linter, and no type checker — `npm run build` is the only correctness gate for the frontend. The Supabase Edge Function (`supabase/functions/agent-run/`) is Deno/TypeScript and is type-checked at `supabase functions deploy` time (there is no local Deno toolchain in this repo).

## Architecture

**Velyr** is an autonomous **Growth Agent** SaaS. A single product: **€29/mo** (Stripe price `STRIPE_PRICE_GROWTH`) subscribers connect their GitHub repo, and every week the agent opens a GitHub PR for the single highest-impact conversion fix it can find, gated by a Telegram approval flow. (The earlier free-scan / €9-report product was removed in S0a — no scan, report, or `/premium` surface remains.)

### Frontend (`src/`)

Single-page React 18 app with **manual client-side routing — no React Router** (despite `react-router-dom` being in `package.json`, it is unused). `App.jsx` owns all routing and global state. Path matching is done against `window.location.pathname`; navigation calls a local `navigate()` that does `window.history.pushState` + `setPath`. A `popstate` listener keeps state in sync with browser back/forward.

Routes (matched in `App.jsx`):
- `/` → `Home.jsx`
- `/pricing` → `Home.jsx` with `scrollToPricing`
- `/faq`, `/agb`, `/impressum`, `/privacy` → static legal/info pages
- `/agent/login`, `/agent/register`, `/agent/reset-password`, `/agent/post-signup`, `/agent/onboarding` → auth + onboarding
- `/agent` and `/agent/dashboard` → `AgentDashboard.jsx`
- `/agent/{slug}` (slug not in the reserved set) → `pages/AgentPublic.jsx` (public agent timeline)

**Auth hash interception**: `App.jsx` reads `window.location.hash` on mount and redirects Supabase magic-link / recovery flows: `type=recovery` → `/agent/reset-password`, `access_token`/`type=signup` → `/agent/dashboard`. Don't strip this `useEffect` — it's how Supabase email links land.

**No shared component library**: `src/components/` is empty. Each page/screen is self-contained with inline styles.

### Agent System

Subscribers authenticate via Supabase Auth, connect GitHub via the Velyr GitHub App (OAuth — see "Onboarding / OAuth" below), and configure their site. `vercel.json` defines **five** cron entries that all hit `/api/agent/run` with different `?mode=` params:

- `0 9 * * 1` (Mon 09:00 UTC) — full run (no mode)
- `0 9 * * 3` (Wed 09:00 UTC) — `mode=midweek`
- `0 10 * * 3` (Wed 10:00 UTC) — `mode=rollback_check`
- `0 8 * * 1` (Mon 08:00 UTC) — `mode=weekly_summary`
- `0 0 * * *` (daily 00:00 UTC) — `mode=enforce_subscriptions` (cancels subscriptions past their period end, and GCs the `telegram_webhook_dedupe` and `rate_limit_hits` tables)

**Important**: the full Monday run is too heavy for Vercel's 60s budget. `/api/agent/run` (no mode) **fires a request to a Supabase Edge Function `agent-run` and returns immediately without awaiting** (2s `AbortController` timeout, errors ignored). The actual analysis → GitHub PR → Telegram message happens inside that Edge Function, whose source **is in this repo** at `supabase/functions/agent-run/` (entry `index.ts`, with the discovery/reasoning pipeline split across `repo-mapper.ts`, `import-graph.ts`, `component-ranker.ts`, `deep-reader.ts`, `receipt-builder.ts`, and `route-map.ts`); it is deployed to Supabase via `supabase functions deploy`. The quick modes (`midweek`, `rollback_check`, `weekly_summary`, `enforce_subscriptions`) run inline in Vercel. (The `evaluate_ab` mode handler remains in `api/agent/run.js` but has **no cron** — the agent no longer creates A/B tests.)

Auth: cron requests must carry either Vercel's `x-vercel-cron` header or `x-cron-secret: $AGENT_CRON_SECRET`. The same endpoint handles user `?action=pause|resume|delete|update-settings|export-dna|public-timeline` calls authenticated via Bearer token (Supabase user JWT).

**Vercel 12-function limit**: `api/agent/run.js` bundles `public-timeline`, `update-settings`, and `export-dna` actions alongside the cron modes deliberately to stay within Vercel Hobby's 12 serverless function limit. Don't split these into separate files. (Shared helpers live under `api/_lib/` — the underscore prefix means Vercel does NOT treat them as routes, so they don't count toward the cap.)

**The weekly discovery pipeline (RA1–RA7, inside the Edge Function):**
1. **RA1 `repo-mapper.ts`** — one recursive `git.getTree` + a few targeted reads produce a structural `MapResult`: framework, monorepo workspace, entry points, TS path aliases, CSS approach, and the full `repoTree`. Honest fail: unknown shape → `framework: 'unsupported'`, run skips.
2. **RA2 `import-graph.ts`** — BFS over local imports from the entry points (bounded by `AGENT_GRAPH_MAX_DEPTH` / `_MAX_FILES`), one `getBlob` per file via the tree's SHAs. Nodes cache `firstChars` only.
3. **RA3 `component-ranker.ts`** — LLM Pass 1 ranks graph components by conversion impact (reads `firstChars`, never re-fetches), with a sparse-graph gate and a conversion-vocabulary safety override.
4. **RA4 `deep-reader.ts`** — reads full source of the ranked components (+ supporting files) within a byte budget.
5. **RA5 (in `index.ts` `callAIForFix`)** — LLM Pass 2 returns one `file_to_edit` + `code_change` + honesty fields (`confidence`, `blind_spots`, `rollback_signal`, …) or `{ skip }`.
6. **createPR** — forbidden-path allowlist → whitespace-normalized find guard → Babel syntax check, all before branching.
7. **RA7 `receipt-builder.ts`** — the PR body is a "receipt" of what was/wasn't inspected.

**App Router support (Stage 2)**: `repo-mapper.ts` classifies `nextjs-app` only when a **root `app/layout.*`** exists (a bare `app/` dir is not enough — guards stray folders). App Router routes are filesystem-based, not import-reachable, so entry points are **discovered dynamically from `repoTree`** (`app/**/{page,layout}.{tsx,jsx,ts,js}`, skipping `route.*`, `_private`, and `@slot`), shallow-first and capped (`AGENT_APP_ROUTER_MAX_ENTRIES`, default 25). **Hybrid `pages/` + `app/`** repos index both trees; on a route-path collision **`app/` wins** (matches Next.js precedence). File→URL mapping uses the shared `fileToRoutePath` (see "Cross-runtime twin pattern").

**Approval flow**: the agent posts to Telegram via `@octokit/rest` + bot token; the user replies `YES` or `NO`. The `YES`/`NO` flow finds the most recent `waiting_approval` run for the chat's subscription via `findPendingRunForChat()`. `/api/webhooks/telegram` ingests replies and merges or closes the PR.

Telegram bot commands (handled in `api/webhooks/telegram.js`):
- `YES` / `NO` — approve or reject the latest pending PR
- `approve <run-id>` / `reject <run-id>` — power-user override by run ID
- `status` — last 5 runs + tracked competitors
- `dna` — view Business DNA learnings
- `note <run-id> <reason>` — add a manual learning
- `competitor add <url>` / `competitor remove <url>` — manage tracked competitor sites (max 2)
- `/start` — onboarding; generates a `VELYR-XXXXXX` verification code (30-min TTL)

**Telegram trust model**: the chat_id is treated as the caller's identity for every command except `/start`. The binding has an audit trail (`agent_connections.verification_code_id` + `verified_at`); a chat with no `verification_code_id` is treated as "not authorized." Never trust chat_id alone or message metadata.

**Rollback safety**: 48h after deploy, `rollback_check` mode checks the site-wide bounce rate via PostHog; if it rose by **`ROLLBACK_BOUNCE_PP_THRESHOLD`** percentage points (default 15) it auto-opens a rollback PR for approval. This threshold is a named constant in `api/agent/run.js` (`handleRollbackCheck`) with a **format-locked twin in `supabase/functions/agent-run/receipt-builder.ts`** (the receipt states the real trigger; the AI's `rollback_signal` is a labelled hypothesis, never the trigger). DNA entries land as `pending` on approval; `rollback_check` promotes them to `success` after 7 days still-deployed.

### Onboarding / OAuth

GitHub is connected via the Velyr GitHub App through a server-driven OAuth flow (the browser never holds the GitHub token, and identity is re-established from server-trusted state):

1. `api/github/oauth-initiate.js` — writes a single-use nonce row to `github_oauth_states` (keyed by `auth_user_id`) and redirects to GitHub with an HMAC-signed `state` token.
2. `api/github/oauth-callback.js` — verifies the state HMAC + consumes the nonce, exchanges the code, lists `GET /user/installations`, and mints an HMAC-signed, HttpOnly handoff cookie holding the verified installation/repo snapshot. **Org installations are supported (Stage 3B)**: GitHub already scopes `/user/installations` to installations the user can access, so the list itself is the permission boundary — we accept the user's own personal install (`account.id === githubUserId`) **and** any `account.type === 'Organization'` install (member-level trust; no extra org-admin call).
3. `api/onboarding.js` — action-routed (to fit the 12-function budget):
   - `?action=snapshot` (GET) — reads back the handoff cookie for the repo picker.
   - `?action=complete` (POST) — verifies and calls the `complete_onboarding` RPC.
   - `?action=finalize` (POST) — service-role write of the remaining connection fields + atomic consume of the Telegram verification code.
   - `?action=verify_telegram_code` (POST) — validity check for a pasted `VELYR-XXXXXX` code (rate-limited; see "Rate limiting").

**Cross-tenant defense (layers that must all pass before any write):** state HMAC + expiry → single-use nonce → cookie HMAC + expiry → `cookie.authUserId === JWT user.id` → `installationId ∈ cookie.installations` → `repoFullName ∈ that installation's verified repos` → the `complete_onboarding` RPC's own `auth.uid() == subscription.auth_user_id` check (SECURITY DEFINER). Ownership is keyed on the **Velyr subscription**, never the GitHub account — so org support changes nothing here. `complete_onboarding` also stores the installation account identity (`installation_account_type` / `installation_account_login` / `installation_account_id`); the subscription:user model stays 1:1 (multi-user org dashboards are not modeled yet).

### Rate limiting (Stage 3C)

`verify_telegram_code` is a code-validity oracle, so it is throttled **per `auth_user_id`, 10 requests / 60s**, via the `rate_limit_hits` table + the atomic `rate_limit_hit(bucket_key, limit, window_seconds)` SECURITY DEFINER RPC (service-role only, mirrors the `agent_run_locks` / `telegram_webhook_dedupe` pattern). On exceed it returns **429** with `Retry-After`. The limiter **fails closed**: an RPC error returns **503** (not 429), because it's a security control, not a cost gate — silently disabling it would defeat the purpose. Buckets are GC'd by the daily `enforce_subscriptions` cron. (Known parked issue: `finalize` binds a `verificationCodeId` without verifying the requesting user originated the code — the throttle mitigates brute-force discovery but a full fix, binding the code to `auth_user` at `/start` time, is a separate stage.)

### Cross-runtime twin pattern (Stages 1–3)

Vercel Node functions (`api/`) and the Supabase Deno Edge Function (`supabase/functions/agent-run/`) are separate deploy bundles and **cannot import a shared module** (`node:crypto` vs Web Crypto, different resolvers). Where logic must match across the boundary, we keep **format-locked twins** — each carries a "keep in sync with the other declaration" comment:
- `fileToRoutePath` — `supabase/functions/agent-run/route-map.ts` ↔ `api/agent/run.js`
- `encryptSecret` / `decryptSecret` (the `enc:v1:` AES-256-GCM wire format) — `api/_lib/secret-crypto.js` ↔ `supabase/functions/agent-run/index.ts`
- `ROLLBACK_BOUNCE_PP_THRESHOLD` — `api/agent/run.js` ↔ `supabase/functions/agent-run/receipt-builder.ts`

Within a single runtime, do share: the two Node onboarding/agent files import `encryptSecret`/`decryptSecret` from `api/_lib/secret-crypto.js` (underscore prefix ⇒ not a Vercel route, doesn't count toward the 12-function cap).

### Supabase Tables

Key tables used by the backend (all accessed via the service-role key, which bypasses RLS; RLS only constrains the browser client):
- `agent_subscriptions` — one row per subscriber; holds `status`, `telegram_chat_id`, `public_slug`, `is_public`, `competitors[]`; billing columns `user_id`, `auth_user_id`, `subscription_status`, `stripe_customer_id`, `subscription_id`, `current_period_end`, `cancel_at_period_end`, `canceled_at`; onboarding/identity columns `github_oauth_user_id`, `github_oauth_login`, `github_installation_verified_at`, `onboarding_completed_at`, and the installation account identity `installation_account_type` / `installation_account_login` / `installation_account_id`. Note the column split: the Stripe webhook keys on `user_id`, the agent system keys on `auth_user_id`; both hold a Supabase auth UUID.
- `agent_connections` — GitHub + PostHog credentials per subscription (PostHog key encrypted at rest); also `verification_code_id` + `verified_at` for the Telegram binding.
- `agent_runs` — one row per agent run; status lifecycle (`running` → `waiting_approval` → `deployed` / `rejected` / `rolled_back`, plus honest skip statuses).
- `agent_learnings` — per-run outcome records used to guide future analysis.
- `agent_business_dna` — persistent outcome log (`pending` → `success` after 7d, or `rollback`).
- `agent_competitor_urls` / `agent_competitor_snapshots` — competitor tracking.
- `agent_funnel_pages` — per-run funnel page snapshot.
- `agent_brand_guardrails` — per-subscription brand/tone constraints (browser-upsertable).
- `agent_llm_usage` — monthly LLM spend accounting per subscription (wallet cap).
- `impact_metrics` — site-wide bounce rate before/after per run.
- `telegram_verification_codes` — short-lived `VELYR-XXXXXX` codes for bot onboarding.
- `telegram_webhook_dedupe` — Telegram `update_id` dedupe (GC'd daily).
- `agent_run_locks` — per-subscription advisory lock against overlapping runs.
- `github_oauth_states` — single-use OAuth nonce registry (service-role only).
- `rate_limit_hits` — fixed-window rate-limit buckets (Stage 3C; GC'd daily).

`agent_ab_tests` still exists but is vestigial (the `evaluate_ab` handler has no cron). DB migrations are applied **manually via the Supabase SQL Editor** (the `supabase/migrations/` files are the repo record of what was run, not an automated pipeline).

### API Layer (`api/`)

ES modules (`"type": "module"`). Database access is `@supabase/supabase-js` with the service-role key for backend ops. Endpoints:
- `api/agent/run.js` — cron modes + user actions (see Agent System).
- `api/onboarding.js` — onboarding actions (see Onboarding / OAuth).
- `api/github/oauth-initiate.js` / `oauth-callback.js` / `_oauth-state.js` — GitHub App OAuth.
- `api/github/validate-repo.js` — validates GitHub repo access during onboarding.
- `api/webhooks/stripe.js` — Stripe subscription webhook.
- `api/webhooks/telegram.js` — Telegram bot webhook.
- `api/stripe.js` — Stripe checkout/portal/session actions (subscription only).
- `api/_lib/secret-crypto.js` — shared secret encryption (not a route).

`vercel.json` includes a SPA rewrite (`/(.*)` → `/index.html`) and security headers (HSTS, X-Frame-Options DENY, etc.). Don't add a route to `vercel.json` — frontend routes are handled by `App.jsx`.

> Note: `package.json` still lists `playwright-core`, `@sparticuz/chromium`, and `posthog-node` as dependencies, but **nothing imports them anymore** (they were scan-only / used by the deleted `api/posthog.js`). Flagged for removal in a separate dependency-cleanup PR.

### Analytics

PostHog is loaded inline in `index.html` (US host). Server-side, the agent reads PostHog via the project API for its `midweek` / `weekly_summary` / `rollback_check` analytics.

## Environment Variables

See `.env.example`. Note the **inconsistent prefixes** — Supabase uses `NEXT_PUBLIC_*` (legacy from a Next.js scaffold) even though this is Vite, so the frontend reads `import.meta.env.NEXT_PUBLIC_SUPABASE_URL`.

Required:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — frontend Supabase client
- `SUPABASE_SERVICE_ROLE_KEY` — backend API operations (never expose)
- `OPENROUTER_API_KEY` — Claude AI for the agent's analysis passes (model: `anthropic/claude-sonnet-4-5`)
- `GOOGLE_PAGESPEED_API_KEY` — PageSpeed/Core Web Vitals signal for the agent run
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY_BASE64` / `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` / `GITHUB_OAUTH_STATE_SECRET` — GitHub App + OAuth onboarding
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_CHAT_ID` — default chat for notifications
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PRICE_GROWTH` (€29/mo subscription)
- `AGENT_TOKEN_ENCRYPTION_KEY` (AES-256, 64 hex), `AGENT_APPROVAL_TOKEN_SECRET` (HMAC, 32 hex), `AGENT_CRON_SECRET` (32 hex)
- `SCREENSHOTONE_API_KEY` — screenshot capture for rollback comparison (optional; rollback skips screenshots if absent)
- `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / `POSTHOG_HOST` — server-side analytics used by the agent's midweek/weekly/rollback modes (falls back to these if not set per-subscription in `agent_connections`)
