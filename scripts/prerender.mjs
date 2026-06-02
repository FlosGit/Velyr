// Static, dependency-free prerender step. Runs AFTER `vite build` (see the
// "build" script in package.json). For each non-root route it writes a
// dist/<route>/index.html derived from the built dist/index.html, with:
//   - route-specific <title>, meta description, canonical + hreflang, OG/Twitter
//   - route-specific crawler-visible fallback inside <div id="root">
//   - route-specific JSON-LD (FAQPage for /faq)
//
// Why this and not a headless-browser prerender: Vercel's Linux build has no
// local Chrome, and the app reads window/localStorage at render time so it is
// not SSR-safe. Pure string templating works everywhere and never breaks the
// deploy. Vercel serves these files directly because static files take priority
// over the SPA rewrite in vercel.json (/(.*) -> /index.html).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FAQS } from '../src/data/faqs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const ORIGIN = 'https://velyr.io'

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const MAIN_OPEN =
  '<main style="max-width:680px;margin:0 auto;padding:80px 24px;font-family:Jost,system-ui,sans-serif;color:#1c1917;background:#f7f4ef">'
const H1 = (t) =>
  `<h1 style="font-family:Cormorant Garant,Georgia,serif;font-weight:300;font-size:48px;line-height:1.1;letter-spacing:-.025em;margin:16px 0">${esc(t)}</h1>`
const HOME_LINK =
  '<p style="margin-top:32px"><a href="/" style="color:#2a5c45">← Back to Velyr</a></p>'

function faqFallback() {
  const items = FAQS.map(
    (f) =>
      `<h2 style="font-family:Cormorant Garant,Georgia,serif;font-weight:400;font-size:22px;margin:32px 0 8px">${esc(f.q)}</h2><p style="font-size:15px;line-height:1.78;color:#6b6460">${esc(f.a)}</p>`
  ).join('')
  return `<div id="root">${MAIN_OPEN}${H1('Frequently Asked Questions')}<p style="font-size:16px;color:#6b6460;max-width:640px">Common questions about the Velyr Growth Agent — how it ships weekly conversion fixes as GitHub Pull Requests, the approval and rollback model, and the 14-day free trial.</p>${items}${HOME_LINK}</main></div>`
}

function legalFallback(title, intro) {
  return `<div id="root">${MAIN_OPEN}${H1(title)}<p style="font-size:16px;line-height:1.78;color:#6b6460;max-width:640px">${esc(intro)}</p>${HOME_LINK}</main></div>`
}

const faqJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
})

const ROUTES = [
  {
    dir: 'faq',
    path: '/faq',
    title: 'FAQ — Velyr Growth Agent',
    description:
      'Frequently asked questions about Velyr — how the AI growth agent ships weekly conversion fixes as GitHub Pull Requests, the approval and 48h rollback model, supported frameworks, and the 14-day free trial.',
    fallback: faqFallback(),
    jsonLd: faqJsonLd,
  },
  {
    dir: 'privacy',
    path: '/privacy',
    title: 'Privacy Policy — Velyr',
    description:
      'How Velyr collects, uses, and protects your data — including PostHog analytics and GitHub repository access.',
    fallback: legalFallback(
      'Privacy Policy',
      'This page explains what data Velyr processes, why, and your rights. Velyr uses PostHog (US-hosted) for analytics with your consent and accesses your GitHub repository only to propose changes as Pull Requests you approve.'
    ),
  },
  {
    dir: 'agb',
    path: '/agb',
    title: 'Terms & Conditions (AGB) — Velyr',
    description:
      'Velyr terms and conditions (AGB) for the €29/month AI growth agent subscription, including the 14-day free trial and cancellation.',
    fallback: legalFallback(
      'Terms & Conditions',
      'The terms governing your use of Velyr, the €29/month AI growth agent subscription, the 14-day free trial, billing, and cancellation.'
    ),
  },
  {
    dir: 'impressum',
    path: '/impressum',
    title: 'Impressum — Velyr',
    description: 'Legal notice (Impressum) for Velyr.',
    fallback: legalFallback(
      'Impressum',
      'Legal notice and provider identification for Velyr in accordance with German law.'
    ),
  },
]

// --- transform helpers (operate on the built dist/index.html) -----------------

const base = readFileSync(join(DIST, 'index.html'), 'utf8')

function replaceContentAttr(html, matchAttr, value) {
  // Replaces the content="..." of a tag identified by a leading attribute match,
  // e.g. matchAttr = 'name="description"' or 'property="og:title"'.
  const re = new RegExp(`(<meta[^>]*${matchAttr}[^>]*content=")[^"]*(")`)
  return html.replace(re, (_m, p1, p2) => p1 + esc(value) + p2)
}

function setRootHref(html, linkMatch, href) {
  // Repoints a <link ... href="https://velyr.io/"> for canonical / hreflang.
  const re = new RegExp(`(<link[^>]*${linkMatch}[^>]*href=")https://velyr\\.io/(")`)
  return html.replace(re, (_m, p1, p2) => p1 + href + p2)
}

for (const r of ROUTES) {
  const url = ORIGIN + r.path
  let html = base

  // <title>
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(r.title)}</title>`)

  // meta description (name + OG + Twitter)
  html = replaceContentAttr(html, 'name="description"', r.description)
  html = replaceContentAttr(html, 'property="og:description"', r.description)
  html = replaceContentAttr(html, 'name="twitter:description"', r.description)

  // titles (OG + Twitter)
  html = replaceContentAttr(html, 'property="og:title"', r.title)
  html = replaceContentAttr(html, 'name="twitter:title"', r.title)

  // canonical + og:url + hreflang -> route URL
  html = setRootHref(html, 'rel="canonical"', url)
  html = setRootHref(html, 'hreflang="en"', url)
  html = setRootHref(html, 'hreflang="x-default"', url)
  html = replaceContentAttr(html, 'property="og:url"', url)

  // route-specific JSON-LD (injected before </head>)
  if (r.jsonLd) {
    const tag = `<script type="application/ld+json" id="faq-jsonld">${r.jsonLd}</script>`
    html = html.replace('</head>', `    ${tag}\n  </head>`)
  }

  // crawler-visible fallback body
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/, r.fallback)

  const outDir = join(DIST, r.dir)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')
  console.log(`prerendered ${r.path} -> dist/${r.dir}/index.html`)
}

console.log(`prerender: wrote ${ROUTES.length} routes`)
