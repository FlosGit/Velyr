-- ════════════════════════════════════════════════════════════════════════════
-- Shopify connection — reconciliation migration
--
-- Reconciled from direct SQL-Editor changes applied 2026-06-14; idempotent, safe
-- to re-run.
--
-- The Shopify connection columns + partial-unique index, and the
-- github_oauth_states.provider column, were applied directly via the Supabase SQL
-- Editor across several steps — so the repo migration history had drifted from
-- the live DB. This file is the single source of truth for that end state. It is
-- fully ADDITIVE and IDEMPOTENT (ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT
-- EXISTS), so applying it to the already-migrated production DB is a no-op; it
-- exists so a fresh / reproducible environment lands in the same state.
--
-- Connection model is unchanged: agent_connections stays 1 row per subscription,
-- and every shopify_* column is nullable so GitHub-only, Shopify-only, or both
-- can coexist in one row. These columns are written by the shopify-oauth Edge
-- Function via the service role — no RLS change is needed (the browser cannot
-- write agent_connections; interim write policies were retired in
-- 20260522_retire_interim_oauth_rls.sql).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Step 1: Shopify connection columns on agent_connections (8) ─────────────
-- All nullable. The two token columns hold enc:v1: AES-256-GCM ciphertext
-- (api/_lib/secret-crypto.js twin). The expiry columns are absolute timestamps
-- derived from Shopify's expires_in / refresh_token_expires_in (seconds).
alter table public.agent_connections
  add column if not exists shopify_shop_domain              text,        -- validated *.myshopify.com
  add column if not exists shopify_access_token             text,        -- encrypted offline access token
  add column if not exists shopify_refresh_token            text,        -- encrypted 90-day refresh token
  add column if not exists shopify_token_expires_at         timestamptz, -- access-token expiry  (~1h)
  add column if not exists shopify_refresh_token_expires_at timestamptz, -- refresh-token expiry (~90d)
  add column if not exists shopify_main_theme_id            bigint,      -- role MAIN theme id (GID numeric tail)
  add column if not exists shopify_scope                    text,        -- granted scopes, e.g. 'read_themes'
  add column if not exists shopify_connected_at             timestamptz; -- when the connection was established

-- ─── Step 2: partial-unique index — one myshopify domain ⇒ one subscription ──
-- The shopify-oauth callback relies on this constraint's 23505 to reject a shop
-- already connected to a DIFFERENT Velyr subscription (→ 'shop_already_connected'
-- redirect, not a 500). Partial (WHERE NOT NULL) so the many GitHub-only rows
-- with a null domain never collide with each other.
create unique index if not exists agent_connections_shopify_shop_domain_key
  on public.agent_connections (shopify_shop_domain)
  where shopify_shop_domain is not null;

-- ─── Step 3: github_oauth_states.provider — multi-provider nonce registry ────
-- The single-use OAuth nonce table is now shared between the GitHub and Shopify
-- flows. `provider` scopes a nonce to its flow: the shopify-oauth callback
-- consumes only its own nonces (`... and provider = 'shopify'`), and the GitHub
-- flow keeps the default. NOT NULL DEFAULT 'github' backfills the pre-existing
-- github-only rows so legacy nonces remain valid.
alter table public.github_oauth_states
  add column if not exists provider text not null default 'github';
