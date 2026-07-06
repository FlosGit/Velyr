# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server at http://localhost:5173
npm run build     # Production build: vite build + prerender + blog-parity/HogQL asserts
npm run preview   # Preview production build locally
npx vite build    # Build WITHOUT the prerender step — use this for local verification
```

**`npm run build` pings production**: `scripts/prerender.mjs` POSTs an IndexNow recrawl request for velyr.io at the end of every full build. For local verification use `npx vite build` only; the full chain belongs to the Vercel deploy.

Deployment is via Vercel. API endpoints in `/api/` are Vercel Serverless Functions. There is no test suite, no linter, and no type checker — `npm run build` is the only correctness gate for the frontend. The Supabase Edge Functions (`supabase/functions/agent-run/` and `supabase/functions/shopify-oauth/`) are Deno/TypeScript and are type-checked at `supabase functions deploy` time (there is no local Deno toolchain in this repo); each deploys individually via `npx supabase functions deploy <name>`, **not** via git push.

## Architecture

**Velyr** is an autonomous **Growth Agent** SaaS. A single product: **€29/mo** (Stripe price `STRIPE_PRICE_GROWTH`) subscribers connect their GitHub repo **or their Shopify store (direct Admin-API path)**, and every week the agent ships the single highest-impact conversion fix it can find — a GitHub PR on the repo path, a staged live-theme write on the Shopify-direct path — gated by a Telegram approval flow. (The earlier free-scan / €9-report product was removed in S0a — no scan, report, or `/premium` surface remains.)

### Frontend (`src/`)

Single-page React 18 app with **manual client-side routing — no React Router** (despite `react-router-dom` being in `package.json`, it is unused). `App.jsx` owns all routing and global state. Path matching is done against `window.location.pathname`; navigation calls a local `navigate()` that does `window.history.pushState` + `setPath`. A `popstate` listener keeps state in sync with browser back/forward.

Routes (matched in `App.jsx`):
- `/` → `Home.jsx` (note: lives at `src/Home.jsx`, not `src/pages/`)
- `/pricing` → `Home.jsx` with `scrollToPricing`
- `/faq`, `/agb`, `/impressum`, `/privacy` → static legal/info pages
- `/blog`, `/blog/category/{cluster}`, `/blog/{slug}` → blog (order matters: index → category → article; see "Blog / SEO surfaces")
- `/agent/login`, `/agent/register`, `/agent/reset-password`, `/agent/post-signup`, `/agent/onboarding` → auth + onboarding
- `/agent` and `/agent/dashboard` → `AgentDashboard.jsx`
- `/agent/{slug}` (slug not in the reserved set) → `pages/AgentPublic.jsx` (public agent timeline)

**Auth hash interception**: `App.jsx` reads `window.location.hash` on mount and redirects Supabase magic-link / recovery flows: `type=recovery` → `/agent/reset-password`, `access_token`/`type=signup` → `/agent/dashboard`. Don't strip this `useEffect` — it's how Supabase email links land.

**No component library, but a handful of shared components**: `src/components/` holds `SubscribeButton`, `SiteNetwork`, `MiniNetwork`, `networkGlass`, `HeroWorkspace`, and `CheckoutConfirmModal`; shared animation helpers live in `src/lib/motion.jsx`, demo/mock data in `src/data/`. Everything else is self-contained pages with inline styles.

### Blog / SEO surfaces

Articles are markdown in `content/blog/*.md`; `scripts/lib/blog.mjs` is the single source of truth (`loadArticles`), consumed by `scripts/vite-plugin-blog.mjs` (serves `/blog-index.json` + `/blog/<slug>.json` in dev, emits them into `dist/` at build) and by `scripts/prerender.mjs` (static per-route HTML with route-specific meta/JSON-LD, `sitemap.xml`, `llms-full.txt`, then the IndexNow ping). `npm run build` asserts parity via `scripts/assert-blog-parity.mjs` + `scripts/assert-hogql-safe.mjs`.

**Marketing claims live in five places that must stay in sync**: `src/Home.jsx` (landing), `index.html` (title/meta/OG/JSON-LD + the crawler-visible `<noscript>` block), `public/llms.txt`, `src/data/faqs.js` (FAQ page + FAQPage JSON-LD + prerendered /faq), and the `ROUTES` descriptions in `scripts/prerender.mjs`. When product framing changes (e.g. Shopify support), sweep all five. `og-image.png` is a rendered image and needs a manual re-render when the headline changes. Keep `faqs.js` dependency-free (no JSX/imports) — `prerender.mjs` imports it directly in Node.

### Agent System

Subscribers authenticate via Supabase Auth, connect GitHub via the Velyr GitHub App (OAuth — see "Onboarding / OAuth" below), and configure their site. `vercel.json` defines **five** cron entries that all hit `/api/agent/run` with different `?mode=` params:

- `0 9 * * 1` (Mon 09:00 UTC) — full run (no mode)
- `0 9 * * 3` (Wed 09:00 UTC) — `mode=midweek`
- `0 10 * * 3` (Wed 10:00 UTC) — `mode=rollback_check`
- `0 8 * * 1` (Mon 08:00 UTC) — `mode=weekly_summary`
- `0 0 * * *` (daily 00:00 UTC) — `mode=enforce_subscriptions` (cancels subscriptions past their period end, and GCs the `telegram_webhook_dedupe` and `rate_limit_hits` tables)

**Important**: the full Monday run is too heavy for Vercel's 60s budget. `/api/agent/run` (no mode) **fires a request to a Supabase Edge Function `agent-run` and returns immediately without awaiting** (2s `AbortController` timeout, errors ignored). The actual analysis → GitHub PR → Telegram message happens inside that Edge Function, whose source **is in this repo** at `supabase/functions/agent-run/` (entry `index.ts`, with the discovery/reasoning pipeline split across `repo-mapper.ts`, `import-graph.ts`, `component-ranker.ts`, `deep-reader.ts`, `receipt-builder.ts`, and `route-map.ts`); it is deployed to Supabase via `supabase functions deploy`. The quick modes (`midweek`, `rollback_check`, `weekly_summary`, `enforce_subscriptions`) run inline in Vercel. (A/B testing is fully removed — item 8a deleted the vestigial `evaluate_ab` handler and every A/B render; the agent no longer creates or reports A/B tests.)

Auth: cron requests must carry either Vercel's `x-vercel-cron` header or `x-cron-secret: $AGENT_CRON_SECRET`. The same endpoint handles user `?action=pause|resume|delete|update-settings|reenable_snippet|trigger_run|dna_verdict|public-timeline` calls authenticated via Bearer token (Supabase user JWT). Two dashboard feedback loops ride on these actions (migration `20260703_focus_page_dna_verdict.sql`): **"Fix in next run"** (Funnel tab) writes `agent_subscriptions.focus_page_path` via `update-settings`; the edge fn biases the Pass-1 ranker context + Pass-2 prompt toward the pinned page on all three pipeline paths (`loadFocusPage`), then clears the pin after Pass 2 (`clearFocusPage` — consumed even on a skip). **DNA confirm/reject** (`dna_verdict`) stamps `agent_business_dna.user_verdict`; `loadBusinessDNA` excludes `'rejected'` entries from the prompt and labels `'confirmed'` ones owner-confirmed.

**Vercel 12-function limit**: `api/agent/run.js` bundles `public-timeline` and `update-settings` actions alongside the cron modes deliberately to stay within Vercel Hobby's 12 serverless function limit. Don't split these into separate files. (Shared helpers live under `api/_lib/` — the underscore prefix means Vercel does NOT treat them as routes, so they don't count toward the cap.)

**The weekly discovery pipeline (RA1–RA7, inside the Edge Function):**
1. **RA1 `repo-mapper.ts`** — one recursive `git.getTree` + a few targeted reads produce a structural `MapResult`: framework, monorepo workspace, entry points, TS path aliases, CSS approach, and the full `repoTree`. Honest fail: unknown shape → `framework: 'unsupported'`, run skips.
2. **RA2 `import-graph.ts`** — BFS over local imports from the entry points (bounded by `AGENT_GRAPH_MAX_DEPTH` / `_MAX_FILES`), one `getBlob` per file via the tree's SHAs, fetched in concurrent frontier batches of 8 (item 8b — results processed in dequeue order, so node order and the count cutoff match the old sequential traversal exactly). Nodes cache `firstChars` only.
3. **RA3 `component-ranker.ts`** — LLM Pass 1 ranks graph components by conversion impact (reads `firstChars`, never re-fetches), with a sparse-graph gate and a conversion-vocabulary safety override.
4. **RA4 `deep-reader.ts`** — reads full source of the ranked components (+ supporting files) within a byte budget; fetches are pooled at concurrency 8 (item 8b) while the budget walk stays in rank order, so prompt bytes are unchanged.
5. **RA5 (in `index.ts` `callAIForFix`)** — LLM Pass 2 returns one `file_to_edit` + `code_change` + honesty fields (`confidence`, `blind_spots`, `rollback_signal`, …) or `{ skip }`; since item 4 it may add `additional_edits` (max 2, sanitized post-parse) for companion files the primary change *requires* (component + CSS module, constant + call site) — every downstream guard runs per file, and `pages_fixed` / the revert PR / the Shopify staging cover all of them. Since item 3a it also receives desktop+mobile screenshots of the live target page (site root, or the focus-pinned PostHog-real path) as `image_url` input: captures start before Pass 1 so they overlap LLM latency, the model-input wait is hard-budgeted (`AGENT_FIX_SCREENSHOT_BUDGET_MS`, default 20s — budget miss ⇒ Pass 2 runs without images), an image-bearing call failure retries once without images, and the desktop shot is reused as the `screenshot_before` artifact (the old serial post-createPR capture — the WallClockTimeout culprit — is gone).
6. **createPR** — forbidden-path allowlist → whitespace-normalized find guard → Babel syntax check, run per file for **every** edit (primary + additional) **before** branching, so a failure on any file can never leave an orphan branch or partial commit set; a find problem on any file fails the whole fix (interdependent edits are never partially applied).
7. **RA7 `receipt-builder.ts`** — the PR body is a "receipt" of what was/wasn't inspected.

**App Router support (Stage 2)**: `repo-mapper.ts` classifies `nextjs-app` only when a **root `app/layout.*`** exists (a bare `app/` dir is not enough — guards stray folders). App Router routes are filesystem-based, not import-reachable, so entry points are **discovered dynamically from `repoTree`** (`app/**/{page,layout}.{tsx,jsx,ts,js}`, skipping `route.*`, `_private`, and `@slot`), shallow-first and capped (`AGENT_APP_ROUTER_MAX_ENTRIES`, default 25). **Hybrid `pages/` + `app/`** repos index both trees; on a route-path collision **`app/` wins** (matches Next.js precedence). File→URL mapping uses the shared `fileToRoutePath` (see "Cross-runtime twin pattern").

**Approval flow**: the agent posts to Telegram via the Bot API (`fetch` to `api.telegram.org` + bot token; `@octokit/rest` is GitHub-only); the user replies `YES` or `NO`. The `YES`/`NO` flow finds the most recent `waiting_approval` run for the chat's subscription via `findPendingRunForChat()`. `/api/webhooks/telegram` ingests replies and merges or closes the PR.

**Email notifications removed — Telegram is the sole customer notification channel.** The former Mailjet weekly-summary + monthly-roast emails were deleted; the weekly run notifies only via the Telegram approval message, and the monthly roast goes to Telegram only. (Supabase Auth's own SMTP for signup/reset/magic-link emails is separate, configured in the Supabase dashboard, and untouched.)

**Telegram parse mode**: messages that interpolate uncontrolled values (LLM output, file paths like `Hero_Section.jsx`, error strings, repo-derived reasons) are sent as `parse_mode: 'HTML'` with every interpolated value run through an `escapeHtml()` helper. Legacy `Markdown` (v1) has no reliable escape mechanism, so a stray `*`/`_`/`[`/`` ` `` in an interpolated value used to break sends with "can't parse entities". Static or numbers-only messages may still use Markdown.

Telegram bot commands (handled in `api/webhooks/telegram.js`):
- `YES` / `NO` — approve or reject the latest pending PR
- `approve <run-id>` / `reject <run-id>` — power-user override by run ID
- `status` — last 5 runs + tracked competitors
- `dna` — view Business DNA learnings
- `note <reason>` — add context to the last skipped PR (explicit `note <run-id> <reason>` still works as an unadvertised fallback)
- `competitor add <url>` / `competitor remove <url>` — manage tracked competitor sites (max 2)
- `set branch <name>` / `unset branch` — Shopify-via-GitHub: set/clear the connected branch theme fixes target (validated to exist before save; see "Shopify-via-GitHub theme path")
- `/start` — onboarding; generates a `VELYR-XXXXXX` verification code (30-min TTL)

**Telegram trust model**: the chat_id is treated as the caller's identity for every command except `/start`. The binding has an audit trail (`agent_connections.verification_code_id` + `verified_at`); a chat with no `verification_code_id` is treated as "not authorized." Never trust chat_id alone or message metadata.

**Rollback safety**: 48h after deploy, `rollback_check` mode checks the bounce rate via PostHog; if it rose by **`ROLLBACK_BOUNCE_PP_THRESHOLD`** percentage points (default 15) it auto-opens a rollback PR for approval. This threshold is a named constant in `api/agent/run.js` (`handleRollbackCheck`) with a **format-locked twin in `supabase/functions/agent-run/receipt-builder.ts`** (the receipt states the real trigger; the AI's `rollback_signal` is a labelled hypothesis, never the trigger). The comparison is **route-scoped when possible** (`api/_lib/route-scope.js`, pure + unit-tested): if every file the run touched maps confidently to a route class AND the scoped session sample clears the same ≥100/side floor, the threshold is applied to sessions that viewed those routes (`metric_type='route_scoped_bounce_rate'`); any layout/section/snippet/component/unmappable file, or a thin scoped sample, falls back to the site-wide comparison (`site_wide_bounce_rate`). DNA entries land as `pending` on approval; `promotePendingDNA` resolves them after 7 days still-deployed to **`measured_win`** (matched-window bounce improved ≥ `MEASURED_WIN_MIN_PP`, default 5pp) or **`survived`** (still live, no measured improvement — fed to the prompt as weak signal). Legacy `success` rows read as `survived`.

### Shopify-via-GitHub theme path (SG1–SG4)

A Shopify merchant who connected their store to GitHub via **Shopify's official GitHub theme integration** has their theme code (Liquid/JSON under `templates/ sections/ snippets/ layout/ config/`) in a GitHub repo Shopify auto-syncs both ways. To Velyr that's a **normal GitHub connection** (`github_repo_name` set, `shopify_shop_domain` NULL) — so Velyr opens a conversion-fix PR against the theme repo via the existing flow; the merchant merges; Shopify syncs it live. **No `write_themes`, no Shopify Admin API needed on this path.** (The separate **Shopify-direct** Admin-API path is now live too — see the next section. Historical note: it was once dead at `shopify_preview` while the `write_themes` exemption was pending, ticket 68049335; the exemption was granted.)

What the staged build shipped:
- **Detection + fork (SG1)**: `isShopifyThemeRepo(repoTree)` in `repo-mapper.ts` keys on a strong marker (`layout/theme.liquid` **or** `config/settings_schema.json`) **plus** the `templates/`+`sections/`+`snippets/` dir shape. `processConnection` forks into `processGithubThemeConnection` **after** RA1's `getTree` but **before** the `unsupported` skip (a theme repo has no `package.json`/root `index.html`, so RA1 would otherwise classify it `unsupported`). The theme path reuses the existing two-pass LLM pipeline unchanged via the `shopifyGraph` / `shopifyDeepContext` adapters (the conversion surface is `SHOPIFY_KEEP_RE = templates|sections|snippets`, read as GitHub blobs by `readThemeFilesFromGithub`).
- **Real PR + approval (SG2)**: `createPR` allows `.liquid`/`.json` for theme runs (`isThemeRun = mapResult.framework === 'shopify-liquid'`) and validates them via `validateThemeSyntax` (best-effort Liquid `{{ }}`/`{% %}` delimiter balance — **delimiter-level only, not block-tag pairing**, to avoid false-rejecting valid markup — plus `JSON.parse`). `config/settings_*.json` is in `FORBIDDEN_EDIT_PATHS`. The run lands in `waiting_approval` reusing the **existing** Telegram YES/NO → `reconcileDeployed` merge machinery (no parallel flow).
- **Approval-lookup hardening (SG3a, `api/webhooks/telegram.js`)**: a YES/NO replied to an approval message resolves the exact run by `telegram_message_id` (`resolveApprovalRunId`); approval is authorized run-scoped across **all** chat-bound subs (`getChatAuthorizedSubIds` + `.in(subIds)`), so a shared `telegram_chat_id` no longer nulls out approval. Bare yes/no with no reply degrades to "newest pending" instead of erroring.
- **Connected-branch correctness (SG3b)**: Shopify can map the live theme to **any** branch; a GitHub-only connection can't auto-detect it. `agent_connections.shopify_connected_branch` (NULL = repo default) is an optional override set via the `set branch <name>` Telegram command (validates the branch exists with `getBranch` before saving). A theme run's base branch = `conn.shopify_connected_branch ?? <repo default>` in **both** `createPR` (forward fix, threaded via `ReceiptCtx.connectedBranch`) and the `handleRollbackCheck` revert PR (`api/agent/run.js`) — all touch-points (branch-cut, current-file read, PR base) use the resolved branch, or a merged PR silently never syncs.
- **Bug-guards + UX (SG4)**: a `agent_connections_single_type_check` CHECK forbids a row having **both** `github_repo_name` and `shopify_shop_domain` (both-NULL still allowed) so `processConnection` routing can't be ambiguous. The rollback theme-detection regex (`api/agent/run.js`) is `/^(layout|templates|sections|snippets)\/.+\.(liquid|json)$/i`. The React PostHog snippet message provably can't reach a theme run (the SG1 fork returns before `maybeRunSnippetSetup`; `setupPostHogForConnection` only writes the DB), so no gating was needed. The post-merge Telegram says "Shopify is syncing the change to your connected theme" for a theme run (`handleApprove`), byte-identical otherwise.

**Deliberately deferred (not built, by decision):**
- ~~`liquidDelimitersBalanced` hardening~~ — **built 2026-07-05**: `validateThemeSyntax` now runs a second layer, `validateLiquidBlocks` (`liquid-block-validate.ts`, provable-only block-tag pairing + `{% schema %}` JSON parse; a `{% liquid %}` tag opts the file out; node-tested via `scripts/test-liquid-blocks.mjs`). The delimiter layer itself keeps its original conservative asymmetry (flags only dropped opens, never stray closes).
- `subscription_id` text-vs-uuid schema unification (the Stripe webhook keys on `user_id`, the agent on `auth_user_id`; a pre-existing inconsistency, not Shopify-specific).

### Shopify-direct path (`shopify_direct`, Stages 1–4)

The pure-Shopify Admin-API path is **live**: a merchant with no GitHub connects their store directly, and Velyr reads/writes the live theme over the Admin GraphQL API, gated by the same Telegram YES/NO. Landing + onboarding market both paths as equals (updated 2026-07-01).

- **Discriminator (Stage 1)**: `agent_connections.connection_source` — `'github'` (default) | `'shopify_direct'`, CHECK-constrained. The weekly run routes on it: `shopify_direct` → `processShopifyConnection` (edge fn); everything else stays on the GitHub path. Theme reads carry a per-file `checksumMd5` (the concurrency token).
- **Onboarding (Stage 2)**: the wizard forks at `ConnectionTypeChoice` (`src/pages/AgentOnboarding.jsx`) into the GitHub flow (6 steps) or the Shopify-direct flow (4 steps: storefront URL → OAuth via `supabase/functions/shopify-oauth` → theme picker via `/api/onboarding?action=list_themes` / `set_theme` → Telegram). OAuth scopes `read_themes,write_themes`; token exchange uses `expiring=1` (**literal string "1"** — a non-expiring token 403s on every call post-2026-04-01), yielding ~1h access + 90d refresh tokens, both encrypted `enc:v1:` at rest. One merchant per shop via the unique `shopify_shop_domain` index. `hosting_provider` allows `'shopify'` (migration `20260630_hosting_provider_shopify.sql`).
- **Write + approval (Stage 3)**: the run stages the fix as `analysis_result.pending_write` (per file: `newContent`, `priorContent`, `checksumMd5`) and lands in `shopify_awaiting_approval` — **nothing is written before YES**. On YES, `applyShopifyDirectWrite` (`api/webhooks/telegram.js`) re-queries checksums first (optimistic concurrency: merchant edited the theme between analysis and YES → `shopify_concurrency_abort`, nothing overwritten), then upserts via `themeFilesUpsert` (`api/_lib/shopify-theme-io.js`) and records `applied_write` (the rollback basis) → `shopify_deployed`. **Gotcha:** `themeFilesUpsert` returns a job **only for async** operations; small upserts complete synchronously with `job = null` and `upsertedThemeFiles` populated — never assume a job exists (dev-store-verified 2026-07-01; harness `scripts/shopify-dv-verify.mjs`).
- **Rollback (Stage 3)**: the 48h bounce check proposes a rollback (`shopify_rollback_pending`); on YES `executeShopifyDirectRollback` executes the pure `planRollbackOps` (`api/_lib/shopify-rollback.js`, unit-tested in `shopify-rollback.test.mjs`): modified file → re-upsert `priorContent`, created file → delete → `shopify_rolled_back`.
- **PostHog (Stage 4)**: the first run proposes injecting the analytics loader into `layout/theme.liquid` (`supabase/functions/agent-run/posthog-inject.mjs`), approval-gated, with marker-block-aware self-heal (re-proposes on a broken loader). Known debt: `posthog_snippet_installed_at` is also stamped on **decline** (to avoid weekly re-nagging) — never read it as "analytics active".
- **Token refresh**: `refreshShopifyToken` rotates both tokens and re-encrypts them (`encryptSecret` exists in the edge functions again for this). A dead refresh token (90d) → `shopify_needs_reconsent`. Both HTTP **400 and 401** on the refresh grant map to `needs_reconsent` (a dead/revoked/already-used token); everything else (5xx, 429, other 4xx, 2xx-without-token) stays transient `refresh_failed`. This is twinned in the edge fn and `api/_lib/shopify-token-refresh.js`.

Status lifecycle: `shopify_awaiting_approval` → `shopify_deployed` → (`shopify_rollback_pending` → `shopify_rolled_back`) | `shopify_rejected`; concurrency abort: `shopify_concurrency_abort`. All values live in the `agent_runs_status_check` CHECK (migrations `20260624_shopify_approval_statuses.sql`, `20260630_shopify_rollback_statuses.sql`).

### Onboarding / OAuth

GitHub is connected via the Velyr GitHub App through a server-driven OAuth flow (the browser never holds the GitHub token, and identity is re-established from server-trusted state):

1. `api/github/oauth-initiate.js` — writes a single-use nonce row to `github_oauth_states` (keyed by `auth_user_id`) and redirects to GitHub with an HMAC-signed `state` token.
2. `api/github/oauth-callback.js` — verifies the state HMAC + consumes the nonce, exchanges the code, lists `GET /user/installations`, and mints an HMAC-signed, HttpOnly handoff cookie holding the verified installation/repo snapshot. **Org installations are supported (Stage 3B)**: GitHub already scopes `/user/installations` to installations the user can access, so the list itself is the permission boundary — we accept the user's own personal install (`account.id === githubUserId`) **and** any `account.type === 'Organization'` install (member-level trust; no extra org-admin call).
3. `api/onboarding.js` — action-routed (to fit the 12-function budget):
   - `?action=snapshot` (GET) — reads back the handoff cookie for the repo picker.
   - `?action=init_subscription` (POST) — idempotently creates the caller's bare `agent_subscriptions` row at onboarding mount (`status='active'` but `subscription_status=NULL`, so the agent can't run until `start_trial` fills it in).
   - `?action=complete` (POST) — verifies and calls the `complete_onboarding` RPC.
   - `?action=finalize` (POST) — service-role write of the remaining connection fields + atomic consume of the Telegram verification code (B3: the code's stamped `auth_user_id` must match the caller; NULL legacy codes pass once).
   - `?action=telegram_start_token` (POST) — mints the single-use bot deep-link token (`t.me/...?start=<token>`); the bot's `/start` consumes it and stamps `auth_user_id` onto the verification code, making a leaked code non-transferable across accounts.
   - `?action=discover_structure` (POST) — fires the edge function's RA1-only structure preview after the repo pick (seeds `site_structure_preview` as `'mapping'`, non-blocking).
   - `?action=verify_telegram_code` (POST) — validity check for a pasted `VELYR-XXXXXX` code (rate-limited; see "Rate limiting").
   - `?action=list_branches` (POST) — branch picker for GitHub-synced Shopify theme repos (→ `shopify_connected_branch`).
   - `?action=list_themes` / `?action=set_theme` (POST) — Shopify-direct theme picker (MAIN + unpublished themes → `shopify_main_theme_id`).

**Cross-tenant defense (layers that must all pass before any write):** state HMAC + expiry → single-use nonce → cookie HMAC + expiry → `cookie.authUserId === JWT user.id` → `installationId ∈ cookie.installations` → `repoFullName ∈ that installation's verified repos` → the `complete_onboarding` RPC's own `auth.uid() == subscription.auth_user_id` check (SECURITY DEFINER). Ownership is keyed on the **Velyr subscription**, never the GitHub account — so org support changes nothing here. `complete_onboarding` also stores the installation account identity (`installation_account_type` / `installation_account_login` / `installation_account_id`); the subscription:user model stays 1:1 (multi-user org dashboards are not modeled yet).

### Rate limiting (Stage 3C)

`verify_telegram_code` is a code-validity oracle, so it is throttled **per `auth_user_id`, 10 requests / 60s**, via the `rate_limit_hits` table + the atomic `rate_limit_hit(bucket_key, limit, window_seconds)` SECURITY DEFINER RPC (service-role only, mirrors the `agent_run_locks` / `telegram_webhook_dedupe` pattern). On exceed it returns **429** with `Retry-After`. The limiter **fails closed**: an RPC error returns **503** (not 429), because it's a security control, not a cost gate — silently disabling it would defeat the purpose. Buckets are GC'd by the daily `enforce_subscriptions` cron. (The formerly parked B3 issue is **fixed**: `telegram_start_token` binds the code to `auth_user_id` at `/start` time and `finalize` rejects a non-matching caller. Remaining parked follow-up: `finalize` still lets a legacy `auth_user_id IS NULL` code pass once — codes minted before `/start` started stamping; removing the null-allow was deferred as a 24h follow-up.)

### Cross-runtime twin pattern (Stages 1–3)

Vercel Node functions (`api/`) and the Supabase Deno Edge Function (`supabase/functions/agent-run/`) are separate deploy bundles and **cannot import a shared module** (`node:crypto` vs Web Crypto, different resolvers). Where logic must match across the boundary, we keep **format-locked twins** — each carries a "keep in sync with the other declaration" comment:
- `fileToRoutePath` — `supabase/functions/agent-run/route-map.ts` ↔ `api/agent/run.js`
- `decryptSecret` / `encryptSecret` (the `enc:v1:` AES-256-GCM wire format) — `api/_lib/secret-crypto.js` ↔ `supabase/functions/agent-run/index.ts` ↔ `supabase/functions/shopify-oauth/index.ts`. Both sides are twinned again: the edge functions encrypt Shopify access/refresh tokens (OAuth callback + token rotation) and decrypt them for theme I/O, and the Vercel side does the same in `applyShopifyDirectWrite`. All three declarations must stay format-locked.
- `ROLLBACK_BOUNCE_PP_THRESHOLD` — `api/agent/run.js` ↔ `supabase/functions/agent-run/receipt-builder.ts`
- `refreshShopifyToken` — `supabase/functions/agent-run/index.ts` ↔ `api/_lib/shopify-token-refresh.js`. The edge fn refreshes eagerly at the weekly run; the Vercel copy refreshes at YES-approval time (`applyShopifyDirectWrite` / `executeShopifyDirectRollback`), where the ~1h access token is usually already expired. Note the **signature differs**: the edge copy is `refreshShopifyToken(conn)` (module-scope `supabase`), the Node copy is `refreshShopifyToken(supabase, conn)` (the client is passed in). Keep the endpoint, form params, the 400+401→`needs_reconsent` classification, `shopify_token_expires_at` / `shopify_refresh_token_expires_at` column names, and single-use refresh-token rotation in sync.

Within a single runtime, do share: the two Node onboarding/agent files import `encryptSecret`/`decryptSecret` from `api/_lib/secret-crypto.js` (underscore prefix ⇒ not a Vercel route, doesn't count toward the 12-function cap).

### Supabase Tables

Key tables used by the backend (all accessed via the service-role key, which bypasses RLS; RLS only constrains the browser client):
- `agent_subscriptions` — one row per subscriber; holds `status`, `telegram_chat_id`, `public_slug`, `is_public`, `competitors[]`; billing columns `user_id`, `auth_user_id`, `subscription_status`, `stripe_customer_id`, `subscription_id`, `current_period_end`, `cancel_at_period_end`, `canceled_at`; onboarding/identity columns `github_oauth_user_id`, `github_oauth_login`, `github_installation_verified_at`, `onboarding_completed_at`, and the installation account identity `installation_account_type` / `installation_account_login` / `installation_account_id`; `focus_page_path` (one-shot "Fix in next run" pin, consumed by the next run's Pass 2). Note the column split: the Stripe webhook keys on `user_id`, the agent system keys on `auth_user_id`; both hold a Supabase auth UUID.
- `agent_connections` — GitHub/Shopify + PostHog credentials per subscription (secrets encrypted at rest); `connection_source` (`'github'` | `'shopify_direct'` — the run-path discriminator); Shopify-direct columns `shopify_shop_domain` (unique), `shopify_access_token` / `shopify_refresh_token` (encrypted) + their `*_expires_at`, `shopify_main_theme_id`, `shopify_scope`, `shopify_connected_at`, plus `shopify_connected_branch` (GitHub-synced themes only); `posthog_project_id` (the shared project id), `posthog_host_filter` (the customer's domain — the `$host` partition key, set on first run), `posthog_snippet_token`; also `verification_code_id` + `verified_at` for the Telegram binding.
- `agent_runs` — one row per agent run; status lifecycle (`running` → `waiting_approval` → `deployed` / `rejected` / `rolled_back`, plus honest skip statuses and the `shopify_*` lifecycle — see "Shopify-direct path").
- `agent_learnings` — per-run outcome records used to guide future analysis.
- `agent_business_dna` — persistent outcome log (`pending` → `measured_win` | `survived` after 7d, or `rollback`; legacy `success` rows normalize to `survived` in every reader); `user_verdict` (`'confirmed'`/`'rejected'`/NULL, dashboard DNA tab) — rejected entries are excluded from the agent's prompt context.
- `agent_competitor_urls` / `agent_competitor_snapshots` — competitor tracking.
- `agent_funnel_pages` — per-run funnel page snapshot.
- `site_structure_preview` — first-connect RA1 structure preview per subscription (`status: mapping → ready|partial|error`, `framework`); seeded by `discover_structure`, polled by the onboarding finale and the dashboard's pre-first-run preview, and by `StepPlatform` to detect GitHub-synced Shopify theme repos.
- `agent_brand_guardrails` — per-subscription brand/tone constraints (browser-upsertable).
- `agent_llm_usage` — monthly LLM spend accounting per subscription (wallet cap).
- `impact_metrics` — matched-window (deploy±2d) bounce rate before/after per run; `metric_type` is `site_wide_bounce_rate` or `route_scoped_bounce_rate` (plus legacy `bounce_rate`). The dashboard Runs chip, public timeline, and DNA promotion all read this — never render `agent_runs.bounce_rate_before/after` as a pair (mixed windows).
- `telegram_verification_codes` — short-lived `VELYR-XXXXXX` codes for bot onboarding.
- `telegram_webhook_dedupe` — Telegram `update_id` dedupe (GC'd daily).
- `agent_run_locks` — per-subscription advisory lock against overlapping runs.
- `github_oauth_states` — single-use OAuth nonce registry (service-role only).
- `rate_limit_hits` — fixed-window rate-limit buckets (Stage 3C; GC'd daily).

`agent_ab_tests` still exists but is dormant data only — all reads/writes were removed in item 8a; the table stays solely for historical rows and the account-deletion purge list in `api/agent/run.js`. DB migrations are applied **manually via the Supabase SQL Editor** (the `supabase/migrations/` files are the repo record of what was run, not an automated pipeline).

### API Layer (`api/`)

ES modules (`"type": "module"`). Database access is `@supabase/supabase-js` with the service-role key for backend ops. Endpoints:
- `api/agent/run.js` — cron modes + user actions (see Agent System).
- `api/onboarding.js` — onboarding actions (see Onboarding / OAuth).
- `api/github/oauth-initiate.js` / `oauth-callback.js` / `_oauth-state.js` — GitHub App OAuth.
- `api/webhooks/stripe.js` — Stripe subscription webhook.
- `api/webhooks/telegram.js` — Telegram bot webhook.
- `api/webhooks/github.js` — GitHub App `pull_request` webhook (HMAC via `GITHUB_WEBHOOK_SECRET`). Reconciles a PR merged/closed directly on github.com to the same run state (`deployed`/`rejected`/`rolled_back`) as the Telegram YES/NO, via the shared `api/_lib/run-reconcile.js` helpers.
- `api/stripe.js` — Stripe checkout/portal/session actions (subscription only).
- `api/_lib/secret-crypto.js` — shared secret encryption (not a route).

`vercel.json` includes a SPA rewrite (`/(.*)` → `/index.html`) and security headers (HSTS, X-Frame-Options DENY, etc.). Don't add a route to `vercel.json` — frontend routes are handled by `App.jsx`.

> Note: `playwright-core`, `@sparticuz/chromium`, and `posthog-node` (scan-only / used by the deleted `api/posthog.js`) have been **removed** from `package.json` — nothing imported them anymore.

### Analytics

PostHog is loaded inline in `index.html` (US host), **consent-gated**: init is deferred until the visitor accepts the vanilla cookie banner (decision persisted in `localStorage` under `velyr_consent`). Server-side, the agent reads PostHog via the project API for its `midweek` / `weekly_summary` / `rollback_check` analytics.

**Shared-project architecture (single PostHog project for all customers).** Velyr does **not** create a per-customer PostHog project — the PostHog Free plan caps an org at one project, so the old per-customer `POST /api/organizations/{ORG_ID}/projects/` provisioning always failed with "maximum limit of allowed projects". Instead there is **one shared project** (`POSTHOG_PROJECT_ID`, currently `412701`), and every customer's site emits to it using the shared public write token (`POSTHOG_PROJECT_TOKEN`, the same `phc_…` token `index.html` uses). The **partition key is the customer's domain**, carried on each event as `properties.$host`:

- **Setup (first run):** `setupPostHogForConnection` (in `supabase/functions/agent-run/index.ts`) is now a no-op DB write + Telegram message. It derives the hostname from `agent_connections.website_url`, stores it in `agent_connections.posthog_host_filter`, stamps the shared id into `posthog_project_id` (for clarity only), and Telegrams the customer a paste-once snippet. The snippet calls `posthog.register({ $host: '<domain>' })` so events are tagged with the partition key on emission (not relying on auto-capture). It is gated on `posthog_host_filter` being null, so it runs exactly once per connection.
- **Reads:** every PostHog query filters by `properties.$host = '<domain>'`. This lives in **format-locked twins**: `getPostHogAnalytics` in both `supabase/functions/agent-run/index.ts` and `api/agent/run.js`, plus the before/after bounce comparison in `handleRollbackCheck` (`api/agent/run.js`). Without the filter these read the whole shared project (including velyr.io's own pageviews) and mis-attribute it. If `posthog_host_filter` is null/empty the queries are **skipped** (warn + null metrics) and the run continues with funnel discovery only.
- **Engagement enrichment (edge-only):** the edge `getPostHogAnalytics` additionally returns `last7Days.engagement` — per-page scroll depth (avg max-scroll % from `$pageleave` `$prev_pageview_max_scroll_percentage`, so bounced single-page sessions count) and the top clicked elements (`$autocapture` `$el_text`), both **device-split since item 3b** (grouped by `$device_type`, merged client-side: per-page `byDevice.Mobile/Desktop` scroll + per-element `mobileShare`; a null `mobileShare` means the rows lacked device data — render as unknown, never 0%). It's the "heatmap" signal that lets the Pass-2 fix prompt ground a hypothesis in real behavior ("the CTA is below the fold and most visitors never reach it") instead of inferring from code layout. Both queries rely on posthog-js default autocapture, so **no customer snippet change is needed**. The block is gated on real traffic (`MIN_UNIQUE_VISITORS_7D`) and wrapped in its own try/catch so it can never null-out the core analytics. It is **deliberately not mirrored** in the `api/agent/run.js` twin (that twin powers reporting modes that don't feed the LLM); only the `$host` filter is twin-locked.
- `POSTHOG_ORG_ID` is **no longer read at runtime** (per-customer project creation is gone). It can be removed from Supabase secrets.

## Environment Variables

See `.env.example`. Note the **inconsistent prefixes** — Supabase uses `NEXT_PUBLIC_*` (legacy from a Next.js scaffold) even though this is Vite, so the frontend reads `import.meta.env.NEXT_PUBLIC_SUPABASE_URL`.

Required:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — frontend Supabase client
- `SUPABASE_SERVICE_ROLE_KEY` — backend API operations (never expose)
- `OPENROUTER_API_KEY` — Claude AI for the agent's analysis passes (model: `anthropic/claude-sonnet-4.6` — OpenRouter slugs use a dot, not the native dash)
- `GOOGLE_PAGESPEED_API_KEY` — PageSpeed/Core Web Vitals signal for the agent run
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY_BASE64` / `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` / `GITHUB_OAUTH_STATE_SECRET` — GitHub App + OAuth onboarding
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for the GitHub App `pull_request` webhook (`api/webhooks/github.js`), which reconciles a PR merged/closed directly on github.com to the same run state as the Telegram YES/NO
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_OAUTH_STATE_SECRET` — Shopify-direct OAuth (Supabase Edge Function secrets, read by `supabase/functions/shopify-oauth`; app config in `shopify.app.toml`)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_CHAT_ID` — default chat for notifications
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PRICE_GROWTH` (€29/mo subscription)
- `AGENT_TOKEN_ENCRYPTION_KEY` (AES-256, 64 hex), `AGENT_APPROVAL_TOKEN_SECRET` (HMAC, 32 hex), `AGENT_CRON_SECRET` (32 hex)
- `SCREENSHOTONE_API_KEY` — screenshot capture for rollback comparison (optional; rollback skips screenshots if absent)
- `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / `POSTHOG_HOST` — server-side analytics used by the agent's midweek/weekly/rollback modes (falls back to these if not set per-subscription in `agent_connections`). `POSTHOG_PROJECT_ID` is the **shared** project (all customers); reads are partitioned by `$host`. `POSTHOG_PROJECT_TOKEN` (optional) is the shared public write token handed to customers in the analytics snippet — defaults to the `phc_…` token in `index.html` if unset. `POSTHOG_ORG_ID` is **no longer used** (per-customer project creation was removed).
