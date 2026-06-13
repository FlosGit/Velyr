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
    document.title = 'Impressum — Velyr'
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
          <h1 style={{ marginBottom: 48 }}>Impressum</h1>

          <div style={block}>
            <span style={label}>Angaben gemäß § 5 TMG</span>
            <p>Florian Rappold<br />Maikäferstraße 3f<br />85551 Kirchheim bei München<br />Deutschland</p>
          </div>

          <div style={block}>
            <span style={label}>Kontakt</span>
            <p>
              Telefon: <a href="tel:+4915161893139">+49 151 61893139</a><br />
              E-Mail: <a href="mailto:info@velyr.io">info@velyr.io</a>
            </p>
          </div>

          <div style={block}>
            <span style={label}>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</span>
            <p>Florian Rappold<br />Maikäferstraße 3f<br />85551 Kirchheim bei München</p>
          </div>

          <div style={block}>
            <span style={label}>Umsatzsteuer</span>
            <p>Hinweis gemäß § 19 UStG: Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer erhoben und ausgewiesen.</p>
          </div>

          <div style={block}>
            <span style={label}>EU-Streitschlichtung</span>
            <p>
              Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
              <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>.{' '}
              Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen. Bitte kontaktieren Sie uns zur außergerichtlichen Lösung zunächst per E-Mail an <a href="mailto:info@velyr.io">info@velyr.io</a>.
            </p>
          </div>

          <div style={block}>
            <span style={label}>Hinweis zur Dienstleistung</span>
            <p>Velyr ist ein KI-gestützter Growth Agent, der die Website von Abonnenten wöchentlich analysiert und Verbesserungen als Pull Requests vorschlägt. Änderungen werden ausschließlich nach ausdrücklicher Freigabe durch den Nutzer übernommen. Die Ergebnisse beruhen auf automatisierten Analysen und stellen keine rechtliche, steuerliche oder geschäftliche Beratung dar. Für Entscheidungen auf Basis der Empfehlungen des Growth Agent wird keine Haftung übernommen.</p>
          </div>

          <div style={block}>
            <span style={label}>Zahlungsabwicklung</span>
            <p>Die Zahlungsabwicklung für kostenpflichtige Leistungen (Growth Agent €29/Monat) erfolgt über Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, D02 H210, Irland. Zahlungsdaten werden ausschließlich von Stripe verarbeitet und nicht von Velyr gespeichert.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          <h2 style={{ marginBottom: 20 }}>Haftungsausschluss</h2>

          <div style={block}>
            <span style={label}>Haftung für Inhalte</span>
            <p>Die Inhalte dieser Website wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden. Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen.</p>
          </div>

          <div style={block}>
            <span style={label}>KI-generierte Inhalte</span>
            <p>Die vom Growth Agent generierten Analysen und Code-Vorschläge (Pull Requests) werden teilweise durch KI-Systeme (Anthropic Claude) erstellt. Diese stellen automatisierte Auswertungen dar und ersetzen keine fachkundige Beratung. Velyr übernimmt keine Haftung für Entscheidungen, die auf Basis dieser Analysen getroffen werden.</p>
          </div>

          <div style={block}>
            <span style={label}>Haftung für Links</span>
            <p>Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich. Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar.</p>
          </div>

          <div style={block}>
            <span style={label}>Urheberrecht</span>
            <p>Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          <h2 style={{ marginBottom: 20 }}>Datenschutz</h2>

          <div style={block}>
            <span style={label}>Verantwortlicher</span>
            <p>Verantwortlicher im Sinne der DSGVO ist Florian Rappold, Maikäferstraße 3f, 85551 Kirchheim bei München. Kontakt: <a href="mailto:info@velyr.io">info@velyr.io</a></p>
          </div>

          <div style={block}>
            <span style={label}>Weitere Informationen</span>
            <p>Weitere Informationen zum Datenschutz finden Sie in unserer{' '}
              <button onClick={() => navigate('/privacy')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2a5c45', fontFamily: 'Jost, sans-serif', fontSize: 15, fontWeight: 300, textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)', padding: 0 }}>Datenschutzerklärung</button>.
            </p>
          </div>

        </div>

        <div className="legal-footer" style={{ borderTop: '1px solid rgba(28,25,23,0.08)', padding: '24px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#a09890', fontWeight: 300 }}>© 2026 Velyr</span>
          <div className="legal-footer-links" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
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