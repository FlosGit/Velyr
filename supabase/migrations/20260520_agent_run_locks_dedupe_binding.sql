-- Stage 4 migrations: cron-overlap lock, webhook dedupe, strong chat_id binding.

-- ─── 4.6: per-subscription advisory lock + stale-run cleanup support ─────────
create table if not exists public.agent_run_locks (
  subscription_id uuid        primary key references public.agent_subscriptions(id) on delete cascade,
  locked_until    timestamptz not null,
  acquired_at     timestamptz not null default now()
);

-- Atomic acquire: take the lock if free or expired; return false if a live
-- lock exists.
create or replace function public.agent_run_lock_acquire(
  p_subscription_id uuid,
  p_locked_until    timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  insert into public.agent_run_locks (subscription_id, locked_until, acquired_at)
  values (p_subscription_id, p_locked_until, v_now)
  on conflict (subscription_id) do update
    set locked_until = excluded.locked_until,
        acquired_at  = v_now
    where agent_run_locks.locked_until < v_now;  -- only steal if expired
  return exists (
    select 1 from public.agent_run_locks
    where subscription_id = p_subscription_id
      and acquired_at = v_now
  );
end;
$$;

create or replace function public.agent_run_lock_release(p_subscription_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.agent_run_locks where subscription_id = p_subscription_id;
$$;

alter table public.agent_run_locks enable row level security;
revoke all on public.agent_run_locks from anon, authenticated;
revoke execute on function public.agent_run_lock_acquire(uuid, timestamptz) from anon, authenticated;
revoke execute on function public.agent_run_lock_release(uuid) from anon, authenticated;

-- ─── 4.9: Telegram webhook update_id dedupe ──────────────────────────────────
create table if not exists public.telegram_webhook_dedupe (
  update_id   bigint      primary key,
  received_at timestamptz not null default now()
);
alter table public.telegram_webhook_dedupe enable row level security;
revoke all on public.telegram_webhook_dedupe from anon, authenticated;
-- GC is piggybacked on the daily enforce-subscriptions cron (deletes rows
-- older than 7 days); no pg_cron required.

-- ─── 4.13: strong chat_id ↔ subscription binding ─────────────────────────────
alter table public.agent_connections
  add column if not exists verification_code_id uuid references public.telegram_verification_codes(id) on delete set null,
  add column if not exists verified_at          timestamptz;

-- Backfill existing rows so current users aren't locked out of the bot.
update public.agent_connections ac
set verification_code_id = vc.id,
    verified_at          = coalesce(ac.created_at, now())
from public.telegram_verification_codes vc
where ac.telegram_chat_id is not null
  and ac.verification_code_id is null
  and vc.chat_id = ac.telegram_chat_id
  and vc.used    = true;

-- Rows still missing verification_code_id after backfill are locked out of bot
-- commands until the user re-runs /start + onboarding. Find them with:
--   select id, subscription_id, telegram_chat_id from agent_connections
--   where telegram_chat_id is not null and verification_code_id is null;
