// Standalone unit test for the PURE route-scoping / bounce-aggregation logic
// used by the 48h rollback check. No framework (the repo has none) — run with:
//   node api/_lib/route-scope.test.mjs
// Exits 0 if all assertions pass, 1 (with the failing cases) otherwise.

import {
  resolveAffectedScope,
  matchesRoute,
  normalizePathname,
  sessionize,
  bounceFromSessions,
} from './route-scope.js'

let passed = 0
const failures = []
function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`)
}

// Minimal stand-in for the fileToRoutePath twin in api/agent/run.js —
// only the shapes these tests exercise.
function fileToRouteStub(p) {
  if (p === 'src/pages/Pricing.jsx') return '/pricing'
  if (p === 'pages/index.jsx') return '/'
  if (p === 'pages/blog/[slug].jsx') return '/blog/:slug'
  if (p === 'pages/docs/[...parts].jsx') return '/docs/[...parts]'
  if (p === 'pages/[slug].jsx') return '/:slug'
  if (p === 'app/pricing/page.tsx') return '/pricing'
  return null
}

// ── resolveAffectedScope: Shopify theme files ────────────────────────────────
eq('theme: product template → /products/ prefix',
  resolveAffectedScope(['templates/product.liquid']),
  { kind: 'route', matchers: [{ prefix: '/products/' }], routesLabel: '/products/*' })

eq('theme: sectioned template (product.quick-buy.json) → same route class',
  resolveAffectedScope(['templates/product.quick-buy.json']),
  { kind: 'route', matchers: [{ prefix: '/products/' }], routesLabel: '/products/*' })

eq('theme: index template → exact /',
  resolveAffectedScope(['templates/index.json']),
  { kind: 'route', matchers: [{ exact: '/' }], routesLabel: '/' })

eq('theme: section file → site-wide (rendered across templates)',
  resolveAffectedScope(['sections/hero.liquid']),
  { kind: 'site_wide' })

eq('theme: snippet → site-wide',
  resolveAffectedScope(['snippets/price.liquid']),
  { kind: 'site_wide' })

eq('theme: layout → site-wide',
  resolveAffectedScope(['layout/theme.liquid']),
  { kind: 'site_wide' })

eq('theme: guard (a) — one site-wide file poisons the set',
  resolveAffectedScope(['templates/product.liquid', 'snippets/price.liquid']),
  { kind: 'site_wide' })

eq('theme: customers templates → /account prefix',
  resolveAffectedScope(['templates/customers/login.liquid']),
  { kind: 'route', matchers: [{ prefix: '/account' }], routesLabel: '/account*' })

eq('theme: unknown template (404) → site-wide',
  resolveAffectedScope(['templates/404.liquid']),
  { kind: 'site_wide' })

// ── resolveAffectedScope: React / Next files ─────────────────────────────────
eq('react: pages file → exact route',
  resolveAffectedScope(['src/pages/Pricing.jsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'route', matchers: [{ exact: '/pricing' }], routesLabel: '/pricing' })

eq('react: pages index → exact /',
  resolveAffectedScope(['pages/index.jsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'route', matchers: [{ exact: '/' }], routesLabel: '/' })

eq('react: dynamic segment truncates to static prefix',
  resolveAffectedScope(['pages/blog/[slug].jsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'route', matchers: [{ prefix: '/blog/' }], routesLabel: '/blog/*' })

eq('react: catch-all segment truncates to static prefix',
  resolveAffectedScope(['pages/docs/[...parts].jsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'route', matchers: [{ prefix: '/docs/' }], routesLabel: '/docs/*' })

eq('react: root-level dynamic route would match everything → site-wide',
  resolveAffectedScope(['pages/[slug].jsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'site_wide' })

eq('react: component file → site-wide (never trust a non-route mapping)',
  resolveAffectedScope(['src/components/Hero.jsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'site_wide' })

eq('react: app router page → route',
  resolveAffectedScope(['app/pricing/page.tsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'route', matchers: [{ exact: '/pricing' }], routesLabel: '/pricing' })

eq('react: app router layout → site-wide (affects a subtree)',
  resolveAffectedScope(['app/layout.tsx'], { fileToRoute: fileToRouteStub }),
  { kind: 'site_wide' })

eq('react: pages/api file → site-wide',
  resolveAffectedScope(['pages/api/checkout.js'], { fileToRoute: fileToRouteStub }),
  { kind: 'site_wide' })

eq('react: no mapper injected → site-wide',
  resolveAffectedScope(['src/pages/Pricing.jsx']),
  { kind: 'site_wide' })

eq('empty file list → site-wide',
  resolveAffectedScope([]),
  { kind: 'site_wide' })

eq('dedupe: two files in the same route class → one matcher',
  resolveAffectedScope(['templates/product.liquid', 'templates/product.quick-buy.json']),
  { kind: 'route', matchers: [{ prefix: '/products/' }], routesLabel: '/products/*' })

// ── matchesRoute / normalizePathname ─────────────────────────────────────────
eq('exact / does not match /pricing', matchesRoute('/pricing', [{ exact: '/' }]), false)
eq('exact / matches /',               matchesRoute('/', [{ exact: '/' }]), true)
eq('prefix matches nested path',      matchesRoute('/products/red-shoe', [{ prefix: '/products/' }]), true)
eq('prefix does not match sibling',   matchesRoute('/collections/all', [{ prefix: '/products/' }]), false)

eq('normalize: trailing slash stripped', normalizePathname('/pricing/'), '/pricing')
eq('normalize: query stripped',          normalizePathname('/pricing?utm=x'), '/pricing')
eq('normalize: full URL accepted',       normalizePathname('https://shop.example/products/x'), '/products/x')
eq('normalize: root stays /',            normalizePathname('/'), '/')
eq('normalize: garbage → null',          normalizePathname('not-a-path'), null)

// ── sessionize + bounceFromSessions ──────────────────────────────────────────
// 3 sessions site-wide: s1 bounced on /products/x, s2 two views, s3 bounced on /.
const rows = [
  ['s1', '/products/x'],
  ['s2', '/products/y'], ['s2', '/cart'],
  ['s3', '/'],
]
const sessions = sessionize(rows)

eq('site-wide bounce: 2 of 3 sessions bounced',
  bounceFromSessions(sessions, null, 1), { rate: 67, sessions: 3 })

eq('scoped bounce: /products/ population is s1+s2, 1 bounced',
  bounceFromSessions(sessions, [{ prefix: '/products/' }], 1), { rate: 50, sessions: 2 })

eq('scoped population below floor → rate null, sessions honest',
  bounceFromSessions(sessions, [{ prefix: '/products/' }], 3), { rate: null, sessions: 2 })

eq('exact / scope only catches the / session',
  bounceFromSessions(sessions, [{ exact: '/' }], 1), { rate: 100, sessions: 1 })

eq('rows with missing pathname still count site-wide',
  bounceFromSessions(sessionize([['s1', null], ['s2', '/x']]), null, 1), { rate: 100, sessions: 2 })

eq('rows with missing pathname are excluded from scoped populations',
  bounceFromSessions(sessionize([['s1', null], ['s2', '/x']]), [{ exact: '/x' }], 1), { rate: 100, sessions: 1 })

eq('empty/na session ids skipped', bounceFromSessions(sessionize([[null, '/x'], ['', '/y']]), null, 1), { rate: null, sessions: 0 })

// ── report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`route-scope tests: ${failures.length} FAILED, ${passed} passed\n`)
  for (const f of failures) console.error(`  ✕ ${f}\n`)
  process.exit(1)
}
console.log(`route-scope tests: all ${passed} passed`)
