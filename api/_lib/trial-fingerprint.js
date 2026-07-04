// ─── TRIAL-ABUSE FINGERPRINT LEDGER HELPERS ───────────────────────────────────
// One free trial per site identity, surviving account deletion. At trial start
// (api/stripe.js handleStartTrial) we record HMAC fingerprints of the site's
// identity in trial_fingerprints (migration 20260704_trial_fingerprints.sql —
// no FK to users/subscriptions, excluded from the account-delete teardown);
// a later start_trial whose identity matches any row is denied the free trial
// (the paid checkout path stays open).
//
// Hashes are HMAC-SHA256 keyed with AGENT_APPROVAL_TOKEN_SECRET — NOT plain
// SHA-256: domains/repos are public-corpus enumerable and Telegram chat ids are
// small integers, so an unkeyed hash would be dictionary-reversible from a
// table dump. Rotating that secret orphans every ledger row (abusers get one
// fresh trial each; nothing breaks).
//
// canonicalizeHost is behaviorally a superset of the edge fn's hostnameFromUrl
// (supabase/functions/agent-run/index.ts) — deliberately NOT a format-locked
// twin: only this Vercel side reads/writes the ledger, so canonicalization
// consistency matters ledger-internally only.
import crypto from 'node:crypto'

const HMAC_PREFIX = 'velyr_trial_fp:v1:'

// website_url is stored raw (onboarding only prepends https://), so the ledger
// needs its own canonical form: hostname only (drops port/path/query),
// lowercase, one leading `www.` stripped, trailing dot stripped. Invalid → null
// (the field is then skipped, never hashed as garbage).
export function canonicalizeHost(rawUrl) {
  if (typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  let hostname
  try {
    hostname = new URL(withProto).hostname
  } catch {
    return null
  }
  let host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  if (!host || !host.includes('.')) return null
  return host
}

export function hmacFingerprint(type, value, secret) {
  if (!secret) throw new Error('trial-fingerprint: HMAC secret is not configured')
  return crypto
    .createHmac('sha256', secret)
    .update(`${HMAC_PREFIX}${type}:${value}`)
    .digest('hex')
}

// Pure: canonicalizes each identity field and returns [{ type, hash }],
// skipping absent/uncanonicalizable fields. The type prefix inside the HMAC
// message domain-separates the hashes, so lookups can match on hash alone.
export function computeTrialFingerprints(fields, secret) {
  const { websiteUrl, githubRepoOwner, githubRepoName, shopifyShopDomain, telegramChatId } = fields || {}
  const out = []

  const host = canonicalizeHost(websiteUrl)
  if (host) out.push({ type: 'website_host', hash: hmacFingerprint('website_host', host, secret) })

  if (githubRepoOwner && githubRepoName) {
    // GitHub owner/repo names are case-insensitive.
    const repo = `${String(githubRepoOwner).trim().toLowerCase()}/${String(githubRepoName).trim().toLowerCase()}`
    out.push({ type: 'github_repo', hash: hmacFingerprint('github_repo', repo, secret) })
  }

  if (shopifyShopDomain) {
    const shop = String(shopifyShopDomain).trim().toLowerCase()
    if (shop) out.push({ type: 'shopify_shop', hash: hmacFingerprint('shopify_shop', shop, secret) })
  }

  if (telegramChatId != null && String(telegramChatId).trim() !== '') {
    out.push({ type: 'telegram_chat', hash: hmacFingerprint('telegram_chat', String(telegramChatId).trim(), secret) })
  }

  return out
}

// DB-reading wrapper for handleStartTrial. Never throws: on a missing secret or
// failed read it logs loudly and returns [] — the caller treats an empty list
// as "nothing to check" and fails OPEN (this is a cost gate, not a security
// control).
export async function computeFingerprintsForSubscription(supabase, subscriptionId) {
  const secret = process.env.AGENT_APPROVAL_TOKEN_SECRET
  if (!secret) {
    console.error('trial-fingerprint: AGENT_APPROVAL_TOKEN_SECRET not configured — ledger disabled (failing open)')
    return []
  }

  const [{ data: conn, error: connErr }, { data: sub, error: subErr }] = await Promise.all([
    supabase
      .from('agent_connections')
      .select('website_url, github_repo_owner, github_repo_name, shopify_shop_domain, telegram_chat_id')
      .eq('subscription_id', subscriptionId)
      .maybeSingle(),
    supabase
      .from('agent_subscriptions')
      .select('telegram_chat_id')
      .eq('id', subscriptionId)
      .maybeSingle(),
  ])
  if (connErr) console.error('trial-fingerprint: agent_connections read failed:', connErr.message)
  if (subErr) console.error('trial-fingerprint: agent_subscriptions read failed:', subErr.message)
  if (!conn && !sub) return []

  return computeTrialFingerprints({
    websiteUrl: conn?.website_url,
    githubRepoOwner: conn?.github_repo_owner,
    githubRepoName: conn?.github_repo_name,
    shopifyShopDomain: conn?.shopify_shop_domain,
    // The browser writes telegram_chat_id onto agent_subscriptions too; prefer
    // the connection row, fall back to the subscription row.
    telegramChatId: conn?.telegram_chat_id ?? sub?.telegram_chat_id,
  }, secret)
}
