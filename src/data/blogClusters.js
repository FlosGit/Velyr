// Single source of truth for the blog's topic-cluster architecture.
// Consumed by BOTH the Node build pipeline (scripts/lib/blog.mjs — validation +
// category pages + sitemap) AND the React blog pages (src/pages/Blog*.jsx).
// Keep it dependency-free (no JSX, no imports) so the Node scripts can import it
// directly, exactly like src/data/faqs.js.
//
// `schemaType` is the per-cluster default Article subtype for JSON-LD
// (TechArticle for hands-on/technical clusters, Article for definitional/
// editorial clusters). A single article may override it via frontmatter.
export const CLUSTERS = [
  {
    slug: 'framework-fixes',
    title: 'Framework Conversion Fixes',
    description:
      'Framework-specific conversion fixes for Next.js, React, Astro, SvelteKit, Remix, Nuxt, Vue, and plain HTML sites — hero, CTA, pricing, forms, and mobile.',
    intent: 'How do I improve conversion on my [framework] [surface]?',
    schemaType: 'TechArticle',
  },
  {
    slug: 'posthog-recipes',
    title: 'PostHog Analysis Recipes',
    description:
      'Step-by-step PostHog recipes — funnels, scroll depth, drop-off, CTA clicks, and before/after deploy comparisons, with runnable HogQL and insight configs.',
    intent: 'How do I measure [X] in PostHog?',
    schemaType: 'TechArticle',
  },
  {
    slug: 'benchmarks',
    title: 'Conversion Benchmarks',
    description:
      'Honest, sourced conversion benchmarks for SaaS and developer tools — landing page conversion rate, bounce rate, scroll depth, trial-to-paid, and more.',
    intent: 'What is a good [metric] for [niche]?',
    schemaType: 'Article',
  },
  {
    slug: 'core-web-vitals',
    title: 'Core Web Vitals & Conversion',
    description:
      'How Core Web Vitals (LCP, CLS, INP) affect conversion, and how to fix them in React, Next.js, and other modern frameworks.',
    intent: 'Does [CWV metric] affect conversion / how do I fix it in [framework]?',
    schemaType: 'TechArticle',
  },
  {
    slug: 'concepts',
    title: 'CRO Concepts & Glossary',
    description:
      'Plain-language definitions of conversion, CRO, AEO, micro-conversions, funnels, bounce vs. exit rate, and the rest of the growth vocabulary.',
    intent: 'What is [term]?',
    schemaType: 'Article',
  },
  {
    slug: 'automation',
    title: 'AI Agents & PR Automation',
    description:
      'How AI agents open pull requests, the approval-gate pattern, and safely automating conversion fixes and rollbacks inside a GitHub + Vercel workflow.',
    intent: 'How do I automate [X] with pull requests / an AI agent?',
    schemaType: 'TechArticle',
  },
  {
    slug: 'experimentation',
    title: 'A/B Testing & Experimentation',
    description:
      'Lightweight experimentation for developers — A/B testing without heavy tooling, statistical significance, and sample-size questions.',
    intent: 'How do I A/B test [framework] / is my result significant?',
    schemaType: 'TechArticle',
  },
  {
    slug: 'comparisons',
    title: 'Comparisons & Alternatives',
    description:
      'Honest comparisons for conversion-minded developers — analytics tools, testing platforms, and CRO approaches, with the tradeoffs spelled out.',
    intent: '[X] vs. [Y] for conversion / best [tool] for developers?',
    schemaType: 'Article',
  },
  {
    slug: 'patterns',
    title: 'Landing Page Patterns',
    description:
      'Landing page patterns and teardowns — hero sections, pricing layouts, CTA counts, and the structures that convert for developer tools and SaaS.',
    intent: '[section] best practices for SaaS?',
    schemaType: 'Article',
  },
  {
    slug: 'playbooks',
    title: 'Founder Growth Playbooks',
    description:
      'Conversion and growth playbooks for solo founders and indie hackers — first signups, lightweight CRO, and doing it without an agency.',
    intent: 'How do I [growth task] as a solo founder?',
    schemaType: 'Article',
  },
]

// Lookup map: slug -> cluster object.
export const CLUSTER_BY_SLUG = Object.fromEntries(CLUSTERS.map((c) => [c.slug, c]))

export const CLUSTER_SLUGS = CLUSTERS.map((c) => c.slug)
