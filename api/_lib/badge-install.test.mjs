// Unit tests for the agent badge-install helpers. Run: node api/_lib/badge-install.test.mjs
import { buildBadgeBlock, decideBadgeInjection, BADGE_MARKERS, BADGE_LOOSE_TOKEN, BADGE_TARGETS } from './badge-install.js'

let passed = 0
const assert = (cond, label) => {
  if (!cond) { console.error(`FAIL  ${label}`); process.exit(1) }
  passed++
}

// ── Block builders ────────────────────────────────────────────────────────────
const htmlBlock = buildBadgeBlock('my-shop', 'html')
assert(htmlBlock.startsWith(BADGE_MARKERS.html.open) && htmlBlock.endsWith(BADGE_MARKERS.html.close), 'html block is marker-wrapped')
assert(htmlBlock.includes('action=win_badge&amp;slug=my-shop'), 'html img URL uses &amp; + slug')
assert(htmlBlock.includes('href="https://velyr.io/agent/my-shop"'), 'html links the public timeline')

const jsxBlock = buildBadgeBlock('my-shop', 'jsx')
assert(jsxBlock.startsWith(BADGE_MARKERS.jsx.open) && jsxBlock.endsWith(BADGE_MARKERS.jsx.close), 'jsx block is marker-wrapped')
assert(jsxBlock.includes('action=win_badge&slug=my-shop') && !jsxBlock.includes('&amp;'), 'jsx img URL uses a bare &')
assert(jsxBlock.includes('style={{') && jsxBlock.includes('width={320}'), 'jsx uses style objects + numeric attrs')

// Hostile slug is stripped, never breaks out of the attribute.
const hostile = buildBadgeBlock('x"><script>alert(1)</script>', 'html')
assert(!hostile.includes('<script>') && !hostile.includes('">'.repeat(2)), 'hostile slug sanitized')
assert(hostile.includes('slug=xscriptalert1script'), 'hostile slug reduced to [a-z0-9-]')

// ── Injection decision ────────────────────────────────────────────────────────
const page = '<html><head></head><body><main>content</main></body></html>'

// Fresh inject lands before </body>, after existing content.
const inj = decideBadgeInjection(page, htmlBlock, 'html')
assert(inj.action === 'inject', 'fresh page → inject')
assert(inj.newContent.indexOf('</main>') < inj.newContent.indexOf(BADGE_MARKERS.html.open), 'badge sits after page content')
assert(inj.newContent.indexOf(BADGE_MARKERS.html.close) < inj.newContent.indexOf('</body>'), 'badge sits before </body>')

// Idempotent: deciding again on the injected content skips.
assert(decideBadgeInjection(inj.newContent, htmlBlock, 'html').action === 'skip', 'already installed → skip')

// A hand-pasted badge without markers (loose token) also counts as installed.
const pasted = page.replace('</body>', `<img src="https://velyr.io/api/agent/run?${BADGE_LOOSE_TOKEN}&slug=my-shop"></body>`)
assert(decideBadgeInjection(pasted, htmlBlock, 'html').action === 'skip', 'loose token → skip')

// A stale block (old slug) is replaced in place, exactly once.
const staleBlock = buildBadgeBlock('old-slug', 'html')
const stale = page.replace('</body>', staleBlock + '\n</body>')
const re = decideBadgeInjection(stale, htmlBlock, 'html')
assert(re.action === 'reinject', 'edited/stale block → reinject')
assert(re.newContent.includes('slug=my-shop') && !re.newContent.includes('slug=old-slug'), 'reinject swaps the slug')
assert(re.newContent.split(BADGE_MARKERS.html.open).length === 2, 'reinject never leaves two blocks')

// No </body> anywhere → honest no_anchor (never a blind append).
assert(decideBadgeInjection('<div>fragment page</div>', htmlBlock, 'html').action === 'no_anchor', 'no anchor → no_anchor')

// JSX variant anchors the same way and uses JSX markers for detection.
const layout = 'export default function RootLayout({children}){return (<html><body>{children}</body></html>)}'
const jsxInj = decideBadgeInjection(layout, jsxBlock, 'jsx')
assert(jsxInj.action === 'inject' && jsxInj.newContent.indexOf('{children}') < jsxInj.newContent.indexOf(BADGE_MARKERS.jsx.open), 'jsx inject lands after {children}')
assert(decideBadgeInjection(jsxInj.newContent, jsxBlock, 'jsx').action === 'skip', 'jsx idempotent')

// ── Target list sanity ────────────────────────────────────────────────────────
assert(BADGE_TARGETS[0].path === 'layout/theme.liquid', 'theme shell is checked first')
assert(BADGE_TARGETS.every(t => t.variant === 'html' || t.variant === 'jsx'), 'every target has a known variant')

console.log(`ok — ${passed} assertions passed`)
