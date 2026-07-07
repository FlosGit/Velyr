// Unit tests for the C12 SVG builders. Run: node api/_lib/win-card.test.mjs
import { escapeXml, buildWinBadgeSvg, buildWinCardSvg } from './win-card.js'

let passed = 0
const assert = (cond, label) => {
  if (!cond) { console.error(`FAIL  ${label}`); process.exit(1) }
  passed++
}

// escapeXml covers all five XML-critical characters and nullish input.
assert(escapeXml(`<img src="x" onerror='a&b'>`) === '&lt;img src=&quot;x&quot; onerror=&apos;a&amp;b&apos;&gt;', 'escapeXml all five chars')
assert(escapeXml(null) === '' && escapeXml(undefined) === '', 'escapeXml nullish → empty')

// Badge: measured win renders the delta; hostile host string is escaped.
const badge = buildWinBadgeSvg({ siteHost: 'shop."><script>alert(1)</script>', win: { deltaPp: -7.2, scope: 'site_wide_bounce_rate' } })
assert(badge.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'badge is a root svg')
assert(badge.includes('−7.2pp'), 'badge shows the signed delta')
assert(!badge.includes('<script>'), 'badge escapes hostile input')

// Badge: route-scoped win labels the scope; no win → honest fallback line.
assert(buildWinBadgeSvg({ siteHost: 'a.de', win: { deltaPp: -3, scope: 'route_scoped_bounce_rate' } }).includes('(affected pages)'), 'badge labels route scope')
const noWin = buildWinBadgeSvg({ siteHost: 'a.de', win: null })
assert(noWin.includes('Weekly conversion fixes, measured') && !/[+−]\d/.test(noWin), 'badge no-win fallback')

// Badge: non-finite delta degrades to the fallback line, never "NaNpp".
assert(!buildWinBadgeSvg({ siteHost: 'a.de', win: { deltaPp: 'oops' } }).includes('NaN'), 'badge non-finite delta safe')

// Card: numbers formatted + clamped, delta chip, scope + measured-at footer, escaping.
const card = buildWinCardSvg({
  siteHost: 'shop.example', problem: `Hero CTA <b>"hidden"</b> & below fold`,
  before: 58.04, after: 50.8, deltaPp: -7.24, scope: 'route_scoped_bounce_rate', measuredAt: '2026-07-01T09:00:00Z',
})
assert(card.includes('58%') && card.includes('50.8%'), 'card formats before/after')
assert(card.includes('−7.2pp') && card.includes('bounce'), 'card delta chip')
assert(card.includes('affected pages') && card.includes('2026-07-01'), 'card scope + date footer')
assert(!card.includes('<b>') && !card.includes('& below'), 'card escapes problem text')

// Card: out-of-range/garbage values render safely ("—", clamped, no chip on non-finite delta).
const junk = buildWinCardSvg({ siteHost: 'a', problem: '', before: 'x', after: 250, deltaPp: NaN, scope: '', measuredAt: null })
assert(junk.includes('—') && junk.includes('100%'), 'card clamps/dashes junk numbers')
assert(!junk.includes('NaN'), 'card no NaN anywhere')

// Card: long problem text truncated with ellipsis.
const long = buildWinCardSvg({ siteHost: 'a', problem: 'p'.repeat(200), before: 1, after: 2, deltaPp: 1, scope: '', measuredAt: '' })
assert(long.includes('…') && !long.includes('p'.repeat(100)), 'card truncates long problem')

console.log(`✅ win-card: all ${passed} assertions passed`)
