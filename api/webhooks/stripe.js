import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const config = { api: { bodyParser: false } }

const STATE_MAP = {
  active:             'active',
  // 'trialing' is a first-class status as of the 14-day-trial stage (no longer
  // collapsed into 'active'). The cron run-eligibility queries accept both
  // 'active' and 'trialing', so trial customers get full feature access while
  // the dashboard can still surface a distinct trial banner.
  trialing:           'trialing',
  past_due:           'past_due',
  unpaid:             'past_due',
  canceled:           'cancelled',
  incomplete:         'incomplete',
  incomplete_expired: 'cancelled',
  paused:             'paused',
}

function trialEndIso(sub) {
  return sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null
}

// Minimal Telegram send for webhook-driven alerts (e.g. trial_will_end). The
// full bot lives in api/webhooks/telegram.js; here we only need a one-shot
// HTML message, so we hit the Bot API directly. Best-effort — never throws.
async function sendTelegram(chatId, text) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch (err) {
    console.warn('[webhook] sendTelegram failed:', err?.message || String(err))
  }
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// As of Stripe API version 2025-04-30.basil, `current_period_end` was removed
// from the Subscription object and lives on each SubscriptionItem instead.
// We're pinned to 2026-04-22.dahlia, so always read from items.data[0]; the
// top-level field is kept as a fallback only for legacy event replays.
function periodEndIso(sub) {
  const ts = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end
  return ts ? new Date(ts * 1000).toISOString() : null
}

export default async function handler(req, res) {
  console.log('[webhook] entry — method:', req.method, '| has-sig:', !!req.headers['stripe-signature'], '| webhook-secret-present:', !!process.env.STRIPE_WEBHOOK_SECRET)

  if (req.method !== 'POST') {
    console.log('[webhook] rejecting — wrong method:', req.method)
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sig = req.headers['stripe-signature']
  if (!sig) {
    console.log('[webhook] rejecting — missing stripe-signature header')
    return res.status(400).json({ error: 'Missing stripe-signature header' })
  }

  let event
  try {
    const rawBody = await getRawBody(req)
    console.log('[webhook] raw body bytes:', rawBody.length, '| sig prefix:', String(sig).slice(0, 40))
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
    console.log('[webhook] signature verified — event:', event.id, '| type:', event.type, '| livemode:', event.livemode, '| api_version:', event.api_version)
  } catch (err) {
    console.error('[webhook] signature verification failed — name:', err?.name, '| message:', err?.message)
    if (err?.stack) console.error(err.stack)
    return res.status(400).json({ error: `Webhook error: ${err.message}` })
  }

  // Idempotency: reject duplicate event deliveries
  const { error: dupErr } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })

  if (dupErr?.code === '23505') {
    console.log('[webhook] DUPLICATE — event', event.id, 'was already processed; short-circuiting with 200. Delete the row from stripe_events to replay.')
    return res.status(200).json({ duplicate: true })
  }
  if (dupErr) {
    console.error('[webhook] stripe_events insert failed (non-duplicate):', { code: dupErr.code, message: dupErr.message, details: dupErr.details, hint: dupErr.hint })
  } else {
    console.log('[webhook] stripe_events insert ok — proceeding to switch for', event.type)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        console.log('[webhook/checkout] event id:', event.id)
        console.log('[webhook/checkout] session:', JSON.stringify(session))
        console.log('[webhook/checkout] metadata:', session.metadata)
        console.log('[webhook/checkout] client_reference_id:', session.client_reference_id, '| mode:', session.mode, '| customer:', session.customer, '| subscription:', session.subscription, '| customer_email:', session.customer_email)

        const userId = session.client_reference_id
        const type = session.metadata?.type

        if (session.mode === 'subscription') {
          const subscriptionId = session.subscription
          const customerId = session.customer

          if (userId && subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId)
            console.log('[webhook/checkout] retrieved subscription id:', subscription.id, '| status:', subscription.status, '| items:', subscription.items?.data?.length)
            const payload = {
              user_id: userId,
              auth_user_id: userId,
              email: session.customer_email || session.customer_details?.email,
              plan: 'growth',
              // `status` is the agent lifecycle column (the onboarding gate reads
              // it); a started subscription — trial or paid — is 'active' here.
              status: 'active',
              stripe_customer_id: customerId,
              subscription_id: subscription.id,
              // `subscription_status` carries the true Stripe state, so a trial
              // checkout lands as 'trialing' (→ trial banner) while still being
              // run-eligible.
              subscription_status: STATE_MAP[subscription.status] ?? subscription.status,
              current_period_end: periodEndIso(subscription),
              trial_end: trialEndIso(subscription),
              cancel_at_period_end: subscription.cancel_at_period_end === true,
            }
            console.log('[webhook/checkout] subscription upsert payload:', payload)
            const result = await supabase
              .from('agent_subscriptions')
              .upsert(payload, { onConflict: 'user_id' })
            console.log('[webhook/checkout] subscription upsert result:', { data: result.data, error: result.error, status: result.status })
          } else {
            console.log('[webhook/checkout] subscription SKIPPED — userId:', userId, '| subscriptionId:', subscriptionId)
          }
        } else {
          console.log('[webhook/checkout] no branch matched — mode:', session.mode, '| metadata.type:', type)
        }
        break
      }

      case 'customer.subscription.created': {
        const s = event.data.object
        // No user_id lookup here — this event has no metadata. The row was
        // already created (or will be created) by checkout.session.completed,
        // keyed on stripe_customer_id. If the row doesn't exist yet (event
        // ordering can vary), this UPDATE is a no-op and the
        // checkout.session.completed handler will fill in the rest.
        await supabase.from('agent_subscriptions').update({
          subscription_status:  STATE_MAP[s.status] ?? s.status,
          subscription_id:      s.id,
          current_period_end:   periodEndIso(s),
          trial_end:            trialEndIso(s),
          cancel_at_period_end: s.cancel_at_period_end === true,
        }).eq('stripe_customer_id', s.customer)
        break
      }

      case 'customer.subscription.updated': {
        const s = event.data.object
        // Handles trial→active transition: when Stripe ends the trial and the
        // first invoice is paid, s.status flips to 'active' and STATE_MAP carries
        // it through, clearing the trial banner.
        await supabase.from('agent_subscriptions').update({
          subscription_status:  STATE_MAP[s.status] ?? s.status,
          subscription_id:      s.id,
          current_period_end:   periodEndIso(s),
          trial_end:            trialEndIso(s),
          cancel_at_period_end: s.cancel_at_period_end === true,
          canceled_at:          s.canceled_at
            ? new Date(s.canceled_at * 1000).toISOString()
            : null,
        }).eq('stripe_customer_id', s.customer)
        break
      }

      case 'customer.subscription.trial_will_end': {
        // Fires ~3 days before trial_end. Nudge the customer on Telegram.
        const s = event.data.object
        const { data: sub } = await supabase
          .from('agent_subscriptions')
          .select('telegram_chat_id')
          .eq('stripe_customer_id', s.customer)
          .single()
        if (sub?.telegram_chat_id) {
          await sendTelegram(
            sub.telegram_chat_id,
            '⏳ <b>Your Velyr trial ends in 3 days.</b>\n\n' +
            "You'll be automatically charged €29 and your Growth Agent keeps running — no action needed.\n\n" +
            'Want to stop? Cancel anytime before the trial ends from your dashboard and you won\'t be charged.'
          )
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        await supabase
          .from('agent_subscriptions')
          .update({
            subscription_status: 'cancelled',
            canceled_at: subscription.canceled_at
              ? new Date(subscription.canceled_at * 1000).toISOString()
              : new Date().toISOString(),
          })
          .eq('stripe_customer_id', subscription.customer)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        await supabase
          .from('agent_subscriptions')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer)
        break
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object
        if (['subscription_cycle', 'subscription_create'].includes(inv.billing_reason)) {
          await supabase
            .from('agent_subscriptions')
            .update({ subscription_status: 'active' })
            .eq('stripe_customer_id', inv.customer)
            .neq('subscription_status', 'cancelled')
        }
        break
      }

      default:
        break
    }
  } catch (err) {
    console.error(`event ${event.id} ${event.type} failed:`, err?.message || String(err))
    if (err?.stack) console.error(err.stack)
    await supabase.from('stripe_events').delete().eq('id', event.id)
    return res.status(500).json({ error: 'processing failed' })
  }

  return res.status(200).json({ received: true, id: event.id })
}
