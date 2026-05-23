import { useEffect } from 'react'

const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@300;400;500&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; color: #1c1917; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  h1 { font-family: 'Cormorant Garant', serif; font-weight: 300; font-size: clamp(32px, 5vw, 56px); letter-spacing: -.025em; line-height: 1.08; word-break: break-word; }
  h2 { font-family: 'Cormorant Garant', serif; font-weight: 400; font-size: 22px; letter-spacing: -.015em; margin-bottom: 14px; color: #1c1917; word-break: break-word; }
  p, li { color: #6b6460; line-height: 1.78; font-size: 15px; font-weight: 300; overflow-wrap: anywhere; }
  a { color: #2a5c45; text-decoration: underline; text-decoration-color: rgba(42,92,69,0.35); transition: color .2s; word-break: break-word; }
  a:hover { color: #1e4433; }
  @media (max-width: 600px) {
    .faq-page-pad { padding: 56px 16px 72px !important; }
    .faq-nav      { padding: 0 16px !important; }
    .faq-footer   { padding: 24px 16px !important; }
    .faq-footer-links { flex-wrap: wrap !important; gap: 10px !important; }
  }
`

const FAQS = [
  {
    q: 'What is an AI Growth Agent and how does it help my business grow?',
    a: 'An AI Growth Agent is a semi-autonomous system that continuously analyzes your business data, prioritizes the single highest-impact change each week, and ships the fix on your behalf. Velyr\'s Growth Agent reads your live analytics every Monday, identifies your worst-performing area (bounce rate, low-converting page, weak headline, missing CTA), writes the code change, opens a GitHub Pull Request, and sends it to you on Telegram for one-tap approval. After deployment, it monitors impact for 48 hours and automatically rolls back if metrics drop. It is the difference between hiring a growth consultant once and having a tireless one working every week.'
  },
  {
    q: 'How much does an AI Growth Agent cost compared to hiring a consultant?',
    a: 'A traditional growth or marketing consultant typically charges €1,500–€8,000 per month, plus several weeks of onboarding before any output. Velyr\'s Growth Agent costs €29 per month for a fully autonomous service that ships improvements weekly — roughly 50–250x cheaper than a human consultant. Most SMEs recover the monthly cost from a single improved conversion.'
  },
  {
    q: 'How do I use AI for my SME growth strategy?',
    a: 'The most effective way to use AI for SME growth is to let it handle the work humans are slow at: continuous monitoring, benchmark comparison, and writing the actual fix. Velyr\'s Growth Agent watches your analytics weekly, proposes the single highest-leverage change, and waits for your approval before deploying. Keep your role at the strategic level (saying yes or no) while AI handles diagnosis, prioritization, and implementation.'
  },
  {
    q: 'Why use an AI growth agent instead of a traditional business consultant?',
    a: 'An AI growth agent operates 24/7 at a fraction of the cost, ships actual code changes rather than recommendations, and learns from every deployment. A traditional consultant produces a strategy document; Velyr\'s Growth Agent reads your real analytics, writes the fix, opens a Pull Request, deploys after your approval, and rolls back automatically if the change hurts your bounce rate. There is no kickoff call, no retainer, no Slack channel — just a Telegram message every Monday with the next move. For founders and SME operators who value speed and measurable outcomes, this is a structurally better trade-off.'
  },
  {
    q: 'What does a fully automated business intelligence tool do for small businesses?',
    a: 'A fully automated business intelligence tool turns the data small businesses already generate — analytics, conversion behavior — into a prioritized action list without anyone having to build dashboards or run reports. Velyr\'s Growth Agent reads your analytics each week, identifies your weakest link, writes the fix, and ships it after your approval. For a small team without a dedicated analyst, this is the difference between guessing where to invest time and knowing. Weekly summaries delivered to Telegram keep you informed without logging into another dashboard.'
  },
]

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

export default function Faq({ navigate }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'FAQ — Velyr Growth Agent'

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

    const pageUrl = 'https://www.velyr.io' + window.location.pathname

    let canonical = document.querySelector('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.setAttribute('rel', 'canonical'); document.head.appendChild(canonical) }
    canonical.setAttribute('href', pageUrl)

    let hreflangEn = document.querySelector('link[rel="alternate"][hreflang="en"]')
    if (!hreflangEn) { hreflangEn = document.createElement('link'); hreflangEn.setAttribute('rel', 'alternate'); hreflangEn.setAttribute('hreflang', 'en'); document.head.appendChild(hreflangEn) }
    hreflangEn.setAttribute('href', pageUrl)

    let hreflangDefault = document.querySelector('link[rel="alternate"][hreflang="x-default"]')
    if (!hreflangDefault) { hreflangDefault = document.createElement('link'); hreflangDefault.setAttribute('rel', 'alternate'); hreflangDefault.setAttribute('hreflang', 'x-default'); document.head.appendChild(hreflangDefault) }
    hreflangDefault.setAttribute('href', pageUrl)

    const ld = document.createElement('script')
    ld.type = 'application/ld+json'
    ld.id = 'faq-jsonld'
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
    document.head.appendChild(ld)

    return () => {
      document.title = prevTitle
      if (robots.created) robots.tag.remove()
      else robots.tag.setAttribute('content', robots.prev || 'index, follow')
      canonical.setAttribute('href', 'https://www.velyr.io/')
      hreflangEn.setAttribute('href', 'https://www.velyr.io/')
      hreflangDefault.setAttribute('href', 'https://www.velyr.io/')
      const existing = document.getElementById('faq-jsonld')
      if (existing) existing.remove()
    }
  }, [])

  return (
    <>
      <style>{SHARED_CSS}</style>
      <div style={{ minHeight: '100vh', background: '#f7f4ef' }}>

        <nav className="faq-nav" style={{ borderBottom: '1px solid rgba(28,25,23,0.08)', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(247,244,239,0.95)' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={24} />
            <span style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 500, fontSize: 20, color: '#1c1917', letterSpacing: '-.01em' }}>Velyr</span>
          </button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300, transition: 'color .2s' }}
            onMouseEnter={e => e.target.style.color = '#6b6460'}
            onMouseLeave={e => e.target.style.color = '#a09890'}
          >← Back to home</button>
        </nav>

        <div className="faq-page-pad" style={{ maxWidth: 760, margin: '0 auto', padding: '72px 24px 96px' }}>
          <p style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: '#2a5c45', marginBottom: 16, fontWeight: 400 }}>Help</p>
          <h1 style={{ marginBottom: 16 }}>Frequently Asked Questions</h1>
          <p style={{ marginBottom: 56, color: '#a09890', fontSize: 15 }}>Common questions about AI business audits, the Velyr Growth Agent, and how automated business intelligence compares to traditional consulting.</p>

          {FAQS.map((f, i) => (
            <div key={i} style={{ marginBottom: 40, paddingBottom: 40, borderBottom: i < FAQS.length - 1 ? '1px solid rgba(28,25,23,0.08)' : 'none' }}>
              <h2>{f.q}</h2>
              <p>{f.a}</p>
            </div>
          ))}

          <div style={{ marginTop: 56, padding: 24, background: '#ffffff', borderRadius: 14, border: '1px solid rgba(28,25,23,0.08)' }}>
            <h2 style={{ marginBottom: 8 }}>Still have questions?</h2>
            <p style={{ marginBottom: 12 }}>The fastest way to see what Velyr can do for your business is to start the Growth Agent.</p>
            <p>
              <button onClick={() => navigate('/agent/login')} style={{ background: '#2a5c45', color: '#f7f4ef', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontFamily: 'Jost, sans-serif', fontWeight: 400, cursor: 'pointer', letterSpacing: '.02em' }}>Start the Growth Agent</button>
              {' '}or email <a href="mailto:info@velyr.io">info@velyr.io</a>.
            </p>
          </div>
        </div>

        <div className="faq-footer" style={{ borderTop: '1px solid rgba(28,25,23,0.08)', padding: '24px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#a09890', fontWeight: 300 }}>© 2026 Velyr</span>
          <div className="faq-footer-links" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/faq')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>FAQ</button>
            <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
            <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Legal Notice (Impressum)</button>
            <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>AGB</button>
          </div>
        </div>

      </div>
    </>
  )
}
