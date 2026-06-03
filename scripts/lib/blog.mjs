// Shared, framework-free blog pipeline. The SINGLE source of truth consumed by:
//   - scripts/vite-plugin-blog.mjs  (dev middleware + build emit of JSON)
//   - scripts/prerender.mjs         (Stage 2: per-article HTML, sitemap, llms)
//   - scripts/assert-blog-parity.mjs(Stage 2: byte-for-byte fallback guard)
//
// loadArticles() reads content/blog/*.md, parses frontmatter (gray-matter),
// compiles the body (marked), assembles ONE canonical `contentHtml` string per
// article, validates everything, and returns published + all sets. Because every
// consumer renders the SAME `contentHtml`, the React page and the prerendered
// crawler fallback are byte-for-byte identical by construction (Stage 2 asserts
// it). Honest fail: any bad frontmatter / unresolved link / duplicate throws and
// breaks the build — there is no silent skip.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import matter from 'gray-matter'
import { marked } from 'marked'
import { CLUSTER_BY_SLUG } from '../../src/data/blogClusters.js'
import { AUTHOR } from '../../src/data/blogAuthor.js'
import { checkDuplicates } from './dedupe.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = join(__dirname, '..', '..', 'content', 'blog')
const ORIGIN = 'https://velyr.io'

const REQUIRED_FIELDS = ['title', 'slug', 'description', 'tldr', 'publishedAt', 'cluster', 'author']
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,70}[a-z0-9]$/

marked.setOptions({ gfm: true, breaks: false })

// HTML-escape values that we interpolate around the marked output. (marked
// escapes the body itself; this guards frontmatter-derived text.)
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Build date — overridable for deterministic tests. Date-only (UTC) compare.
function buildDate() {
  return (process.env.VELYR_BUILD_DATE || new Date().toISOString().slice(0, 10))
}

function formatDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  return `${months[(m || 1) - 1]} ${d}, ${y}`
}

// ── canonical contentHtml assembly ───────────────────────────────────────────
// Everything visible in the article. React renders this verbatim; prerender
// drops the SAME string into the display:none fallback. (The author bio block
// lands in Stage 4; for now the byline carries author identity.)
function assembleContentHtml(fm, bodyHtml, cluster, relatedResolved) {
  const clusterUrl = `/blog/category/${cluster.slug}`
  const updated =
    fm.updatedAt && fm.updatedAt !== fm.publishedAt
      ? ` · Updated <time datetime="${esc(fm.updatedAt)}">${esc(formatDate(fm.updatedAt))}</time>`
      : ''

  const breadcrumb =
    `<nav class="blog-breadcrumb" aria-label="Breadcrumb">` +
    `<a href="/">Home</a> › <a href="/blog">Blog</a> › ` +
    `<a href="${esc(clusterUrl)}">${esc(cluster.title)}</a> › ` +
    `<span aria-current="page">${esc(fm.title)}</span>` +
    `</nav>`

  const header =
    `<p class="blog-eyebrow"><a href="${esc(clusterUrl)}">${esc(cluster.title)}</a></p>` +
    `<h1>${esc(fm.title)}</h1>` +
    `<p class="blog-byline">By ${esc(fm.author)} · ` +
    `Published <time datetime="${esc(fm.publishedAt)}">${esc(formatDate(fm.publishedAt))}</time>${updated}</p>`

  const tldr =
    `<div class="blog-tldr"><span class="blog-tldr-label">TL;DR</span>` +
    `<p>${esc(fm.tldr)}</p></div>`

  const body = `<div class="blog-body">${bodyHtml}</div>`

  let faq = ''
  if (Array.isArray(fm.faqs) && fm.faqs.length) {
    const items = fm.faqs
      .map(
        (f) =>
          `<div class="blog-faq-item"><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`
      )
      .join('')
    faq = `<section class="blog-faq"><h2>Frequently asked questions</h2>${items}</section>`
  }

  let related = ''
  if (relatedResolved.length) {
    const links = relatedResolved
      .map((r) => `<li><a href="/blog/${esc(r.slug)}">${esc(r.title)}</a></li>`)
      .join('')
    related = `<section class="blog-related"><h2>Keep reading</h2><ul>${links}</ul></section>`
  }

  // Author bio (E-E-A-T) — inside contentHtml so it lives in the parity-checked
  // string and renders identically in React + the crawler fallback.
  const authorBio =
    `<aside class="blog-author">` +
    `<p class="blog-author-name">Written by ${esc(AUTHOR.name)}</p>` +
    `<p class="blog-author-bio">${esc(AUTHOR.bio)}</p>` +
    `</aside>`

  const cta =
    `<div class="blog-cta">` +
    `<p>Velyr is an AI growth agent that ships one weekly conversion fix as a GitHub Pull Request — you approve it over Telegram, and it rolls itself back if the numbers drop.</p>` +
    `<a class="blog-cta-btn" href="/agent/register">Start the Growth Agent</a>` +
    `</div>`

  return (
    `<article class="blog-article">` +
    breadcrumb + header + tldr + body + faq + related + authorBio + cta +
    `</article>`
  )
}

// ── load + validate ──────────────────────────────────────────────────────────
export function loadArticles() {
  if (!existsSync(CONTENT_DIR)) {
    return { published: [], all: [], today: buildDate() }
  }

  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))
  const today = buildDate()
  const all = []
  const seenSlug = new Map()

  for (const file of files) {
    const raw = readFileSync(join(CONTENT_DIR, file), 'utf8')
    const { data: fm, content: body } = matter(raw)

    // Required-field gate.
    for (const field of REQUIRED_FIELDS) {
      if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
        throw new Error(`blog: ${file} is missing required frontmatter field "${field}"`)
      }
    }
    if (!SLUG_RE.test(fm.slug)) {
      throw new Error(`blog: ${file} has invalid slug "${fm.slug}" (expected kebab-case, 3–72 chars)`)
    }
    if (seenSlug.has(fm.slug)) {
      throw new Error(`blog: duplicate slug "${fm.slug}" in ${file} and ${seenSlug.get(fm.slug)}`)
    }
    seenSlug.set(fm.slug, file)

    const cluster = CLUSTER_BY_SLUG[fm.cluster]
    if (!cluster) {
      throw new Error(`blog: ${file} has unknown cluster "${fm.cluster}" (see src/data/blogClusters.js)`)
    }

    all.push({
      file,
      fm,
      body,
      cluster,
      slug: fm.slug,
      schemaType: fm.schemaType || cluster.schemaType,
      isPublished: String(fm.publishedAt) <= today,
    })
  }

  // Related-slug resolution: every `related` entry must exist in `all` (typo
  // guard → fail). The VISIBLE related list later uses only published targets.
  const bySlug = new Map(all.map((a) => [a.slug, a]))
  for (const a of all) {
    const related = Array.isArray(a.fm.related) ? a.fm.related : []
    for (const rs of related) {
      if (!bySlug.has(rs)) {
        throw new Error(`blog: ${a.file} lists related slug "${rs}" which does not resolve to any article`)
      }
    }
  }

  // Compile body + assemble canonical contentHtml for every article.
  for (const a of all) {
    const bodyHtml = marked.parse(a.body)
    const relatedResolved = (Array.isArray(a.fm.related) ? a.fm.related : [])
      .map((rs) => bySlug.get(rs))
      .filter((r) => r && r.isPublished)
      .map((r) => ({ slug: r.slug, title: r.fm.title }))
    a.contentHtml = assembleContentHtml(a.fm, bodyHtml, a.cluster, relatedResolved)
  }

  // Near-duplicate gate (warns/fails; see dedupe.mjs).
  const { warnings } = checkDuplicates(all.map((a) => ({ slug: a.slug, contentHtml: a.contentHtml })))
  for (const w of warnings) console.warn(`blog[dedupe]: ${w}`)

  // Newest first.
  all.sort((x, y) => String(y.fm.publishedAt).localeCompare(String(x.fm.publishedAt)))
  const published = all.filter((a) => a.isPublished)

  return { published, all, today }
}

// ── serialization helpers (shared by the Vite plugin + prerender) ─────────────
export function toIndexEntry(a) {
  return {
    slug: a.slug,
    title: a.fm.title,
    description: a.fm.description,
    cluster: a.cluster.slug,
    clusterTitle: a.cluster.title,
    tags: Array.isArray(a.fm.tags) ? a.fm.tags : [],
    publishedAt: a.fm.publishedAt,
    updatedAt: a.fm.updatedAt || a.fm.publishedAt,
  }
}

export function toArticleJson(a) {
  return {
    slug: a.slug,
    title: a.fm.title,
    description: a.fm.description,
    tldr: a.fm.tldr,
    cluster: a.cluster.slug,
    clusterTitle: a.cluster.title,
    tags: Array.isArray(a.fm.tags) ? a.fm.tags : [],
    publishedAt: a.fm.publishedAt,
    updatedAt: a.fm.updatedAt || a.fm.publishedAt,
    author: a.fm.author,
    schemaType: a.schemaType,
    faqs: Array.isArray(a.fm.faqs) ? a.fm.faqs : [],
    canonical: `${ORIGIN}/blog/${a.slug}`,
    contentHtml: a.contentHtml,
  }
}

export { ORIGIN }
