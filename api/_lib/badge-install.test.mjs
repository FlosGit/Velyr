// Unit tests for the agent badge-install helpers. Run: node api/_lib/badge-install.test.mjs
import { buildBadgeBlock, decideBadgeInjection, BADGE_MARKERS, BADGE_LOOSE_TOKEN, BADGE_TARGETS, BADGE_ROUTE_GUARD } from './badge-install.js'

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

// SPA-flash guard: on client-rendered shells the badge is the only painted
// element until the app mounts, so it must start hidden and fade in via CSS.
// The REVEAL must stay CSS-only (a script-driven reveal under strict CSP would
// leave the badge permanently invisible) — the route-guard script below only
// ever HIDES, so a blocked script fails open to badge-on-every-page.
assert(htmlBlock.includes('opacity:0') && htmlBlock.includes('animation:velyrBadgeIn'), 'html badge starts hidden + animates in')
assert(htmlBlock.includes('<style>@keyframes velyrBadgeIn{to{opacity:1}}</style>'), 'html block ships its own keyframes')

// Landing-page-only (2026-07-18): the html variant carries the route-guard
// script (hide off '/', SPA-navigation aware); it must sit AFTER the badge div
// (currentScript.previousElementSibling is how it finds its target).
assert(htmlBlock.includes(`<script>${BADGE_ROUTE_GUARD}</script>`), 'html block ships the route guard')
assert(htmlBlock.indexOf('</div>') < htmlBlock.indexOf('<script>'), 'route guard sits directly after the badge div')
assert(BADGE_ROUTE_GUARD.includes("location.pathname") && BADGE_ROUTE_GUARD.includes("'none'"), 'guard hides on non-root paths (never reveals)')
assert(BADGE_ROUTE_GUARD.includes('pushState') && BADGE_ROUTE_GUARD.includes('popstate'), 'guard tracks SPA client-side navigation')
assert(!BADGE_ROUTE_GUARD.includes('"') && !BADGE_ROUTE_GUARD.includes('`') && !BADGE_ROUTE_GUARD.includes('${'), 'guard embeds safely in JSX double-quoted strings + template literals')

const jsxBlock = buildBadgeBlock('my-shop', 'jsx')
assert(jsxBlock.startsWith(BADGE_MARKERS.jsx.open) && jsxBlock.endsWith(BADGE_MARKERS.jsx.close), 'jsx block is marker-wrapped')
assert(jsxBlock.includes('action=win_badge&slug=my-shop') && !jsxBlock.includes('&amp;'), 'jsx img URL uses a bare &')
assert(jsxBlock.includes('style={{') && jsxBlock.includes('width={320}'), 'jsx uses style objects + numeric attrs')
assert(!jsxBlock.includes('opacity:0'), 'jsx (server-rendered shells) stays immediately visible')
// JSX renders <script> children as text, so the guard must ride in via
// dangerouslySetInnerHTML to actually execute.
assert(jsxBlock.includes(`<script dangerouslySetInnerHTML={{__html:"${BADGE_ROUTE_GUARD}"}}/>`), 'jsx block ships the route guard via dangerouslySetInnerHTML')

// Liquid variant: server-side landing-page gate, no script at all — the badge
// never renders outside the home page, CSP-immune, and shares the html markers.
const liquidBlock = buildBadgeBlock('my-shop', 'liquid')
assert(liquidBlock.startsWith(BADGE_MARKERS.html.open) && liquidBlock.endsWith(BADGE_MARKERS.html.close), 'liquid block uses html markers')
assert(liquidBlock.includes("{% if request.page_type == 'index' %}") && liquidBlock.includes('{% endif %}'), 'liquid block is page_type-gated to the home page')
assert(liquidBlock.indexOf("{% if") < liquidBlock.indexOf('<style>') && liquidBlock.indexOf('</div>') < liquidBlock.indexOf('{% endif %}'), 'liquid gate wraps the whole badge markup')
assert(!liquidBlock.includes('<script'), 'liquid variant needs no script (server-side gate)')
assert(liquidBlock.includes('action=win_badge&amp;slug=my-shop'), 'liquid img URL uses &amp; like html')

// Hostile slug is stripped, never breaks out of the attribute. (The block now
// legitimately contains our own <script> guard — the assertion is that the
// injected payload never survives, not that no script exists.)
const hostile = buildBadgeBlock('x"><script>alert(1)</script>', 'html')
assert(!hostile.includes('alert(1)') && !hostile.includes('">'.repeat(2)), 'hostile slug sanitized')
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

// A pre-flash-fix block (the 2026-07-15 format without the opacity guard, as it
// sits on already-installed sites) self-heals to the new embed on reinstall.
const legacyBlock = `${BADGE_MARKERS.html.open}\n<div style="text-align:center;padding:16px 0"><a href="https://velyr.io/agent/my-shop" target="_blank" rel="noopener"><img src="https://velyr.io/api/agent/run?action=win_badge&amp;slug=my-shop" alt="Optimized weekly by Velyr" width="320" height="64" loading="lazy" style="display:inline-block;border:0"></a></div>\n${BADGE_MARKERS.html.close}`
const legacy = page.replace('</body>', legacyBlock + '\n</body>')
const heal = decideBadgeInjection(legacy, htmlBlock, 'html')
assert(heal.action === 'reinject' && heal.newContent.includes('animation:velyrBadgeIn'), 'legacy no-guard block self-heals to the fading embed')

// A pre-route-guard block (fade but no landing-page script — the every-page
// format installed before 2026-07-18) also self-heals on reinstall.
const preGuardBlock = `${BADGE_MARKERS.html.open}\n<style>@keyframes velyrBadgeIn{to{opacity:1}}</style>\n<div style="text-align:center;padding:16px 0;opacity:0;animation:velyrBadgeIn .6s ease .9s forwards"><a href="https://velyr.io/agent/my-shop" target="_blank" rel="noopener"><img src="https://velyr.io/api/agent/run?action=win_badge&amp;slug=my-shop" alt="Optimized weekly by Velyr" width="320" height="64" loading="lazy" style="display:inline-block;border:0"></a></div>\n${BADGE_MARKERS.html.close}`
const preGuard = page.replace('</body>', preGuardBlock + '\n</body>')
const healGuard = decideBadgeInjection(preGuard, htmlBlock, 'html')
assert(healGuard.action === 'reinject' && healGuard.newContent.includes(BADGE_ROUTE_GUARD), 'pre-guard every-page block self-heals to the landing-page-only embed')

// The dashboard's hand-paste snippet is the same block with newlines collapsed
// to single spaces — whitespace-normalized equal, so it must count as installed.
const pastedOneLine = page.replace('</body>', htmlBlock.replace(/\n/g, ' ') + '</body>')
assert(decideBadgeInjection(pastedOneLine, htmlBlock, 'html').action === 'skip', 'one-line hand-pasted twin → skip')

// No </body> anywhere → honest no_anchor (never a blind append).
assert(decideBadgeInjection('<div>fragment page</div>', htmlBlock, 'html').action === 'no_anchor', 'no anchor → no_anchor')

// JSX variant anchors the same way and uses JSX markers for detection.
const layout = 'export default function RootLayout({children}){return (<html><body>{children}</body></html>)}'
const jsxInj = decideBadgeInjection(layout, jsxBlock, 'jsx')
assert(jsxInj.action === 'inject' && jsxInj.newContent.indexOf('{children}') < jsxInj.newContent.indexOf(BADGE_MARKERS.jsx.open), 'jsx inject lands after {children}')
assert(decideBadgeInjection(jsxInj.newContent, jsxBlock, 'jsx').action === 'skip', 'jsx idempotent')

// ── Target list sanity ────────────────────────────────────────────────────────
assert(BADGE_TARGETS[0].path === 'layout/theme.liquid' && BADGE_TARGETS[0].variant === 'liquid', 'theme shell is checked first and gets the server-side liquid gate')
assert(BADGE_TARGETS.every(t => ['html', 'jsx', 'liquid'].includes(t.variant)), 'every target has a known variant')

console.log(`ok — ${passed} assertions passed`)
