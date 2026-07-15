// ════════════════════════════════════════════════════════════════════════════
// Agent-installed win badge (C12 follow-up): pure decision + content builders.
//
// The dashboard's "Let the agent install it" button ships the 320×64 win badge
// into the customer's site footer — as a merged PR on the GitHub path, as a
// direct theme write on the Shopify-direct path. This module only BUILDS the
// embed block and DECIDES what to do with a target file's current content; all
// I/O (GitHub reads/commits, theme reads/upserts) stays in the caller
// (api/agent/run.js handleInstallBadge). Modeled on posthog-inject.mjs, which
// is the proven shape for marker-block install/self-heal decisions.
//
// Plain ESM, no runtime APIs — unit-tested offline (badge-install.test.mjs).
// ════════════════════════════════════════════════════════════════════════════

// Marker pairs differ by syntax: HTML comments survive in .html/.liquid, JSX
// comments in React layout files. The markers are the unit we detect/replace.
export const BADGE_MARKERS = {
  html: { open: '<!-- Velyr Badge -->', close: '<!-- /Velyr Badge -->' },
  jsx:  { open: '{/* Velyr Badge */}',  close: '{/* /Velyr Badge */}' },
}

// Presence of the badge endpoint path anywhere in the file (e.g. the customer
// pasted the embed by hand, without our markers) counts as installed — a second
// badge would be visual duplication, not breakage, but still wrong.
export const BADGE_LOOSE_TOKEN = 'action=win_badge'

// Ordered target candidates for the GitHub path — first path that exists in the
// repo wins. Theme repos are checked first (layout/theme.liquid is their
// mandatory shell); then the static-HTML shells; then React layout shells.
export const BADGE_TARGETS = [
  { path: 'layout/theme.liquid',      variant: 'html' },
  { path: 'index.html',               variant: 'html' },
  { path: 'public/index.html',        variant: 'html' },
  { path: 'app/layout.tsx',           variant: 'jsx' },
  { path: 'app/layout.jsx',           variant: 'jsx' },
  { path: 'app/layout.js',            variant: 'jsx' },
  { path: 'src/app/layout.tsx',       variant: 'jsx' },
  { path: 'src/app/layout.jsx',       variant: 'jsx' },
  { path: 'src/app/layout.js',        variant: 'jsx' },
  { path: 'pages/_document.tsx',      variant: 'jsx' },
  { path: 'pages/_document.jsx',      variant: 'jsx' },
  { path: 'pages/_document.js',       variant: 'jsx' },
  { path: 'src/pages/_document.tsx',  variant: 'jsx' },
  { path: 'src/pages/_document.jsx',  variant: 'jsx' },
  { path: 'src/pages/_document.js',   variant: 'jsx' },
]

// Slugs are validated at save time ([a-z0-9-], 3-30), but the builder is the
// last line of defense before content lands in a customer file — strip anything
// else so a hostile/corrupt slug can never break out of the attribute.
function safeSlug(slug) {
  return String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
}

// Build the full marker-wrapped embed block for a slug + variant.
// html: correct-HTML entity escaping (&amp;) for .html/.liquid. The badge starts
//       opacity:0 and fades in via a delayed CSS animation: on client-rendered
//       SPA shells (vite/CRA index.html) the badge is static HTML outside the
//       app root, so at first paint it is the only visible element and flashes
//       at the TOP of a blank page until the app mounts and pushes it to the
//       footer. CSS-only on purpose — an inline reveal script would be silently
//       killed by a strict CSP (script-src without unsafe-inline) on customer
//       sites, leaving the badge permanently invisible.
// jsx:  JSX style objects + numeric width/height; a bare & in a JSX string
//       attribute stays literal, so no entity is needed. No fade here: the jsx
//       targets (Next layouts/_document) are server-rendered, the surrounding
//       page always paints with the badge, so hiding it would only delay it.
export function buildBadgeBlock(slug, variant) {
  const s = safeSlug(slug)
  const timeline = `https://velyr.io/agent/${s}`
  const { open, close } = BADGE_MARKERS[variant === 'jsx' ? 'jsx' : 'html']
  if (variant === 'jsx') {
    const img = `https://velyr.io/api/agent/run?action=win_badge&slug=${s}`
    return `${open}\n<div style={{textAlign:'center',padding:'16px 0'}}><a href="${timeline}" target="_blank" rel="noopener noreferrer"><img src="${img}" alt="Optimized weekly by Velyr" width={320} height={64} loading="lazy" style={{display:'inline-block',border:0}}/></a></div>\n${close}`
  }
  const img = `https://velyr.io/api/agent/run?action=win_badge&amp;slug=${s}`
  return `${open}\n<style>@keyframes velyrBadgeIn{to{opacity:1}}</style>\n<div style="text-align:center;padding:16px 0;opacity:0;animation:velyrBadgeIn .6s ease .9s forwards"><a href="${timeline}" target="_blank" rel="noopener"><img src="${img}" alt="Optimized weekly by Velyr" width="320" height="64" loading="lazy" style="display:inline-block;border:0"></a></div>\n${close}`
}

function normWs(s) {
  return String(s ?? '').replace(/[ \t\r\n]+/g, ' ').trim()
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Decide what to do with the target file's current content.
// Anchor is </body> ONLY — the badge is a visual footer element; injecting into
// <head> (the posthog-inject fallback order) would be meaningless here. In the
// React layout shells </body> sits after {children}, which is exactly the
// bottom-of-page position we want.
//
// Returns exactly one of:
//   { action: 'skip' }                 — correct block (or a hand-pasted badge) already present
//   { action: 'inject',   newContent } — no block → insert before </body>
//   { action: 'reinject', newContent } — stale/edited block (e.g. old slug) → replace in place
//   { action: 'no_anchor' }            — nothing to anchor on; honest failure upstream
export function decideBadgeInjection(currentContent, expectedBlock, variant) {
  const content = String(currentContent ?? '')
  const { open, close } = BADGE_MARKERS[variant === 'jsx' ? 'jsx' : 'html']
  const blockRe = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`)
  const existing = content.match(blockRe)

  if (existing) {
    if (normWs(existing[0]) === normWs(expectedBlock)) return { action: 'skip' }
    return { action: 'reinject', newContent: content.replace(blockRe, expectedBlock) }
  }

  if (content.includes(BADGE_LOOSE_TOKEN)) return { action: 'skip' }

  const m = content.match(/<\/body>/i)
  if (!m || m.index == null) return { action: 'no_anchor' }
  return { action: 'inject', newContent: content.slice(0, m.index) + expectedBlock + '\n' + content.slice(m.index) }
}
