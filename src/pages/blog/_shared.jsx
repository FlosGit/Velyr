// Shared chrome + head helpers for the blog sub-app. Tokens and the nav/footer
// pattern are lifted from src/pages/Faq.jsx so the blog matches the rest of the
// site without a component library. Used by BlogIndex / BlogCategory /
// BlogArticle. The JSON-LD builders mirror scripts/prerender.mjs so the React
// page updates the SAME stable-id <script> tags the prerender already wrote —
// never a duplicate block.

export const ORIGIN = 'https://velyr.io'

export const C = {
  bg: '#f7f4ef',
  ink: '#1c1917',
  muted: '#6b6460',
  faint: '#a09890',
  green: '#2a5c45',
  greenDark: '#1e4433',
  border: 'rgba(28,25,23,0.08)',
  card: '#ffffff',
}

// Typography + styling for the dangerouslySetInnerHTML article body (targets the
// .blog-* classes baked into contentHtml by scripts/lib/blog.mjs) plus index /
// category chrome.
export const BLOG_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: ${C.bg}; color: ${C.ink}; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  .blog-wrap { max-width: 760px; margin: 0 auto; padding: 56px 24px 96px; }
  .blog-wrap h1 { font-family: 'Cormorant Garamond', serif; font-weight: 300; font-size: clamp(32px, 5vw, 52px); letter-spacing: -.025em; line-height: 1.1; word-break: break-word; margin: 14px 0 18px; }
  .blog-wrap h2 { font-family: 'Cormorant Garamond', serif; font-weight: 400; font-size: 26px; letter-spacing: -.015em; margin: 40px 0 14px; color: ${C.ink}; word-break: break-word; }
  .blog-wrap h3 { font-family: 'Jost', sans-serif; font-weight: 500; font-size: 17px; margin: 26px 0 8px; color: ${C.ink}; }
  .blog-wrap p, .blog-wrap li { color: ${C.muted}; line-height: 1.78; font-size: 16px; font-weight: 300; overflow-wrap: anywhere; }
  .blog-wrap ul, .blog-wrap ol { padding-left: 22px; margin: 12px 0; }
  .blog-wrap li { margin: 6px 0; }
  .blog-wrap a { color: ${C.green}; text-decoration: underline; text-decoration-color: rgba(42,92,69,0.35); transition: color .2s; word-break: break-word; }
  .blog-wrap a:hover { color: ${C.greenDark}; }
  .blog-wrap strong { color: ${C.ink}; font-weight: 500; }

  .blog-breadcrumb { font-size: 12.5px; color: ${C.faint}; margin-bottom: 20px; }
  .blog-eyebrow { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; font-weight: 400; }
  .blog-eyebrow a { text-decoration: none; color: ${C.green}; }
  .blog-byline { font-size: 13.5px; color: ${C.faint}; margin: 0 0 28px; }

  .blog-tldr { background: ${C.card}; border: 1px solid ${C.border}; border-left: 3px solid ${C.green}; border-radius: 12px; padding: 18px 20px; margin: 0 0 32px; }
  .blog-tldr-label { display: inline-block; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: ${C.green}; font-weight: 500; margin-bottom: 6px; }
  .blog-tldr p { font-size: 16px; color: ${C.ink}; line-height: 1.7; }

  .blog-body pre { background: #1c1917; color: #f7f4ef; border-radius: 10px; padding: 16px 18px; overflow-x: auto; margin: 18px 0; font-size: 13.5px; line-height: 1.6; }
  .blog-body pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
  .blog-body code { background: rgba(28,25,23,0.06); border-radius: 5px; padding: 1px 5px; font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .blog-body table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14.5px; }
  .blog-body th, .blog-body td { border: 1px solid ${C.border}; padding: 8px 12px; text-align: left; color: ${C.muted}; }
  .blog-body th { background: rgba(28,25,23,0.03); color: ${C.ink}; font-weight: 500; }
  .blog-body blockquote { border-left: 3px solid ${C.border}; padding: 4px 0 4px 18px; margin: 18px 0; color: ${C.faint}; font-style: italic; }

  .blog-faq { margin-top: 48px; border-top: 1px solid ${C.border}; padding-top: 8px; }
  .blog-faq-item { margin-top: 24px; }
  .blog-related { margin-top: 48px; }
  .blog-related ul { list-style: none; padding-left: 0; }
  .blog-related li { margin: 8px 0; }

  .blog-author { margin-top: 44px; padding: 18px 20px; background: rgba(28,25,23,0.025); border: 1px solid ${C.border}; border-radius: 12px; }
  .blog-author-name { font-weight: 500; color: ${C.ink}; font-size: 14px; margin-bottom: 4px; }
  .blog-author-bio { font-size: 14px; color: ${C.muted}; line-height: 1.7; }

  .blog-cta { margin-top: 48px; padding: 24px; background: ${C.card}; border-radius: 14px; border: 1px solid ${C.border}; }
  .blog-cta p { margin-bottom: 14px; color: ${C.ink}; }
  .blog-cta-btn { display: inline-block; background: ${C.green}; color: ${C.bg} !important; border: none; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 400; letter-spacing: .02em; text-decoration: none !important; }
  .blog-cta-btn:hover { background: ${C.greenDark}; }

  .blog-card { display: block; background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px; padding: 18px 20px; margin: 12px 0; text-decoration: none !important; transition: border-color .2s, transform .15s; }
  .blog-card:hover { border-color: rgba(28,25,23,0.18); transform: translateY(-1px); }
  .blog-card-title { font-family: 'Cormorant Garamond', serif; font-weight: 500; font-size: 20px; color: ${C.ink}; letter-spacing: -.01em; }
  .blog-card-desc { font-size: 14.5px; color: ${C.muted}; line-height: 1.6; margin-top: 6px; }

  @media (max-width: 600px) {
    .blog-wrap { padding: 40px 16px 72px; }
    .blog-nav  { padding: 0 16px !important; }
    .blog-footer { padding: 24px 16px !important; }
    .blog-footer-links { flex-wrap: wrap !important; gap: 10px !important; }
  }
`

export function Logo({ size = 24, color = C.green }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" stroke={color} strokeWidth="1.1" opacity="0.35" />
      <circle cx="16" cy="16" r="9" stroke={color} strokeWidth="1.1" opacity="0.6" />
      <circle cx="16" cy="16" r="3.2" fill={color} />
      <line x1="16" y1="2" x2="16" y2="7" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
      <line x1="16" y1="25" x2="16" y2="30" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
      <line x1="2" y1="16" x2="7" y2="16" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
      <line x1="25" y1="16" x2="30" y2="16" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
    </svg>
  )
}

export function BlogNav({ navigate }) {
  return (
    <nav className="blog-nav" style={{ borderBottom: `1px solid ${C.border}`, padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(247,244,239,0.95)' }}>
      <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
        <Logo size={24} />
        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: C.ink, letterSpacing: '-.01em' }}>Velyr</span>
      </button>
      <button onClick={() => navigate('/blog')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.faint, fontFamily: 'Jost, sans-serif', fontWeight: 300, transition: 'color .2s' }}
        onMouseEnter={(e) => (e.target.style.color = C.muted)}
        onMouseLeave={(e) => (e.target.style.color = C.faint)}
      >All articles</button>
    </nav>
  )
}

export function BlogFooter({ navigate }) {
  const links = [
    { label: 'Blog', path: '/blog' },
    { label: 'FAQ', path: '/faq' },
    { label: 'Privacy Policy', path: '/privacy' },
    { label: 'Imprint', path: '/impressum' },
    { label: 'AGB', path: '/agb' },
  ]
  return (
    <div className="blog-footer" style={{ borderTop: `1px solid ${C.border}`, padding: '24px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <span style={{ fontSize: 13, color: C.faint, fontWeight: 300 }}>© 2026 Velyr</span>
      <div className="blog-footer-links" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {links.map((l) => (
          <button key={l.label} onClick={() => navigate(l.path)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.faint, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>{l.label}</button>
        ))}
      </div>
    </div>
  )
}

// ── head helpers ──────────────────────────────────────────────────────────────
function upsertMeta(key, content, attr = 'name') {
  let tag = document.querySelector(`meta[${attr}="${key}"]`)
  const created = !tag
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  const prev = tag.getAttribute('content')
  tag.setAttribute('content', content)
  return () => { if (created) tag.remove(); else if (prev != null) tag.setAttribute('content', prev) }
}

function upsertLink(rel, href, hreflang) {
  const sel = `link[rel="${rel}"]` + (hreflang ? `[hreflang="${hreflang}"]` : '')
  let tag = document.querySelector(sel)
  const created = !tag
  if (!tag) {
    tag = document.createElement('link')
    tag.setAttribute('rel', rel)
    if (hreflang) tag.setAttribute('hreflang', hreflang)
    document.head.appendChild(tag)
  }
  const prev = tag.getAttribute('href')
  tag.setAttribute('href', href)
  return () => { if (created) tag.remove(); else if (prev != null) tag.setAttribute('href', prev) }
}

// Sets title + description/OG/Twitter + canonical/hreflang and returns a single
// cleanup that restores everything. `robots` lets the not-found view noindex.
export function applyHead({ title, description, url, robots }) {
  const prevTitle = document.title
  document.title = title
  const cleanups = [
    upsertMeta('description', description),
    upsertMeta('og:description', description, 'property'),
    upsertMeta('twitter:description', description),
    upsertMeta('og:title', title, 'property'),
    upsertMeta('twitter:title', title),
    upsertMeta('og:url', url, 'property'),
    upsertLink('canonical', url),
    upsertLink('alternate', url, 'en'),
    upsertLink('alternate', url, 'x-default'),
  ]
  if (robots) cleanups.push(upsertMeta('robots', robots))
  return () => { document.title = prevTitle; cleanups.forEach((fn) => fn()) }
}

// Create-or-update a stable-id JSON-LD block; returns a cleanup. On a direct
// landing the prerendered tag already exists (created=false → we just update and
// restore on unmount); on SPA navigation we update the previous page's tag —
// never a duplicate.
export function injectJsonLd(id, obj) {
  let el = document.getElementById(id)
  const created = !el
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = id
    document.head.appendChild(el)
  }
  const prev = el.textContent
  el.textContent = JSON.stringify(obj)
  return () => { if (created) el.remove(); else el.textContent = prev }
}

// ── JSON-LD builders (mirror scripts/prerender.mjs) ───────────────────────────
export function articleLd(d) {
  // Organizational author ("Velyr Team"); publisher stays the Velyr Organization.
  const author = { '@type': 'Organization', name: d.author }
  return {
    '@context': 'https://schema.org',
    '@type': d.schemaType,
    headline: d.title,
    description: d.description,
    datePublished: d.publishedAt,
    dateModified: d.updatedAt,
    author,
    publisher: { '@type': 'Organization', name: 'Velyr', url: ORIGIN, logo: { '@type': 'ImageObject', url: ORIGIN + '/og-image.png' } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': d.canonical },
    image: ORIGIN + '/og-image.png',
    inLanguage: 'en',
  }
}

export const faqLd = (faqs) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
})

export const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
})
