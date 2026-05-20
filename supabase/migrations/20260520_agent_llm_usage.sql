-- Stage 2: per-subscription monthly LLM spend tracking.
-- Read/written by the Edge Function (Deno) and api/agent/run.js (Node) via the
-- atomic increment RPC. Without these, spend tracking silently no-ops (the
-- code warns and proceeds — a missing migration must not lock the agent out).

create table if not exists public.agent_llm_usage (
  subscription_id uuid          not null references public.agent_subscriptions(id) on delete cascade,
  period          text          not null,                 -- 'YYYY-MM' in UTC
  input_tokens    bigint        not null default 0,
  output_tokens   bigint        not null default 0,
  cost_eur        numeric(12,6) not null default 0,
  updated_at      timestamptz   not null default now(),
  primary key (subscription_id, period)
);

-- Atomic increment so the weekly cron and user-triggered export-dna can't race
-- on the same row.
create or replace function public.agent_llm_usage_increment(
  p_subscription_id uuid,
  p_period          text,
  p_input_tokens    bigint,
  p_output_tokens   bigint,
  p_cost_eur        numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agent_llm_usage (subscription_id, period, input_tokens, output_tokens, cost_eur, updated_at)
  values (p_subscription_id, p_period, p_input_tokens, p_output_tokens, p_cost_eur, now())
  on conflict (subscription_id, period) do update
  set input_tokens  = agent_llm_usage.input_tokens  + excluded.input_tokens,
      output_tokens = agent_llm_usage.output_tokens + excluded.output_tokens,
      cost_eur      = agent_llm_usage.cost_eur      + excluded.cost_eur,
      updated_at    = now();
end;
$$;

alter table public.agent_llm_usage enable row level security;
revoke all on public.agent_llm_usage from anon, authenticated;
revoke execute on function public.agent_llm_usage_increment(uuid, text, bigint, bigint, numeric) from anon, authenticated;
