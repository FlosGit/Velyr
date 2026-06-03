// Author identity for the blog (E-E-A-T). Consumed by scripts/lib/blog.mjs to
// append the on-page bio block INTO the canonical contentHtml (so the bio sits
// inside the parity-checked string), and available to React if needed. The
// per-article `author` frontmatter string ("Velyr Team") is what drives the
// Organization author schema in prerender; this is the fuller on-page bio.
// Dependency-free, like src/data/faqs.js / blogClusters.js.
export const AUTHOR = {
  name: 'Velyr Team',
  bio:
    'The Velyr Team builds Velyr, an AI growth agent that ships one weekly conversion ' +
    'fix as a GitHub Pull Request. We write about conversion optimization, PostHog ' +
    'analytics, and shipping growth changes as code — for developers and founders who ' +
    'run their own product.',
  url: 'https://velyr.io',
}
