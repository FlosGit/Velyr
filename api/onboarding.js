// ════════════════════════════════════════════════════════════════════════════
// OA4 Part 1 — /api/onboarding  (action-routed to fit the 12-function budget)
//
//   GET  /api/onboarding?action=snapshot   → read-back of the OA3 handoff cookie
//   POST /api/onboarding?action=complete   → verified write via complete_onboarding
//
// This file is the trust gate that closes OA3-A: complete_onboarding (OA1)
// trusts whatever installation_id the browser sends. We refuse to call it
// unless the requested installation + repo were actually present in the
// HMAC-signed snapshot that ONLY oauth-callback (OA3) could have minted, and
// unless that snapshot belongs to the authenticated caller.
//
// Five defense layers (all must pass before any DB write — see (d) in the
// stage writeup):
//   1. cookie HMAC + expiry  (verifySessionCookie)
//   2. cookie.authUserId === JWT user.id
//   3. installationId ∈ cookie.installations
//   4. repoFullName ∈ that installation's verified repo list
//   5. complete_onboarding's own auth.uid()==owner check, run via the user JWT
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { encryptSecret } from './_lib/secret-crypto.js'
import { verifySessionCookie } from './github/_oauth-state.js'

export const config = { maxDuration: 60 }

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY          = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const STATE_SECRET      = process.env.GITHUB_OAUTH_STATE_SECRET
const SESSION_COOKIE    = 'velyr_oauth_session'
const DEFAULT_PH_HOST   = 'https://us.i.posthog.com'

// Anon client used only to validate the bearer token → user.
const authClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Service-role client. Used by ?action=finalize, which is the ONLY legitimate
// write path into agent_connections once OA5 retires the interim browser-write
// RLS policies (20260522_retire_interim_oauth_rls.sql).
const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// secret encryption: encryptSecret is imported from ./_lib/secret-crypto.js
// (shared with api/agent/run.js's decryptSecret). See that file for the
// enc:v1: wire-format contract and the Deno-copy sync note.

// Extract + validate the JWT, returning the user or null.
async function getUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  if (!m) return null
  const { data: { user } = {}, error } = await authClient.auth.getUser(m[1])
  if (error || !user) return null
  return { user, token: m[1] }
}

// Read + verify the handoff cookie against the authenticated user. Returns
// { ok: true, payload } or { ok: false, status, error }.
function readVerifiedCookie(req, user) {
  const raw = req.cookies?.[SESSION_COOKIE]
  if (!raw) return { ok: false, status: 400, error: 'OAuth session expired. Reconnect GitHub.' }

  const v = verifySessionCookie(raw, STATE_SECRET)
  if (!v.valid) return { ok: false, status: 400, error: 'OAuth session invalid. Reconnect GitHub.' }

  // Layer 2: the cookie must belong to the caller, not just be any valid cookie.
  if (v.payload.authUserId !== user.id) {
    return { ok: false, status: 403, error: 'Session mismatch.' }
  }
  return { ok: true, payload: v.payload }
}

// ─── action=snapshot (GET) ───────────────────────────────────────────────────
// The OA3 cookie is HttpOnly, so the browser can't read it. This hands the
// picker the installation/repo list — but never the signature or expiry.
async function handleSnapshot(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const c = readVerifiedCookie(req, auth.user)
  if (!c.ok) return res.status(c.status).json({ error: c.error })

  // OA3 stored account as a login string; surface it as { login } for the UI.
  const installations = (c.payload.installations || []).map(i => ({
    installationId: i.installationId,
    // Stage 3: surface the account type so the picker can badge org installs.
    account: { login: i.account, type: i.accountType || 'User' },
    repos: i.repos,
  }))
  return res.status(200).json({ githubLogin: c.payload.githubLogin, installations })
}

// ─── action=complete (POST) ──────────────────────────────────────────────────
async function handleComplete(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const c = readVerifiedCookie(req, auth.user)
  if (!c.ok) return res.status(c.status).json({ error: c.error })

  const { subscriptionId, installationId, repoFullName } = req.body || {}
  if (!subscriptionId || !installationId || !repoFullName) {
    return res.status(400).json({ error: 'Missing subscriptionId, installationId, or repoFullName.' })
  }

  // Layer 3: the chosen installation must be one we verified during OAuth.
  const inst = (c.payload.installations || []).find(
    i => Number(i.installationId) === Number(installationId)
  )
  if (!inst) return res.status(403).json({ error: 'Installation not in your verified set.' })

  // Layer 4: the chosen repo must be one this installation actually exposed.
  const repoOk = (inst.repos || []).some(r => r.fullName === repoFullName)
  if (!repoOk) return res.status(403).json({ error: 'Repo not in your verified installation.' })

  // Parse owner/name. full_name is always exactly "owner/name".
  const parts = String(repoFullName).split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return res.status(400).json({ error: 'Invalid repository name.' })
  }
  const [repoOwner, repoName] = parts

  // Layer 5: call the RPC with the USER's JWT so auth.uid() resolves and the
  // RPC's own ownership check (and RLS) apply. Service role would bypass both.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: rpcError } = await userClient.rpc('complete_onboarding', {
    p_subscription_id: subscriptionId,
    p_installation_id: Number(installationId),
    p_github_user_id:  c.payload.githubUserId,
    p_github_login:    c.payload.githubLogin,
    p_repo_owner:      repoOwner,
    p_repo_name:       repoName,
    // Stage 3: installation account identity (personal vs org), from the verified
    // snapshot. Stored on agent_subscriptions; does not affect the ownership check.
    p_installation_account_type:  inst.accountType ?? null,
    p_installation_account_login: inst.account ?? null,
    p_installation_account_id:    inst.accountId ?? null,
  })

  if (rpcError) {
    console.error('onboarding/complete: complete_onboarding RPC failed:', rpcError.message)
    // The RPC's raise messages are user-meaningful ("subscription does not
    // belong to authenticated user") and safe to surface.
    return res.status(400).json({ error: rpcError.message || 'Could not complete onboarding.' })
  }

  // Single-use: drop the handoff cookie now that it's been redeemed.
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
  return res.status(200).json({ ok: true })
}

// ─── action=finalize (POST) ──────────────────────────────────────────────────
// Writes the remaining (non-GitHub) connection fields server-side. This is the
// migration of OA4's handleStep4 browser write: once the interim RLS policies
// are retired, the browser cannot write agent_connections at all, so this
// service-role path is the only legitimate one. Ownership is enforced here in
// code (the service role bypasses RLS).
async function handleFinalize(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('onboarding/finalize: SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(500).json({ error: 'Onboarding is not configured. Contact support.' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const {
    subscriptionId, websiteUrl, posthogApiKey, posthogProjectId,
    posthogHost, telegramChatId, verificationCodeId,
  } = req.body || {}
  if (!subscriptionId) return res.status(400).json({ error: 'Missing subscriptionId.' })

  // Ownership + GitHub-step gate. github_installation_verified_at is non-null
  // only after complete_onboarding ran, so this also proves the GitHub step is
  // done before we flip onboarding_completed_at to its final meaning.
  const { data: sub, error: subErr } = await serviceClient
    .from('agent_subscriptions')
    .select('auth_user_id, github_installation_verified_at')
    .eq('id', subscriptionId)
    .maybeSingle()
  if (subErr) {
    console.error('onboarding/finalize: subscription lookup failed:', subErr.message)
    return res.status(500).json({ error: 'Could not complete onboarding. Try again.' })
  }
  if (!sub || sub.auth_user_id !== auth.user.id) {
    return res.status(403).json({ error: 'subscription does not belong to authenticated user' })
  }
  if (!sub.github_installation_verified_at) {
    return res.status(400).json({ error: 'Connect GitHub before finishing onboarding.' })
  }

  // The connection row must already exist (complete_onboarding created it).
  const { data: conn, error: connErr } = await serviceClient
    .from('agent_connections')
    .select('subscription_id')
    .eq('subscription_id', subscriptionId)
    .maybeSingle()
  if (connErr) {
    console.error('onboarding/finalize: connection lookup failed:', connErr.message)
    return res.status(500).json({ error: 'Could not complete onboarding. Try again.' })
  }
  if (!conn) {
    return res.status(400).json({ error: 'GitHub connection not found. Reconnect GitHub.' })
  }

  // ── OA6: validate + atomically consume the Telegram verification code ───────
  // This MUST succeed before the agent_connections write, eliminating the old
  // "bound but not consumed" window (the browser previously marked used=true
  // AFTER finalize). If the connection write later fails, the code is left
  // used — the safe direction: a stale-used code is re-issuable via /start,
  // whereas a live-but-bound code would be undetectable by the bot.
  if (!verificationCodeId) {
    return res.status(400).json({ error: 'Missing verification code.' })
  }
  const { data: codeRow, error: codeErr } = await serviceClient
    .from('telegram_verification_codes')
    .select('id, chat_id, used, expires_at')
    .eq('id', verificationCodeId)
    .maybeSingle()
  if (codeErr) {
    console.error('onboarding/finalize: code lookup failed:', codeErr.message)
    return res.status(500).json({ error: 'Could not complete onboarding. Try again.' })
  }
  if (!codeRow) return res.status(400).json({ error: 'Verification code not found.' })
  if (codeRow.used) return res.status(400).json({ error: 'This code has already been used.' })
  if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This code has expired.' })
  }
  if (String(codeRow.chat_id) !== String(telegramChatId)) {
    return res.status(400).json({ error: 'Code/chat mismatch.' })
  }

  // Atomic consume: the `.eq('used', false)` guard means only one concurrent
  // request can flip it. 0 rows back ⇒ another request consumed it between the
  // check above and here — bail BEFORE touching agent_connections.
  const { data: consumed, error: consumeErr } = await serviceClient
    .from('telegram_verification_codes')
    .update({ used: true })
    .eq('id', verificationCodeId)
    .eq('used', false)
    .select('id')
  if (consumeErr) {
    console.error('onboarding/finalize: code consume failed:', consumeErr.message)
    return res.status(500).json({ error: 'Could not complete onboarding. Try again.' })
  }
  if (!consumed || consumed.length === 0) {
    return res.status(409).json({ error: 'Code was just consumed by another request. Try again.' })
  }

  let encryptedPosthogKey
  try {
    encryptedPosthogKey = encryptSecret(posthogApiKey) // null when empty/absent
  } catch (e) {
    console.error('onboarding/finalize: posthog key encryption failed:', e.message)
    return res.status(500).json({ error: 'Could not securely store analytics key.' })
  }

  const { error: updErr } = await serviceClient
    .from('agent_connections')
    .update({
      website_url:           websiteUrl ?? null,
      posthog_api_key:       encryptedPosthogKey,
      posthog_project_id:    posthogProjectId ?? null,
      posthog_host:          posthogHost || DEFAULT_PH_HOST,
      posthog_snippet_token: null,
      telegram_chat_id:      telegramChatId ?? null,
      verification_code_id:  verificationCodeId ?? null,
      verified_at:           new Date().toISOString(),
    })
    .eq('subscription_id', subscriptionId)
  if (updErr) {
    console.error('onboarding/finalize: connection update failed:', updErr.message)
    return res.status(500).json({ error: 'Could not complete onboarding. Try again.' })
  }

  // Stamp the *final* onboarding-complete time (overwrites the earlier value
  // complete_onboarding set at the GitHub step, so it now means "fully done").
  const { error: subUpdErr } = await serviceClient
    .from('agent_subscriptions')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', subscriptionId)
  if (subUpdErr) {
    console.error('onboarding/finalize: subscription stamp failed:', subUpdErr.message)
    // Non-fatal: the connection is already written; surface success.
  }

  return res.status(200).json({ ok: true })
}

// ─── action=verify_telegram_code (POST) ──────────────────────────────────────
// Lightweight, read-only Step-4 affordance: tells the UI whether a pasted code
// is currently valid (exists, unused, unexpired) so it can show "connected to
// @username" before the user finishes the remaining steps. It does NOT mark the
// code used and does NOT bind it to a subscription — that happens atomically in
// finalize. It deliberately does not check code ownership (the user has no claim
// to a specific code yet; the ownership-bound consume is finalize's job). The
// bare code is never echoed back, only its id + chat_id + username.
const TELEGRAM_CODE_RE = /^VELYR-[A-Z0-9]{6}$/
async function handleVerifyTelegramCode(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('onboarding/verify_telegram_code: SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(500).json({ error: 'Onboarding is not configured. Contact support.' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : ''
  if (!TELEGRAM_CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Invalid code format. It should look like VELYR-XXXXXX.' })
  }

  // Stage 3C: per-user fixed-window throttle (10/min) before the code-validity
  // lookup. verify_telegram_code is a 200-vs-400 oracle; this caps brute-force
  // probing of the ~1B VELYR-XXXXXX space. Keyed on auth_user_id only
  // (decision 3). FAILS CLOSED on RPC error: this is a security control, not a
  // cost gate — fail-open would silently disable the exact protection this stage
  // adds. The only realistic error is a not-yet-applied migration (a deploy →
  // `supabase db push` window of seconds-to-minutes); a brief 503 there beats a
  // silently-off limiter. (Contrast getMonthlySpend, which fails open because
  // it's cost tracking with availability priority.)
  const { data: rl, error: rlErr } = await serviceClient.rpc('rate_limit_hit', {
    p_bucket_key:     `verify_telegram_code:${auth.user.id}`,
    p_limit:          10,
    p_window_seconds: 60,
  })
  if (rlErr) {
    console.error('onboarding/verify_telegram_code: rate_limit_hit failed (blocking):', rlErr.message)
    return res.status(503).json({ error: 'rate_limit_check_failed' })
  }
  const decision = Array.isArray(rl) ? rl[0] : rl
  if (decision && decision.allowed === false) {
    res.setHeader('Retry-After', String(decision.retry_after_seconds ?? 60))
    return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' })
  }

  const { data: row, error } = await serviceClient
    .from('telegram_verification_codes')
    .select('id, chat_id, expires_at, used, telegram_username')
    .eq('code', code)
    .maybeSingle()
  if (error) {
    console.error('onboarding/verify_telegram_code: lookup failed:', error.message)
    return res.status(500).json({ error: 'Could not verify code. Try again.' })
  }
  if (!row) {
    return res.status(400).json({ error: 'Invalid code. Make sure you sent /start to the Velyr bot first.' })
  }
  if (row.used) {
    return res.status(400).json({ error: 'This code has already been used.' })
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This code has expired. Request a new one from the bot.' })
  }

  return res.status(200).json({ codeId: row.id, chatId: row.chat_id, telegramUsername: row.telegram_username })
}

// ─── dispatcher ──────────────────────────────────────────────────────────────
// No top-level method guard — snapshot is GET, the rest are POST; each guards
// its own method internally.
export default async function handler(req, res) {
  if (!SUPABASE_URL || !ANON_KEY || !STATE_SECRET) {
    console.error('onboarding: missing required env var(s)')
    return res.status(500).json({ error: 'Onboarding is not configured. Contact support.' })
  }

  const action = req.query.action
  if (action === 'snapshot')             return handleSnapshot(req, res)
  if (action === 'complete')             return handleComplete(req, res)
  if (action === 'finalize')             return handleFinalize(req, res)
  if (action === 'verify_telegram_code') return handleVerifyTelegramCode(req, res)
  return res.status(400).json({ error: 'Unknown action' })
}
