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
import { loadArticles, toArticleJson } from './lib/blog.mjs'
import { CLUSTERS } from '../src/data/blogClusters.js'
import { submitToIndexNow } from '../src/utils/indexNow.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const ORIGIN = 'https://velyr.io'

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// display:none so JS visitors never see a flash of the fallback before React
// mounts; raw-HTML crawlers ignore CSS and still read the text, and Googlebot
// renders the real React app. Keep in sync with the fallback in index.html.
const MAIN_OPEN =
  '<main style="display:none;max-width:680px;margin:0 auto;padding:80px 24px;font-family:Jost,system-ui,sans-serif;color:#1c1917;background:#f7f4ef">'
const H1 = (t) =>
  `<h1 style="font-family:Cormorant Garant,Georgia,serif;font-weight:300;font-size:48px;line-height:1.1;letter-spacing:-.025em;margin:16px 0">${esc(t)}</h1>`
const HOME_LINK =
  '<p style="margin-top:32px"><a href="/" style="color:#2a5c45">← Back to Velyr</a></p>'

function faqFallback() {
  const items = FAQS.map(
    (f) =>
      `<h2 style="font-family:Cormorant Garant,Georgia,serif;font-weight:400;font-size:22px;margin:32px 0 8px">${esc(f.q)}</h2><p style="font-size:15px;line-height:1.78;color:#6b6460">${esc(f.a)}</p>`
  ).join('')
  return `<div id="root">${MAIN_OPEN}${H1('Frequently Asked Questions')}<p style="font-size:16px;color:#6b6460;max-width:640px">Common questions about the Velyr Growth Agent — how it ships weekly conversion fixes to your GitHub repo or Shopify store, the approval and rollback model, and the 14-day free trial.</p>${items}${HOME_LINK}</main></div>`
}

function legalFallback(title, intro) {
  return `<div id="root">${MAIN_OPEN}${H1(title)}<p style="font-size:16px;line-height:1.78;color:#6b6460;max-width:640px">${esc(intro)}</p>${HOME_LINK}</main></div>`
}

// Crawler fallback for /code-vs-overlay — mirrors the page's core argument in
// plain HTML. Keep the claims in sync with src/pages/CodeVsOverlay.jsx.
function compareFallback() {
  const h2 = (t) =>
    `<h2 style="font-family:Cormorant Garant,Georgia,serif;font-weight:400;font-size:22px;margin:32px 0 8px">${esc(t)}</h2>`
  const p = (t) => `<p style="font-size:15px;line-height:1.78;color:#6b6460">${esc(t)}</p>`
  const body = [
    p('AI conversion tools apply changes to your site in one of two fundamentally different ways. The difference decides what you actually own — and what happens the day you cancel.'),
    h2('How overlay tools work'),
    p('Most AI conversion-optimization platforms install a JavaScript snippet that rewrites parts of the page in the visitor’s browser on every load. Installation is one script tag and experiments ship instantly — but the changes live in the vendor’s script, not in your site: cancel the subscription and every improvement disappears. Runtime rewriting happens after your page renders (flicker, layout shift, another third-party script), search engines mostly read your original served HTML, and redesigns break overlays silently.'),
    h2('How code-level changes work'),
    p('The alternative is to change the source itself: a Pull Request on your GitHub repository, or an edit to your Shopify theme files. You own every line permanently — version-controlled, reviewable, revertible, still yours if you cancel. There is no runtime dependency, crawlers see the improved page, and every change is a readable diff you approve before it ships. The honest trade-offs: it requires repo or store access, ships at deploy pace rather than instantly, and cannot run dozens of parallel A/B variants.'),
    h2('When an overlay tool is the better fit'),
    p('Enterprise sites with heavy traffic and a dedicated CRO team running many parallel experiments are what overlay experimentation platforms are built for. Velyr is built for the opposite case: indie founders, small SaaS teams, and store owners who want one well-evidenced improvement a week that they own forever.'),
    h2('How Velyr ships code'),
    p('Every week, Velyr reads your PostHog analytics, scans your pages, and writes the single highest-impact conversion fix as a GitHub Pull Request or a staged Shopify theme change. You approve or skip with one tap in Telegram or from the dashboard — nothing ships without your YES. After a fix ships, Velyr compares bounce rate in the 48 hours after against the 48 hours before and proposes a rollback if the numbers got worse. €49/month after a 14-day free trial; every fix is code you keep.'),
  ].join('')
  return `<div id="root">${MAIN_OPEN}${H1('Overlay scripts vs. real code')}${body}${HOME_LINK}</main></div>`
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
      'Frequently asked questions about Velyr — how the AI growth agent ships weekly conversion fixes to your GitHub repo or Shopify store, the approval and 48h rollback model, supported platforms, and the 14-day free trial.',
    fallback: faqFallback(),
    jsonLd: faqJsonLd,
  },
  {
    dir: 'code-vs-overlay',
    path: '/code-vs-overlay',
    title: 'Overlay Scripts vs. Real Code — How AI CRO Tools Apply Changes | Velyr',
    description:
      'How AI conversion tools apply changes: JavaScript overlay scripts vs real code changes (GitHub Pull Requests, Shopify theme edits). Latency, SEO visibility, code ownership — and what happens to the improvements when you cancel.',
    fallback: compareFallback(),
  },
  {
    dir: 'privacy',
    path: '/privacy',
    title: 'Privacy Policy — Velyr',
    description:
      'How Velyr collects, uses, and protects your data — including PostHog analytics and GitHub repository access.',
    robots: 'noindex, nofollow',
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
      'Velyr terms and conditions (AGB) for the €49/month AI growth agent subscription, including the 14-day free trial and cancellation.',
    robots: 'noindex, nofollow',
    fallback: legalFallback(
      'Terms & Conditions',
      'The terms governing your use of Velyr, the €49/month AI growth agent subscription, the 14-day free trial, billing, and cancellation.'
    ),
  },
  {
    dir: 'impressum',
    path: '/impressum',
    title: 'Imprint — Velyr',
    description: 'Imprint for Velyr.',
    robots: 'noindex, nofollow',
    fallback: legalFallback(
      'Imprint',
      'Imprint and provider identification for Velyr in accordance with German law.'
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

  // robots — legal pages opt out of indexing (default index.html stays index,follow)
  if (r.robots) html = replaceContentAttr(html, 'name="robots"', r.robots)

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

// ── Blog ──────────────────────────────────────────────────────────────────────
// Per-article static HTML (crawler fallback = the SAME canonical contentHtml that
// React renders, wrapped in sentinel comments so assert-blog-parity.mjs can prove
// byte-for-byte identity), plus blog index, cluster pages, generated sitemap, and
// llms-full.txt. All driven by scripts/lib/blog.mjs (single source of truth).

const BLOG_CONTENT_START = '<!--blog-content-start-->'
const BLOG_CONTENT_END = '<!--blog-content-end-->'

const BLOG_MAIN_OPEN =
  '<main style="display:none;max-width:760px;margin:0 auto;padding:80px 24px;font-family:Jost,system-ui,sans-serif;color:#1c1917;background:#f7f4ef">'

// Build date (date-only, UTC), overridable for deterministic tests — mirrors the
// same logic in scripts/lib/blog.mjs so the publish gate and sitemap agree.
const today = () => process.env.VELYR_BUILD_DATE || new Date().toISOString().slice(0, 10)

// Embed a string inside a <script> safely: escape `<` so a `</script>` (or any
// markup) inside JSON / JSON-LD can never break out of the element.
const scriptSafe = (s) => String(s).replace(/</g, '\\u003c')

// All injections below use the function form of String.replace so `$` sequences
// in article content (HogQL `$pathname`, FAQ "$99/mo", …) are emitted literally
// and never interpreted as replacement patterns.
function transformPage(base, { url, title, description, headTags = [], fallback }) {
  let html = base
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`)
  html = replaceContentAttr(html, 'name="description"', description)
  html = replaceContentAttr(html, 'property="og:description"', description)
  html = replaceContentAttr(html, 'name="twitter:description"', description)
  html = replaceContentAttr(html, 'property="og:title"', title)
  html = replaceContentAttr(html, 'name="twitter:title"', title)
  html = setRootHref(html, 'rel="canonical"', url)
  html = setRootHref(html, 'hreflang="en"', url)
  html = setRootHref(html, 'hreflang="x-default"', url)
  html = replaceContentAttr(html, 'property="og:url"', url)
  if (headTags.length) {
    const block = headTags.join('\n    ')
    html = html.replace('</head>', () => `    ${block}\n  </head>`)
  }
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/, () => fallback)
  return html
}

const ldScript = (id, obj) =>
  `<script type="application/ld+json" id="${id}">${scriptSafe(JSON.stringify(obj))}</script>`

function articleJsonLd(a) {
  // Organizational author ("Velyr Team"); publisher stays the Velyr Organization.
  const author = { '@type': 'Organization', name: a.author }
  return {
    '@context': 'https://schema.org',
    '@type': a.schemaType, // 'Article' | 'TechArticle' (per-cluster default)
    headline: a.title,
    description: a.description,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt,
    author,
    publisher: {
      '@type': 'Organization',
      name: 'Velyr',
      url: ORIGIN,
      logo: { '@type': 'ImageObject', url: ORIGIN + '/og-image.png' },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.canonical },
    image: ORIGIN + '/og-image.png',
    inLanguage: 'en',
  }
}

const faqJsonLdFor = (faqs) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
})

const breadcrumbJsonLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: it.url,
  })),
})

const { published } = loadArticles()
const clustersWithPosts = CLUSTERS.filter((c) => published.some((a) => a.cluster.slug === c.slug))

// --- individual articles ---
let blogCount = 0
const indexNowUrls = []
for (const article of published) {
  const a = toArticleJson(article)
  const url = a.canonical
  indexNowUrls.push(url)
  const cluster = article.cluster

  const headTags = [
    ldScript('article-jsonld', articleJsonLd(a)),
    a.faqs.length ? ldScript('faqpage-jsonld', faqJsonLdFor(a.faqs)) : '',
    ldScript('breadcrumb-jsonld', breadcrumbJsonLd([
      { name: 'Home', url: ORIGIN + '/' },
      { name: 'Blog', url: ORIGIN + '/blog' },
      { name: cluster.title, url: `${ORIGIN}/blog/category/${cluster.slug}` },
      { name: a.title, url },
    ])),
    // Inline data so a direct landing renders instantly (no fetch waterfall);
    // React matches on slug and falls back to fetching for in-SPA navigations.
    `<script type="application/json" id="blog-data">${scriptSafe(JSON.stringify(a))}</script>`,
  ].filter(Boolean)

  const fallback =
    `<div id="root">${BLOG_MAIN_OPEN}${BLOG_CONTENT_START}${a.contentHtml}${BLOG_CONTENT_END}</main></div>`

  const html = transformPage(base, { url, title: `${a.title} — Velyr Blog`, description: a.description, headTags, fallback })
  const outDir = join(DIST, 'blog', a.slug)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')
  blogCount++
}

// Notify IndexNow (Bing/Yandex) about all published articles once per deploy.
// Fire-and-forget: never awaited and errors are swallowed so it can't block or
// break the build. The blog index itself is included so the listing re-crawls too.
submitToIndexNow([ORIGIN + '/blog', ...indexNowUrls]).catch(() => {})

// --- blog index ---
{
  const url = ORIGIN + '/blog'
  const title = 'Velyr Blog — Conversion Optimization for Developers'
  const description =
    'Practical, sourced guides on conversion optimization, PostHog analysis, Core Web Vitals, and shipping growth fixes as code — for developers and founders.'
  const listByCluster = clustersWithPosts
    .map((c) => {
      const items = published
        .filter((a) => a.cluster.slug === c.slug)
        .map((a) => `<li><a href="/blog/${esc(a.slug)}">${esc(a.fm.title)}</a> — ${esc(a.fm.description)}</li>`)
        .join('')
      return `<h2 style="font-family:Cormorant Garant,Georgia,serif;font-weight:400;font-size:22px;margin:32px 0 8px">${esc(c.title)}</h2><ul style="line-height:1.78;color:#6b6460;font-size:15px;padding-left:20px">${items}</ul>`
    })
    .join('')
  const fallback =
    `<div id="root">${BLOG_MAIN_OPEN}` +
    `<p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#2a5c45">Velyr Blog</p>` +
    H1('The Velyr Blog') +
    `<p style="font-size:16px;color:#6b6460;max-width:640px">${esc(description)}</p>` +
    listByCluster + HOME_LINK + `</main></div>`
  const headTags = [ldScript('breadcrumb-jsonld', breadcrumbJsonLd([
    { name: 'Home', url: ORIGIN + '/' },
    { name: 'Blog', url },
  ]))]
  const html = transformPage(base, { url, title, description, headTags, fallback })
  const outDir = join(DIST, 'blog')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')
}

// --- cluster (category) pages — only clusters that have published articles ---
for (const c of clustersWithPosts) {
  const url = `${ORIGIN}/blog/category/${c.slug}`
  const title = `${c.title} — Velyr Blog`
  const items = published
    .filter((a) => a.cluster.slug === c.slug)
    .map((a) => `<li><a href="/blog/${esc(a.slug)}">${esc(a.fm.title)}</a> — ${esc(a.fm.description)}</li>`)
    .join('')
  const fallback =
    `<div id="root">${BLOG_MAIN_OPEN}` +
    `<nav style="font-size:13px;color:#a09890"><a href="/" style="color:#2a5c45">Home</a> › <a href="/blog" style="color:#2a5c45">Blog</a> › ${esc(c.title)}</nav>` +
    H1(c.title) +
    `<p style="font-size:16px;color:#6b6460;max-width:640px">${esc(c.description)}</p>` +
    `<ul style="line-height:1.78;color:#6b6460;font-size:15px;padding-left:20px;margin-top:24px">${items}</ul>` +
    HOME_LINK + `</main></div>`
  const headTags = [ldScript('breadcrumb-jsonld', breadcrumbJsonLd([
    { name: 'Home', url: ORIGIN + '/' },
    { name: 'Blog', url: ORIGIN + '/blog' },
    { name: c.title, url },
  ]))]
  const html = transformPage(base, { url, title, description: c.description, headTags, fallback })
  const outDir = join(DIST, 'blog', 'category', c.slug)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')
}

// --- generated sitemap.xml (replaces the former hand-maintained public file) ---
// The legal pages (/privacy, /agb, /impressum) are deliberately excluded: they
// are noindex,nofollow (see ROUTES above), so listing them in the sitemap would
// be a contradictory crawl signal.
const STATIC_URLS = [
  { loc: ORIGIN + '/', lastmod: '2026-06-02', changefreq: 'weekly', priority: '1.0' },
  { loc: ORIGIN + '/faq', lastmod: '2026-06-02', changefreq: 'weekly', priority: '0.8' },
  { loc: ORIGIN + '/code-vs-overlay', lastmod: '2026-07-11', changefreq: 'monthly', priority: '0.7' },
]
const blogUrls = [
  { loc: ORIGIN + '/blog', lastmod: today(), changefreq: 'daily', priority: '0.7' },
  ...clustersWithPosts.map((c) => ({
    loc: `${ORIGIN}/blog/category/${c.slug}`,
    lastmod: today(),
    changefreq: 'weekly',
    priority: '0.5',
  })),
  ...published.map((a) => ({
    loc: `${ORIGIN}/blog/${a.slug}`,
    lastmod: a.fm.updatedAt || a.fm.publishedAt,
    changefreq: 'monthly',
    priority: '0.6',
  })),
]
const allUrls = [...STATIC_URLS, ...blogUrls]

// Guard: the indexable static URLs (/ and /faq) must never silently drop out.
const locSet = new Set(allUrls.map((u) => u.loc))
for (const s of STATIC_URLS) {
  if (!locSet.has(s.loc)) throw new Error(`sitemap: required static URL missing: ${s.loc}`)
}

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  allUrls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n') +
  `\n</urlset>\n`
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8')

// --- llms-full.txt: machine-readable index of all published articles ---
const llmsFull =
  `# Velyr Blog — Full Index\n\n` +
  `> Every published article on the Velyr blog. Velyr is an AI growth agent that ships one weekly conversion fix — a GitHub Pull Request on your repo or a direct change to your Shopify theme. These guides cover conversion optimization, PostHog analysis, Core Web Vitals, and shipping growth fixes as code.\n\n` +
  clustersWithPosts
    .map((c) => {
      const items = published
        .filter((a) => a.cluster.slug === c.slug)
        .map((a) => `- [${a.fm.title}](${ORIGIN}/blog/${a.slug}): ${a.fm.description}`)
        .join('\n')
      return `## ${c.title}\n${items}`
    })
    .join('\n\n') +
  `\n`
writeFileSync(join(DIST, 'llms-full.txt'), llmsFull, 'utf8')

console.log(
  `prerender: wrote ${blogCount} blog articles, blog index, ${clustersWithPosts.length} cluster pages, sitemap.xml (${allUrls.length} urls), llms-full.txt`
)
