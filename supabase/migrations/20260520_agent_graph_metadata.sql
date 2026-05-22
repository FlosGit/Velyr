-- Stage RA2: persist discovery + import-graph metadata per run so we can see,
-- from the agent_runs table alone, which framework the mapper resolved and how
-- large / how resolvable the import graph was. Useful for tuning RA3's
-- sparse-graph gate and for spotting repos where import resolution degrades.
--
-- All three columns are additive and nullable (no default-break, idempotent).
-- The Edge Function writes them in a best-effort update separate from the
-- run's status write, so a deploy that lands before this migration cannot
-- break the pipeline — the metadata write simply no-ops until the columns
-- exist.
alter table public.agent_runs
  add column if not exists discovered_framework   text;

alter table public.agent_runs
  add column if not exists graph_node_count        integer;

alter table public.agent_runs
  add column if not exists graph_unresolved_count  integer;
