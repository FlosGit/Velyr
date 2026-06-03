import { useEffect, useState } from 'react'
import { C, BLOG_CSS, BlogNav, BlogFooter, ORIGIN, applyHead, injectJsonLd, breadcrumbLd } from './blog/_shared.jsx'
import { CLUSTERS } from '../data/blogClusters.js'

const TITLE = 'Velyr Blog — Conversion Optimization for Developers'
const DESC =
  'Practical, sourced guides on conversion optimization, PostHog analysis, Core Web Vitals, and shipping growth fixes as code — for developers and founders.'

export default function BlogIndex({ navigate }) {
  const [articles, setArticles] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/blog-index.json')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setArticles(d.articles || []) })
      .catch(() => { if (!cancelled) setArticles([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const url = ORIGIN + '/blog'
    const cleanups = [
      applyHead({ title: TITLE, description: DESC, url }),
      injectJsonLd('breadcrumb-jsonld', breadcrumbLd([
        { name: 'Home', url: ORIGIN + '/' },
        { name: 'Blog', url },
      ])),
    ]
    return () => cleanups.forEach((fn) => fn())
  }, [])

  const go = (e, path) => { e.preventDefault(); navigate(path) }
  const clustersWithPosts = articles
    ? CLUSTERS.filter((c) => articles.some((a) => a.cluster === c.slug))
    : []

  return (
    <>
      <style>{BLOG_CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg }}>
        <BlogNav navigate={navigate} />
        <div className="blog-wrap">
          <p className="blog-eyebrow" style={{ color: C.green }}>Velyr Blog</p>
          <h1>The Velyr Blog</h1>
          <p style={{ color: C.muted, fontSize: 16, maxWidth: 640 }}>{DESC}</p>

          {articles === null && (
            <p style={{ color: C.faint, marginTop: 32 }}>Loading…</p>
          )}
          {articles && articles.length === 0 && (
            <p style={{ color: C.faint, marginTop: 32 }}>No articles yet — check back soon.</p>
          )}

          {clustersWithPosts.map((c) => (
            <section key={c.slug} style={{ marginTop: 40 }}>
              <h2 style={{ marginBottom: 4 }}>
                <a href={`/blog/category/${c.slug}`} onClick={(e) => go(e, `/blog/category/${c.slug}`)} style={{ color: C.ink, textDecoration: 'none' }}>{c.title}</a>
              </h2>
              {articles
                .filter((a) => a.cluster === c.slug)
                .map((a) => (
                  <a key={a.slug} className="blog-card" href={`/blog/${a.slug}`} onClick={(e) => go(e, `/blog/${a.slug}`)}>
                    <div className="blog-card-title">{a.title}</div>
                    <div className="blog-card-desc">{a.description}</div>
                  </a>
                ))}
            </section>
          ))}
        </div>
        <BlogFooter navigate={navigate} />
      </div>
    </>
  )
}
