import { useEffect, useState } from 'react'
import {
  C, BLOG_CSS, BlogNav, BlogFooter, ORIGIN,
  applyHead, injectJsonLd, articleLd, faqLd, breadcrumbLd,
} from './blog/_shared.jsx'
import { CLUSTER_BY_SLUG } from '../data/blogClusters.js'

// Reads the inline <script id="blog-data"> the prerender baked into the page
// (instant render on a direct landing, matched by slug), and falls back to
// fetching /blog/<slug>.json for in-SPA navigations. Renders the canonical
// contentHtml verbatim via dangerouslySetInnerHTML — the SAME string the
// prerendered crawler fallback uses, so the two are byte-for-byte identical.
function readInline(slug) {
  const el = document.getElementById('blog-data')
  if (!el) return null
  try {
    const data = JSON.parse(el.textContent)
    return data && data.slug === slug ? data : null
  } catch {
    return null
  }
}

export default function BlogArticle({ navigate, slug }) {
  const [data, setData] = useState(() => readInline(slug))
  const [status, setStatus] = useState(() => (readInline(slug) ? 'ready' : 'loading'))

  useEffect(() => {
    let cancelled = false
    const inline = readInline(slug)
    if (inline) {
      setData(inline)
      setStatus('ready')
      return
    }
    setStatus('loading')
    fetch(`/blog/${slug}.json`)
      .then((r) => {
        if (!r.ok) throw new Error('not found')
        return r.json()
      })
      .then((d) => {
        if (cancelled) return
        setData(d)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('notfound')
      })
    return () => { cancelled = true }
  }, [slug])

  // Head + JSON-LD (reuse the prerendered stable-id tags → no duplicates).
  useEffect(() => {
    if (status === 'notfound') {
      const cleanup = applyHead({
        title: 'Article not found — Velyr Blog',
        description: 'This article could not be found.',
        url: ORIGIN + '/blog/' + slug,
        robots: 'noindex, follow',
      })
      return cleanup
    }
    if (status !== 'ready' || !data) return
    const cluster = CLUSTER_BY_SLUG[data.cluster]
    const cleanups = [
      applyHead({ title: `${data.title} — Velyr Blog`, description: data.description, url: data.canonical }),
      injectJsonLd('article-jsonld', articleLd(data)),
    ]
    if (data.faqs && data.faqs.length) cleanups.push(injectJsonLd('faqpage-jsonld', faqLd(data.faqs)))
    cleanups.push(injectJsonLd('breadcrumb-jsonld', breadcrumbLd([
      { name: 'Home', url: ORIGIN + '/' },
      { name: 'Blog', url: ORIGIN + '/blog' },
      { name: cluster ? cluster.title : data.clusterTitle, url: `${ORIGIN}/blog/category/${data.cluster}` },
      { name: data.title, url: data.canonical },
    ])))
    return () => cleanups.forEach((fn) => fn())
  }, [status, data, slug])

  return (
    <>
      <style>{BLOG_CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg }}>
        <BlogNav navigate={navigate} />
        <div className="blog-wrap">
          {status === 'loading' && (
            <p style={{ color: C.faint, fontSize: 15 }}>Loading…</p>
          )}
          {status === 'notfound' && (
            <>
              <h1>Article not found</h1>
              <p style={{ color: C.muted, marginTop: 12 }}>
                We couldn’t find that article. <a href="/blog" onClick={(e) => { e.preventDefault(); navigate('/blog') }}>Browse all articles →</a>
              </p>
            </>
          )}
          {status === 'ready' && data && (
            <div dangerouslySetInnerHTML={{ __html: data.contentHtml }} />
          )}
        </div>
        <BlogFooter navigate={navigate} />
      </div>
    </>
  )
}
