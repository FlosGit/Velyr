// Vite plugin that makes the generated blog JSON available in BOTH dev and build,
// without polluting the (committed) public/ dir or adding .gitignore entries —
// dist/ is already ignored, and dev is served from memory.
//
//   - dev   (configureServer): a middleware answers GET /blog-index.json and
//           GET /blog/<slug>.json by re-running loadArticles() per request, so
//           editing a markdown file is reflected on the next reload.
//   - build (generateBundle): emits the same JSON as assets into dist/.
//
// All real logic lives in scripts/lib/blog.mjs (the single source of truth that
// prerender.mjs also consumes). Only PUBLISHED articles are exposed.

import { loadArticles, toIndexEntry, toArticleJson } from './lib/blog.mjs'

const ARTICLE_RE = /^\/blog\/([a-z0-9][a-z0-9-]{1,70}[a-z0-9])\.json$/

export default function blogPlugin() {
  return {
    name: 'velyr-blog',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (url !== '/blog-index.json' && !ARTICLE_RE.test(url)) return next()

        let published
        try {
          ;({ published } = loadArticles())
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err.message || err) }))
          return
        }

        const send = (obj) => {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(obj))
        }

        if (url === '/blog-index.json') {
          send({ articles: published.map(toIndexEntry) })
          return
        }
        const slug = url.match(ARTICLE_RE)[1]
        const found = published.find((a) => a.slug === slug)
        if (!found) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }
        send(toArticleJson(found))
      })
    },

    generateBundle() {
      const { published } = loadArticles()
      this.emitFile({
        type: 'asset',
        fileName: 'blog-index.json',
        source: JSON.stringify({ articles: published.map(toIndexEntry) }),
      })
      for (const a of published) {
        this.emitFile({
          type: 'asset',
          fileName: `blog/${a.slug}.json`,
          source: JSON.stringify(toArticleJson(a)),
        })
      }
    },
  }
}
