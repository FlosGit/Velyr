// Standalone unit test for the PURE trial-fingerprint helpers (anti-abuse
// ledger). No framework (the repo has none) and no DB — run with:
//   node api/_lib/trial-fingerprint.test.mjs
// Exits 0 if all assertions pass, 1 (with the failing case) otherwise.

import {
  canonicalizeHost,
  hmacFingerprint,
  computeTrialFingerprints,
} from './trial-fingerprint.js'

let passed = 0
const failures = []
function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`)
}

const SECRET = 'test-secret-not-a-real-key'

// ── canonicalizeHost ─────────────────────────────────────────────────────────
eq('host: bare domain', canonicalizeHost('example.com'), 'example.com')
eq('host: no scheme + path', canonicalizeHost('example.com/pricing'), 'example.com')
eq('host: https scheme', canonicalizeHost('https://example.com'), 'example.com')
eq('host: http scheme', canonicalizeHost('http://example.com'), 'example.com')
eq('host: uppercase + WWW.', canonicalizeHost('HTTPS://WWW.Example.COM'), 'example.com')
eq('host: www stripped once only', canonicalizeHost('www.www.example.com'), 'www.example.com')
eq('host: port dropped', canonicalizeHost('https://example.com:8443'), 'example.com')
eq('host: path/query/fragment dropped', canonicalizeHost('https://example.com/a/b?q=1#x'), 'example.com')
eq('host: trailing slash', canonicalizeHost('https://example.com/'), 'example.com')
eq('host: trailing dot (FQDN)', canonicalizeHost('example.com.'), 'example.com')
eq('host: surrounding whitespace', canonicalizeHost('  example.com  '), 'example.com')
eq('host: subdomain preserved (NOT collapsed to apex)', canonicalizeHost('shop.example.com'), 'shop.example.com')
eq('host: credentials stripped by URL parse', canonicalizeHost('https://user:pass@example.com'), 'example.com')
eq('host: empty string → null', canonicalizeHost(''), null)
eq('host: whitespace only → null', canonicalizeHost('   '), null)
eq('host: non-string → null', canonicalizeHost(null), null)
eq('host: number → null', canonicalizeHost(42), null)
eq('host: dotless garbage → null', canonicalizeHost('localhost'), null)
eq('host: unparsable → null', canonicalizeHost('http://'), null)

// ── hmacFingerprint ──────────────────────────────────────────────────────────
const h1 = hmacFingerprint('website_host', 'example.com', SECRET)
eq('hmac: 64 lowercase hex chars', /^[0-9a-f]{64}$/.test(h1), true)
eq('hmac: deterministic', hmacFingerprint('website_host', 'example.com', SECRET), h1)
eq('hmac: value-sensitive', h1 === hmacFingerprint('website_host', 'other.com', SECRET), false)
eq('hmac: secret-sensitive', h1 === hmacFingerprint('website_host', 'example.com', 'different'), false)
// Domain separation: same value under a different type must never collide —
// this is what makes matching on fingerprint_hash alone safe.
eq('hmac: cross-type domain separation',
  h1 === hmacFingerprint('shopify_shop', 'example.com', SECRET), false)
eq('hmac: missing secret throws',
  (() => { try { hmacFingerprint('website_host', 'example.com', '') ; return 'no-throw' } catch { return 'threw' } })(),
  'threw')

// ── computeTrialFingerprints ─────────────────────────────────────────────────
const full = computeTrialFingerprints({
  websiteUrl: 'https://www.Example.com/pricing',
  githubRepoOwner: 'Acme-Inc',
  githubRepoName: 'Store-Front',
  shopifyShopDomain: 'Acme.myshopify.com',
  telegramChatId: 123456789,
}, SECRET)
eq('compute: all four types, in order',
  full.map(f => f.type),
  ['website_host', 'github_repo', 'shopify_shop', 'telegram_chat'])
eq('compute: website canonicalized before hashing',
  full[0].hash, hmacFingerprint('website_host', 'example.com', SECRET))
eq('compute: repo lowercased owner/name',
  full[1].hash, hmacFingerprint('github_repo', 'acme-inc/store-front', SECRET))
eq('compute: shop lowercased',
  full[2].hash, hmacFingerprint('shopify_shop', 'acme.myshopify.com', SECRET))
eq('compute: chat id stringified',
  full[3].hash, hmacFingerprint('telegram_chat', '123456789', SECRET))

eq('compute: absent fields skipped (github-only)',
  computeTrialFingerprints({ githubRepoOwner: 'a', githubRepoName: 'b' }, SECRET).map(f => f.type),
  ['github_repo'])
eq('compute: owner without name → repo skipped',
  computeTrialFingerprints({ githubRepoOwner: 'a' }, SECRET).map(f => f.type),
  [])
eq('compute: invalid website skipped, rest kept',
  computeTrialFingerprints({ websiteUrl: 'not a url', telegramChatId: '99' }, SECRET).map(f => f.type),
  ['telegram_chat'])
eq('compute: empty input → empty list', computeTrialFingerprints({}, SECRET), [])
eq('compute: null input → empty list', computeTrialFingerprints(null, SECRET), [])
eq('compute: negative (group) chat id kept',
  computeTrialFingerprints({ telegramChatId: -1001234 }, SECRET).map(f => f.type),
  ['telegram_chat'])
eq('compute: same identity, differently-written URL → same hash (abuse case)',
  computeTrialFingerprints({ websiteUrl: 'example.com' }, SECRET)[0].hash,
  computeTrialFingerprints({ websiteUrl: 'https://www.example.com/' }, SECRET)[0].hash)

// ── report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ ${failures.length} assertion(s) FAILED (${passed} passed):\n`)
  for (const f of failures) console.error('  • ' + f + '\n')
  process.exit(1)
}
console.log(`✅ trial-fingerprint: all ${passed} assertions passed`)
