// Byte-for-byte parity guard (build gate). For every built blog article it proves
// that the crawler-visible fallback text inside dist/blog/<slug>/index.html is
// IDENTICAL to the contentHtml React renders (dist/blog/<slug>.json) — and to the
// inline <script id="blog-data"> payload on the page. Any drift = cloaking risk,
// so the build fails. This reads the actual built artifacts (not the source lib),
// so it catches template drift in the prerender step itself.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const BLOG_DIR = join(DIST, 'blog')

const START = '<!--blog-content-start-->'
const END = '<!--blog-content-end-->'

function extractFallback(html, slug) {
  const i = html.indexOf(START)
  const j = html.indexOf(END)
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`blog-parity: ${slug}: sentinel markers not found in index.html`)
  }
  return html.slice(i + START.length, j)
}

function extractInlineData(html, slug) {
  const m = html.match(/<script type="application\/json" id="blog-data">([\s\S]*?)<\/script>/)
  if (!m) throw new Error(`blog-parity: ${slug}: inline #blog-data script not found`)
  // Reverse the `<` → < script-safety escape before parsing.
  const json = m[1].replace(/\\u003c/g, '<')
  return JSON.parse(json)
}

if (!existsSync(BLOG_DIR)) {
  console.log('blog-parity: no dist/blog dir — nothing to check')
  process.exit(0)
}

const slugs = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))

let checked = 0
for (const slug of slugs) {
  const json = JSON.parse(readFileSync(join(BLOG_DIR, `${slug}.json`), 'utf8'))
  const htmlPath = join(BLOG_DIR, slug, 'index.html')
  if (!existsSync(htmlPath)) {
    throw new Error(`blog-parity: ${slug}: ${htmlPath} missing (JSON has no prerendered page)`)
  }
  const html = readFileSync(htmlPath, 'utf8')

  const fallback = extractFallback(html, slug)
  if (fallback !== json.contentHtml) {
    throw new Error(
      `blog-parity: ${slug}: fallback HTML ≠ JSON contentHtml (${fallback.length} vs ${json.contentHtml.length} bytes)`
    )
  }

  const inline = extractInlineData(html, slug)
  if (inline.contentHtml !== json.contentHtml) {
    throw new Error(`blog-parity: ${slug}: inline #blog-data contentHtml ≠ JSON contentHtml`)
  }

  checked++
}

console.log(`blog-parity: OK — ${checked} article(s) byte-for-byte identical across fallback, inline data, and JSON`)
