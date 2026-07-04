-- ════════════════════════════════════════════════════════════════════════════
-- Trial-abuse ledger: deletion-surviving fingerprints of site identities that
-- have already consumed a 14-day free trial.
--
-- The abuse vector: use trial → delete account (api/agent/run.js action=delete
-- hard-deletes agent_connections + agent_subscriptions + the auth user) → sign
-- up again → fresh trial for the SAME website. This table is the only record
-- that survives: it has NO FK to auth.users or agent_subscriptions (so nothing
-- cascades), and it is deliberately ABSENT from the delete handler's
-- childTables list. Never add either.
--
-- Rows are written by api/stripe.js handleStartTrial (via
-- api/_lib/trial-fingerprint.js) at trial-creation time and checked before a
-- new trial is minted. Values are never plaintext:
--   fingerprint_hash = HMAC-SHA256(AGENT_APPROVAL_TOKEN_SECRET,
--     'velyr_trial_fp:v1:<type>:<canonical-value>')
-- ROTATING THAT SECRET ORPHANS EVERY ROW (hashes become unmatchable — abusers
-- get one fresh trial each; no data breaks). 'email' is reserved in the CHECK
-- but not recorded in v1 (plus-addressing makes it trivially bypassable and it
-- is the only pure-PII type).
--
-- Retention: rows older than 365 days are GC'd by the daily
-- enforce_subscriptions cron (api/agent/run.js) — hashed pseudonymous
-- identifiers kept ≤12 months for fraud prevention (legitimate interest,
-- GDPR Art. 6(1)(f), Recital 47).
--
-- Applied manually via the Supabase SQL Editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.trial_fingerprints (
  id               uuid primary key default gen_random_uuid(),
  fingerprint_type text not null check (fingerprint_type in
    ('website_host','github_repo','shopify_shop','telegram_chat','email')),
  fingerprint_hash text not null check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  trial_started_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- hash FIRST so the start_trial lookup (match on fingerprint_hash alone —
  -- the HMAC message is type-prefixed, so cross-type collisions can't happen)
  -- reuses this same index.
  unique (fingerprint_hash, fingerprint_type)
);

-- GC scans by age (daily enforce_subscriptions cron).
create index if not exists idx_trial_fingerprints_created_at
  on public.trial_fingerprints(created_at);

-- Service-role only: RLS on with NO policies + explicit revoke (mirrors the
-- rate_limit_hits pattern, 20260523_verify_code_rate_limit.sql).
alter table public.trial_fingerprints enable row level security;
revoke all on public.trial_fingerprints from anon, authenticated;
