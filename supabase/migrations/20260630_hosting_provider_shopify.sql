-- ════════════════════════════════════════════════════════════════════════════
-- agent_connections.hosting_provider — allow 'shopify'
--
-- A Shopify-direct connection (connection_source = 'shopify_direct') has NO
-- external web host — Shopify hosts the storefront. The original CHECK
-- (20260614_hosting_provider.sql) only allowed the five GitHub-deploy hosts
-- (vercel/netlify/render/railway/cloudflare_pages), so onboarding's finalize
-- defaulted those connections to 'vercel' — a silent falsehood that would distort
-- any future host-grouped view or the hosting-adapter roadmap.
--
-- This extends the CHECK to allow 'shopify' (the honest, descriptive value — Shopify
-- is the host), mirroring the connection_source enum-as-text pattern. NULL was
-- considered but the column is NOT NULL and dropping that is a broader change.
--
-- Idempotent: drop-if-exists then re-add. The existing five values are reproduced
-- verbatim; nothing is dropped or reordered. No row rewrite needed — every existing
-- row already holds one of the five legacy values, all still allowed.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_connections
  drop constraint if exists agent_connections_hosting_provider_check;

alter table public.agent_connections
  add constraint agent_connections_hosting_provider_check
  check (hosting_provider in ('vercel','netlify','render','railway','cloudflare_pages','shopify'));
