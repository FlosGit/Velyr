// Pure route-scoping + bounce aggregation for the 48h rollback check
// (api/agent/run.js handleRollbackCheck). No I/O — unit-tested by
// route-scope.test.mjs (run: node api/_lib/route-scope.test.mjs).
//
// Contract: this module never touches the rollback fire/no-fire threshold.
// It only decides WHICH session population the existing threshold applies to
// (the routes the change actually touched vs the whole site) and aggregates
// bounce rates from raw pageview rows. Anything ambiguous MUST resolve to
// site-wide: measuring the wrong narrow population is worse than measuring
// broad. That resolves the concern that originally rejected route scoping
// (file→URL mapping is unreliable for dynamic routes) — unmappable files
// don't get mislabeled "no data", they fall back to the site-wide comparison.

// ─── Route matchers ──────────────────────────────────────────────────────────
// A matcher is { exact: '/cart' } or { prefix: '/products/' }. Exact-only for
// short paths ('/', '/cart') where a prefix would swallow the whole site.

export function matchesRoute(pathname, matchers) {
  for (const m of matchers || []) {
    if (m.exact != null && pathname === m.exact) return true
    if (m.prefix != null && pathname.startsWith(m.prefix)) return true
  }
  return false
}

// ─── File classification ─────────────────────────────────────────────────────
// Returns { kind: 'route', matchers: [...] } | { kind: 'site_wide' }.
// site_wide is the safe default for every file class we can't confidently
// bind to a route: layouts, sections (rendered across templates), snippets,
// components, styles, unknown paths.

const THEME_FILE_RE = /^(layout|templates|sections|snippets|config|assets|locales)\//i

// Shopify URL structure is fixed by the platform, so template→route is the
// one place file mapping IS reliable. Sections/snippets/layout are rendered
// across arbitrary templates → site-wide by definition.
const THEME_TEMPLATE_ROUTES = {
  index:              [{ exact: '/' }],
  product:            [{ prefix: '/products/' }],
  collection:         [{ prefix: '/collections/' }],
  'list-collections': [{ exact: '/collections' }],
  page:               [{ prefix: '/pages/' }],
  blog:               [{ prefix: '/blogs/' }],
  article:            [{ prefix: '/blogs/' }],
  cart:               [{ exact: '/cart' }],
  search:             [{ exact: '/search' }],
}

function classifyThemeFile(path) {
  const p = path.toLowerCase()
  if (!/^templates\//.test(p)) return { kind: 'site_wide' }
  if (/^templates\/customers\//.test(p)) return { kind: 'route', matchers: [{ prefix: '/account' }] }
  const base = (p.split('/').pop() || '')
    .replace(/\.(liquid|json)$/, '')
    .replace(/\..*$/, '')            // templates/product.quick-buy.json → product
  const matchers = THEME_TEMPLATE_ROUTES[base]
  return matchers ? { kind: 'route', matchers } : { kind: 'site_wide' }
}

// React/Next: only files living in a route directory count, and only when the
// injected fileToRoute mapper (the fileToRoutePath twin in api/agent/run.js)
// yields a usable path. Dynamic segments (:param, [...slug]) truncate to their
// static prefix; a prefix that collapses to '/' matches everything → site-wide.
const REACT_ROUTE_DIR_RE = /^(?:src\/)?(pages|app|views|screens)\//

function classifyReactFile(path, fileToRoute) {
  const p = path.replace(/\\/g, '/')
  if (!REACT_ROUTE_DIR_RE.test(p)) return { kind: 'site_wide' }
  if (/^(?:src\/)?app\//.test(p) && !/\/page\.(tsx|jsx|ts|js)$/.test(p)) {
    // App Router: layout/template/error/loading/route.* affect a whole subtree
    // or aren't pages at all — never route-scope them.
    return { kind: 'site_wide' }
  }
  if (/^(?:src\/)?pages\/(_app|_document|_error)\.|^(?:src\/)?pages\/api\//.test(p)) {
    return { kind: 'site_wide' }
  }
  const route = typeof fileToRoute === 'function' ? fileToRoute(p) : null
  if (!route || typeof route !== 'string' || !route.startsWith('/')) return { kind: 'site_wide' }
  const dynIdx = Math.min(
    ...[route.indexOf(':'), route.indexOf('[')].filter(i => i >= 0).concat([route.length])
  )
  if (dynIdx < route.length) {
    const prefix = route.slice(0, dynIdx)
    if (prefix === '/' || prefix === '') return { kind: 'site_wide' }
    return { kind: 'route', matchers: [{ prefix }] }
  }
  return { kind: 'route', matchers: [{ exact: route === '/' ? '/' : route.replace(/\/$/, '') }] }
}

// ─── Scope resolution (guard a) ──────────────────────────────────────────────
// files: every path the run touched (agent_runs.pages_fixed, falling back to
// analysis_result.file_to_edit). ONE site-wide-class file → the whole change
// is measured site-wide; route-scoping applies only when every touched file
// confidently maps to a route.

const MAX_ROUTE_MATCHERS = 5

export function resolveAffectedScope(files, { fileToRoute } = {}) {
  const list = (files || []).filter(f => typeof f === 'string' && f.trim())
  if (list.length === 0) return { kind: 'site_wide' }
  const matchers = []
  for (const file of list) {
    const cls = THEME_FILE_RE.test(file)
      ? classifyThemeFile(file)
      : classifyReactFile(file, fileToRoute)
    if (cls.kind !== 'route') return { kind: 'site_wide' }
    matchers.push(...cls.matchers)
  }
  // Dedupe; an implausibly wide matcher set means we're not really "scoped".
  const seen = new Set()
  const deduped = matchers.filter(m => {
    const key = m.exact != null ? `e:${m.exact}` : `p:${m.prefix}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (deduped.length === 0 || deduped.length > MAX_ROUTE_MATCHERS) return { kind: 'site_wide' }
  const label = deduped.map(m => m.exact != null ? m.exact : `${m.prefix}*`).join(', ')
  return { kind: 'route', matchers: deduped, routesLabel: label }
}

// ─── Bounce aggregation ──────────────────────────────────────────────────────
// rows: PostHog EventsQuery results, one row per $pageview event —
// row[0] = properties.$session_id, row[1] = properties.$pathname.

export function normalizePathname(raw) {
  if (typeof raw !== 'string' || !raw) return null
  let p = raw
  // Defensive: accept a full URL if an SDK ever sends one.
  const urlMatch = p.match(/^https?:\/\/[^/]+(\/[^?#]*)?/i)
  if (urlMatch) p = urlMatch[1] || '/'
  p = p.split(/[?#]/)[0].replace(/\/{2,}/g, '/')
  if (!p.startsWith('/')) return null
  if (p.length > 1) p = p.replace(/\/$/, '')
  return p.toLowerCase()
}

export function sessionize(rows) {
  const bySession = new Map()
  for (const row of rows || []) {
    const sid = row?.[0]
    if (sid == null || sid === '') continue
    let s = bySession.get(sid)
    if (!s) { s = { pageviews: 0, paths: new Set() }; bySession.set(sid, s) }
    s.pageviews++
    const p = normalizePathname(row?.[1])
    if (p) s.paths.add(p)
  }
  return bySession
}

// Same result shape as the previous inline calcBounceRate: { rate, sessions }.
// matchers=null → site-wide. Scoped population = sessions that viewed at least
// one affected route (for a bounced single-pageview session that IS the
// landing page). Below the floor → rate null; the caller decides the fallback.
export function bounceFromSessions(bySession, matchers, minSessions) {
  let total = 0, bounced = 0
  for (const s of bySession.values()) {
    if (matchers && ![...s.paths].some(p => matchesRoute(p, matchers))) continue
    total++
    if (s.pageviews === 1) bounced++
  }
  if (total < minSessions) return { rate: null, sessions: total }
  return { rate: Math.round((bounced / total) * 100), sessions: total }
}
