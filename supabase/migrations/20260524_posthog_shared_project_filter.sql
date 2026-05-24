-- ════════════════════════════════════════════════════════════════════════════
-- PostHog architecture switch: per-customer projects → ONE shared project,
-- partitioned by the customer's domain on event property $host.
--
-- Why: the old setupPostHogForConnection() tried to POST a dedicated PostHog
-- project per customer to /api/organizations/{ORG_ID}/projects/. The PostHog
-- Free plan caps an org at one project, so every provisioning call failed with
-- "permission_denied: maximum limit of allowed projects" and all connections
-- ended up with posthog_project_id = null / posthog_snippet_token = null.
--
-- New model: every customer's site emits to Velyr's single shared project
-- (POSTHOG_PROJECT_ID, currently 412701) using the shared public write token.
-- The customer's domain is the partition key, carried on each event as
-- properties.$host. Reads filter by properties.$host = '<domain>' to scope data
-- to the right customer. No runtime PostHog org-level API calls remain, so
-- POSTHOG_ORG_ID is no longer read by the code.
--
-- Idempotent (IF NOT EXISTS guards). Applied manually in the Supabase SQL
-- Editor per the established workflow.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Domain partition key. Nullable: backfilled on the connection's first run
--    (setupPostHogForConnection derives the hostname from website_url, stores it
--    here, and sends the snippet via Telegram). Reads that find it null skip the
--    PostHog queries and fall back to funnel discovery only.
alter table public.agent_connections
  add column if not exists posthog_host_filter text;

-- 2) Backfill posthog_project_id with the shared project id for existing rows so
--    the column is non-null and documents which project these connections point
--    at. The runtime no longer depends on this value (it falls back to the
--    POSTHOG_PROJECT_ID env var), and the first-run trigger keys on
--    posthog_host_filter, not this column — so this backfill is purely for
--    clarity and is safe to skip if the shared id ever changes.
--    NOTE: 412701 is the current POSTHOG_PROJECT_ID. If yours differs, edit it
--    before running.
update public.agent_connections
  set posthog_project_id = '412701'
  where posthog_project_id is null;
