---
name: velyr-architecture-contract
description: The load-bearing design decisions, invariants, and known-weak points of Velyr. Load BEFORE designing any change — especially before adding API endpoints, routes, tables, or run statuses, touching auth/tokens/webhooks/secrets, editing any function that has a cross-runtime twin, or asking "why is it designed this way", "can I add a route", "is this safe to change", "what must stay in sync". Contains the authoritative twin inventory, the invariant table with enforcing code, the trust/secret model, and the plainly-stated weak points.
---

# Velyr Architecture Contract

CLAUDE.md describes *what* the architecture is. This skill is the **contract layer**: what is load-bearing, what must never be violated, why (with the incident behind it), and where the system is knowingly weak. Check your planned change against §2 (invariants) and §1 (twins) before writing code.

Line numbers below are anchors **as of 2026-07-11** — anchor your edits on the named functions/constants, never on the line numbers (they drift).

## 1. The twin inventory (format-locked cross-runtime pairs)

**Why twins exist:** Vercel Node functions (`api/`) and the Supabase Deno edge functions (`supabase/functions/`) are separate deploy bundles with different runtimes (`node:crypto` vs Web Crypto, different resolvers) — they **cannot import a shared module across the boundary**. Where logic must match, the repo keeps duplicate declarations marked with "keep in sync" / "FORMAT-LOCKED TWIN" comments.

**The rule: edit one side ⇒ edit the other in the same change, then diff them.** The edge side only takes effect after `npx supabase functions deploy <fn>` (OPERATOR — ask Florian); shipping the Vercel side alone leaves the twins skewed in production.

| Twin | Declarations (as of 2026-07-11) | Must match | Deliberate differences |
|---|---|---|---|
| `fileToRoutePath` (file → URL route) | `supabase/functions/agent-run/route-map.ts:47` ↔ `api/agent/run.js:804` | Byte-compatible mapping rules (segment rules, index collapsing) | Full rule docs live in route-map.ts only |
| `encryptSecret`/`decryptSecret` (`enc:v1:` wire format) | **Three** declarations: `api/_lib/secret-crypto.js` ↔ `supabase/functions/agent-run/index.ts:~449–494` ↔ `supabase/functions/shopify-oauth/index.ts:114` | `enc:v1:` + base64(iv(12) ‖ tag(16) ‖ ciphertext), AES-256-GCM; legacy plaintext passes through | Node uses `node:crypto`, Deno uses Web Crypto — implementation differs, wire format may not |
| OAuth state HMAC token format | `supabase/functions/shopify-oauth/index.ts:166` ↔ `api/github/_oauth-state.js` | Signed-state token format | Shopify vs GitHub payload fields |
| `ROLLBACK_BOUNCE_PP_THRESHOLD` (15pp) | `api/agent/run.js:~1084` (the trigger) ↔ `supabase/functions/agent-run/receipt-builder.ts:48` (the receipt text) | The number and its meaning — the PR receipt states the *real* trigger | Only run.js enforces; receipt-builder narrates |
| `cleanupStaleRuns` (zombie `running` sweep) | `supabase/functions/agent-run/index.ts:5525` ↔ `api/agent/run.js:330` | Criteria (`status='running'`, older than threshold), error message, 60-min `STALE_RUN_THRESHOLD_MS` default (env-overridable both sides) | Edge runs at run start; Vercel runs in daily cron + `trigger_run` pre-check |
| `readShopifyThemeFile` ↔ `readThemeFile` | `supabase/functions/agent-run/index.ts:4063` ↔ `api/_lib/shopify-theme-io.js:83` | Same GraphQL query name `VelyrThemeFile`, same `{ ok, content, checksumMd5 } \| { ok:false, reason, message }` shape, same 401/403→`unauthorized` classification | — |
| `refreshShopifyToken` | `supabase/functions/agent-run/index.ts:550` ↔ `api/_lib/shopify-token-refresh.js:31` | Endpoint, form params, **400 AND 401 → `needs_reconsent`** (everything else transient `refresh_failed`), token-column names, single-use rotation | **Signature differs**: edge is `(conn)` (module-scope supabase), Node is `(supabase, conn)` |
| `getPostHogAnalytics` `$host` filter | `supabase/functions/agent-run/index.ts` ↔ `api/agent/run.js` (+ the before/after comparison in `handleRollbackCheck`) | Every PostHog query filters `properties.$host = posthog_host_filter`; null filter ⇒ skip, never unfiltered | Engagement enrichment (scroll/click/rage/dead) is **edge-only by design** — do NOT "fix" the Vercel twin by adding it |
| `captureScreenshot` (ScreenshotOne config) | `supabase/functions/agent-run/index.ts:2734` ↔ `api/_lib/screenshot.js:9` (shared by run.js + telegram webhook) | `format=png, cache=false, wait_until=load, delay=8, navigation_timeout=20, timeout=30`, no `response_type`, no `wait_for_selector`; upload to public `screenshots` bucket | Node version extracted to `_lib` (one Node declaration, not two) |
| `escapeHtml` (Telegram HTML mode) | Edge `index.ts:1051` ↔ Node ×4: `api/agent/run.js:63`, `api/webhooks/telegram.js:40`, `api/webhooks/stripe.js:37`, `api/_lib/shopify-approval.js:25` (+ email-flavored `api/_lib/email.js:51`) | Escapes `& < >` **and `"`** | Five Node copies exist — a change means sweeping all of them |
| `approvalKeyboard` (inline YES/NO buttons) | `supabase/functions/agent-run/index.ts:1064` ↔ `api/agent/run.js:97` | `callback_data` format `approve:<runId>` / `reject:<runId>` (+ preview variant) | — |
| `SHOPIFY_API_VERSION = '2026-04'` (file-level Admin API pin) | `supabase/functions/agent-run/index.ts:689` ↔ `api/_lib/shopify-theme-io.js:14` ↔ `api/onboarding.js:44` ↔ `supabase/functions/shopify-oauth/index.ts` | The version string | Theme-**level** ops (`themeDuplicate`/`themeDelete`) pin their own `THEME_OPS_API_VERSION = '2026-07'` in `shopify-theme-io.js:153` — a separate, intentional pin |
| Model + pricing | `AGENT_LLM_MODEL` fallback slug: `api/agent/run.js:~914` (`VISUAL_CHECK_MODEL`) ↔ edge `LLM_MODEL`; `VISUAL_LLM_EUR_PER_M` (run.js:~918) ↔ `LLM_PRICING_EUR_PER_M` (edge) | Fallback slug `anthropic/claude-sonnet-4.6` (OpenRouter **dot** convention) and €/M defaults (3.0 in / 15.0 out) | Env var must be set on BOTH surfaces (Supabase secret + Vercel env) |
| `email_type` vocabulary | `api/_lib/email.js:33` ↔ `supabase/migrations/20260711_email_lifecycle.sql` CHECK | The allowed email_type strings | Code ↔ SQL twin (migration applied manually) |
| Crawler-fallback markup | `scripts/prerender.mjs:35` ↔ `index.html` fallback block | The static fallback content | Build-time only, no runtime effect |
| PostHog loader snippet | `POSTHOG_ARRAY_LOADER` (edge `index.ts:1849`, used by `buildPostHogLoaderJS`) ↔ the inline loader in `index.html` | The array.js CDN loader body | Customer snippet adds `posthog.register({ $host })` |

**Deliberate NON-twins** (marked in code — don't "unify" them):
- `supabase/functions/agent-run/posthog-inject.mjs` — a **cross-runtime shared module** (dependency-free ESM imported by both the Deno edge fn and the Node unit test). This is the preferred pattern when logic is pure: share the file, don't twin it.
- `canonicalizeHost` in `api/_lib/trial-fingerprint.js:16` — behaviorally a superset of the edge `hostnameFromUrl`, deliberately not locked (only the Vercel side touches the ledger).
- Within one runtime, sharing is required, not twinning: Node files import from `api/_lib/` (underscore ⇒ not a Vercel route).

## 2. Invariants

| Invariant | Why | Enforced at | If violated |
|---|---|---|---|
| Max 12 Vercel serverless functions (Hobby plan). Currently **8 route files** under `api/` (`_lib/` and `_`-prefixed files are not routes) | Hard platform cap | Convention: action-routing (`?action=`, `?mode=`) inside `api/agent/run.js` / `api/onboarding.js` / `api/stripe.js` | Deploy fails or a route silently doesn't ship. Never split the action-routed files; never add routes to `vercel.json` |
| Monday full run is **fire-and-forget** edge dispatch: 2s AbortController, abort = success | Vercel 60s budget vs multi-minute analysis | `api/_lib/edge-dispatch.js` (AbortError means the request WAS sent; edge continues via `EdgeRuntime.waitUntil`) | Awaiting the edge fn times out the cron |
| **One shared PostHog project** (412701), partitioned by `properties.$host` | PostHog Free = 1 project/org (per-customer creation always failed) | Every read carries the `$host` filter; `posthog_host_filter` null ⇒ queries **skipped** (warn + null metrics) | Unfiltered reads mix all tenants + velyr.io's own traffic → mis-attributed metrics, possible cross-tenant leak |
| **Nothing writes to a customer's repo/theme before an explicit YES** | The product promise ("your code, your approval") | GitHub: PR created but merged only in approve handlers; Shopify-direct: fix staged as `analysis_result.pending_write`, written only by `applyShopifyDirectWrite` (`api/_lib/shopify-approval.js`) | Trust destroyed; also legal exposure. No code path may route around the approval gate |
| Shopify writes use **optimistic concurrency**: re-query `checksumMd5` at YES-time; mismatch or create-collision ⇒ `shopify_concurrency_abort`, nothing written | Merchant may edit the theme between analysis and YES | `shopify-approval.js:81–128` | Silent overwrite of merchant edits |
| Idempotency layers: `agent_run_locks` (per-sub advisory lock), `telegram_webhook_dedupe` (update_id), `email_log` claim-first-send-second (release claim on failed send, `23505` ⇒ already sent), CAS on run-status flips (`api/_lib/run-reconcile.js`) | Crons, webhooks, and double-taps all re-fire | `api/_lib/email.js:333–360`; lock/dedupe tables used in run.js, telegram.js, edge index.ts | Duplicate runs/PRs/emails/state flips |
| Focus pin (`focus_page_path`) is **one-shot**: consumed after Pass 2 (even on skip), survives pre-Pass-2 death | One week's bias, not a permanent override | `clearFocusPage` called at `index.ts:3679` only after the Pass-2 call | Pin dominates every subsequent run |
| Run statuses are CHECK-constrained; **migration first, code second** | DB rejects unknown status writes at runtime | `agent_runs_status_check` (extended by `20260624_shopify_approval_statuses.sql`, `20260630_shopify_rollback_statuses.sql`) | Inserting an unlisted status throws in prod — shipping code before the manual migration bricks the flow |
| One connection type per row: `github_repo_name` XOR `shopify_shop_domain` (both-NULL allowed) | `processConnection` routing must be unambiguous | `agent_connections_single_type_check` (migration `20260620_...`) | Ambiguous pipeline routing. Note: applying this CHECK to a fresh env requires a zero-violator audit first |
| **Honest fail**: unknown framework ⇒ `unsupported` skip; thin data ⇒ `insufficient_data`; no fabricated success | The product's credibility is the receipt | `repo-mapper.ts` classification; skip statuses; receipt-builder | Fake fixes/metrics — the exact failure the competitors have |
| Secrets at rest are `enc:v1:` AES-256-GCM only; legacy plaintext tolerated on read during migration | Tokens grant write access to customer repos/stores | `api/_lib/secret-crypto.js` + the two edge declarations | Plaintext tokens in DB dumps |
| Cross-tenant data crosses **only as anonymized counts**: Global Win Library = fix_type × outcome counts, `n ≥ 2` per line, ≤ 10 lines, `fix_type='other'` and `user_verdict='rejected'` excluded, `pending` never counted — never notes, paths, URLs, or per-site text | Multi-tenant privacy with a single LLM prompt surface | `getGlobalWinLibrary` (`index.ts:3106–3142`) | Tenant data leaks into another tenant's prompt |
| Telegram trust model: `chat_id` is identity **only** with a `verification_code_id` + `verified_at` audit trail; approval resolves run-scoped via `telegram_message_id` across all chat-bound subs | Chat IDs are guessable/forwardable | `api/webhooks/telegram.js:101–160, 294–330` (`getChatAuthorizedSubIds`, `resolveApprovalRunId`) | Anyone messaging the bot could approve someone else's PR |
| OAuth defense-in-depth — ALL layers must pass before any write: state HMAC + expiry → single-use nonce (`github_oauth_states`) → cookie HMAC + expiry → `cookie.authUserId === JWT user.id` → `installationId ∈ cookie.installations` → `repoFullName ∈ installation's repos` → `complete_onboarding` RPC's own `auth.uid()` check | Ownership is keyed on the **Velyr subscription**, never the GitHub account | `api/github/oauth-initiate.js`, `oauth-callback.js`, `api/onboarding.js`, the SECURITY DEFINER RPC | Cross-tenant connection takeover |
| `trial_fingerprints` must **never** gain an FK to users/subscriptions and **never** enter the delete handler's `childTables` list (`api/agent/run.js:668`) | The ledger's whole point is surviving account deletion (anti delete-and-retrial) | Guard comments in `api/agent/run.js` + `api/stripe.js:237` | Anti-abuse layer silently dies |

## 3. Trust and secret boundaries

- **Service-role key bypasses RLS.** All backend code uses it; RLS protects only against the browser client. Treat every backend query as root — scoping is your job, not the DB's.
- **Double-duty secret — `AGENT_APPROVAL_TOKEN_SECRET`:** HMAC key for (a) one-click email-unsubscribe links (§7 Abs. 3 UWG objection — rotating it kills every already-sent link, a *legal* problem) and (b) the `trial_fingerprints` ledger hashes (rotating orphans every ledger row — every past abuser gets one fresh trial). Rotation is an event, not hygiene.
- **`AGENT_TOKEN_ENCRYPTION_KEY`:** rotating it bricks every stored GitHub/Shopify token — all connections need reconsent. There is no re-encryption tool (as of 2026-07-11).
- Surface split: Mailjet vars are Vercel-only (edge never emails); `SHOPIFY_API_KEY/SECRET` are Supabase secrets (OAuth fn); `AGENT_LLM_MODEL` must live on **both** surfaces. Full catalog: see **velyr-config-and-flags**.

## 4. Known-weak points (stated plainly)

| Weak point | Why still there | Trip-wire that forces the fix |
|---|---|---|
| `subscription_id` text-vs-uuid + column split: Stripe webhook keys on `user_id`, agent system on `auth_user_id` (both hold a Supabase auth UUID) | Pre-existing; unification needs a careful data migration | Any second billing surface or a webhook bug touching the wrong row |
| `App.jsx` auth routing sniffs `window.location.hash` synchronously on mount — races supabase-js's async session exchange | Minimal fix shipped; full `onAuthStateChange` migration deferred | **Before adding a 2nd OAuth login provider.** Must preserve all four landings (recovery, email-confirm, checkout-intent, plain login) |
| Brand guardrails are **prompt-only** — `guardrailsContext` (`index.ts:3552`, interpolated `:3636`); no post-parse enforcement | Enforcement needs a real checker, not copy | Any marketing claim like "rejected before they reach you" (forbidden — see velyr-docs-and-writing), or a guardrail violation reaching a customer |
| `finalize` lets a legacy `auth_user_id IS NULL` verification code pass once (`api/onboarding.js:646`) | Codes minted before `/start` stamping; removal was deferred | Any suspicious onboarding activity; or simply: it's a 24h-followup that never happened |
| Shopify-direct apply/rollback can double-fire on two concurrent YES (no `shopify_applying`/`shopify_rolling_back` interim statuses — M2-B/M5) | Needs a manual status-CHECK migration; harm bounded (write is idempotent + checksum-guarded; loser only mislabels status) | First real double-fire mislabel, or the next status migration touching `agent_runs_status_check` anyway |
| `react-router-dom` is in `package.json` but **unused** — routing is manual in `App.jsx` (deliberate) | Removing the dep is churn; wiring it up would be a regression | Don't wire it up. If dependency-pruning, verify zero imports first (zero as of 2026-07-11) |
| Frontend env prefixes: `VITE_*` is authoritative; `NEXT_PUBLIC_*` is a code-level fallback Vite does **not** expose to the browser (`src/lib/supabase.js:15`) | Legacy scaffold | Any "supabase client is undefined" in a fresh env — set the `VITE_*` vars |
| `agent_ab_tests` table is dormant data only (feature removed) | Kept for historical rows + the account-deletion purge list | Never add reads/writes; never reintroduce A/B naming |

## When NOT to use this skill

- **How the weekly pipeline works internally** (RA1–RA7, prompts, budgets) → `velyr-agent-pipeline-reference`
- **Process for shipping a change** (stages, gates, staging discipline) → `velyr-change-control`
- **The history behind an incident** (what was tried, red herrings) → `velyr-failure-archaeology`
- **Where a flag/env var lives and its default** → `velyr-config-and-flags`
- **Live triage of a failure happening now** → `velyr-debugging-playbook`

## Provenance and maintenance

Verified against the repo on **2026-07-11** (main @ 58d8326). Re-verify before relying on drift-prone items:

- Twin comment sweep: `grep -rn "keep in sync\|FORMAT-LOCKED\|format-locked" api supabase scripts --include="*.js" --include="*.ts" --include="*.mjs"`
- Route-file count vs the 12-cap: `find api -name "*.js" ! -path "*/_lib/*" ! -name "_*"`
- Rollback threshold pair: `grep -rn "ROLLBACK_BOUNCE_PP_THRESHOLD" api supabase`
- Stale-run twins: `grep -rn "STALE_RUN_THRESHOLD_MS" api supabase`
- Token-refresh classification: `grep -n "400\|401" api/_lib/shopify-token-refresh.js supabase/functions/agent-run/index.ts | grep -i reconsent`
- Win-library privacy bounds: read `getGlobalWinLibrary` in `supabase/functions/agent-run/index.ts` (search the function name)
- Guardrails still prompt-only: `grep -n "guardrailsContext" supabase/functions/agent-run/index.ts` (interpolation only, no post-parse check)
- Legacy null-code pass still present: `grep -n "legacy" api/onboarding.js`
- react-router-dom still unused: `grep -rn "react-router" src/`
- Admin API version pins: `grep -rn "2026-04\|THEME_OPS_API_VERSION" api/_lib/shopify-theme-io.js api/onboarding.js supabase/functions`
