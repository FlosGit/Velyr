-- Stage 5.8: store the squash-merge commit SHA so the 48h rollback can locate
-- the exact change deterministically instead of fuzzy-matching commit messages
-- (which squash-merge rewrites).
alter table public.agent_runs
  add column if not exists merge_commit_sha text;

-- FINAL/Flag 2: impact_metrics had no subscription_id column, so the dashboard
-- query (.eq('subscription_id', …)) always returned empty. Add it (denormalized
-- convenience; run_id stays the authoritative FK) and backfill from agent_runs.
alter table public.impact_metrics
  add column if not exists subscription_id uuid references public.agent_subscriptions(id) on delete cascade;

update public.impact_metrics im
set subscription_id = r.subscription_id
from public.agent_runs r
where im.run_id = r.id
  and im.subscription_id is null;
