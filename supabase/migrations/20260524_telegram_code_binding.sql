-- ════════════════════════════════════════════════════════════════════════════
-- B3 — Telegram code binding hardening.
--
-- Problem (pre-B3): nothing tied a VELYR-XXXXXX verification code to the
-- velyr.io account that should own it. A leaked/shoulder-surfed code let any
-- authenticated user call verify_telegram_code (→ learn the victim's chat_id)
-- and finalize (→ bind the victim's chat to the attacker's subscription).
-- "Claim at verify" (option b) does NOT close this: the attacker is both the
-- verifier and the finalizer, so a match check passes for them. The fix binds
-- the code to an identity the attacker cannot substitute — at /start time,
-- before the code can leak (option a):
--
--   1. The AUTHENTICATED onboarding UI mints a single-use, short-TTL start
--      token tied to auth_user_id and renders t.me/VelyrBot?start=<token>.
--   2. The bot's /start consumes the token and stamps auth_user_id onto the
--      new telegram_verification_codes row.
--   3. verify_telegram_code + finalize enforce code.auth_user_id == auth.uid().
--
-- A stolen code is now bound to the victim's auth_user_id, so the attacker's
-- JWT no longer matches — closing the leak/shoulder-surf vector, not just
-- brute force (which Stage 3C's rate limit already throttled).
--
-- All DB access here is via the service-role key (bot + onboarding endpoint),
-- which bypasses RLS; these tables get NO browser policy. Idempotent guards
-- throughout. Applied manually via the Supabase SQL Editor (repo record only).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Bind each verification code to the initiating velyr.io account ────────
-- Nullable on purpose: codes minted in the deploy window (before the new
-- /start ships) carry NULL and are allowed through finalize/verify ONCE — they
-- all drain within the 30-min code TTL. (Removing the null-allow is a parked
-- 24h follow-up.) ON DELETE CASCADE: if the auth user is deleted, drop their
-- in-flight codes.
alter table public.telegram_verification_codes
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

create index if not exists tvc_auth_user_id_idx
  on public.telegram_verification_codes (auth_user_id);

-- ─── 2. Single-use start tokens (the deep-link payload) ───────────────────────
-- Minted by /api/onboarding?action=telegram_start_token for the authenticated
-- caller, consumed by the bot's /start. Short TTL (15 min) + single-use so a
-- captured deep link can't be replayed to mint extra victim-bound codes.
create table if not exists public.telegram_start_tokens (
  token        text        primary key,
  auth_user_id uuid        not null references auth.users(id) on delete cascade,
  used         boolean     not null default false,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

alter table public.telegram_start_tokens enable row level security;
revoke all on public.telegram_start_tokens from anon, authenticated;
-- GC piggybacked on the daily enforce_subscriptions cron (rows older than 1 day);
-- no pg_cron required.
