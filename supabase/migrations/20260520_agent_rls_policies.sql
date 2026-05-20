-- ════════════════════════════════════════════════════════════════════════════
-- FINAL: Row-Level Security for the agent tables.
--
-- Context: the backend (Edge Function + every api/ route) uses the SERVICE ROLE
-- key, which bypasses RLS. These policies only constrain the BROWSER
-- (anon / authenticated) client. Safe to apply — no agent/cron/webhook op
-- depends on RLS being permissive.
--
-- Closes the three gaps confirmed by the Part A audit:
--   (1) telegram_verification_codes was browser-readable with using=true
--   (2) agent_subscriptions had conflicting policies + a cmd=ALL policy with no
--       column restriction → premium-status self-grant
--   (3) anon held ALL PRIVILEGES on every table
--
-- Ownership model: agent_subscriptions carries BOTH user_id (set by the Stripe
-- webhook, used by every browser read) and auth_user_id (set during onboarding,
-- used by the agent). We accept either as proof of ownership.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Step 0: drop ALL pre-existing policies on the target tables ─────────────
-- Explicit named drops for the two conflicting agent_subscriptions policies the
-- audit found (so the intent is documented)…
drop policy if exists "Users see own subscriptions" on public.agent_subscriptions;
drop policy if exists "users read own subscription"  on public.agent_subscriptions;

-- …and a programmatic sweep that removes every remaining policy (including the
-- old cmd=ALL policies on agent_connections / agent_runs whose exact names we
-- don't hard-code) BEFORE creating the canonical ones, so nothing overlaps.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'agent_subscriptions','agent_connections','agent_runs','agent_ab_tests',
        'agent_learnings','agent_business_dna','agent_competitor_urls',
        'agent_competitor_snapshots','agent_funnel_pages','agent_brand_guardrails',
        'impact_metrics','telegram_verification_codes')
  loop
    execute format('drop policy if exists %I on public.%I;', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ─── Step 1: enable RLS + revoke anon everywhere (closes gap 3) ──────────────
do $$
declare t text;
begin
  foreach t in array array[
    'agent_subscriptions','agent_connections','agent_runs','agent_ab_tests',
    'agent_learnings','agent_business_dna','agent_competitor_urls',
    'agent_competitor_snapshots','agent_funnel_pages','agent_brand_guardrails',
    'impact_metrics','telegram_verification_codes'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end $$;

-- ─── Step 2: agent_subscriptions — root ownership (closes gap 2) ─────────────
create policy agent_subscriptions_select_own on public.agent_subscriptions
  for select to authenticated
  using (user_id = auth.uid() or auth_user_id = auth.uid());

create policy agent_subscriptions_update_own on public.agent_subscriptions
  for update to authenticated
  using (user_id = auth.uid() or auth_user_id = auth.uid())
  with check (user_id = auth.uid() or auth_user_id = auth.uid());

-- Column-level grant is what actually prevents the premium-status self-grant:
-- the row policy alone would let a user UPDATE subscription_status on their own
-- row. Only the four columns onboarding legitimately writes from the browser
-- are granted (verified via grep of all src/ writes). Everything else —
-- subscription_status, full_scan_purchased(_at), stripe_*, subscription_id,
-- current_period_end, cancel_at_period_end, canceled_at, user_id — stays
-- service-role-only.
revoke update on public.agent_subscriptions from authenticated;
grant  update (auth_user_id, email, plan, telegram_chat_id)
  on public.agent_subscriptions to authenticated;
-- No INSERT/DELETE policy → browser cannot create or delete subscriptions.

-- ─── Step 3: child tables keyed by subscription_id — browser READS only ──────
do $$
declare t text;
begin
  foreach t in array array[
    'agent_runs','agent_ab_tests','agent_learnings','agent_business_dna',
    'agent_competitor_urls','agent_competitor_snapshots','agent_funnel_pages'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (subscription_id in (
          select id from public.agent_subscriptions
          where user_id = auth.uid() or auth_user_id = auth.uid()
        ));
    $f$, t||'_select_own', t);
  end loop;
end $$;

-- ─── Step 4: agent_brand_guardrails — browser READS + UPSERTS (dashboard) ────
create policy agent_brand_guardrails_select_own on public.agent_brand_guardrails
  for select to authenticated
  using (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

create policy agent_brand_guardrails_insert_own on public.agent_brand_guardrails
  for insert to authenticated
  with check (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

create policy agent_brand_guardrails_update_own on public.agent_brand_guardrails
  for update to authenticated
  using (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()))
  with check (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

-- ─── Step 5: impact_metrics — now keyed by subscription_id (Flag 2 column) ───
create policy impact_metrics_select_own on public.impact_metrics
  for select to authenticated
  using (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

-- ─── Step 6: agent_connections — sensitive (creds + verification binding) ────
-- READ own (posthog key is encrypted at rest, Stage 4.1).
create policy agent_connections_select_own on public.agent_connections
  for select to authenticated
  using (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

-- ⚠️ INTERIM browser write policies. Onboarding currently upserts this row
-- from the browser (incl. verification_code_id / verified_at), so denying
-- writes now would break onboarding. These owner-scoped policies keep it
-- working but leave verified_at browser-forgeable. The OAuth-block
-- complete_onboarding() RPC REPLACES these (deny browser writes; write
-- server-side). Remove both when that lands.
create policy agent_connections_insert_own_interim on public.agent_connections
  for insert to authenticated
  with check (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

create policy agent_connections_update_own_interim on public.agent_connections
  for update to authenticated
  using (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()))
  with check (subscription_id in (select id from public.agent_subscriptions where user_id = auth.uid() or auth_user_id = auth.uid()));

-- ─── Step 7: telegram_verification_codes (closes gap 1) ──────────────────────
-- ⚠️ INTERIM. The secure end state is: NO browser policy + consume via a
-- SECURITY DEFINER RPC (built in the OAuth/complete_onboarding block). Until
-- onboarding switches to the RPC it still reads/updates this table client-side,
-- so we replace the wide-open using=true with the narrowest policy that keeps
-- onboarding working: only currently-live codes (unused, unexpired) are
-- visible/updatable. This removes exposure of used/expired codes and is a
-- large improvement over using=true; the RPC removes browser access entirely.
create policy tvc_select_live_interim on public.telegram_verification_codes
  for select to authenticated
  using (used = false and (expires_at is null or expires_at > now()));

create policy tvc_update_live_interim on public.telegram_verification_codes
  for update to authenticated
  using (used = false and (expires_at is null or expires_at > now()))
  with check (true);
