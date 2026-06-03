import { useEffect, useState } from 'react'
import { C, BLOG_CSS, BlogNav, BlogFooter, ORIGIN, applyHead, injectJsonLd, breadcrumbLd } from './blog/_shared.jsx'
import { CLUSTER_BY_SLUG } from '../data/blogClusters.js'

export default function BlogCategory({ navigate, cluster: clusterSlug }) {
  const cluster = CLUSTER_BY_SLUG[clusterSlug]
  const [articles, setArticles] = useState(null)

  useEffect(() => {
    if (!cluster) return
    let cancelled = false
    fetch('/blog-index.json')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setArticles((d.articles || []).filter((a) => a.cluster === clusterSlug)) })
      .catch(() => { if (!cancelled) setArticles([]) })
    return () => { cancelled = true }
  }, [clusterSlug, cluster])

  useEffect(() => {
    const url = `${ORIGIN}/blog/category/${clusterSlug}`
    if (!cluster) {
      return applyHead({ title: 'Category not found — Velyr Blog', description: 'This category could not be found.', url, robots: 'noindex, follow' })
    }
    const cleanups = [
      applyHead({ title: `${cluster.title} — Velyr Blog`, description: cluster.description, url }),
      injectJsonLd('breadcrumb-jsonld', breadcrumbLd([
        { name: 'Home', url: ORIGIN + '/' },
        { name: 'Blog', url: ORIGIN + '/blog' },
        { name: cluster.title, url },
      ])),
    ]
    return () => cleanups.forEach((fn) => fn())
  }, [clusterSlug, cluster])

  const go = (e, path) => { e.preventDefault(); navigate(path) }

  if (!cluster) {
    return (
      <>
        <style>{BLOG_CSS}</style>
        <div style={{ minHeight: '100vh', background: C.bg }}>
          <BlogNav navigate={navigate} />
          <div className="blog-wrap">
            <h1>Category not found</h1>
            <p style={{ color: C.muted, marginTop: 12 }}>
              <a href="/blog" onClick={(e) => go(e, '/blog')}>Browse all articles →</a>
            </p>
          </div>
          <BlogFooter navigate={navigate} />
        </div>
      </>
    )
  }

  return (
    <>
      <style>{BLOG_CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg }}>
        <BlogNav navigate={navigate} />
        <div className="blog-wrap">
          <nav className="blog-breadcrumb">
            <a href="/" onClick={(e) => go(e, '/')}>Home</a> › <a href="/blog" onClick={(e) => go(e, '/blog')}>Blog</a> › {cluster.title}
          </nav>
          <h1>{cluster.title}</h1>
          <p style={{ color: C.muted, fontSize: 16, maxWidth: 640 }}>{cluster.description}</p>

          {articles === null && <p style={{ color: C.faint, marginTop: 32 }}>Loading…</p>}
          {articles && articles.length === 0 && (
            <p style={{ color: C.faint, marginTop: 32 }}>No articles in this category yet — check back soon.</p>
          )}
          <div style={{ marginTop: 24 }}>
            {(articles || []).map((a) => (
              <a key={a.slug} className="blog-card" href={`/blog/${a.slug}`} onClick={(e) => go(e, `/blog/${a.slug}`)}>
                <div className="blog-card-title">{a.title}</div>
                <div className="blog-card-desc">{a.description}</div>
              </a>
            ))}
          </div>
        </div>
        <BlogFooter navigate={navigate} />
      </div>
    </>
  )
}
