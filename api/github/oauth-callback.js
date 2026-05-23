// ════════════════════════════════════════════════════════════════════════════
// OA3 — GET /api/github/oauth-callback?code=…&state=…
//
// GitHub redirects the browser here after the user authorizes the Velyr App.
// The browser is NOT carrying a Supabase JWT (the session lives in localStorage,
// which a server can't read), so identity is re-established two ways:
//   • subscriptionId comes from the HMAC-verified state token (tamper-proof)
//   • the trusted auth_user_id comes from github_oauth_states.auth_user_id —
//     the row written at /initiate, keyed by the single-use nonce. We trust
//     ONLY this column for "who is the user", never an unverified token field.
//
// The GitHub access_token is used to identify the user + list installations,
// then discarded. It is never logged or persisted. The long-lived credential we
// keep is the installation_id (usable later via App auth, like validate-repo.js).
//
// Output is a browser-facing HTML/redirect, not JSON. On success we set a
// signed, HttpOnly, short-lived handoff cookie and 302 to /agent/onboarding,
// where OA4 reads it back (verifying the signature + JWT match) to render the
// repo picker and finally call complete_onboarding() from the browser.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { verifyStateToken, signSessionCookie } from './_oauth-state.js'

export const config = { maxDuration: 60 }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_SLUG        = 'velyr-growth-agent'
const ONBOARDING_PATH = '/agent/onboarding'
const SESSION_COOKIE  = 'velyr_oauth_session'
const GH_HEADERS_BASE = { 'User-Agent': 'velyr-oauth', Accept: 'application/json' }

// ─── small HTML responders (browser-facing; no JSON) ─────────────────────────
function htmlShell(title, bodyInner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#0b0b0f;color:#e7e7ea;display:flex;min-height:100vh;align-items:center;
justify-content:center;margin:0}.card{max-width:440px;padding:32px;text-align:center}
h1{font-size:20px;margin:0 0 12px}p{color:#a1a1aa;line-height:1.5;margin:0 0 20px}
a.btn{display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
padding:10px 18px;border-radius:8px;font-weight:500}</style></head>
<body><div class="card">${bodyInner}</div></body></html>`
}

function renderError(res, status, userMessage) {
  const body = `<h1>Couldn't connect GitHub</h1><p>${userMessage}</p>
<a class="btn" href="${ONBOARDING_PATH}">Back to onboarding</a>`
  return res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(htmlShell('GitHub connection failed', body))
}

function renderNeedsInstall(res) {
  const installUrl = `https://github.com/apps/${APP_SLUG}/installations/new`
  const body = `<h1>Install the Velyr app first</h1>
<p>No installations match your GitHub account. Install the Velyr Growth Agent on
the repository you want the agent to work on, then return to onboarding.</p>
<a class="btn" href="${installUrl}">Install on GitHub</a>
<p style="margin-top:16px"><a href="${ONBOARDING_PATH}" style="color:#a1a1aa">Back to onboarding</a></p>`
  return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(htmlShell('Install required', body))
}

export default async function handler(req, res) {
  // ── Step 1: method guard ────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── fail closed on missing config (don't name the missing secret to user) ───
  const clientId     = process.env.GITHUB_OAUTH_CLIENT_ID
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET
  const stateSecret  = process.env.GITHUB_OAUTH_STATE_SECRET
  if (!clientId || !clientSecret || !stateSecret
      || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('oauth-callback: missing required env var(s)')
    return renderError(res, 500, 'OAuth is not configured. Contact support.')
  }

  const { code, state } = req.query

  // ── Step 2: verify the state token (HMAC + expiry) BEFORE any DB work ────────
  if (!state) return renderError(res, 400, 'Missing state parameter.')
  const verified = verifyStateToken(Array.isArray(state) ? state[0] : state, stateSecret)
  if (!verified.valid) {
    console.error('oauth-callback: state verification failed:', verified.reason)
    return renderError(res, 400, 'This sign-in link is invalid or has expired. Please start again.')
  }
  const { nonce, subscriptionId } = verified

  if (!code) return renderError(res, 400, 'Missing authorization code.')

  // ── Step 3: consume the nonce (single-use) — row MUST exist, MUST be fresh ──
  // Service-role read; browsers have no access to this table.
  const { data: stateRow, error: stateErr } = await supabase
    .from('github_oauth_states')
    .select('auth_user_id, consumed_at')
    .eq('state_token', nonce)
    .maybeSingle()

  if (stateErr) {
    console.error('oauth-callback: state row lookup failed:', stateErr.message)
    return renderError(res, 500, 'Something went wrong. Please try again.')
  }
  if (!stateRow) {
    // Forged token for a nonce we never issued, or the row was GC'd. Either way: reject.
    return renderError(res, 400, 'Invalid OAuth state. Please start again.')
  }
  if (stateRow.consumed_at) {
    // Genuine replay — this nonce was already redeemed.
    return renderError(res, 400, 'This sign-in link was already used. Please start again.')
  }

  // Atomically claim it: only stamp consumed_at if still null (defends against a
  // double-submit race — two concurrent callbacks for the same nonce).
  const { data: claimed, error: claimErr } = await supabase
    .from('github_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_token', nonce)
    .is('consumed_at', null)
    .select('auth_user_id')
    .maybeSingle()

  if (claimErr) {
    console.error('oauth-callback: state consume failed:', claimErr.message)
    return renderError(res, 500, 'Something went wrong. Please try again.')
  }
  if (!claimed) {
    // Lost the race — another request consumed it first.
    return renderError(res, 400, 'This sign-in link was already used. Please start again.')
  }

  // SOLE trusted user identity. Never the (also-verified) subscriptionId owner
  // by itself — this row proves who clicked "Connect GitHub".
  const authUserId = claimed.auth_user_id

  // ── Step 4: exchange code → access_token ─────────────────────────────────────
  let accessToken
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { ...GH_HEADERS_BASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: Array.isArray(code) ? code[0] : code,
        redirect_uri: 'https://velyr.io/api/github/oauth-callback',
      }),
    })
    const tokenJson = await tokenRes.json()
    if (!tokenRes.ok || tokenJson.error || !tokenJson.access_token) {
      // Log GitHub's reason server-side only; never echo it to the user.
      console.error('oauth-callback: token exchange failed:', tokenJson.error || tokenRes.status)
      return renderError(res, 400, 'GitHub authorization failed. Please try connecting again.')
    }
    accessToken = tokenJson.access_token
  } catch (err) {
    console.error('oauth-callback: token exchange network error:', err.message)
    return renderError(res, 502, 'Could not reach GitHub. Please try again.')
  }

  // Authenticated GitHub API headers (token used in-memory only, never stored).
  const ghAuth = { ...GH_HEADERS_BASE, Authorization: `token ${accessToken}` }

  // ── Step 5: identify the GitHub user ─────────────────────────────────────────
  let githubUserId, githubLogin
  try {
    const userRes = await fetch('https://api.github.com/user', { headers: ghAuth })
    const userJson = await userRes.json()
    if (!userRes.ok || !userJson.id || !userJson.login) {
      console.error('oauth-callback: /user failed:', userRes.status)
      return renderError(res, 400, 'Could not identify your GitHub user.')
    }
    githubUserId = userJson.id
    githubLogin  = userJson.login
  } catch (err) {
    console.error('oauth-callback: /user network error:', err.message)
    return renderError(res, 502, 'Could not reach GitHub. Please try again.')
  }

  // ── Step 6: list the user's installations of the Velyr App ───────────────────
  let installations
  try {
    const instRes = await fetch('https://api.github.com/user/installations', { headers: ghAuth })
    const instJson = await instRes.json()
    if (!instRes.ok || !Array.isArray(instJson.installations)) {
      console.error('oauth-callback: /user/installations failed:', instRes.status)
      return renderError(res, 502, 'Could not read your GitHub installations. Please try again.')
    }
    // GitHub scopes /user/installations to installations THIS authenticated user
    // can access, so the list itself is the permission boundary (Stage 3
    // decision 1: member-level org support, no extra org-admin gate). We keep the
    // numeric-id identity check for the user's OWN personal install — a login can
    // be reused after an account is deleted, the numeric id cannot — and also
    // admit organization installs the user is authorized for (account.type ===
    // 'Organization'). Unexpected account types are excluded.
    installations = instJson.installations.filter(
      i => i?.account?.id === githubUserId || i?.account?.type === 'Organization'
    )
  } catch (err) {
    console.error('oauth-callback: /user/installations network error:', err.message)
    return renderError(res, 502, 'Could not reach GitHub. Please try again.')
  }

  if (installations.length === 0) return renderNeedsInstall(res)

  // ── Step 7: list accessible repos per installation ──────────────────────────
  const snapshot = []
  try {
    for (const inst of installations) {
      const repoRes = await fetch(
        `https://api.github.com/user/installations/${inst.id}/repositories`,
        { headers: ghAuth }
      )
      const repoJson = await repoRes.json()
      if (!repoRes.ok || !Array.isArray(repoJson.repositories)) {
        console.error('oauth-callback: repositories list failed for installation', inst.id, repoRes.status)
        continue // skip this installation rather than failing the whole flow
      }
      const repos = repoJson.repositories.map(r => ({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner?.login,
      }))
      if (repos.length === 0) continue // skip installations with no repos
      snapshot.push({
        installationId: inst.id,
        account:        inst.account?.login,
        accountType:    inst.account?.type,   // 'User' | 'Organization' (Stage 3)
        accountId:      inst.account?.id,
        repos,
      })
    }
  } catch (err) {
    console.error('oauth-callback: repositories network error:', err.message)
    return renderError(res, 502, 'Could not read your repositories. Please try again.')
  }

  if (snapshot.length === 0) return renderNeedsInstall(res)

  // ── Step 8: hand the verified snapshot to the browser via a signed cookie ────
  // accessToken is now out of scope and discarded — never persisted/logged.
  const cookieValue = signSessionCookie(
    { authUserId, githubUserId, githubLogin, installations: snapshot },
    stateSecret
  )

  // HttpOnly so page JS can't read or tamper; OA4's read-back endpoint verifies
  // the signature server-side and matches authUserId to the caller's JWT.
  // SameSite=Lax: the cookie must survive the top-level redirect chain and be
  // sent on the same-site read-back call. Secure: HTTPS only. 10-min Max-Age.
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`)

  // ── Step 9: redirect to onboarding (OA4 renders the repo picker) ─────────────
  res.statusCode = 302
  res.setHeader('Location', `${ONBOARDING_PATH}?oauth=success`)
  return res.end()
}
