import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function handleCheckout(req, res) {
  const { type, userId, userEmail } = req.body

  if (type !== 'full_scan' && type !== 'subscription') {
    return res.status(400).json({ error: 'Invalid type. Must be full_scan or subscription' })
  }

  // Subscriptions require an account (the Growth Agent system is keyed by Supabase user_id).
  // Full-scan checkouts allow guests — Stripe collects the email and access is granted via
  // session_id verification at /premium.
  if (type === 'subscription' && !userId) {
    return res.status(400).json({ error: 'userId required for subscription' })
  }

  const APP_URL = process.env.VITE_APP_URL

  try {
    let session
    if (type === 'full_scan') {
      const base = {
        mode: 'payment',
        line_items: [{ price: process.env.STRIPE_PRICE_FULL_SCAN, quantity: 1 }],
        success_url: `${APP_URL}/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${APP_URL}/agent/dashboard?checkout=cancelled`,
        metadata: userId ? { type, user_id: userId } : { type },
      }
      if (userId)    base.client_reference_id = userId
      if (userEmail) base.customer_email      = userEmail
      session = await stripe.checkout.sessions.create(base)
    } else {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: process.env.STRIPE_PRICE_GROWTH, quantity: 1 }],
        allow_promotion_codes: true,
        // Paid subscribers go straight to onboarding so they can connect GitHub
        // and Telegram. The onboarding mount gate will accept them once the
        // webhook has flipped subscription_status to 'active'.
        success_url: `${APP_URL}/agent/onboarding?checkout=success&session_id={CHECKOUT_SESSION_ID}&type=subscription`,
        cancel_url:  `${APP_URL}/agent/dashboard?checkout=cancelled`,
        client_reference_id: userId,
        customer_email: userEmail,
        metadata: { type, user_id: userId },
      })
    }

    return res.status(200).json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return res.status(500).json({ error: err.message })
  }
}

async function handleVerifySession(req, res) {
  const sessionId = req.query?.session_id || req.body?.session_id
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ valid: false, error: 'session_id required' })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const valid = session.payment_status === 'paid'
      && session.metadata?.type === 'full_scan'
    return res.status(200).json({
      valid,
      type: session.metadata?.type || null,
      paymentStatus: session.payment_status,
    })
  } catch (err) {
    console.error('Stripe verify_session error:', err.message)
    return res.status(400).json({ valid: false, error: 'invalid session' })
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

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action

  // verify_session is GET-friendly so the success-page redirect can read it
  if (action === 'verify_session') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleVerifySession(req, res)
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === 'checkout') return handleCheckout(req, res)
  if (action === 'portal')   return handlePortal(req, res)

  return res.status(400).json({ error: 'Invalid action. Use ?action=checkout, portal, or verify_session' })
}
