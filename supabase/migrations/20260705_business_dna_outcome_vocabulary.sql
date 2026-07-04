-- Honest DNA outcomes: 'success' only ever meant "still deployed after 7 days
-- and never auto-rolled-back" — no measured improvement was required. Feeding
-- that back into the agent's prompt as "what works" rewarded innocuous edits.
-- New vocabulary:
--   pending      → awaiting the 7-day verdict (unchanged)
--   measured_win → matched-window bounce improved ≥ MEASURED_WIN_MIN_PP
--                  (impact_metrics, deploy±2d — api/agent/run.js promotePendingDNA)
--   survived     → still deployed at 7 days, but no measured improvement
--   rollback     → rejected or auto-rolled-back (unchanged)
-- 'success' stays ALLOWED (not written by new code) so an old deploy in the
-- window between this migration and the Vercel/edge-fn rollout can't fail its
-- promotion writes; readers normalize success→survived. Tighten later.
-- Applied manually via the Supabase SQL Editor (this file is the repo record).

-- The base table predates the repo migrations, so the outcome CHECK's name is
-- unknown — drop whichever CHECK constrains the column before re-adding.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.agent_business_dna'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%outcome%'
  loop
    execute format('alter table public.agent_business_dna drop constraint %I', c.conname);
  end loop;
end $$;

-- Historical 'success' rows were never measured — relabel them honestly.
update public.agent_business_dna set outcome = 'survived' where outcome = 'success';

alter table public.agent_business_dna
  add constraint agent_business_dna_outcome_check
  check (outcome = any (array[
    'pending'::text,
    'measured_win'::text,
    'survived'::text,
    'rollback'::text,
    'success'::text
  ]));
