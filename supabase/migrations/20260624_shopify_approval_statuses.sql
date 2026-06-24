alter table public.agent_runs
  drop constraint if exists agent_runs_status_check;

alter table public.agent_runs
  add constraint agent_runs_status_check
  check (status = any (array[
    'pending','running','waiting_approval','approved','rejected','deployed','failed','rolled_back',
    'skipped_setup_pending','skipped_cost_cap','skipped_repo_unavailable','skipped_unsupported_framework',
    'skipped_no_data','skipped_insufficient_graph','skipped_low_confidence',
    'find_mismatch','find_ambiguous',
    'shopify_preview','shopify_needs_reconsent','shopify_not_configured','shopify_token_failed',
    'shopify_theme_read_failed','shopify_github_preview',
    'shopify_awaiting_approval','shopify_deployed','shopify_rejected'
  ]::text[]));