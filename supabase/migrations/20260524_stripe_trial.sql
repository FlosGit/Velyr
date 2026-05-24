-- ════════════════════════════════════════════════════════════════════════════
-- 14-day Stripe trial support.
--
-- Adds a nullable trial_end timestamp to agent_subscriptions. Populated by the
-- Stripe webhook from subscription.trial_end on checkout.session.completed and
-- customer.subscription.created/updated. NULL for subscriptions created before
-- this stage and for subs that never had a trial.
--
-- No new status enum is introduced: subscription_status is a free-text column
-- and already carries Stripe states via STATE_MAP in api/webhooks/stripe.js.
-- As of this stage STATE_MAP no longer collapses 'trialing' into 'active', so
-- 'trialing' is now a first-class value; the cron run-eligibility queries accept
-- both 'active' and 'trialing'.
--
-- Applied manually via the Supabase SQL Editor (repo record only). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE agent_subscriptions
  ADD COLUMN IF NOT EXISTS trial_end timestamptz;
