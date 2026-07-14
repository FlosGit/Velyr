---
name: velyr-config-and-flags
description: Catalog of every Velyr configuration axis — env vars, secrets, feature flags, tuning knobs — with read-site, surface (Vercel vs Supabase secret vs both), code default, and hazards. Load when adding/reading/renaming/rotating an env var or secret, switching the LLM model, enabling a feature flag (AGENT_SHOPIFY_PREVIEW_THEMES, AGENT_FULLRUN_FANOUT), tuning budgets/caps, or answering "where is X configured", "what happens if X is unset", "is this a flag or a constant". Also covers .env.example/CLAUDE.md drift and the how-to-add-a-flag checklist.
---

# Velyr configuration and flags

All line numbers and defaults below were verified against the repo on **2026-07-12**. Line numbers drift — anchor on the variable name (grep it), not the line.

**The three config surfaces** (they do NOT share env):

| Surface | Where set | Feeds |
|---|---|---|
| **Vercel env** | Vercel dashboard → Settings → Environment Variables (CLI not installed as of 2026-07-12) | All `api/**` serverless functions, plus `VITE_*` vars at frontend build time |
| **Supabase secret** | `npx supabase secrets set NAME=value --project-ref mtqctjgecbscjmottauv` — OPERATOR (ask Florian) | Edge functions `agent-run` and `shopify-oauth` |
| **Local only** | `.env.local` / shell | `scripts/*.mjs` run on the dev machine |

A var marked **BOTH** must be set on Vercel **and** as a Supabase secret, or the two runtimes silently disagree.

## Required secrets and credentials

| Var | Read at (verified 2026-07-12) | Surface | If unset |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `api/agent/run.js:39`, `api/onboarding.js:33`, all webhooks, `api/_lib/edge-dispatch.js:12` | Vercel — **server-side, despite the prefix** | Every API endpoint breaks |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `api/onboarding.js:34` | Vercel | Onboarding JWT verification breaks |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.js:15,19` (build-time) | Vercel (exposed to browser) | Frontend Supabase client dead — see prefix trap below |
| `SUPABASE_SERVICE_ROLE_KEY` | all of `api/**` + edge (`index.ts:22`) | BOTH (Supabase auto-provides it to edge fns) | Everything backend breaks. Never expose |
| `SUPABASE_URL` | edge only (`index.ts:21`, `shopify-oauth/index.ts:63`) | Supabase (auto-provided) | — |
| `VITE_APP_URL` | `api/stripe.js:64,281` (checkout redirect base) | Vercel | Stripe checkout/portal redirects break. **Not in `.env.example`** |
| `OPENROUTER_API_KEY` | edge `index.ts:3298` (Pass 1/2, roast), `api/agent/run.js:925` (48h visual check), `scripts/generate-articles.mjs:109` | BOTH (+ local for blog gen) | Agent runs fail; visual check skips silently |
| `AGENT_TOKEN_ENCRYPTION_KEY` | `api/_lib/secret-crypto.js:18`, edge `index.ts:466`, `shopify-oauth/index.ts:122` | BOTH | Token encrypt/decrypt fails — see rotation hazards |
| `AGENT_APPROVAL_TOKEN_SECRET` | `api/_lib/email.js:43,67` (unsubscribe HMAC), `api/_lib/trial-fingerprint.js:84` (ledger HMAC) | Vercel only | Lifecycle emails skip; trial-abuse ledger inert |
| `AGENT_CRON_SECRET` | `api/agent/run.js:156-175` (`authorizeCron`) | Vercel | Cron auth accepts `x-cron-secret: $AGENT_CRON_SECRET` **or** `Authorization: Bearer $CRON_SECRET` (Vercel-native). The old `x-vercel-cron` header is deliberately **no longer trusted** (comment at `:701-705`; CLAUDE.md is stale on this). If BOTH env vars are unset the endpoint refuses everyone (500). velyr-run-and-operate owns cron auth. |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY_BASE64` | `api/_lib/github-app.js:12,14`, `api/onboarding.js:718`, `api/agent/run.js:766`, edge `index.ts:1221` | BOTH | All GitHub operations fail |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | `api/github/oauth-initiate.js:44`, `oauth-callback.js:77-78` | Vercel | GitHub connect flow dead. **`.env.example` documents the WRONG names** (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`) |
| `GITHUB_OAUTH_STATE_SECRET` | `api/onboarding.js:36`, `oauth-initiate.js:45`, `oauth-callback.js:79` | Vercel | OAuth state HMAC fails. **Not in `.env.example`** |
| `GITHUB_WEBHOOK_SECRET` | `api/webhooks/github.js:65` | Vercel | PR-merge reconciliation webhook rejects everything |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | edge `index.ts:541-542`, `shopify-oauth/index.ts:57-58`, `api/_lib/shopify-token-refresh.js:16-17` | BOTH (Node side refreshes tokens at YES-approval time) | Shopify-direct OAuth + token refresh dead |
| `SHOPIFY_OAUTH_STATE_SECRET` | `shopify-oauth/index.ts:59` | Supabase secret | Shopify OAuth state HMAC fails |
| `STRIPE_SECRET_KEY` | `api/stripe.js:6`, `api/webhooks/stripe.js:4`, `api/agent/run.js:34`, edge `index.ts:2944` (revenue attribution, optional) | BOTH (edge use degrades gracefully) | Billing dead |
| `STRIPE_WEBHOOK_SECRET` | `api/webhooks/stripe.js:137` | Vercel | Stripe webhook rejects all events |
| `STRIPE_PRICE_GROWTH` | `api/stripe.js:84,201` | Vercel | Checkout/trial creation fails (the only price actually read) |
| `TELEGRAM_BOT_TOKEN` | every Telegram send in `api/**` + edge | BOTH | All approvals/alerts dead |
| `TELEGRAM_WEBHOOK_SECRET` | `api/webhooks/telegram.js:1050` | Vercel | Bot webhook rejects updates |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | `api/_lib/email.js:41-42,289-292` | Vercel **only** (edge never emails — deliberate) | Lifecycle emails skip silently with a console warning |
| `EMAIL_FROM_ADDRESS` | `api/_lib/email.js:30` | Vercel | Defaults to `info@velyr.io` (must be Mailjet-verified) |
| `GOOGLE_PAGESPEED_API_KEY` | edge `index.ts:1669` **only** | Supabase secret | PageSpeed signal missing from runs (degrades) |
| `SCREENSHOTONE_API_KEY` | `api/_lib/screenshot.js:10`, edge `index.ts:2735` | BOTH | Screenshots skip gracefully; Pass 2 runs without images |
| `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / `POSTHOG_HOST` | `api/agent/run.js:1146-1148`, edge `index.ts:4348-4354` (fallbacks after per-connection values) | BOTH | Analytics reads fail → runs continue with funnel-only. `POSTHOG_HOST` defaults to `https://us.i.posthog.com` on the Vercel side only |
| `POSTHOG_PROJECT_TOKEN` | edge `index.ts:1820,2051,2636,4150` | Supabase secret | Falls back to the hardcoded `VELYR_POSTHOG_TOKEN` const (same `phc_…` token as `index.html`) |

**Deliberately unread:** `TELEGRAM_CHAT_ID`. Code comments at `api/agent/run.js:1159,1636` and edge `index.ts:5046,5267,5495` forbid falling back to it — an operator-chat fallback once leaked one tenant's change description to the operator chat. CLAUDE.md still lists it as required (stale as of 2026-07-12). Never reintroduce a fallback to it.

## Behavior flags and tuning knobs (all optional — defaults in code)

| Var | Read at | Surface | Default | Effect |
|---|---|---|---|---|
| `AGENT_LLM_MODEL` | edge `index.ts:81` (`LLM_MODEL` — Pass 1/2, find-repair, roast), `api/agent/run.js:916` (`VISUAL_CHECK_MODEL` — 48h visual check) | **BOTH** | `anthropic/claude-sonnet-4.6` | Model switch = set on BOTH surfaces. Use the OpenRouter **dot** slug (`…-4.6`), never the Anthropic-native dash ID; verify against `GET https://openrouter.ai/api/v1/models` first. Re-check `LLM_INPUT_EUR_PER_M`/`LLM_OUTPUT_EUR_PER_M` against the new model's pricing |
| `AGENT_SHOPIFY_PREVIEW_THEMES` | `api/webhooks/telegram.js:812`, edge `index.ts:4606` — both compare `=== '1'` exactly | **BOTH** | unset (off) | C3 preview themes. Edge side shows the 🔍 Preview button; Vercel side executes it. Enabling only one surface = button without handler or vice versa. Operator-confirmed set on both, 2026-07-10 |
| `AGENT_FULLRUN_FANOUT` | edge `index.ts:5712` | Supabase | on — `(env ?? 'true') !== 'false'`, so ONLY the literal string `false` disables | Monday fan-out: one `single_run` self-invocation per subscription. `false` = inline worker pool (escape hatch) |
| `AGENT_FANOUT_BATCH` / `AGENT_FANOUT_PAUSE_MS` | edge `index.ts:5648-5649` | Supabase | 5 / 1000 | Fan-out dispatch batching |
| `AGENT_RUN_CONCURRENCY` | edge `index.ts:5683` | Supabase | 3 | Inline (non-fanout) worker pool size |
| `AGENT_MONTHLY_SPEND_CAP_EUR` | edge `index.ts:101` | Supabase | 20.0 | Per-subscription monthly LLM wallet cap (Velyr cost protection, not a customer feature) |
| `LLM_INPUT_EUR_PER_M` / `LLM_OUTPUT_EUR_PER_M` | edge `index.ts:90-91`, `api/agent/run.js:920-921` | **BOTH** | 3.0 / 15.0 | €/1M tokens for spend accounting (Sonnet 4.6 pricing verified live 2026-07-05) |
| `AGENT_FIX_SCREENSHOT_BUDGET_MS` | edge `index.ts:2864` | Supabase | 20000 | Hard budget for screenshots reaching Pass 2 as model input; miss ⇒ Pass 2 runs without images |
| `AGENT_DEEP_CONTEXT_BYTES` | `deep-reader.ts:131`, edge `index.ts:933` (Shopify twin) | Supabase | 400000 | RA4 deep-read byte budget |
| `AGENT_GRAPH_MAX_DEPTH` / `AGENT_GRAPH_MAX_FILES` | `import-graph.ts:281,285` | Supabase | 3 / 50 | RA2 BFS bounds |
| `AGENT_MIN_GRAPH_NODES` | `component-ranker.ts:55` | Supabase | 3 | Sparse-graph skip gate (this is why `plain-html` sites always skip) |
| `AGENT_APP_ROUTER_MAX_ENTRIES` | `repo-mapper.ts:283` | Supabase | 25 | App Router entry-point discovery cap |
| `LLM_MAX_TOKENS_ANALYSIS` / `LLM_MAX_TOKENS_RANKER` / `LLM_MAX_TOKENS_ROAST` | edge `index.ts:59,68,60` | Supabase | 6000 / 2000 / 1500 | max_tokens per call type (analysis was raised from 2000 — truncated mid-JSON) |
| `LLM_MAX_PROMPT_BYTES` | edge `index.ts:72` | Supabase | 512000 | Prompt size ceiling |
| `LLM_MAX_FILE_BYTES` | `deep-reader.ts:61`, edge `index.ts:934` | Supabase | 61440 | Per-file read cap |
| `STALE_RUN_THRESHOLD_MS` | `api/agent/run.js:331`, edge `index.ts:5526` | **BOTH** | 3600000 (60 min) | Zombie `running`-row sweep threshold — format-locked twin, keep equal |
| `RUN_LOCK_TTL_MS` | edge `index.ts:5556` | Supabase | 900000 (15 min) | Per-subscription advisory-lock TTL |
| `DB_WRITE_TIMEOUT_MS` | edge `index.ts:36` | Supabase | 10000 | Edge DB write timeout |
| `ROLLBACK_LOOKBACK_MS` | `api/agent/run.js:1106` | Vercel | 864000000 (10 d) | How far back the Wednesday rollback check scans deployed runs |
| `MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION` | `api/agent/run.js:1228` | Vercel | 100 | Per-side session floor for bounce comparison (else `insufficient_data`) |
| `SHOPIFY_TOKEN_SKEW_MS` | `api/_lib/shopify-token-refresh.js:19`, edge `index.ts:544` | **BOTH** | 300000 (5 min) | Refresh-early skew on the ~1h Shopify access token |
| `SHOPIFY_THEME_MAX_PAGES` | edge `index.ts:690` | Supabase | 10 | Theme-file listing pagination cap |
| `SHOPIFY_GITHUB_MAX_FILES` | edge `index.ts:4631` | Supabase | 300 | Shopify-via-GitHub blob-read cap |

## Local-script-only vars (never set in prod)

| Var | Script | Default | Notes |
|---|---|---|---|
| `GEN_MODEL` | `scripts/generate-articles.mjs:47` | `anthropic/claude-sonnet-4.6` | Blog generator's own model — deliberately independent of `AGENT_LLM_MODEL` |
| `VELYR_BUILD_DATE` | `scripts/prerender.mjs:213`, `scripts/lib/blog.mjs:43` | today | Deterministic build dates |
| `SHOT_URL` | `scripts/shoot.mjs:5` | `http://localhost:4173/` | Screenshot target |
| `SHOPIFY_SHOP` / `SHOPIFY_TOKEN` / `SHOPIFY_THEME_ID` / `SHOPIFY_API_VERSION` | `scripts/shopify-dv-verify.mjs:27-30` | version `2026-04` | Dev-store harness only — OPERATOR (mutates a dev store) |
| `MAILJET_*`, `AGENT_APPROVAL_TOKEN_SECRET` | `scripts/email-preview.mjs:38-40,81` | placeholder secret injected for preview | Test-SEND requires real Mailjet keys — OPERATOR |

## Looks like config, is actually a code constant

These come up in greps and look env-driven — changing them is a **code edit + deploy**, not a config change:

| Constant | Where | Value (2026-07-12) |
|---|---|---|
| `SHOPIFY_API_VERSION` | edge `index.ts:689`, `api/_lib/shopify-theme-io.js:14` (`DEFAULT_API_VERSION`) | `'2026-04'` — file-level Admin API pin, "keep in sync" twin |
| `THEME_OPS_API_VERSION` | `api/_lib/shopify-theme-io.js:153` | `'2026-07'` — theme-level ops (`themeDuplicate`/`themeDelete`) pin their own version, deliberately separate |
| `SHOPIFY_SCOPE` | `shopify-oauth/index.ts:45` | `'read_themes,write_themes'` |
| `LLM_TIMEOUT_MS` | `api/agent/run.js:929` | 15000 (visual check only) |
| `LLM_RANKED_CAP` / `FINAL_RANKED_CAP` | `component-ranker.ts:58-59` | 7 / 10 |
| `VISUAL_CHECK_MODEL`, `VISUAL_LLM_EUR_PER_M`, `MONTHLY_SPEND_CAP_EUR`, `FROM_EMAIL` | derived consts wrapping the env vars above | — |
| `EMAIL_TYPES` | `api/_lib/email.js:34` | welcome / setup_reminder / tips / weekly_digest |
| `TELEGRAM_CODE_RE` | `api/onboarding.js:587` | `/^VELYR-[A-Z0-9]{6}$/` |
| `ROLLBACK_BOUNCE_PP_THRESHOLD` (15 pp), `MEASURED_WIN_MIN_PP` (5 pp) | `api/agent/run.js` (+ receipt twin) | acceptance thresholds — see velyr-architecture-contract for the twin discipline |
| `RESERVED_AGENT_PATHS`, `PUBLIC_AGENT_REGEX`, `AGENT_STEPS` | `src/App.jsx:25-26`, `src/pages/AgentDashboard.jsx` | frontend routing/UI constants |

## Rotation hazards (read BEFORE rotating anything)

| Secret | Rotation consequence |
|---|---|
| `AGENT_APPROVAL_TOKEN_SECRET` | **Kills every already-sent one-click-unsubscribe link** (HMAC no longer verifies — a §7 Abs. 3 UWG legal problem, not just broken UX) **and orphans every `trial_fingerprints` ledger row** (each past abuser gets one fresh trial; nothing crashes). Do not rotate casually — OPERATOR decision |
| `AGENT_TOKEN_ENCRYPTION_KEY` | Every stored GitHub/Shopify/PostHog token becomes undecryptable (`enc:v1:` AES-256-GCM) → every connection needs re-consent. Set identically on BOTH surfaces |
| `TELEGRAM_WEBHOOK_SECRET` / `GITHUB_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` | Two-ended: update the provider side (setWebhook call / GitHub App settings / Stripe dashboard) in the same maintenance window or the webhook rejects everything |
| `SHOPIFY_API_SECRET` | Also HMAC-verifies Shopify OAuth callbacks — rotating mid-flight breaks in-progress OAuth |

## The frontend prefix trap

Vite exposes **only `VITE_*`** vars to the browser. `src/lib/supabase.js:15,19` reads `VITE_SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL` — the `NEXT_PUBLIC_` fallback is code-level legacy and is **never populated in a Vite browser bundle**. Meanwhile the **server-side** `api/**` code reads the `NEXT_PUBLIC_`-prefixed names (Node sees all env). Consequence: Vercel needs **both** `VITE_SUPABASE_*` (for the browser) and `NEXT_PUBLIC_SUPABASE_*` (for the API functions), with identical values.

## Known .env.example / CLAUDE.md drift (verified 2026-07-12)

Documented but **never read** in code: `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (wrong names — code reads `GITHUB_OAUTH_*`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (checkout is a server-created session redirect; also stale in CLAUDE.md's required list), `STRIPE_PRICE_STARTER`/`STRIPE_PRICE_SCALE`, `PLAUSIBLE_HOST`, `TRIGGER_API_KEY`/`TRIGGER_API_URL`, `TELEGRAM_CHAT_ID` (deliberately unread — see above).

Read in code but **missing from .env.example**: `GITHUB_OAUTH_STATE_SECRET`, `VITE_APP_URL`, `AGENT_LLM_MODEL`, `POSTHOG_API_KEY`/`POSTHOG_PROJECT_ID`/`POSTHOG_HOST`/`POSTHOG_PROJECT_TOKEN`, `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`/`SHOPIFY_OAUTH_STATE_SECRET`, and all tuning knobs. Fixing `.env.example` is a normal change — route it through velyr-change-control.

## How to add a config axis (checklist)

1. **Pick the surface(s).** Read on the edge → Supabase secret; read in `api/` → Vercel env; both runtimes → BOTH, and consider whether the values must match (then treat as a format-locked pair and say so in a comment).
2. **Pick the failure default.** Precedents: security controls fail **closed** (the `verify_telegram_code` rate limiter returns 503 on RPC error — silently disabling a security control defeats it); convenience/anti-abuse checks fail **open** (trial-fingerprint check passes on infra errors, migration `20260704`); integrations degrade gracefully with a console warning (ScreenshotOne, Mailjet, PageSpeed).
3. **Escape hatch pattern** for risky behavior changes: default-on with a literal-`false` kill switch, like `AGENT_FULLRUN_FANOUT` (`(env ?? 'true') !== 'false'`), or default-off with exact `'1'` opt-in, like `AGENT_SHOPIFY_PREVIEW_THEMES`.
4. **Document**: add to `.env.example` with a comment block, and to CLAUDE.md's Environment Variables section if it's load-bearing.
5. **Setting the value is OPERATOR work** (ask Florian): Vercel dashboard for Vercel env; `npx supabase secrets set … --project-ref mtqctjgecbscjmottauv` for edge. A Supabase secret change requires **no** redeploy; a Vercel env change requires a redeploy to take effect.
6. Add a one-line re-verification command to this skill's provenance section if the flag is drift-prone.

## Verifying live values

- Supabase side — OPERATOR (announce first): `npx supabase secrets list --project-ref mtqctjgecbscjmottauv` — there is **no `--linked` flag** on this subcommand; values come back **SHA-256-hashed** (compare against `echo -n "1" | sha256sum` style hashes, e.g. the `AGENT_SHOPIFY_PREVIEW_THEMES=1` check).
- Vercel side — dashboard only (Vercel CLI not installed as of 2026-07-12).
- In-code defaults: grep the var name; the `|| 'default'` / `?? 'default'` at the read site is the truth.

## When NOT to use this skill

- Setting up a local `.env.local` from scratch → **velyr-build-and-env**.
- How/where to deploy or set secrets step-by-step, cron auth → **velyr-run-and-operate**.
- WHY the twins/secrets are structured this way, encryption format, trust model → **velyr-architecture-contract**.
- What a knob does inside the pipeline (budgets, gates, prompts) → **velyr-agent-pipeline-reference**.

## Provenance and maintenance

All facts verified against the working tree on 2026-07-12 (branch `main`, post-58d8326). Re-verify with:

- Full catalog re-derivation: `grep -rnoE "process\.env\.[A-Z_0-9]+" api scripts | sort -u` and `grep -rnoE "Deno\.env\.get\('[A-Z_0-9]+'\)" supabase/functions | sort -u` and `grep -rn "import.meta.env" src`
- A specific default: grep the var name and read the `||`/`??` fallback at the read site.
- Model + pricing: `grep -n "AGENT_LLM_MODEL\|LLM_INPUT_EUR_PER_M" supabase/functions/agent-run/index.ts api/agent/run.js`
- Flag semantics: `grep -n "AGENT_FULLRUN_FANOUT\|AGENT_SHOPIFY_PREVIEW_THEMES" supabase/functions/agent-run/index.ts api/webhooks/telegram.js`
- .env.example drift: diff the greps above against `cat .env.example`
- Live Supabase secrets (OPERATOR): `npx supabase secrets list --project-ref mtqctjgecbscjmottauv`
