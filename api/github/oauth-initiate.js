// ════════════════════════════════════════════════════════════════════════════
// OA2 — POST /api/github/oauth-initiate
//
// Starts the GitHub OAuth flow. Called when the user clicks "Connect GitHub" in
// onboarding. Authenticates the caller (Supabase JWT), confirms they own the
// subscription, mints a stateless signed `state` token, registers its nonce for
// single-use replay protection, and returns the GitHub authorize URL.
//
// The browser receives only { redirectUrl } and does window.location = it (OA4).
// The ownership PROOF that this GitHub user controls the chosen installation is
// established later, server-side, in oauth-callback (OA3). This endpoint only
// proves "you own this Velyr subscription".
//
// TODO(rate-limit): this is an unauthenticated-shaped entry point (cheap to
// hammer) that writes a row per call. If/when the other api/* routes adopt a
// shared rate-limiting middleware, put this behind it too — keyed by user.id.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { signStateToken } from './_oauth-state.js'

export const config = { maxDuration: 60 }

// Service-role client. Bypasses RLS — required for the github_oauth_states
// insert (browsers have no policy on that table, by design) and used to
// validate the user JWT via auth.getUser().
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OAUTH_REDIRECT_URI = 'https://velyr.io/api/github/oauth-callback'

export default async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Env-var presence (fail closed; never leak which secret to the client) ──
  const clientId    = process.env.GITHUB_OAUTH_CLIENT_ID
  const stateSecret = process.env.GITHUB_OAUTH_STATE_SECRET
  if (!clientId || !stateSecret) {
    console.error('oauth-initiate: missing GITHUB_OAUTH_CLIENT_ID or GITHUB_OAUTH_STATE_SECRET env var')
    return res.status(500).json({ error: 'OAuth is not configured. Contact support.' })
  }

  // ── Step 1: authenticate the caller via Supabase JWT ────────────────────────
  const authHeader = req.headers.authorization
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '')
  if (!m) return res.status(401).json({ error: 'Unauthorized' })
  const token = m[1]

  const { data: { user } = {}, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // ── Step 1b: validate input ─────────────────────────────────────────────────
  const subscriptionId = req.body?.subscriptionId
  if (!subscriptionId || !UUID_RE.test(subscriptionId)) {
    return res.status(400).json({ error: 'Missing or invalid subscriptionId.' })
  }

  // ── Step 2: confirm the caller owns the subscription (early double-defense) ──
  // complete_onboarding() re-checks this server-side; we fail fast here so a
  // mismatched user never reaches GitHub at all.
  const { data: sub, error: subError } = await supabase
    .from('agent_subscriptions')
    .select('auth_user_id')
    .eq('id', subscriptionId)
    .maybeSingle()

  if (subError) {
    console.error('oauth-initiate: subscription lookup failed:', subError.message)
    return res.status(500).json({ error: 'Could not start OAuth. Try again.' })
  }
  if (!sub) {
    return res.status(403).json({ error: 'subscription does not belong to authenticated user' })
  }
  if (sub.auth_user_id !== user.id) {
    // Same message as "not found" on purpose — don't reveal that the id exists.
    return res.status(403).json({ error: 'subscription does not belong to authenticated user' })
  }

  // ── Step 3: mint the stateless signed state token ────────────────────────────
  const nonce = crypto.randomBytes(32).toString('hex')
  const signedToken = signStateToken(nonce, subscriptionId, stateSecret)

  // ── Step 4: register the nonce for single-use replay protection ─────────────
  // Service-role insert (browsers can't write this table). The nonce — NOT the
  // full token — is the primary key; OA3 marks consumed_at on redemption.
  const { error: insertError } = await supabase
    .from('github_oauth_states')
    .insert({ state_token: nonce, auth_user_id: user.id })

  if (insertError) {
    console.error('oauth-initiate: failed to register oauth state nonce:', insertError.message)
    return res.status(500).json({ error: 'Could not start OAuth. Try again.' })
  }

  // ── Step 5: build the GitHub authorize URL ──────────────────────────────────
  // No `scope`: GitHub Apps use installation-level permissions, not OAuth
  // scopes. User identity (read:user) is implicit because "Request user
  // authorization (OAuth) during installation" is enabled on the App.
  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    state:        signedToken,
  })
  const redirectUrl = `https://github.com/login/oauth/authorize?${params}`

  // ── Step 6: return to frontend (OA4 does window.location = redirectUrl) ─────
  return res.status(200).json({ redirectUrl })
}
