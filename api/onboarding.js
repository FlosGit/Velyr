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
import crypto from 'node:crypto'
import { encryptSecret } from './_lib/secret-crypto.js'
import { verifySessionCookie } from './github/_oauth-state.js'

export const config = { maxDuration: 60 }

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY          = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const STATE_SECRET      = process.env.GITHUB_OAUTH_STATE_SECRET
const SESSION_COOKIE    = 'velyr_oauth_session'
const DEFAULT_PH_HOST   = 'https://us.i.posthog.com'
// Hosting platforms the onboarding platform-selection step may record. Kept in
// sync with the CHECK constraint in 20260614_hosting_provider.sql. The agent runs
// purely through GitHub PRs, so this is informational only — no run-path logic
// branches on it. 'vercel' is the historical default for legacy connections.
const HOSTING_PROVIDERS = ['vercel', 'netlify', 'render', 'railway', 'cloudflare_pages']

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

// ─── action=init_subscription (POST) ─────────────────────────────────────────
// Creates the bare agent_subscriptions row at onboarding start so the GitHub
// step (complete_onboarding) and finalize have a row to attach to. The 14-day
// Stripe trial is deliberately NOT created here — it is started AFTER onboarding
// completes (api/stripe.js?action=start_trial), so the trial clock begins at
// completion, not signup.
//
// The bare row is run-INELIGIBLE by design: status='active' satisfies the
// onboarding mount gate, while subscription_status=NULL keeps the agent from
// running (cron/manual gates require subscription_status ∈ active|trialing)
// until start_trial fills it in. `status` is NOT NULL in the table so it must be
// set; there is no CHECK on status/subscription_status (verified against live).
// Idempotent: returns the caller's existing row if one already exists.
async function handleInitSubscription(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('onboarding/init_subscription: SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(500).json({ error: 'Onboarding is not configured. Contact support.' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  // Idempotent: reuse the caller's existing subscription row if present (any
  // status — a returning/lapsed user keeps their row; conversion is handled by
  // Stripe checkout, never here). user_id == auth_user_id (both hold the auth
  // UUID), so selecting on either is equivalent.
  const { data: existing, error: selErr } = await serviceClient
    .from('agent_subscriptions')
    .select('id')
    .eq('auth_user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selErr) {
    console.error('onboarding/init_subscription: lookup failed:', selErr.message)
    return res.status(500).json({ error: 'Could not start onboarding. Try again.' })
  }
  if (existing?.id) return res.status(200).json({ subscriptionId: existing.id })

  // Insert the bare row. The column split: the Stripe webhook keys on user_id,
  // the agent system keys on auth_user_id — both carry the same Supabase auth
  // UUID. plan must be one of starter|growth|scale (CHECK).
  const { data: inserted, error: insErr } = await serviceClient
    .from('agent_subscriptions')
    .insert({
      user_id:             auth.user.id,
      auth_user_id:        auth.user.id,
      email:               auth.user.email ?? null,
      plan:                'growth',
      status:              'active',
      subscription_status: null,
    })
    .select('id')
    .single()

  if (insErr) {
    // 23505 = a concurrent init (or the Stripe webhook) created the row first;
    // re-read and return it so the call stays idempotent.
    if (insErr.code === '23505') {
      const { data: raced } = await serviceClient
        .from('agent_subscriptions')
        .select('id')
        .eq('auth_user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (raced?.id) return res.status(200).json({ subscriptionId: raced.id })
    }
    console.error('onboarding/init_subscription: insert failed:', insErr.message)
    return res.status(500).json({ error: 'Could not start onboarding. Try again.' })
  }

  return res.status(200).json({ subscriptionId: inserted.id })
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
    posthogHost, telegramChatId, verificationCodeId, hostingProvider,
  } = req.body || {}
  if (!subscriptionId) return res.status(400).json({ error: 'Missing subscriptionId.' })

  // Defensive validation: an absent/invalid value falls back to 'vercel' (the DB
  // default + historical assumption) so a stale client or crafted body can never
  // hit the CHECK constraint with a 500 — it lands as a clean, known value.
  const provider = HOSTING_PROVIDERS.includes(hostingProvider) ? hostingProvider : 'vercel'

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
    .select('id, chat_id, used, expires_at, auth_user_id')
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
  // B3: the code must belong to the caller. auth_user_id is stamped by the
  // bot's /start (from the deep-link token). A NULL value is a legacy/deploy-
  // window code minted before /start started stamping it — allowed through once;
  // these all drain within the 30-min code TTL (removing the null-allow is a
  // parked 24h follow-up). A non-null mismatch is the B3 attack (someone trying
  // to finalize a code that was started under a different account) → reject.
  if (codeRow.auth_user_id !== null && codeRow.auth_user_id !== auth.user.id) {
    return res.status(403).json({ error: 'This code belongs to a different account.' })
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
      hosting_provider:      provider,
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

  // Auto-fire the first run now (intent: 'single_run') so the analytics Setup-PR
  // lands immediately instead of consuming next Monday's scheduled run. Same 2s-
  // abort fire-and-forget pattern as discover_structure; the Edge function writes
  // the run row + Setup-PR. Deliberately does NOT touch last_manual_run_at — an
  // auto-run must not consume the user's daily manual-run allowance. Non-fatal:
  // any failure here still leaves onboarding successful (Monday cron is the
  // backstop).
  {
    const edgeUrl    = `${SUPABASE_URL}/functions/v1/agent-run`
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), 2000)
    try {
      await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ intent: 'single_run', subscriptionId }),
        signal: controller.signal,
      })
    } catch (err) {
      // AbortError = our 2s timeout → the request landed and the Edge run started.
      if (err?.name !== 'AbortError') {
        console.error('onboarding/finalize: first-run dispatch failed:', err?.message || err)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return res.status(200).json({ ok: true })
}

// ─── action=telegram_start_token (POST) ──────────────────────────────────────
// B3: mint a single-use start token tied to the AUTHENTICATED caller. The
// onboarding UI embeds it in the bot deep link (t.me/VelyrBot?start=<token>);
// the bot's /start consumes it and stamps auth_user_id onto the verification
// code. This is the only point where we have a trustworthy user identity an
// attacker can't substitute — it's what makes a leaked code non-transferable
// across accounts.
async function handleTelegramStartToken(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('onboarding/telegram_start_token: SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(500).json({ error: 'Onboarding is not configured. Contact support.' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  // 24 random bytes → 32-char base64url. Well under Telegram's 64-char start
  // payload limit, and base64url is deep-link safe (no +, /, or =).
  const token = crypto.randomBytes(24).toString('base64url')

  const { error } = await serviceClient
    .from('telegram_start_tokens')
    .insert({
      token,
      auth_user_id: auth.user.id,
      used: false,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min TTL
    })
  if (error) {
    console.error('onboarding/telegram_start_token: insert failed:', error.message)
    return res.status(500).json({ error: 'Could not start Telegram setup. Try again.' })
  }

  return res.status(200).json({ token })
}

// ─── action=discover_structure (POST) ────────────────────────────────────────
// Stage 3: fire the edge function's `discover_structure` intent (RA1 only) after
// the GitHub step so the first-connect preview is mapping while the user finishes
// Telegram. Seeds the row as 'mapping' so the finale poll sees it immediately,
// then fires the edge function (non-blocking, same cron-fire pattern). Errors are
// non-fatal: the row stays 'mapping' and the finale times out → routes to Overview.
async function handleDiscoverStructure(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('onboarding/discover_structure: SUPABASE_SERVICE_ROLE_KEY not configured')
    return res.status(500).json({ error: 'Onboarding is not configured. Contact support.' })
  }

  const auth = await getUser(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const { subscriptionId } = req.body || {}
  if (!subscriptionId) return res.status(400).json({ error: 'Missing subscriptionId.' })

  // Ownership: the subscription must belong to the caller before we touch its row
  // or fire a server-side job for it.
  const { data: sub, error: subErr } = await serviceClient
    .from('agent_subscriptions')
    .select('auth_user_id')
    .eq('id', subscriptionId)
    .maybeSingle()
  if (subErr) {
    console.error('onboarding/discover_structure: subscription lookup failed:', subErr.message)
    return res.status(500).json({ error: 'Could not start structure mapping.' })
  }
  if (!sub || sub.auth_user_id !== auth.user.id) {
    return res.status(403).json({ error: 'subscription does not belong to authenticated user' })
  }

  // Seed 'mapping' so the finale poll has a row to read right away.
  await serviceClient
    .from('site_structure_preview')
    .upsert(
      { subscription_id: subscriptionId, status: 'mapping', updated_at: new Date().toISOString() },
      { onConflict: 'subscription_id' },
    )

  // Fire the edge function (non-blocking — same 2s-abort cron-fire pattern as
  // api/agent/run.js). The edge fn writes the terminal status; we don't await it.
  const edgeUrl   = `${SUPABASE_URL}/functions/v1/agent-run`
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 2000)
  try {
    await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ intent: 'discover_structure', subscriptionId }),
      signal: controller.signal,
    })
  } catch (err) {
    // AbortError = our 2s timeout → the request landed and the edge fn is running.
    // Anything else: the row stays 'mapping' and the finale times out gracefully.
    if (err?.name !== 'AbortError') {
      console.error('onboarding/discover_structure: edge dispatch failed:', err?.message || err)
    }
  } finally {
    clearTimeout(timeoutId)
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
    .select('id, chat_id, expires_at, used, telegram_username, auth_user_id')
    .eq('code', code)
    .maybeSingle()
  if (error) {
    console.error('onboarding/verify_telegram_code: lookup failed:', error.message)
    return res.status(500).json({ error: 'Could not verify code. Try again.' })
  }
  if (!row) {
    return res.status(400).json({ error: 'Invalid code. Make sure you sent /start to the Velyr bot first.' })
  }
  // B3: this endpoint is a chat_id/username oracle — it must not reveal another
  // user's code (or even that it exists). If the code is bound to a different
  // account, return the SAME response as not-found (400 "Invalid code") rather
  // than a distinguishable 403, so a caller can't probe which codes are live
  // for other users. NULL auth_user_id = legacy/deploy-window code, allowed
  // through (drains within the 30-min TTL).
  if (row.auth_user_id !== null && row.auth_user_id !== auth.user.id) {
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
  if (action === 'init_subscription')    return handleInitSubscription(req, res)
  if (action === 'complete')             return handleComplete(req, res)
  if (action === 'finalize')             return handleFinalize(req, res)
  if (action === 'telegram_start_token') return handleTelegramStartToken(req, res)
  if (action === 'discover_structure')   return handleDiscoverStructure(req, res)
  if (action === 'verify_telegram_code') return handleVerifyTelegramCode(req, res)
  return res.status(400).json({ error: 'Unknown action' })
}
