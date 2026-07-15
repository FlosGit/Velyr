import { useEffect } from 'react'

const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; color: #1c1917; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  h1 { font-family: 'Cormorant Garamond', serif; font-weight: 300; font-size: clamp(32px, 5vw, 56px); letter-spacing: -.025em; line-height: 1.08; word-break: break-word; }
  h2 { font-family: 'Cormorant Garamond', serif; font-weight: 400; font-size: 22px; letter-spacing: -.015em; margin-bottom: 10px; word-break: break-word; }
  p, li { color: #6b6460; line-height: 1.78; font-size: 15px; font-weight: 300; overflow-wrap: anywhere; }
  a { color: #2a5c45; text-decoration: underline; text-decoration-color: rgba(42,92,69,0.35); transition: color .2s; word-break: break-word; }
  a:hover { color: #1e4433; }
  @media (max-width: 600px) {
    .legal-page-pad { padding: 56px 16px 72px !important; }
    .legal-nav      { padding: 0 16px !important; }
    .legal-footer   { padding: 24px 16px !important; }
    .legal-footer-links { flex-wrap: wrap !important; gap: 10px !important; }
  }
`

const block = { marginBottom: 36 }
const label = { fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#a09890', fontWeight: 400, marginBottom: 8, display: 'block' }

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

export default function Impressum({ navigate }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Imprint — Velyr'
    let robots = document.querySelector('meta[name="robots"]')
    const created = !robots
    const prevContent = robots?.getAttribute('content')
    if (!robots) {
      robots = document.createElement('meta')
      robots.setAttribute('name', 'robots')
      document.head.appendChild(robots)
    }
    robots.setAttribute('content', 'noindex, nofollow')

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
      if (created) robots.remove()
      else if (prevContent != null) robots.setAttribute('content', prevContent)
      canonical.setAttribute('href', 'https://velyr.io/')
      hreflangEn.setAttribute('href', 'https://velyr.io/')
      hreflangDefault.setAttribute('href', 'https://velyr.io/')
    }
  }, [])

  return (
    <>
      <style>{SHARED_CSS}</style>
      <div style={{ minHeight: '100vh', background: '#f7f4ef' }}>

        <nav className="legal-nav" style={{ borderBottom: '1px solid rgba(28,25,23,0.08)', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(247,244,239,0.95)' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={24} />
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: '#1c1917', letterSpacing: '-.01em' }}>Velyr</span>
          </button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300, transition: 'color .2s' }}
            onMouseEnter={e => e.target.style.color = '#6b6460'}
            onMouseLeave={e => e.target.style.color = '#a09890'}
          >← Back to home</button>
        </nav>

        <div className="legal-page-pad" style={{ maxWidth: 680, margin: '0 auto', padding: '72px 24px 96px' }}>
          <p style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: '#2a5c45', marginBottom: 16, fontWeight: 400 }}>Legal</p>
          <h1 style={{ marginBottom: 48 }}>Imprint</h1>

          <div style={block}>
            <span style={label}>Information pursuant to § 5 TMG (German Telemedia Act)</span>
            <p>Florian Rappold<br />Maikäferstraße 3f<br />85551 Kirchheim bei München<br />Germany</p>
          </div>

          <div style={block}>
            <span style={label}>Contact</span>
            <p>
              Phone: <a href="tel:+4915161893139">+49 151 61893139</a><br />
              Email: <a href="mailto:info@velyr.io">info@velyr.io</a>
            </p>
          </div>

          <div style={block}>
            <span style={label}>Responsible for content pursuant to § 18 (2) MStV</span>
            <p>Florian Rappold<br />Maikäferstraße 3f<br />85551 Kirchheim bei München</p>
          </div>

          <div style={block}>
            <span style={label}>Value Added Tax</span>
            <p>Notice pursuant to § 19 UStG (German VAT Act): As a small business within the meaning of § 19 UStG, no value added tax is charged or shown.</p>
          </div>

          <div style={block}>
            <span style={label}>EU Dispute Resolution</span>
            <p>
              The European Commission provides a platform for online dispute resolution (ODR):{' '}
              <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>.{' '}
              We are neither obliged nor willing to participate in dispute resolution proceedings before a consumer arbitration board. For an out-of-court settlement, please first contact us by email at <a href="mailto:info@velyr.io">info@velyr.io</a>.
            </p>
          </div>

          <div style={block}>
            <span style={label}>Notice on the Service</span>
            <p>Velyr is an AI-powered Growth Agent that analyzes subscribers' websites weekly and proposes improvements as pull requests. Changes are applied only after the user's explicit approval. The results are based on automated analysis and do not constitute legal, tax, or business advice. No liability is assumed for decisions made on the basis of the Growth Agent's recommendations.</p>
          </div>

          <div style={block}>
            <span style={label}>Payment Processing</span>
            <p>Payment processing for paid services (Growth Agent €49/month) is handled by Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, D02 H210, Ireland. Payment data is processed solely by Stripe and is not stored by Velyr.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          <h2 style={{ marginBottom: 20 }}>Disclaimer</h2>

          <div style={block}>
            <span style={label}>Liability for Content</span>
            <p>The contents of this website were created with the greatest care. However, we cannot guarantee the accuracy, completeness, or timeliness of the content. As a service provider, we are responsible for our own content on these pages in accordance with general laws pursuant to § 7 (1) TMG. However, pursuant to §§ 8 to 10 TMG, we as a service provider are not obliged to monitor transmitted or stored third-party information.</p>
          </div>

          <div style={block}>
            <span style={label}>AI-Generated Content</span>
            <p>The analyses and code suggestions (pull requests) generated by the Growth Agent are created in part by AI systems (Anthropic Claude). These constitute automated evaluations and are no substitute for expert advice. Velyr assumes no liability for decisions made on the basis of these analyses.</p>
          </div>

          <div style={block}>
            <span style={label}>Liability for Links</span>
            <p>Our offering contains links to external third-party websites over whose content we have no influence. The respective provider or operator of the linked pages is always responsible for their content. Continuous monitoring of the content of linked pages is not reasonable without concrete evidence of a legal violation.</p>
          </div>

          <div style={block}>
            <span style={label}>Copyright</span>
            <p>The content and works created by the site operators on these pages are subject to German copyright law. Reproduction, editing, distribution, and any kind of use beyond the limits of copyright law require the written consent of the respective author or creator.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          <h2 style={{ marginBottom: 20 }}>Data Protection</h2>

          <div style={block}>
            <span style={label}>Controller</span>
            <p>The controller within the meaning of the GDPR is Florian Rappold, Maikäferstraße 3f, 85551 Kirchheim bei München, Germany. Contact: <a href="mailto:info@velyr.io">info@velyr.io</a></p>
          </div>

          <div style={block}>
            <span style={label}>Further Information</span>
            <p>You can find more information on data protection in our{' '}
              <button onClick={() => navigate('/privacy')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2a5c45', fontFamily: 'Jost, sans-serif', fontSize: 15, fontWeight: 300, textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)', padding: 0 }}>Privacy Policy</button>.
            </p>
          </div>

        </div>

        <div className="legal-footer" style={{ borderTop: '1px solid rgba(28,25,23,0.08)', padding: '24px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#a09890', fontWeight: 300 }}>© 2026 Velyr</span>
          <div className="legal-footer-links" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
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