import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { computeFingerprintsForSubscription } from './_lib/trial-fingerprint.js'
import { dispatchAgentRun } from './_lib/edge-dispatch.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fire the post-onboarding first run (single_run) once the trial exists. Bug A2:
// this MUST happen after start_trial flips subscription_status to 'trialing', not at
// onboarding finalize — handleSingleRun's eligibility filter (active|trialing) drops a
// run fired while the status is still NULL. Idempotent: only dispatches when the sub has
// no run rows yet, so the dashboard's start_trial retry / the alreadyStarted early-return
// can't double-fire. Deliberately does NOT touch last_manual_run_at (an auto-run must not
// consume the daily manual-run allowance). Non-fatal — Monday's cron is the backstop.
async function maybeDispatchFirstRun(subscriptionId) {
  const { count, error } = await supabase
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_id', subscriptionId)
  if (error) {
    console.warn('start_trial: first-run guard count failed, skipping auto-run:', error.message)
    return
  }
  if ((count || 0) > 0) return  // a run already exists — don't re-fire
  await dispatchAgentRun({ intent: 'single_run', subscriptionId })
}

// CONVERSION checkout. As of the no-card-trial change, this path runs ONLY at
// trial-end: the 14-day trial was created WITHOUT a payment method and Stripe's
// trial_settings.end_behavior.missing_payment_method:'cancel' cancelled it, so
// the user clicks "Restart" to subscribe for real. It charges €29 immediately
// (NO trial_period_days) and reuses the existing Stripe customer from the lapsed
// trial so we don't orphan/duplicate customers. First-time users never reach
// here — they start a no-card trial through onboarding (api/onboarding.js
// init_subscription → api/stripe.js start_trial).
async function handleCheckout(req, res) {
  const { type } = req.body

  if (type !== 'subscription') {
    return res.status(400).json({ error: 'Invalid type. Must be subscription' })
  }

  // A14: authenticate. userId/userEmail previously came from the request BODY, so an
  // unauthenticated caller could open a Checkout session bound to another user's Stripe
  // customer — a write into their billing state and, since the Checkout page shows that
  // customer's email, an email-disclosure oracle given a leaked user UUID. Derive both
  // from the verified JWT instead (mirrors start_trial / portal).
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7))
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })
  const userId    = user.id
  const userEmail = user.email

  const APP_URL = process.env.VITE_APP_URL

  // Reuse the trial's Stripe customer when we have one (the expected conversion
  // case). Fall back to customer_email only defensively — a converting user
  // should always have a customer from their trial.
  let stripeCustomerId = null
  try {
    const { data: sub } = await supabase
      .from('agent_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()
    stripeCustomerId = sub?.stripe_customer_id || null
  } catch (e) {
    console.warn('Stripe checkout: customer lookup failed, falling back to email:', e?.message)
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_GROWTH, quantity: 1 }],
      allow_promotion_codes: true,
      // No trial — charge now (payment_method_collection defaults to 'always'
      // for subscription mode, so a card is required). metadata.user_id is
      // stamped onto the SUBSCRIPTION so customer.subscription.created can flip
      // the agent_subscriptions row to 'active' even if checkout.session
      // .completed is lost/delayed — see the webhook.
      subscription_data: { metadata: { user_id: userId } },
      // `customer` and `customer_email` are mutually exclusive in Checkout.
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: userEmail }),
      // The user is already onboarded; return them to the dashboard.
      success_url: `${APP_URL}/agent/dashboard?checkout=success`,
      cancel_url:  `${APP_URL}/agent/dashboard?checkout=cancelled`,
      client_reference_id: userId,
      metadata: { type, user_id: userId },
    })

    return res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Start the 14-day trial WITHOUT collecting a payment method. Called once,
// AFTER onboarding completes (so the trial clock begins at completion, not
// signup). No payment method is attached, so this CANNOT charge anything. At
// trial end with still no card, missing_payment_method:'cancel' cancels the sub
// → the webhook flips subscription_status to 'cancelled' and access is gated →
// the user converts via handleCheckout above.
async function handleStartTrial(req, res) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: sub, error: subErr } = await supabase
    .from('agent_subscriptions')
    .select('id, onboarding_completed_at, stripe_customer_id, email')
    .eq('user_id', user.id)
    .maybeSingle()
  if (subErr) {
    console.error('start_trial: subscription lookup failed:', subErr.message)
    return res.status(500).json({ error: 'Could not start your trial. Try again.' })
  }
  if (!sub) {
    return res.status(400).json({ error: 'No subscription found. Restart onboarding.' })
  }

  // The trial clock starts AFTER onboarding completes.
  if (!sub.onboarding_completed_at) {
    return res.status(400).json({ error: 'Finish onboarding before starting your trial.' })
  }

  // Idempotent: an existing customer id means the trial (or a converted sub)
  // already exists — never create a second trial / second customer.
  if (sub.stripe_customer_id) {
    // Recover a lost first-run dispatch (e.g. the edge was unreachable on the first
    // start_trial): maybeDispatchFirstRun no-ops if a run already exists.
    await maybeDispatchFirstRun(sub.id)
    return res.status(200).json({ ok: true, alreadyStarted: true })
  }

  // Anti-abuse (trial_fingerprints ledger): one free trial per site identity,
  // surviving account deletion — otherwise delete-account + re-signup mints a
  // fresh trial for the same website. Fails OPEN on infra errors (missing
  // table/secret, query failure): this is a cost gate, not a security control
  // (contrast: the verify_telegram_code limiter fails closed by design).
  let fingerprints = []
  try {
    fingerprints = await computeFingerprintsForSubscription(supabase, sub.id)
    if (fingerprints.length === 0) {
      console.error('start_trial: no fingerprints computable for sub', sub.id, '(failing open)')
    } else {
      const { data: hits, error: fpErr } = await supabase
        .from('trial_fingerprints')
        .select('fingerprint_type')
        .in('fingerprint_hash', fingerprints.map(f => f.hash))
      if (fpErr) {
        console.error('start_trial: ledger lookup failed (failing open):', fpErr.message)
      } else if (hits?.length > 0) {
        // Persist the denial so the dashboard's trial-start fallback (which
        // re-fires while subscription_status is null) stops retrying.
        // Conditional on NULL so a racing sibling call that just landed
        // 'trialing' is never stomped. The value is inert everywhere else —
        // every run/telegram/edge eligibility gate allowlists
        // ('active','trialing') — and a later paid checkout's webhook upsert
        // overwrites it.
        await supabase
          .from('agent_subscriptions')
          .update({ subscription_status: 'trial_denied' })
          .eq('id', sub.id)
          .is('subscription_status', null)
        console.warn('start_trial: denied for sub', sub.id, '— identity already trialed:', hits.map(h => h.fingerprint_type).join(','))
        return res.status(403).json({ ok: false, denied: true, code: 'trial_already_used' })
      }
    }
  } catch (e) {
    console.error('start_trial: fingerprint check crashed (failing open):', e?.message)
  }

  try {
    // Idempotency keys make a retry return the SAME customer/sub (no duplicates)
    // for 24h; within that window the customer.subscription.created webhook also
    // backfills stripe_customer_id, so the guard above short-circuits a retry.
    const customer = await stripe.customers.create(
      { email: sub.email || user.email || undefined, metadata: { user_id: user.id } },
      { idempotencyKey: `velyr_trial_cust_${user.id}` },
    )
    const subscription = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: process.env.STRIPE_PRICE_GROWTH }],
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        metadata: { user_id: user.id },
      },
      { idempotencyKey: `velyr_trial_sub_${user.id}` },
    )

    const trialEndIso = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString() : null
    const periodEndTs = subscription.items?.data?.[0]?.current_period_end
      ?? subscription.current_period_end
    const periodEndIso = periodEndTs ? new Date(periodEndTs * 1000).toISOString() : null

    // Write the billing columns onto the existing (bare) row. The
    // customer.subscription.created webhook fires too and upserts the same
    // values (idempotent backstop); both converge on subscription_status
    // 'trialing'.
    const { error: updErr } = await supabase
      .from('agent_subscriptions')
      .update({
        status:               'active',
        subscription_status:  'trialing',
        stripe_customer_id:   customer.id,
        subscription_id:      subscription.id,
        trial_end:            trialEndIso,
        current_period_end:   periodEndIso,
        cancel_at_period_end: false,
      })
      .eq('id', sub.id)
    if (updErr) {
      // The Stripe sub exists; the webhook will reconcile the row. Surface ok so
      // the user proceeds — the dashboard shows 'trialing' once either write lands.
      console.error('start_trial: row update failed (webhook will reconcile):', updErr.message)
    }

    // Burn the fingerprints into the deletion-surviving ledger. ignoreDuplicates
    // = ON CONFLICT DO NOTHING (first trial's timestamp wins). Non-fatal but
    // loud — a lost insert re-opens this identity for one more trial.
    if (fingerprints.length > 0) {
      const { error: fpInsErr } = await supabase.from('trial_fingerprints').upsert(
        fingerprints.map(f => ({ fingerprint_type: f.type, fingerprint_hash: f.hash })),
        { onConflict: 'fingerprint_hash,fingerprint_type', ignoreDuplicates: true },
      )
      if (fpInsErr) console.error('start_trial: fingerprint record failed:', fpInsErr.message)
    }

    // Fire the first run now that the row is 'trialing' (run-eligible) — the analytics
    // Setup-PR lands immediately instead of waiting for Monday's cron. Skip only if the
    // row update above failed (the webhook reconciles it to 'trialing' asynchronously and
    // Monday's cron is the backstop). Bug A2.
    if (!updErr) await maybeDispatchFirstRun(sub.id)

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('start_trial: Stripe error:', err?.message || String(err))
    return res.status(500).json({ error: 'Could not start your trial. Try again.' })
  }
}

async function handlePortal(req, res) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: profile } = await supabase
    .from('agent_subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No Stripe customer found for this user' })
  }

  const APP_URL = process.env.VITE_APP_URL

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${APP_URL}/agent/dashboard`,
    })
    return res.status(200).json({ url: portalSession.url })
  } catch (err) {
    console.error('Stripe portal error:', err)
    return res.status(500).json({ error: err.message })
  }
}

async function handleVerifySession(req, res) {
  const sessionId = req.query?.session_id || req.body?.session_id
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'session_id required' })
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const type = session.metadata?.type || null

    // Defensive: this endpoint now exists ONLY to verify subscription sessions for the Agent onboarding flow.
    // If someone calls it with a non-subscription session type (legacy full_scan sessions in the wild, or future types we don't yet know about), reject explicitly.
    if (type !== 'subscription') {
      return res.status(400).json({ error: 'unsupported session type' })
    }

    // For a 14-day trial, the Checkout session completes with payment_status
    // 'no_payment_required' (card captured, nothing charged yet). Consumers
    // treat both 'paid' and 'no_payment_required' as a valid started subscription.
    return res.status(200).json({
      type,
      paymentStatus: session.payment_status,
    })
  } catch (err) {
    console.error('Stripe verify_session error:', err.message)
    return res.status(400).json({ error: 'invalid session' })
  }
}

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action

  // verify_session is GET-friendly so the onboarding/dashboard redirect can read it
  if (action === 'verify_session') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleVerifySession(req, res)
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === 'checkout')    return handleCheckout(req, res)
  if (action === 'portal')      return handlePortal(req, res)
  if (action === 'start_trial') return handleStartTrial(req, res)

  return res.status(400).json({ error: 'Invalid action. Use ?action=checkout, portal, start_trial, or verify_session' })
}
