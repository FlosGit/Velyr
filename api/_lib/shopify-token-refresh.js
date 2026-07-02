// ════════════════════════════════════════════════════════════════════════════
// Shopify token refresh — NODE twin of refreshShopifyToken in
// supabase/functions/agent-run/index.ts.
//
// WHY a Node copy: the edge function refreshes eagerly at the top of the weekly
// run, but the merchant APPLIES/ROLLS BACK a staged change by replying YES in
// Telegram — handled here on Vercel, typically far more than the ~60-min access-
// token life after the run. Without a refresh here every delayed approval hit a
// 401 and failed with no recovery. This mirrors the edge declaration's endpoint,
// params, column names, and single-use refresh-token rotation — keep them in sync.
//
// `_`-prefixed dir ⇒ not a Vercel route (no function-cap cost).
// ════════════════════════════════════════════════════════════════════════════
import { encryptSecret, decryptSecret } from './secret-crypto.js'

const SHOPIFY_API_KEY       = process.env.SHOPIFY_API_KEY || ''
const SHOPIFY_API_SECRET    = process.env.SHOPIFY_API_SECRET || ''
// Refresh if the access token is absent or within this skew window of expiry.
const SHOPIFY_TOKEN_SKEW_MS = Number(process.env.SHOPIFY_TOKEN_SKEW_MS || String(5 * 60 * 1000))

// decryptSecret THROWS on a corrupt/tampered enc:v1: blob; never let that abort
// the refresh — a corrupt access token just means we fall through and re-mint one.
function safeDecrypt(stored) {
  try { return decryptSecret(stored) } catch { return null }
}

// Returns { ok: true, accessToken, refreshed } or
// { ok: false, reason: 'needs_reconsent' | 'not_configured' | 'refresh_failed', message }.
// Rotates the single-use refresh token and re-encrypts both at rest, then mutates
// `conn` in place so the caller sees the fresh token.
export async function refreshShopifyToken(supabase, conn) {
  const shop = conn.shopify_shop_domain
  const now  = Date.now()

  // Fast path: access token still comfortably valid → return it untouched (no
  // refresh, no rotation). Falls through to refresh if the stored value can't be
  // read (corrupt/tampered blob or key rotation) so we self-heal rather than fail.
  const expMs = conn.shopify_token_expires_at ? Date.parse(conn.shopify_token_expires_at) : NaN
  if (Number.isFinite(expMs) && expMs - now > SHOPIFY_TOKEN_SKEW_MS) {
    const current = safeDecrypt(conn.shopify_access_token)
    if (current) return { ok: true, accessToken: current, refreshed: false }
  }

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    return { ok: false, reason: 'not_configured', message: 'SHOPIFY_API_KEY / SHOPIFY_API_SECRET not configured' }
  }

  // Refresh token past its 90-day life → honest re-consent; never attempt a doomed
  // exchange.
  const refreshExpMs = conn.shopify_refresh_token_expires_at ? Date.parse(conn.shopify_refresh_token_expires_at) : NaN
  if (Number.isFinite(refreshExpMs) && refreshExpMs <= now) {
    return { ok: false, reason: 'needs_reconsent', message: 'Shopify refresh token expired — the merchant must reconnect the store.' }
  }

  const refreshToken = safeDecrypt(conn.shopify_refresh_token)
  if (!refreshToken) {
    return { ok: false, reason: 'needs_reconsent', message: 'No Shopify refresh token on file — the merchant must reconnect the store.' }
  }

  let res, json
  try {
    res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        client_id:     SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })
    json = await res.json().catch(() => ({}))
  } catch (e) {
    return { ok: false, reason: 'refresh_failed', message: `Shopify token refresh threw: ${e?.message || String(e)}` }
  }
  if (!res.ok || !json?.access_token) {
    // Auth failure on the refresh grant (400 OR 401) ⇒ the refresh token is dead
    // (expired / revoked / already-used) ⇒ reconnect. Everything else (5xx, 429,
    // other 4xx, 2xx-without-token) stays transient → the caller can retry later.
    const authFailure = res.status === 400 || res.status === 401
    return {
      ok: false,
      reason: authFailure ? 'needs_reconsent' : 'refresh_failed',
      message: `Shopify token refresh failed (HTTP ${res.status})`,
    }
  }

  const newAccess         = json.access_token
  const newRefresh        = json.refresh_token ?? null
  const newExpiresAt      = Number.isFinite(json.expires_in) ? new Date(now + json.expires_in * 1000).toISOString() : null
  const newRefreshExpires = Number.isFinite(json.refresh_token_expires_in) ? new Date(now + json.refresh_token_expires_in * 1000).toISOString() : null

  const encAccess  = encryptSecret(newAccess)
  const encRefresh = encryptSecret(newRefresh)

  // Unconditional writeback with ONE retry — a rotated single-use refresh token
  // lost to a transient DB error would force a needless re-consent next run.
  const persist = () => supabase.from('agent_connections').update({
    shopify_access_token:             encAccess,
    shopify_refresh_token:            encRefresh,
    shopify_token_expires_at:         newExpiresAt,
    shopify_refresh_token_expires_at: newRefreshExpires,
  }).eq('id', conn.id).then(r => r, e => ({ error: e }))

  let wb = await persist()
  if (wb?.error) wb = await persist()
  if (wb?.error) console.error('[shopify-token-refresh] token writeback failed (next run may re-consent):', wb.error?.message || String(wb.error))

  // Reflect the rotation in-memory so the caller's conn uses the fresh token.
  conn.shopify_access_token             = encAccess
  conn.shopify_refresh_token            = encRefresh
  conn.shopify_token_expires_at         = newExpiresAt
  conn.shopify_refresh_token_expires_at = newRefreshExpires

  return { ok: true, accessToken: newAccess, refreshed: true }
}
