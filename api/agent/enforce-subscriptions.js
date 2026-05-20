import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

// Stage 5: every other file in this repo reads NEXT_PUBLIC_SUPABASE_URL
// (legacy Next.js scaffold naming). This file used the bare SUPABASE_URL,
// which is almost certainly unset on Vercel — the client would point at
// `undefined` and every query silently no-op. Fall back across both names so
// it works regardless of which is configured.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// Mirrors /api/agent/run.js — see that file for the rationale behind accepting
// both `x-cron-secret: $AGENT_CRON_SECRET` (external triggers) and
// `Authorization: Bearer $CRON_SECRET` (Vercel native cron).
function authorizeCron(req) {
  const agentSecret  = process.env.AGENT_CRON_SECRET
  const vercelSecret = process.env.CRON_SECRET
  if (!agentSecret && !vercelSecret) {
    console.error('[enforce-subscriptions] Neither AGENT_CRON_SECRET nor CRON_SECRET configured — refusing request')
    return { ok: false, status: 500, error: 'Server misconfigured' }
  }
  const xCron = req.headers['x-cron-secret']
  if (xCron && agentSecret && safeEqual(String(xCron), agentSecret)) {
    return { ok: true }
  }
  const authHeader = req.headers['authorization']
  if (authHeader && vercelSecret) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader)
    if (m && safeEqual(m[1], vercelSecret)) {
      return { ok: true }
    }
  }
  return { ok: false, status: 401, error: 'Unauthorized' }
}

export default async function handler(req, res) {
  // ── Cron auth ─────────────────────────────────────────────────────────────
  // This endpoint was previously unauthenticated — anyone on the public internet
  // could trigger the subscription-expiry sweep. Auth via shared secret now.
  const cronAuth = authorizeCron(req)
  if (!cronAuth.ok) {
    return res.status(cronAuth.status).json({ error: cronAuth.error })
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('agent_subscriptions')
    .update({ subscription_status: 'cancelled' })
    .eq('cancel_at_period_end', true)
    .lt('current_period_end', now)
    .eq('subscription_status', 'active')

  if (error) {
    console.error('enforce-subscriptions error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Stage 5.D: GC the Telegram webhook dedupe table. Telegram never replays an
  // update older than ~24h, so 7 days is a safe retention floor. Piggybacked
  // on this daily cron so it needs no pg_cron / extra scheduler. Best-effort —
  // a failure here must not fail the subscription sweep.
  const dedupeCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { error: gcError } = await supabase
    .from('telegram_webhook_dedupe')
    .delete()
    .lt('received_at', dedupeCutoff)
  if (gcError) console.warn('[enforce-subscriptions] dedupe GC failed:', gcError.message)

  return res.json({ ok: true, ran_at: now })
}
