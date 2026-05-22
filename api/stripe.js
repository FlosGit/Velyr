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

// Folded from api/subscribe.js (FOLD stage): persists the lead email on a free
// report and sends the "your audit" email via Mailjet. Logic is unchanged from
// the original endpoint except: the method guard moved to the dispatcher, and
// the DB client is now the shared `supabase` above (F-1 fix — the original used
// legacy SUPABASE_URL/SUPABASE_SERVICE_KEY names that are unset on Vercel).
async function handleEmailReport(req, res) {
  const { reportId, email } = req.body

  if (!reportId || !email) {
    return res.status(400).json({ error: 'reportId and email are required' })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  if (!uuidRegex.test(reportId)) {
    return res.status(400).json({ error: 'Invalid report ID' })
  }

  // Save email to Supabase + fetch report data for email content
  const { data: report, error: dbError } = await supabase
    .from('reports')
    .update({ email: email.toLowerCase().trim() })
    .eq('id', reportId)
    .select('website_url, scan_data')
    .single()

  if (dbError) {
    console.error('Supabase update error:', dbError.message)
    return res.status(500).json({ error: dbError.message })
  }

  const BASE_URL   = process.env.VITE_APP_URL
  const reportUrl  = `${BASE_URL}/report/${reportId}`
  const websiteUrl = report?.website_url || 'your website'
  const score      = report?.scan_data?.score ?? '—'
  const scoreColor = score >= 70 ? '#2a5c45' : score >= 40 ? '#d68910' : '#c0392b'
  const scoreLabel = score >= 70 ? 'Strong' : score >= 40 ? 'Needs Work' : 'Critical Issues'

  // Send email via Mailjet
  try {
    const mailjetRes = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`
        ).toString('base64'),
      },
      body: JSON.stringify({
        Messages: [
          {
            From: {
              Email: 'info@velyr.io',
              Name:  'Velyr',
            },
            ReplyTo: {
              Email: 'info@velyr.io',
              Name:  'Velyr',
            },
            To: [{ Email: email }],
            Subject: `Your Velyr audit — ${websiteUrl} scored ${score}/100`,
            HTMLPart: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:300;color:#1c1917;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">

    <div style="margin-bottom:40px;">
      <span style="font-size:22px;font-weight:500;letter-spacing:-.01em;color:#1c1917;">Velyr</span>
    </div>

    <div style="background:#ffffff;border:1px solid rgba(28,25,23,0.08);border-radius:16px;padding:36px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#a09890;font-weight:400;margin:0 0 10px;">Your audit report</p>
      <p style="font-size:18px;font-weight:400;color:#1c1917;margin:0 0 16px;">${websiteUrl}</p>
      <p style="font-size:48px;font-weight:300;color:${scoreColor};margin:0 0 4px;line-height:1;">
        ${score}<span style="font-size:20px;color:#a09890;">/100</span>
      </p>
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${scoreColor};margin:0 0 28px;font-weight:400;">${scoreLabel}</p>
      <a href="${reportUrl}"
        style="display:inline-block;background:#1c1917;color:#f7f4ef;text-decoration:none;border-radius:10px;padding:14px 28px;font-size:14px;font-weight:500;letter-spacing:.02em;">
        View your full report →
      </a>
    </div>

    <p style="font-size:13px;color:#6b6460;line-height:1.75;margin:0 0 32px;">
      Bookmark this link — your report is always available here:<br>
      <a href="${reportUrl}" style="color:#2a5c45;word-break:break-all;">${reportUrl}</a>
    </p>

    <div style="border-top:1px solid rgba(28,25,23,0.08);padding-top:24px;">
      <p style="font-size:12px;color:#a09890;margin:0;line-height:1.6;">
        © 2026 Velyr &nbsp;·&nbsp; You received this because you requested your audit on
        <a href="${BASE_URL}" style="color:#a09890;">Velyr</a>
      </p>
    </div>

  </div>
</body>
</html>`,
            TextPart: `Your Velyr audit for ${websiteUrl}\n\nScore: ${score}/100 — ${scoreLabel}\n\nView your full report:\n${reportUrl}\n\n---\nVelyr · velyr.io`,
          },
        ],
      }),
    })

    const mailData = await mailjetRes.json()
    if (!mailjetRes.ok) {
      console.error('Mailjet error:', JSON.stringify(mailData))
    } else {
      console.log('Report email sent to:', email)
    }
  } catch (e) {
    console.error('Email send error:', e.message)
    // Return ok anyway — email is saved in DB, sending failure is non-blocking
  }

  return res.status(200).json({ ok: true })
}

export default async function handler(req, res) {
  const action = req.query?.action || req.body?.action

  // verify_session is GET-friendly so the success-page redirect can read it
  if (action === 'verify_session') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleVerifySession(req, res)
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === 'checkout')     return handleCheckout(req, res)
  if (action === 'portal')       return handlePortal(req, res)
  if (action === 'email_report') return handleEmailReport(req, res)

  return res.status(400).json({ error: 'Invalid action. Use ?action=checkout, portal, verify_session, or email_report' })
}
