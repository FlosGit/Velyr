-- ════════════════════════════════════════════════════════════════════════════
-- Email lifecycle (Mailjet): onboarding drip + weekly digest, no LLM involved.
--
-- Two pieces:
--   1. agent_subscriptions.email_opt_out — the §7 Abs. 3 Nr. 3 UWG objection
--      flag. Set by the public HMAC-signed one-click unsubscribe action
--      (api/agent/run.js ?action=email_opt_out). Every sender checks it.
--   2. email_log — one row per (subscription, email_type, period_key) actually
--      claimed for sending. The UNIQUE constraint is the idempotency guard:
--      senders INSERT the claim FIRST (23505 → already sent, skip), then send,
--      and best-effort delete the claim if the provider call fails so the next
--      daily cron retries. Drip mails use period_key='once'; the weekly digest
--      uses the ISO week ('2026-W28') so it can send once per week forever.
--
-- email_type vocabulary (keep in sync with api/_lib/email.js EMAIL_TYPES):
--   welcome        — sent at init_subscription (first server-side footprint)
--   setup_reminder — day-2 drip, only while onboarding_completed_at IS NULL
--   tips           — day-7 drip
--   weekly_digest  — Monday weekly_summary cron, per ISO week
--
-- FK cascades on subscription delete, and email_log is ALSO in the account-
-- delete childTables list in api/agent/run.js (idempotent belt-and-suspenders,
-- same as the other cascading children).
--
-- Applied manually via the Supabase SQL Editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_subscriptions
  add column if not exists email_opt_out boolean not null default false;

create table if not exists public.email_log (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.agent_subscriptions(id) on delete cascade,
  email_type      text not null check (email_type in
    ('welcome','setup_reminder','tips','weekly_digest')),
  period_key      text not null default 'once',
  sent_at         timestamptz not null default now(),
  unique (subscription_id, email_type, period_key)
);

-- The daily drip pass looks up all rows for a batch of subscriptions.
create index if not exists idx_email_log_subscription
  on public.email_log(subscription_id);

-- Service-role only: RLS on with NO policies + explicit revoke (mirrors the
-- trial_fingerprints / rate_limit_hits pattern).
alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
