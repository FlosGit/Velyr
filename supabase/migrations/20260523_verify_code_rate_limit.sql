-- ════════════════════════════════════════════════════════════════════════════
-- Stage 3C — per-user fixed-window rate limit for verify_telegram_code.
--
-- verify_telegram_code is a code-VALIDITY oracle (200 vs 400). Without a
-- throttle an authenticated caller could brute-force the ~1B VELYR-XXXXXX space
-- to find a live victim code. We cap attempts per auth_user (decision 3: 10 per
-- 60s, key on auth_user_id only, 429 on exceed).
--
-- Mirrors the telegram_webhook_dedupe / agent_run_locks pattern: a service-role-
-- only table (RLS enabled, anon/authenticated revoked) plus an atomic
-- SECURITY DEFINER RPC. GC is piggybacked on the daily enforce_subscriptions
-- cron (api/agent/run.js) — no pg_cron needed.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.rate_limit_hits (
  bucket_key   text        not null,   -- e.g. 'verify_telegram_code:<auth_user_id>'
  window_start timestamptz not null,   -- fixed-window start (server-computed)
  count        integer     not null default 0,
  primary key (bucket_key, window_start)
);

create index if not exists idx_rate_limit_hits_window_start
  on public.rate_limit_hits(window_start);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Atomic increment-and-check for a fixed window, one round-trip. The window is
-- computed server-side (floor(epoch / window) * window) so a client can't widen
-- it. `allowed` is false once the incremented count exceeds p_limit.
create or replace function public.rate_limit_hit(
  p_bucket_key     text,
  p_limit          integer,
  p_window_seconds integer
) returns table(allowed boolean, current_count integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_window timestamptz := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_count  integer;
begin
  insert into public.rate_limit_hits (bucket_key, window_start, count)
  values (p_bucket_key, v_window, 1)
  on conflict (bucket_key, window_start)
    do update set count = public.rate_limit_hits.count + 1
  returning count into v_count;

  return query select
    (v_count <= p_limit),
    v_count,
    greatest(0, (p_window_seconds - floor(extract(epoch from (v_now - v_window))))::int);
end;
$$;

-- Service-role only (the onboarding endpoint calls it with the service key); the
-- browser must never reach the limiter directly.
revoke execute on function public.rate_limit_hit(text, integer, integer) from anon, authenticated;
