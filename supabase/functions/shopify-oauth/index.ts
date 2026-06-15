// ════════════════════════════════════════════════════════════════════════════
// shopify-oauth — Shopify App OAuth (install + callback) in one Edge Function.
//
// Mirrors the GitHub OAuth security model (api/github/oauth-initiate.js +
// oauth-callback.js + _oauth-state.js) exactly, re-implemented for the Deno /
// Web-Crypto runtime because Supabase Edge Functions cannot import across
// function dirs (or from the Vercel Node bundle). Scope: read_themes only.
//
// Redirect URI (registered with Shopify, fixed): this function's public URL.
//
// Routing is by QUERY-PARAM PRESENCE (an OAuth redirect is a browser GET, not a
// JSON-body intent like agent-run):
//   • no `code`            → ROUTE A (install): authenticated start, returns { url }.
//   • `code` (+ `hmac`)    → ROUTE B (callback): Shopify's redirect back to us.
//
// Trust model (same as GitHub):
//   • The `state` token IS the trust — HMAC-SHA256 over its own payload, keyed by
//     SHOPIFY_OAUTH_STATE_SECRET. github_oauth_states is a separate single-use
//     replay guard (was this exact nonce already redeemed?), never the source of
//     trust. Service-role only; the browser never touches it.
//   • Ownership is keyed on the Velyr subscription (agent_subscriptions.auth_user_id),
//     never the Shopify account.
//   • The Shopify access_token is encrypted at rest (enc:v1: AES-256-GCM) before it
//     ever lands in agent_connections.
//
// DB prerequisites (separate migration — NOT created here):
//   • github_oauth_states.provider text  (so a shopify nonce can't be consumed by
//     the github flow and vice-versa; this code writes/filters provider='shopify').
//   • agent_connections.shopify_*        columns (see the Phase-1 proposal).
//   • partial-unique index agent_connections_shopify_shop_domain_key on
//     shopify_shop_domain — the 23505 caught in ROUTE B step 8.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2'

// ─── Config ──────────────────────────────────────────────────────────────────
const REDIRECT_URI = 'https://mtqctjgecbscjmottauv.supabase.co/functions/v1/shopify-oauth'
const APP_BASE     = 'https://velyr.io'
const SHOPIFY_API_VERSION = '2026-04'
const SHOPIFY_SCOPE = 'read_themes'

// Shop-domain allowlist. SSRF guard: the token exchange + theme read make
// outbound calls to https://{shop}/…, so an unvalidated shop would let an
// attacker point those at an arbitrary host. Applied at BOTH install and
// callback, before any outbound request.
const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes (matches the GitHub flow)
const ENC_PREFIX   = 'enc:v1:'

// Secrets (Deno.env, shared across the Supabase project's functions).
const SHOPIFY_API_KEY    = Deno.env.get('SHOPIFY_API_KEY') || ''
const SHOPIFY_API_SECRET = Deno.env.get('SHOPIFY_API_SECRET') || ''
const STATE_SECRET       = Deno.env.get('SHOPIFY_OAUTH_STATE_SECRET') || ''
// AGENT_TOKEN_ENCRYPTION_KEY is read inside getEncryptionKey() (the crypto twin).

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ─── HTTP helpers ────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS }

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS })
}

// Callback failures are browser redirects (the user is mid-redirect-chain), not
// API responses — surface a clean reason the onboarding page can render, never a 500.
function redirectError(reason: string): Response {
  return Response.redirect(`${APP_BASE}/agent/onboarding?shopify=error&reason=${encodeURIComponent(reason)}`, 302)
}

// ─── Byte / encoding helpers (no Node Buffer in Deno) ────────────────────────
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin) // standard base64 (+/ , padded) — matches Node's toString('base64')
}
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
function bytesToHex(bytes: Uint8Array): string {
  let h = ''
  for (let i = 0; i < bytes.length; i++) h += bytes[i].toString(16).padStart(2, '0')
  return h
}
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const m = hex.match(/.{2}/g) || []
  return new Uint8Array(m.map((b) => parseInt(b, 16)))
}
function b64urlEncodeJson(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecodeJson(str: string): any {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return JSON.parse(new TextDecoder().decode(base64ToBytes(b64)))
}

// ─── Secret crypto: Web-Crypto AES-256-GCM ───────────────────────────────────
// FORMAT-LOCKED TWIN — keep in sync with api/_lib/secret-crypto.js.
// Wire format: `enc:v1:` + base64( iv(12) ‖ tag(16) ‖ ciphertext ), AES-256-GCM,
// 32-byte key from AGENT_TOKEN_ENCRYPTION_KEY (64 hex chars). Node lays the tag
// BEFORE the ciphertext; Web Crypto emits/expects it AFTER, so we reorder on both
// sides. This is the inverse of the decryptSecret reorder already in
// supabase/functions/agent-run/index.ts. Update all three together if the wire
// format ever changes.
async function getEncryptionKey(): Promise<CryptoKey> {
  const hex = Deno.env.get('AGENT_TOKEN_ENCRYPTION_KEY')
  if (!hex) throw new Error('AGENT_TOKEN_ENCRYPTION_KEY is not configured')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('AGENT_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// Canonical empty-string rule (from secret-crypto.js): empty/absent → null.
async function encryptSecret(plaintext: string | null | undefined): Promise<string | null> {
  if (plaintext == null || plaintext === '') return null
  const key = await getEncryptionKey()
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  // Web Crypto AES-GCM returns ciphertext ‖ tag (tag = last 16 bytes).
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plaintext))),
  )
  const ct  = sealed.subarray(0, sealed.length - 16)
  const tag = sealed.subarray(sealed.length - 16)
  // Reorder to Node's iv ‖ tag ‖ ct.
  const out = new Uint8Array(iv.length + tag.length + ct.length)
  out.set(iv, 0)
  out.set(tag, iv.length)
  out.set(ct, iv.length + tag.length)
  return ENC_PREFIX + bytesToBase64(out)
}

// Read-side twin (identical to agent-run's decryptSecret). Legacy non-prefixed
// values are returned as-is so existing rows keep working.
async function decryptSecret(stored: string | null | undefined): Promise<string | null> {
  if (stored == null) return null
  if (typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored
  const raw = base64ToBytes(stored.slice(ENC_PREFIX.length))
  const iv  = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct  = raw.subarray(28)
  const ctPlusTag = new Uint8Array(ct.length + tag.length)
  ctPlusTag.set(ct, 0)
  ctPlusTag.set(tag, ct.length)
  const key = await getEncryptionKey()
  const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctPlusTag)
  return new TextDecoder().decode(pt)
}

// ─── State token: Web-Crypto HMAC-SHA256 ─────────────────────────────────────
// FORMAT-LOCKED TWIN — keep in sync with api/github/_oauth-state.js.
// The token is base64url(JSON{ nonce, subscriptionId, shop, exp, sig }) where
// sig = hex HMAC-SHA256 over the canonical message `nonce.subscriptionId.shop.exp`
// keyed by SHOPIFY_OAUTH_STATE_SECRET. verify() is constant-time
// (crypto.subtle.verify) and NEVER throws — a malformed/attacker token is just
// invalid, not a 500.
async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  )
}
function stateMessage(nonce: string, subscriptionId: string, shop: string, exp: number | string): string {
  return `${nonce}.${subscriptionId}.${shop}.${exp}`
}

async function signState(
  args: { nonce: string; subscriptionId: string; shop: string },
  secret: string,
): Promise<string> {
  const exp = Date.now() + STATE_TTL_MS
  const key = await hmacKey(secret)
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stateMessage(args.nonce, args.subscriptionId, args.shop, exp)))
  const sig = bytesToHex(new Uint8Array(sigBuf))
  return b64urlEncodeJson({ nonce: args.nonce, subscriptionId: args.subscriptionId, shop: args.shop, exp, sig })
}

type StateResult =
  | { valid: true; nonce: string; subscriptionId: string; shop: string }
  | { valid: false; reason: string }

async function verifyState(token: string, secret: string): Promise<StateResult> {
  let payload: any
  try {
    payload = b64urlDecodeJson(token)
  } catch {
    return { valid: false, reason: 'malformed_token' }
  }
  const { nonce, subscriptionId, shop, exp, sig } = payload || {}
  if (!nonce || !subscriptionId || !shop || !exp || !sig) {
    return { valid: false, reason: 'missing_fields' }
  }
  let ok = false
  try {
    const key = await hmacKey(secret)
    // crypto.subtle.verify is a constant-time comparison.
    ok = await crypto.subtle.verify('HMAC', key, hexToBytes(String(sig)), new TextEncoder().encode(stateMessage(nonce, subscriptionId, shop, exp)))
  } catch {
    return { valid: false, reason: 'bad_signature' }
  }
  if (!ok) return { valid: false, reason: 'bad_signature' }
  if (Date.now() > Number(exp)) return { valid: false, reason: 'expired' }
  return { valid: true, nonce, subscriptionId, shop }
}

// ─── Shopify request HMAC verification ───────────────────────────────────────
// Shopify's own integrity check on the callback (independent of our state nonce).
// Drop `hmac` (+ legacy `signature`), sort the remaining params by key, join as
// `key=value&…` (decoded values, per Shopify's reference impl), HMAC-SHA256 hex
// with SHOPIFY_API_SECRET, constant-time compare. Never throws.
async function verifyShopifyHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const provided = params.get('hmac') || ''
  if (!provided) return false
  // params.entries() yields URL-decoded values, matching Shopify's reference impl
  // (its libraries HMAC over the parsed/decoded query, not the raw string). Shopify
  // percent-encodes reserved chars in the redirect — e.g. the base64 `host` value's
  // '+' arrives as '%2B' — so decoding here reproduces exactly the bytes it signed.
  const entries: [string, string][] = []
  for (const [k, v] of params.entries()) {
    if (k === 'hmac' || k === 'signature') continue
    entries.push([k, v])
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&')
  try {
    const key = await hmacKey(secret)
    return await crypto.subtle.verify('HMAC', key, hexToBytes(provided), new TextEncoder().encode(message))
  } catch {
    return false
  }
}

// ─── ROUTE A — install (no `code`), authenticated ────────────────────────────
async function handleInstall(req: Request, url: URL): Promise<Response> {
  if (!SHOPIFY_API_KEY || !STATE_SECRET) {
    console.error('[shopify-oauth] install: SHOPIFY_API_KEY / SHOPIFY_OAUTH_STATE_SECRET not configured')
    return jsonError(500, 'Shopify connection is not configured.')
  }

  // 1. Bearer JWT → Supabase user.
  const authz = req.headers.get('authorization') || ''
  const m = authz.match(/^Bearer\s+(.+)$/i)
  if (!m) return jsonError(401, 'Unauthorized')
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(m[1])
  if (authErr || !user) return jsonError(401, 'Unauthorized')

  // 2. subscriptionId + shop from query; validate shop BEFORE anything else.
  const subscriptionId = (url.searchParams.get('subscriptionId') || '').trim()
  const shop = (url.searchParams.get('shop') || '').trim().toLowerCase()
  if (!subscriptionId) return jsonError(400, 'Missing subscriptionId.')
  if (!SHOP_REGEX.test(shop)) return jsonError(400, 'Invalid shop domain.')

  // 3. Ownership: the subscription must belong to the authenticated user.
  const { data: sub, error: subErr } = await supabase
    .from('agent_subscriptions')
    .select('auth_user_id')
    .eq('id', subscriptionId)
    .maybeSingle()
  if (subErr) {
    console.error('[shopify-oauth] install: subscription lookup failed:', subErr.message)
    return jsonError(500, 'Could not start Shopify connection.')
  }
  // Combine not-found + mismatch into 403 (no existence oracle), as finalize does.
  if (!sub || sub.auth_user_id !== user.id) {
    return jsonError(403, 'subscription does not belong to authenticated user')
  }

  // 4. Single-use nonce → github_oauth_states (provider-scoped to shopify).
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
  const { error: insErr } = await supabase
    .from('github_oauth_states')
    .insert({ state_token: nonce, auth_user_id: user.id, provider: 'shopify' })
  if (insErr) {
    console.error('[shopify-oauth] install: nonce insert failed:', insErr.message)
    return jsonError(500, 'Could not start Shopify connection.')
  }

  // 5. Signed state (carries shop so the callback can cross-check it).
  const state = await signState({ nonce, subscriptionId, shop }, STATE_SECRET)

  // 6. Shopify authorize URL → returned as JSON; the dashboard navigates to it.
  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize?` +
    new URLSearchParams({
      client_id: SHOPIFY_API_KEY,
      scope: SHOPIFY_SCOPE,
      redirect_uri: REDIRECT_URI,
      state,
    }).toString()

  return new Response(JSON.stringify({ url: authorizeUrl }), { headers: JSON_HEADERS })
}

// ─── ROUTE B — callback (`code` + `hmac`) ────────────────────────────────────
async function handleCallback(url: URL): Promise<Response> {
  if (!SHOPIFY_API_SECRET || !STATE_SECRET) {
    console.error('[shopify-oauth] callback: SHOPIFY_API_SECRET / SHOPIFY_OAUTH_STATE_SECRET not configured')
    return redirectError('server_error')
  }
  const params = url.searchParams
  const shop = (params.get('shop') || '').trim().toLowerCase()

  // 1. Shop-domain regex BEFORE any outbound call (SSRF guard).
  if (!SHOP_REGEX.test(shop)) return redirectError('invalid_shop')

  // 2. Shopify HMAC over the callback params.
  if (!(await verifyShopifyHmac(params, SHOPIFY_API_SECRET))) return redirectError('bad_hmac')

  // 3. Our state token (HMAC + expiry), then cross-check the returned shop.
  const verified = await verifyState(params.get('state') || '', STATE_SECRET)
  if (!verified.valid) return redirectError('bad_state')
  if (verified.shop !== shop) return redirectError('shop_mismatch')
  const { nonce, subscriptionId } = verified

  // 4. Atomic single-use nonce consume (scoped to provider='shopify').
  const { data: consumed, error: consumeErr } = await supabase
    .from('github_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_token', nonce)
    .eq('provider', 'shopify')
    .is('consumed_at', null)
    .select('auth_user_id')
    .maybeSingle()
  if (consumeErr) {
    console.error('[shopify-oauth] callback: nonce consume failed:', consumeErr.message)
    return redirectError('server_error')
  }
  if (!consumed) return redirectError('link_already_used') // 0 rows ⇒ replay/invalid.

  // 5. Ownership: the consumed initiator must own the target subscription.
  const { data: sub, error: subErr } = await supabase
    .from('agent_subscriptions')
    .select('auth_user_id')
    .eq('id', subscriptionId)
    .maybeSingle()
  if (subErr) {
    console.error('[shopify-oauth] callback: subscription lookup failed:', subErr.message)
    return redirectError('server_error')
  }
  if (!sub || sub.auth_user_id !== consumed.auth_user_id) return redirectError('ownership_mismatch')

  // 6. Code → EXPIRING offline access token. Public apps created on/after
  // 2026-04-01 cannot use non-expiring tokens — Shopify rejects them on every
  // Admin API call ("Non-expiring access tokens are no longer accepted"), which
  // is what surfaced as the step-7 403. `expiring` requests the rotating variant:
  // a short-lived access_token (~3600s) plus a 90-day refresh_token so agent-run
  // can refresh later WITHOUT re-consent. We store refresh_token + expires_at and
  // deliberately DO NOT refresh here (the callback finishes in seconds with a
  // fresh token; refresh belongs in agent-run's long-running call path).
  // The expiring authorization-code grant MUST be form-encoded with `expiring=1`
  // (the literal string "1") — Shopify's documented format. A JSON body / boolean
  // can silently return a NON-expiring token, which then 403s every Admin API call.
  let accessToken: string
  let grantedScope: string
  let refreshToken: string | null = null
  let expiresAt: string | null = null
  let refreshExpiresAt: string | null = null
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code: params.get('code') || '',
        expiring: '1',
      }).toString(),
    })
    const tokenJson = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenJson?.access_token) {
      console.error('[shopify-oauth] callback: token exchange failed:', tokenRes.status)
      return redirectError('token_exchange_failed')
    }
    accessToken = tokenJson.access_token
    grantedScope = tokenJson.scope || SHOPIFY_SCOPE
    refreshToken = tokenJson.refresh_token ?? null
    // Both are seconds. Convert to absolute timestamps agent-run can compare
    // against without knowing when this exchange happened: expires_in (~3600s, the
    // access token) and refresh_token_expires_in (~7776000s = 90d, after which the
    // refresh token dies and the merchant must re-consent).
    if (Number.isFinite(tokenJson.expires_in)) {
      expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    }
    if (Number.isFinite(tokenJson.refresh_token_expires_in)) {
      refreshExpiresAt = new Date(Date.now() + tokenJson.refresh_token_expires_in * 1000).toISOString()
    }
  } catch (e) {
    console.error('[shopify-oauth] callback: token exchange threw:', (e as Error)?.message)
    return redirectError('token_exchange_failed')
  }

  // 7. Resolve the main theme id (role MAIN) — REQUIRED. main_theme_id is the
  // foundation the downstream theme-read loop depends on, so a null would be a
  // silent half-connection. Use the GraphQL Admin API: the REST themes.json
  // endpoint returns 403 for public apps without the theme/asset exemption,
  // whereas read_themes alone covers theme METADATA (id + role) over GraphQL.
  // Attempt up to 2 times (immediate retry on network error / non-2xx / GraphQL
  // error); if still unresolved, fail the flow rather than store a partial row.
  //
  // GraphQL quirks vs REST: the id is a GID ("gid://shopify/OnlineStoreTheme/123")
  // — take the trailing numeric segment for the bigint column — and role is
  // UPPERCASE ("MAIN", not REST's "main").
  let mainThemeId: number | null = null
  for (let attempt = 1; attempt <= 2 && mainThemeId == null; attempt++) {
    try {
      const themeRes = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query: `{ themes(first: 20) { edges { node { id role } } } }` }),
      })
      const themeJson = await themeRes.json().catch(() => ({}))
      // Surface ACCESS_DENIED / throttling etc. instead of nulling out silently.
      if (!themeRes.ok || themeJson?.errors || themeJson?.data == null) {
        console.error(`[shopify-oauth] callback: themes query failed (attempt ${attempt}):`, themeRes.status, JSON.stringify(themeJson?.errors ?? themeJson))
      } else {
        const edges = themeJson.data?.themes?.edges
        const mainNode = Array.isArray(edges)
          ? edges.find((e: any) => e?.node?.role === 'MAIN')?.node
          : undefined
        if (mainNode?.id) {
          // GID → trailing numeric id, e.g. "gid://shopify/OnlineStoreTheme/123" → 123.
          const parsed = parseInt(String(mainNode.id).split('/').pop() || '', 10)
          if (Number.isFinite(parsed)) mainThemeId = parsed
        }
      }
    } catch (e) {
      console.error(`[shopify-oauth] callback: themes query threw (attempt ${attempt}):`, (e as Error)?.message)
    }
  }
  if (mainThemeId == null) {
    console.error('[shopify-oauth] callback: no main theme resolved after retry')
    return redirectError('theme_read_failed')
  }

  // 8. Encrypt the token, then upsert. The shop-domain unique index can reject a
  // shop already bound to a different subscription → surface a clear reason, not 500.
  let encrypted: string | null
  let encryptedRefresh: string | null
  try {
    encrypted = await encryptSecret(accessToken)
    // refreshToken may be null (e.g. a non-expiring token slipped through) —
    // encryptSecret maps null/'' → null, so this stays null cleanly.
    encryptedRefresh = await encryptSecret(refreshToken)
  } catch (e) {
    console.error('[shopify-oauth] callback: token encryption failed:', (e as Error)?.message)
    return redirectError('server_error')
  }

  try {
    const { error: upErr } = await supabase
      .from('agent_connections')
      .upsert(
        {
          subscription_id: subscriptionId,
          shopify_shop_domain: shop,
          shopify_access_token: encrypted,
          shopify_refresh_token: encryptedRefresh,
          shopify_token_expires_at: expiresAt,
          shopify_refresh_token_expires_at: refreshExpiresAt,
          shopify_main_theme_id: mainThemeId,
          shopify_scope: grantedScope,
          shopify_connected_at: new Date().toISOString(),
        },
        { onConflict: 'subscription_id' },
      )
    if (upErr) {
      // 23505 on agent_connections_shopify_shop_domain_key: this myshopify domain
      // is already connected to a different Velyr subscription.
      if (upErr.code === '23505') {
        console.error('[shopify-oauth] callback: shop already connected:', upErr.message)
        return redirectError('shop_already_connected')
      }
      console.error('[shopify-oauth] callback: connection upsert failed:', upErr.message)
      return redirectError('server_error')
    }
  } catch (e: any) {
    // supabase-js resolves with { error } rather than throwing, but guard the
    // unique violation here too in case a PostgrestError ever surfaces as a throw.
    if (e?.code === '23505' || e?.cause?.code === '23505') return redirectError('shop_already_connected')
    console.error('[shopify-oauth] callback: connection upsert threw:', e?.message)
    return redirectError('server_error')
  }

  // 9. Success.
  return Response.redirect(`${APP_BASE}/agent/onboarding?shopify=connected`, 302)
}

// ─── Entry point ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {
    const url = new URL(req.url)
    // Route by query-param presence: Shopify's callback carries `code`.
    if (url.searchParams.has('code')) {
      return await handleCallback(url)
    }
    return await handleInstall(req, url)
  } catch (err) {
    console.error('[shopify-oauth] top-level error:', (err as Error)?.message, (err as Error)?.stack)
    return jsonError(500, 'Internal error')
  }
})
