import { useEffect } from 'react'

const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; color: #1c1917; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  h1 { font-family: 'Cormorant Garamond', serif; font-weight: 300; font-size: clamp(32px, 5vw, 56px); letter-spacing: -.025em; line-height: 1.08; word-break: break-word; }
  h2 { font-family: 'Cormorant Garamond', serif; font-weight: 400; font-size: 24px; letter-spacing: -.015em; margin-bottom: 14px; color: #1c1917; word-break: break-word; }
  p, li { color: #6b6460; line-height: 1.78; font-size: 15px; font-weight: 300; overflow-wrap: anywhere; }
  ul { padding-left: 20px; }
  li { margin-bottom: 8px; }
  a { color: #2a5c45; text-decoration: underline; text-decoration-color: rgba(42,92,69,0.35); transition: color .2s; word-break: break-word; }
  a:hover { color: #1e4433; }
  .cmp-table-wrap { overflow-x: auto; margin: 8px 0 16px; }
  .cmp-table { border-collapse: collapse; width: 100%; min-width: 560px; background: #ffffff; border: 1px solid rgba(28,25,23,0.08); border-radius: 12px; }
  .cmp-table th, .cmp-table td { text-align: left; padding: 12px 16px; font-size: 14px; font-weight: 300; color: #6b6460; border-bottom: 1px solid rgba(28,25,23,0.06); vertical-align: top; line-height: 1.6; }
  .cmp-table th { font-weight: 400; color: #1c1917; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }
  .cmp-table tr:last-child td { border-bottom: none; }
  .cmp-table td:first-child { color: #1c1917; font-weight: 400; white-space: nowrap; }
  @media (max-width: 600px) {
    .cmp-page-pad { padding: 56px 16px 72px !important; }
    .cmp-nav      { padding: 0 16px !important; }
    .cmp-footer   { padding: 24px 16px !important; }
    .cmp-footer-links { flex-wrap: wrap !important; gap: 10px !important; }
  }
`

function Logo({ size = 24, color = '#2a5c45' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" stroke={color} strokeWidth="1.1" opacity="0.35" />
      <circle cx="16" cy="16" r="9"  stroke={color} strokeWidth="1.1" opacity="0.6" />
      <circle cx="16" cy="16" r="3.2" fill={color} />
      <line x1="16" y1="2"  x2="16" y2="7"  stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
      <line x1="16" y1="25" x2="16" y2="30" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
      <line x1="2"  y1="16" x2="7"  y2="16" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
      <line x1="25" y1="16" x2="30" y2="16" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
    </svg>
  )
}

const SECTION_STYLE = { marginBottom: 44, paddingBottom: 44, borderBottom: '1px solid rgba(28,25,23,0.08)' }

export default function CodeVsOverlay({ navigate }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Overlay Scripts vs. Real Code — How AI CRO Tools Apply Changes | Velyr'

    const setOrCreateMeta = (name, content) => {
      let tag = document.querySelector(`meta[name="${name}"]`)
      const created = !tag
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute('name', name)
        document.head.appendChild(tag)
      }
      const prev = tag.getAttribute('content')
      tag.setAttribute('content', content)
      return { tag, prev, created }
    }

    const robots = setOrCreateMeta('robots', 'index, follow')

    const pageUrl = 'https://velyr.io' + window.location.pathname

    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.setAttribute('rel', 'canonical'); document.head.appendChild(canonical) }
    canonical.setAttribute('href', pageUrl)

    let hreflangEn = document.querySelector('link[rel="alternate"][hreflang="en"]')
    if (!hreflangEn) { hreflangEn = document.createElement('link'); hreflangEn.setAttribute('rel', 'alternate'); hreflangEn.setAttribute('hreflang', 'en'); document.head.appendChild(hreflangEn) }
    hreflangEn.setAttribute('href', pageUrl)

    let hreflangDefault = document.querySelector('link[rel="alternate"][hreflang="x-default"]')
    if (!hreflangDefault) { hreflangDefault = document.createElement('link'); hreflangDefault.setAttribute('rel', 'alternate'); hreflangDefault.setAttribute('hreflang', 'x-default'); document.head.appendChild(hreflangDefault) }
    hreflangDefault.setAttribute('href', pageUrl)

    return () => {
      document.title = prevTitle
      if (robots.created) robots.tag.remove()
      else robots.tag.setAttribute('content', robots.prev || 'index, follow')
      canonical.setAttribute('href', 'https://velyr.io/')
      hreflangEn.setAttribute('href', 'https://velyr.io/')
      hreflangDefault.setAttribute('href', 'https://velyr.io/')
    }
  }, [])

  return (
    <>
      <style>{SHARED_CSS}</style>
      <div style={{ minHeight: '100vh', background: '#f7f4ef' }}>

        <nav className="cmp-nav" style={{ borderBottom: '1px solid rgba(28,25,23,0.08)', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(247,244,239,0.95)' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={24} />
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: '#1c1917', letterSpacing: '-.01em' }}>Velyr</span>
          </button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300, transition: 'color .2s' }}
            onMouseEnter={e => e.target.style.color = '#6b6460'}
            onMouseLeave={e => e.target.style.color = '#a09890'}
          >← Back to home</button>
        </nav>

        <div className="cmp-page-pad" style={{ maxWidth: 760, margin: '0 auto', padding: '72px 24px 96px' }}>
          <p style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: '#2a5c45', marginBottom: 16, fontWeight: 400 }}>Compare</p>
          <h1 style={{ marginBottom: 16 }}>Overlay scripts vs. real code</h1>
          <p style={{ marginBottom: 56, color: '#a09890', fontSize: 15 }}>
            AI conversion tools apply changes to your site in one of two fundamentally different ways.
            The difference decides what you actually own — and what happens the day you cancel.
          </p>

          <div style={SECTION_STYLE}>
            <h2>How overlay tools work</h2>
            <p style={{ marginBottom: 12 }}>
              Most AI conversion-optimization platforms install a JavaScript snippet on your site.
              On every page load, that script rewrites parts of the page in the visitor&rsquo;s browser —
              swapping headlines, moving buttons, testing variants — on top of the HTML your site actually served.
            </p>
            <p style={{ marginBottom: 12 }}>This architecture has real strengths:</p>
            <ul style={{ marginBottom: 12 }}>
              <li>Installation is one script tag — no repository access, no developer needed.</li>
              <li>Changes go live instantly, and many experiments can run in parallel.</li>
              <li>Marketing teams can iterate without touching the codebase at all.</li>
            </ul>
            <p style={{ marginBottom: 12 }}>And structural trade-offs:</p>
            <ul>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>The changes live in the script, not in your site.</strong> Your codebase never contains the winning variant. Cancel the subscription and every improvement disappears with the snippet.</li>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>Runtime rewriting happens after your page renders.</strong> The browser paints your original page first, then the script repaints it — which can surface as flicker or layout shift, and adds another third-party script to every page load.</li>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>Search engines and AI crawlers mostly read your served HTML.</strong> Copy that only exists inside an overlay is invisible to anything that doesn&rsquo;t execute the script.</li>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>Redesigns break overlays silently.</strong> When your team changes the underlying page, selectors stop matching and variants degrade — usually without anyone noticing.</li>
            </ul>
          </div>

          <div style={SECTION_STYLE}>
            <h2>How code-level changes work</h2>
            <p style={{ marginBottom: 12 }}>
              The alternative is to change the source itself: a Pull Request on your GitHub repository,
              or — for Shopify stores — an edit to the theme files. The change ships through your normal
              deploy pipeline, exactly like a change a developer would make.
            </p>
            <ul style={{ marginBottom: 12 }}>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>You own every line, permanently.</strong> The improvement is in your repository or theme — version-controlled, reviewable, revertible, and still there if you cancel.</li>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>No runtime dependency.</strong> Visitors get the improved page directly from your server. Nothing repaints, nothing flickers, no extra script runs on your visitors&rsquo; devices.</li>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>Crawlers see what visitors see.</strong> The change is in the served HTML, so search engines and AI assistants index the improved page, not the original.</li>
              <li><strong style={{ fontWeight: 400, color: '#1c1917' }}>Every change is reviewable before it exists.</strong> A diff is a contract: you see exactly what changes, approve it, and your git history remembers why.</li>
            </ul>
            <p style={{ marginBottom: 12 }}>The honest trade-offs on this side:</p>
            <ul>
              <li>It requires access to your repository or store — a bigger trust decision than a script tag.</li>
              <li>Changes ship at the pace of deploys and reviews, not instantly. This is a deliberate cadence, not experiment velocity.</li>
              <li>It cannot run dozens of simultaneous A/B variants the way an overlay platform can.</li>
            </ul>
          </div>

          <div style={SECTION_STYLE}>
            <h2>Side by side</h2>
            <div className="cmp-table-wrap">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Overlay script</th>
                    <th>Real code (Velyr)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Where the change lives</td>
                    <td>In the vendor&rsquo;s script, applied in the browser on every page load</td>
                    <td>In your repository or Shopify theme</td>
                  </tr>
                  <tr>
                    <td>If you cancel</td>
                    <td>All improvements vanish with the snippet</td>
                    <td>Every shipped change stays yours</td>
                  </tr>
                  <tr>
                    <td>Page load</td>
                    <td>Original page renders, then the script rewrites it</td>
                    <td>The improved page is what your server sends</td>
                  </tr>
                  <tr>
                    <td>SEO / AI crawlers</td>
                    <td>See the original HTML, not the variant</td>
                    <td>See the improved page</td>
                  </tr>
                  <tr>
                    <td>Review</td>
                    <td>Dashboard preview of the variant</td>
                    <td>A readable diff, approved before anything ships</td>
                  </tr>
                  <tr>
                    <td>Experiment velocity</td>
                    <td>High — many parallel variants</td>
                    <td>Deliberate — one measured fix per week</td>
                  </tr>
                  <tr>
                    <td>Access required</td>
                    <td>One script tag</td>
                    <td>GitHub repo or Shopify store access</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={SECTION_STYLE}>
            <h2>When an overlay tool is the better fit</h2>
            <p>
              Honestly: if you run an enterprise site with heavy traffic, a dedicated CRO team, and a culture of
              running many experiments in parallel, an overlay-based experimentation platform is built for that job.
              The same is true if you can&rsquo;t grant code access at all. Velyr is built for the opposite case —
              indie founders, small SaaS teams, and store owners who want one well-evidenced improvement a week
              that they own forever, without adopting a new platform.
            </p>
          </div>

          <div style={{ ...SECTION_STYLE, borderBottom: 'none', paddingBottom: 0 }}>
            <h2>How Velyr ships code</h2>
            <p style={{ marginBottom: 12 }}>
              Every week, Velyr reads your PostHog analytics (scroll depth, click behavior, rage clicks, dead clicks),
              scans your pages, and writes the single highest-impact conversion fix it can defend with evidence —
              as a GitHub Pull Request, or a staged change to your Shopify theme. You approve or skip it with one
              tap in Telegram or from the dashboard. Nothing ships without your YES.
            </p>
            <p>
              After a fix ships, Velyr compares bounce rate in the 48 hours after against the 48 hours before —
              and proposes a rollback if the numbers got worse. Fixes that measurably improved your metrics are
              recorded as measured wins; fixes that merely didn&rsquo;t break anything are labelled exactly that.
              The code stays in your repository either way.
            </p>
          </div>

          <div style={{ marginTop: 56, padding: 24, background: '#ffffff', borderRadius: 14, border: '1px solid rgba(28,25,23,0.08)' }}>
            <h2 style={{ marginBottom: 8 }}>See it on your own site</h2>
            <p style={{ marginBottom: 12 }}>€49/month after a 14-day free trial — no credit card required to start. Every fix is code you keep.</p>
            <p>
              <button onClick={() => navigate('/agent/login')} style={{ background: '#2a5c45', color: '#f7f4ef', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontFamily: 'Jost, sans-serif', fontWeight: 400, cursor: 'pointer', letterSpacing: '.02em' }}>Start the Growth Agent</button>
              {' '}or read the <a href="/faq" onClick={e => { e.preventDefault(); navigate('/faq') }}>FAQ</a>.
            </p>
          </div>
        </div>

        <div className="cmp-footer" style={{ borderTop: '1px solid rgba(28,25,23,0.08)', padding: '24px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#a09890', fontWeight: 300 }}>© 2026 Velyr</span>
          <div className="cmp-footer-links" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/blog')}      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Blog</button>
            <button onClick={() => navigate('/faq')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>FAQ</button>
            <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
            <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Imprint</button>
            <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>AGB</button>
          </div>
        </div>

      </div>
    </>
  )
}
