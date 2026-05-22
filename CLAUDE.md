# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server at http://localhost:5173
npm run build     # Production build
npm run preview   # Preview production build locally
```

Deployment is via Vercel. API endpoints in `/api/` are Vercel Serverless Functions. There is no test suite, no linter, and no type checker — `npm run build` is the only correctness gate.

## Architecture

**Velyr** is an AI-powered website + social audit SaaS. Free users get a scored audit; €9 unlocks the full report; €29/mo subscribers get the autonomous Growth Agent that opens GitHub PRs for the highest-impact fix every Monday.

### Frontend (`src/`)

Single-page React 18 app with **manual client-side routing — no React Router** (despite `react-router-dom` being in `package.json`, it is unused). `App.jsx` owns all routing and global state. Path matching is done with regex against `window.location.pathname`; navigation calls a local `navigate()` that does `window.history.pushState` + `setPath`. A `popstate` listener keeps state in sync with browser back/forward.

All top-level state lives in `App.jsx` — `path`, `scanData`, `reportData`, `liveData` (live scan progress), plus a parallel set of `premium*` versions. Scan handlers (`handleScanStart`, `handlePremiumScanStart`) drive the full pipeline and update `liveData` to feed the `ScanningScreen` progress UI.

Routes (regex-matched in `App.jsx`):
- `/` → `Home.jsx`
- `/report` and `/report/{uuid}` → `pages/Report.jsx` (UUID v4 only)
- `/premium` → `PremiumScanForm.jsx`
- `/premium/report` and `/premium/{uuid}` → `PremiumReport.jsx`
- `/agent`, `/agent/dashboard`, `/agent/login`, `/agent/register`, `/agent/reset-password`, `/agent/onboarding`
- `/agent/{slug}` (public timeline, slug not in reserved set) → `pages/AgentPublic.jsx`
- `/agb`, `/impressum`, `/privacy`

**Auth hash interception**: `App.jsx` reads `window.location.hash` on mount and redirects Supabase magic-link / recovery flows: `type=recovery` → `/agent/reset-password`, `access_token`/`type=signup` → `/agent/dashboard`. Don't strip this `useEffect` — it's how Supabase email links land.

**No shared component library**: `src/components/` is empty. Each page/screen is self-contained with inline styles.

### Scan Pipeline (free tier)

1. `Home.jsx` POSTs to `/api/scan` with URL + optional manual social handles
2. `/api/scan` runs in parallel: Google PageSpeed (perf + Core Web Vitals + a11y), HTML scrape (SEO), content analysis (copy/UX), industry detection
3. `App.jsx` POSTs `/api/scan` result to `/api/report` → OpenRouter Claude (`anthropic/claude-sonnet-4-5`) generates the plain-English report
4. `/api/save-report` writes to Supabase, returns UUID → `navigate('/report/{uuid}')`

`/api/get-report?id={uuid}` is the read path used when a UUID URL is loaded fresh (no in-memory state). For premium reports, the same endpoint takes `&type=premium` (reads from the `premium_reports` table). Premium scan/save flow uses dedicated endpoints: `/api/premium-scan`, `/api/premium-report`, `/api/save-premium-report`.

### /premium paywall and guest access

`/premium` is gated in `App.jsx`. Access is granted in two ways:

1. **Logged-in users** with `agent_subscriptions.full_scan_purchased = true` or `subscription_status = 'active'` (keyed by `user_id`).
2. **Guests** who just paid: Stripe's `success_url` for `type=full_scan` is `/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`. The app calls `GET /api/stripe?action=verify_session&session_id=...`, and on `payment_status === 'paid'` stashes `premiumAccessGranted=true` and `premiumSessionId=<id>` in `sessionStorage`. Subsequent calls to `/api/premium-scan`, `/api/premium-report`, `/api/save-premium-report` from `App.jsx` send an `X-Session-Id` header; each premium endpoint re-verifies the session against Stripe and accepts it as proof of payment (no Supabase login required).

Subscription checkouts still redirect to `/agent/dashboard?checkout=success&type=subscription`. Cancelled checkouts return to `/agent/dashboard?checkout=cancelled`, which renders a brief "no charge was made" banner.

All scan/report functions set `export const config = { maxDuration: 60 }` — Vercel's 60s ceiling. PageSpeed itself is wrapped in a 25s `AbortSignal.timeout` plus a `withTimeout` race fallback.

### Scoring Model

Composite (0–100): **20% performance** + **20% SEO** (title length, meta description, H1, alt text, OG tags) + **20% copy/UX** (outcome-focused headline, CTA, social proof, pricing visibility) + **up to 40% social** (when handles provided, benchmarked against detected industry averages).

Industry detection uses URL + hero headline keywords to pick from fitness / SaaS / e-commerce / service benchmark sets.

### Agent System

Subscribers authenticate via Supabase Auth, connect GitHub via OAuth, and configure their site. `vercel.json` defines four cron entries that all hit `/api/agent/run` with different `?mode=` params:

- Mon 09:00 UTC — full run (no mode)
- Wed 09:00 UTC — `mode=midweek`
- Wed 10:00 UTC — `mode=rollback_check`
- Mon 08:00 UTC — `mode=weekly_summary`

**Important**: the full Monday run is too heavy for Vercel's 60s budget. `/api/agent/run` (no mode) **fires a request to a Supabase Edge Function `agent-run` and returns immediately without awaiting** (2s `AbortController` timeout, errors ignored). The actual analysis → GitHub PR → Telegram message happens inside that Edge Function, whose source **is in this repo** at `supabase/functions/agent-run/` (entry `index.ts`, with the discovery/reasoning pipeline split across `repo-mapper.ts`, `import-graph.ts`, `component-ranker.ts`, `deep-reader.ts`, and `receipt-builder.ts`); it is deployed to Supabase via `supabase functions deploy`. Quick modes (`midweek`, `rollback_check`, `weekly_summary`) run inline in Vercel. (The `evaluate_ab` mode handler remains in `api/agent/run.js` but its cron was removed — the agent no longer creates A/B tests.)

Auth: cron requests must carry either Vercel's `x-vercel-cron` header or `x-cron-secret: $AGENT_CRON_SECRET`. The same endpoint handles user `?action=pause|resume|delete|update-settings|export-dna` calls authenticated via Bearer token (Supabase user JWT).

**Vercel 12-function limit**: `api/agent/run.js` bundles `public-timeline`, `update-settings`, and `export-dna` actions alongside the cron modes deliberately to stay within Vercel Hobby's 12 serverless function limit. Don't split these into separate files.

**Approval flow**: agent posts to Telegram via `@octokit/rest` + bot token; user replies `YES` or `NO` to the bot. The simple `YES`/`NO` flow finds the most recent `waiting_approval` run for the chat's subscription via `findPendingRunForChat()`. `/api/webhooks/telegram` ingests these and merges or closes the PR.

Telegram bot commands (handled in `api/webhooks/telegram.js`):
- `YES` / `NO` — approve or reject the latest pending PR
- `approve <run-id>` / `reject <run-id>` — power-user override by run ID
- `status` — last 5 runs, active A/B tests, tracked competitors
- `dna` — view Business DNA learnings
- `note <run-id> <reason>` — add a manual learning
- `competitor add <url>` / `competitor remove <url>` — manage tracked competitor sites (max 2)
- `/start` — onboarding; generates a `VELYR-XXXXXX` verification code (30-min TTL)

**Rollback safety**: 48h after deploy, `rollback_check` mode checks bounce rate via PostHog; if it rose ≥15pp, it auto-opens a rollback PR. DNA entries land as `pending` on approval; `rollback_check` promotes them to `success` after 7 days still-deployed.

### Supabase Tables

Key tables used by the backend (all accessed via service-role key):
- `agent_subscriptions` — one row per subscriber; holds `status`, `telegram_chat_id`, `public_slug`, `is_public`, `competitors[]`, plus billing/full-scan columns: `user_id`, `auth_user_id`, `full_scan_purchased`, `full_scan_purchased_at`, `subscription_status`, `stripe_customer_id`, `subscription_id`, `current_period_end`, `cancel_at_period_end`, `canceled_at`. Note the column split: the Stripe webhook + premium endpoints key on `user_id`, while the agent system keys on `auth_user_id`; both columns hold a Supabase auth UUID.
- `agent_connections` — GitHub + PostHog credentials per subscription
- `agent_runs` — one row per weekly agent run; tracks status lifecycle (`pending` → `waiting_approval` → `deployed` / `rejected` / `rolled_back`)
- `agent_ab_tests` — A/B test state; evaluated by `mode=evaluate_ab`
- `agent_learnings` — per-run outcome records used to guide future analysis
- `agent_business_dna` — persistent outcome log (`pending` → `success` after 7d, or `rollback`)
- `agent_competitor_urls` / `agent_competitor_snapshots` — competitor tracking
- `impact_metrics` — bounce rate before/after per run
- `telegram_verification_codes` — short-lived codes for bot onboarding
- `premium_reports` — stores premium scan+report data (read by `get-report?type=premium`)

### API Layer (`api/`)

ES modules (`"type": "module"`). Browser automation uses `playwright-core` + `@sparticuz/chromium` (serverless Chromium). Database access is `@supabase/supabase-js` with the service-role key for backend ops.

Additional endpoints not covered above:
- `api/subscribe.js` — Stripe subscription creation
- `api/github/validate-repo.js` — validates GitHub repo access during onboarding

`vercel.json` includes a SPA rewrite (`/(.*)` → `/index.html`) and security headers (HSTS, X-Frame-Options DENY, etc.). Don't add a route to `vercel.json` — frontend routes are handled by `App.jsx`.

### Analytics

PostHog is loaded inline in `index.html` (US host, key `phc_qmLvjZawzLuEnR5ns5eFKXSFiSD5AX4y87LvELP9nqB5`). Server-side capture uses `posthog-node` via `api/posthog.js`.

## Environment Variables

See `.env.example`. Note the **inconsistent prefixes** — Supabase uses `NEXT_PUBLIC_*` (legacy from a Next.js scaffold) even though this is Vite, so the frontend reads `import.meta.env.NEXT_PUBLIC_SUPABASE_URL`. PageSpeed is read as `process.env.PAGESPEED_API_KEY` in `api/scan.js` even though `.env.example` documents `GOOGLE_PAGESPEED_API_KEY` — both names appear in the codebase; check the file you're touching.

Required:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — frontend Supabase client
- `SUPABASE_SERVICE_ROLE_KEY` — backend API operations (never expose)
- `OPENROUTER_API_KEY` — Claude AI report generation (model: `anthropic/claude-sonnet-4-5`)
- `APIFY_TOKEN` — Apify actor runs for premium social scraping (TikTok, Instagram, YouTube, X/Twitter, Facebook, LinkedIn); if unset, every premium scan fails and triggers the auto-refund path
- `PAGESPEED_API_KEY` (a.k.a. `GOOGLE_PAGESPEED_API_KEY`)
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY_BASE64` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — agent
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_CHAT_ID` — default chat for notifications
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PRICE_FULL_SCAN` (€9 one-time) / `STRIPE_PRICE_GROWTH` (€29/mo subscription)
- `AGENT_TOKEN_ENCRYPTION_KEY` (AES-256, 64 hex), `AGENT_APPROVAL_TOKEN_SECRET` (HMAC, 32 hex), `AGENT_CRON_SECRET` (32 hex)
- `SCREENSHOTONE_API_KEY` — screenshot capture for rollback comparison (optional; rollback skips screenshots if absent)
- `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / `POSTHOG_HOST` — server-side analytics used by agent's midweek/weekly modes (falls back to these if not set per-subscription in `agent_connections`)
