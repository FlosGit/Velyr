// ════════════════════════════════════════════════════════════════════════════
// Stateless OAuth `state` token — shared between oauth-initiate (sign) and
// oauth-callback (verify). The `_` prefix keeps Vercel from turning this into a
// serverless function (same convention as api/_posthog.js); it's import-only.
//
// The token IS the trust: it carries an HMAC-SHA256 signature over its own
// payload, keyed by GITHUB_OAUTH_STATE_SECRET. Nothing server-side needs to be
// consulted to know the token is authentic and unexpired. The companion
// github_oauth_states table is a separate, single-use replay guard — it answers
// "has this exact nonce already been redeemed?", NOT "is this token genuine?".
// ════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto'

const TOKEN_TTL_MS = 10 * 60 * 1000 // 10 minutes

// base64url helpers (Node's Buffer supports 'base64url' since v14).
const b64urlEncode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
const b64urlDecode = (str) => JSON.parse(Buffer.from(str, 'base64url').toString('utf8'))

// HMAC-SHA256 over the canonical message form. Must be byte-identical on both
// the sign and verify side — that's the whole reason this lives in one file.
function computeSig(nonce, subscriptionId, exp, secret) {
  const message = `${nonce}.${subscriptionId}.${exp}`
  return crypto.createHmac('sha256', secret).update(message).digest('hex')
}

/**
 * Sign a state token. Returns the base64url string to hand to GitHub as `state`.
 * @param {string} nonce          random hex nonce (also stored in github_oauth_states)
 * @param {string} subscriptionId the subscription this OAuth flow is binding to
 * @param {string} secret         GITHUB_OAUTH_STATE_SECRET
 */
export function signStateToken(nonce, subscriptionId, secret) {
  const exp = Date.now() + TOKEN_TTL_MS
  const sig = computeSig(nonce, subscriptionId, exp, secret)
  return b64urlEncode({ nonce, subscriptionId, exp, sig })
}

/**
 * Verify a state token. Returns { valid: true, nonce, subscriptionId } on
 * success, or { valid: false, reason } on any failure. Never throws — a
 * malformed token from an attacker is just an invalid token, not a 500.
 *
 * Constant-time signature comparison (timingSafeEqual) prevents a timing
 * oracle on the HMAC. Used by OA3 (oauth-callback).
 */
export function verifyStateToken(token, secret) {
  let payload
  try {
    payload = b64urlDecode(token)
  } catch {
    return { valid: false, reason: 'malformed_token' }
  }

  const { nonce, subscriptionId, exp, sig } = payload || {}
  if (!nonce || !subscriptionId || !exp || !sig) {
    return { valid: false, reason: 'missing_fields' }
  }

  const expected = computeSig(nonce, subscriptionId, exp, secret)
  // Length-guard before timingSafeEqual (it throws on length mismatch).
  const sigBuf = Buffer.from(String(sig), 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad_signature' }
  }

  if (Date.now() > Number(exp)) {
    return { valid: false, reason: 'expired' }
  }

  return { valid: true, nonce, subscriptionId }
}

// ════════════════════════════════════════════════════════════════════════════
// OAuth handoff cookie — set by oauth-callback (OA3), read back by OA4.
//
// After the callback verifies GitHub identity + lists installations, it has a
// trustworthy snapshot but NO user JWT (Supabase session lives in localStorage,
// which the server can't read). It hands the snapshot to the browser in this
// signed cookie. The signature is what makes it trustworthy: OA4's read-back
// endpoint re-verifies it server-side and confirms the cookie's authUserId
// matches the caller's JWT before letting the picked installation be written.
//
// Carries NO secret — the GitHub access_token is used and discarded in OA3 and
// never enters this payload. Only the (long-lived, App-auth-usable) installation
// ids + repo names + the user's GitHub identity travel here.
// ════════════════════════════════════════════════════════════════════════════

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 minutes — user must pick a repo soon

/**
 * Sign the OAuth handoff payload into a cookie-safe string `body.sig`.
 * @param {object} payload  { authUserId, githubUserId, githubLogin, installations }
 * @param {string} secret   GITHUB_OAUTH_STATE_SECRET
 */
export function signSessionCookie(payload, secret) {
  const withExp = { ...payload, exp: Date.now() + SESSION_TTL_MS }
  const body = Buffer.from(JSON.stringify(withExp), 'utf8').toString('base64url')
  const sig  = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `${body}.${sig}`
}

/**
 * Verify + decode the handoff cookie. Returns { valid: true, payload } or
 * { valid: false, reason }. Never throws. Used by OA4's read-back endpoint.
 */
export function verifySessionCookie(value, secret) {
  if (typeof value !== 'string' || !value.includes('.')) {
    return { valid: false, reason: 'malformed_cookie' }
  }
  const idx = value.lastIndexOf('.')
  const body = value.slice(0, idx)
  const sig  = value.slice(idx + 1)

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  const sigBuf = Buffer.from(sig, 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad_signature' }
  }

  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed_payload' }
  }
  if (!payload?.exp || Date.now() > Number(payload.exp)) {
    return { valid: false, reason: 'expired' }
  }
  return { valid: true, payload }
}
