import { useEffect } from 'react'

const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@300;400;500&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; color: #1c1917; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  h1 { font-family: 'Cormorant Garant', serif; font-weight: 300; font-size: clamp(32px, 5vw, 56px); letter-spacing: -.025em; line-height: 1.08; word-break: break-word; }
  h2 { font-family: 'Cormorant Garant', serif; font-weight: 400; font-size: 22px; letter-spacing: -.015em; margin-bottom: 10px; word-break: break-word; }
  p, li { color: #6b6460; line-height: 1.78; font-size: 15px; font-weight: 300; overflow-wrap: anywhere; }
  a { color: #2a5c45; text-decoration: underline; text-decoration-color: rgba(42,92,69,0.35); transition: color .2s; word-break: break-word; }
  a:hover { color: #1e4433; }
  ul { padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
  @media (max-width: 600px) {
    .legal-page-pad { padding: 56px 16px 72px !important; }
    .legal-nav      { padding: 0 16px !important; }
    .legal-footer   { padding: 24px 16px !important; }
    .legal-footer-links { flex-wrap: wrap !important; gap: 10px !important; }
  }
`

const block = { marginBottom: 36 }

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

export default function PrivacyPolicy({ navigate }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Privacy Policy — Velyr'
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
            <span style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 500, fontSize: 20, color: '#1c1917', letterSpacing: '-.01em' }}>Velyr</span>
          </button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#a09890', fontFamily: 'Jost, sans-serif', fontWeight: 300, transition: 'color .2s' }}
            onMouseEnter={e => e.target.style.color = '#6b6460'}
            onMouseLeave={e => e.target.style.color = '#a09890'}
          >← Back to home</button>
        </nav>

        <div className="legal-page-pad" style={{ maxWidth: 680, margin: '0 auto', padding: '72px 24px 96px' }}>
          <p style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: '#2a5c45', marginBottom: 16, fontWeight: 400 }}>Legal</p>
          <h1 style={{ marginBottom: 12 }}>Privacy Policy</h1>
          <p style={{ marginBottom: 48, color: '#a09890', fontSize: 13 }}>Last updated: May 2026</p>

          <div style={block}>
            <h2>Who we are</h2>
            <p>Velyr is operated by Florian Rappold, Maikäferstraße 3f, 85551 Kirchheim bei München, Germany. If you have any questions about this privacy policy, contact us at <a href="mailto:info@velyr.io">info@velyr.io</a>.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          <div style={block}>
            <h2>What data we collect</h2>
            <p style={{ marginBottom: 12 }}>When you use Velyr, we may collect the following information:</p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Your email address</strong>, used for account authentication (login, password reset) and essential service/billing notices.</li>
              <li><strong style={{ fontWeight: 500 }}>Payment information</strong>, when you subscribe to the Growth Agent (€29/month). Payment data is processed exclusively by Stripe — we never see or store your card details.</li>
              <li><strong style={{ fontWeight: 500 }}>GitHub repository access</strong>, if you connect the Growth Agent. We access only the repositories you explicitly authorise, solely to read page code and open Pull Requests on your behalf.</li>
              <li><strong style={{ fontWeight: 500 }}>PostHog analytics data</strong>, if you connect the Growth Agent. We read your site's analytics (bounce rates, traffic sources, page views) solely to identify conversion improvements. We do not store this data beyond what is needed for each weekly run.</li>
              <li><strong style={{ fontWeight: 500 }}>Website screenshots</strong>, if you connect the Growth Agent. We capture an image of the specific page the agent proposes to change — a "before" image, and an "after" image once a change is deployed — so you can see a visual comparison in your dashboard (and, if you enable it, on your public timeline). Only the publicly accessible page at that URL is rendered. Screenshots are captured via ScreenshotOne (see Third-party services).</li>
              {/* "competitor scanning" = the current competitor-tracking feature
                  (competitor add/remove via Telegram), NOT the removed free-scan
                  product (S0a). Legitimate; reviewed in the cleanup bundle. */}
              <li><strong style={{ fontWeight: 500 }}>Competitor URLs you provide</strong>, if you use the Growth Agent's competitor scanning feature. These URLs are fetched once per week solely to compare publicly visible elements (hero headline, main CTA, visible pricing) against the previous snapshot. Only public HTML is requested.</li>
              <li><strong style={{ fontWeight: 500 }}>Technical data</strong> such as IP address and browser type, collected automatically by our hosting provider (Vercel) for security and performance purposes.</li>
              <li><strong style={{ fontWeight: 500 }}>Analytics data (with your consent)</strong> — if you accept analytics cookies via our consent banner, PostHog (US-hosted) records pageviews, session activity, and interaction events on velyr.io to help us understand how visitors use the site. You can decline this at any time; declining does not affect any other functionality.</li>
            </ul>
          </div>

          <div style={block}>
            <h2>What data we do NOT collect</h2>
            <ul>
              <li>We do not use marketing or advertising cookies.</li>
              <li>We do not use Google Analytics or any behavioral tracking service other than PostHog (US-hosted, only after your consent — see the Cookies section below).</li>
              <li>We do not share or sell your data to any third party.</li>
              <li>We do not access private social media accounts or require any social media login.</li>
              <li>We do not store your payment card details — this is handled entirely by Stripe.</li>
              <li>Encrypted credentials (e.g. GitHub installation access tokens) are stored at rest using AES-256-GCM with a server-side key. They are used only during scheduled agent runs.</li>
            </ul>
          </div>

          <div style={block}>
            <h2>How we use your data</h2>
            <ul>
              <li>To operate your account and send essential service and billing notices. Weekly summaries, PR approvals, and rollback alerts are delivered via Telegram.</li>
              <li>To process your payment for the Growth Agent subscription via Stripe.</li>
              <li>To operate the Growth Agent: reading your GitHub repo and PostHog analytics weekly, writing code fixes, opening Pull Requests, and sending you Telegram notifications.</li>
            </ul>
            <p style={{ marginTop: 12 }}>The legal basis for processing is your consent (Art. 6(1)(a) GDPR) where you have actively provided data, performance of a contract (Art. 6(1)(b) GDPR) for paid services, and our legitimate interest (Art. 6(1)(f) GDPR) for technical infrastructure data.</p>
          </div>

          <div style={block}>
            <h2>Third-party services</h2>
            <p style={{ marginBottom: 12 }}>Velyr uses the following third-party services to operate:</p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Vercel</strong> — hosting and content delivery. Vercel Inc. is based in the USA; data transfers are governed by the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs) where applicable. Server logs including IP addresses are retained by Vercel for up to 30 days. <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>Supabase</strong> — secure database storage for user accounts, Growth Agent subscriptions, agent run history, and encrypted GitHub/PostHog access tokens. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>Stripe</strong> — payment processing for the Growth Agent subscription (€29/month). Stripe is a PCI-DSS certified payment processor. Your payment data is transmitted directly to Stripe and never stored by Velyr. Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin, D02 H210, Ireland. Stripe may transfer data to its parent company Stripe, Inc. in the USA; such transfers are governed by the EU-US Data Privacy Framework (DPF) and Standard Contractual Clauses (SCCs). <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>OpenRouter</strong> — used to route the Growth Agent's code-generation requests to language models, including Anthropic's Claude. Files from your connected GitHub repository (those our agent identifies as relevant to the conversion fix), along with your analytics context, are sent to OpenRouter, which forwards them to the model provider for processing. No unnecessary personal data is included. Data may be processed in the USA under Standard Contractual Clauses (SCCs) and, where applicable, the EU-US Data Privacy Framework (DPF). <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">OpenRouter privacy policy</a> · <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer">Anthropic privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>Google PageSpeed Insights API</strong> — used by the Growth Agent to measure your website's loading performance during its weekly analysis. Your website URL is sent to Google's API for this purpose. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>ScreenshotOne</strong> — used by the Growth Agent to capture the before/after screenshots of the page it edits on your website, which we display in your dashboard (and, if you enable it, on your public timeline). The URL of the relevant page is sent to ScreenshotOne, which renders the publicly accessible page and returns an image; the image may be briefly cached by ScreenshotOne (a few hours) and is used for no other purpose. ScreenshotOne processes data on servers located in both the EU and the USA. <a href="https://screenshotone.com/privacy-policy/" target="_blank" rel="noopener noreferrer">Privacy policy</a> · <a href="https://screenshotone.com/dpa/" target="_blank" rel="noopener noreferrer">Data processing agreement</a></li>
              <li><strong style={{ fontWeight: 500 }}>GitHub</strong> — used by the Growth Agent to read your repository code and open Pull Requests. Only repositories you explicitly authorise are accessed. <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>PostHog (velyr.io frontend analytics)</strong> — when you accept analytics via our cookie consent banner, PostHog records pageviews, clicks, and session activity on velyr.io to help us understand how the site is used. PostHog Inc. is based in the USA and processes and stores this data on US servers (PostHog US Cloud, us.i.posthog.com); for EU users, data is transferred to the USA under appropriate safeguards — Standard Contractual Clauses (SCCs) and, where applicable, the EU-US Data Privacy Framework (DPF). Data processor: PostHog Inc., 2261 Market Street #4008, San Francisco, CA 94114, USA. Legal basis: your consent (Art. 6 (1)(a) GDPR, § 25 TTDSG). You can decline this at any time. <a href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>PostHog (US, San Francisco)</strong> — analytics sub-processor. Pageview events from your website's visitors are processed in Velyr's PostHog workspace, partitioned by your domain. Velyr accesses this data to generate weekly conversion fixes. As the website operator, you are the data controller for your visitors' data and must disclose Velyr/PostHog as your analytics processor in your own privacy notice. <a href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
              <li><strong style={{ fontWeight: 500 }}>Telegram</strong> — used by the Growth Agent to send you weekly notifications, Pull Request approval requests, and rollback alerts. Your Telegram chat ID is stored solely for this purpose and can be removed at any time. <a href="https://telegram.org/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a></li>
            </ul>
          </div>

          <div style={block}>
            <h2>Cookies</h2>
            <p style={{ marginBottom: 12 }}>
              Velyr uses two categories of cookies and similar storage:
            </p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Strictly necessary (no consent required).</strong> Authentication session tokens for the Growth Agent dashboard, and the localStorage entry that remembers your cookie-consent choice (<code>velyr_consent</code>).</li>
              <li><strong style={{ fontWeight: 500 }}>Analytics (consent required).</strong> If you accept analytics via our cookie consent banner, PostHog (PostHog US Cloud, us.i.posthog.com) sets first-party cookies and stores a session identifier in order to record pageviews, clicks, and session activity on velyr.io. PostHog Inc. is based in the USA and stores this data on US servers; for EU users, data is transferred to the USA under Standard Contractual Clauses (SCCs) and, where applicable, the EU-US Data Privacy Framework (DPF). Legal basis: your consent under § 25 Abs. 1 TTDSG and Art. 6 (1)(a) GDPR. You can withdraw consent at any time by clearing your browser storage for velyr.io, after which the banner will re-appear on the next visit and you can choose "Decline".</li>
            </ul>
            <p style={{ marginTop: 12 }}>
              You can disable cookies in your browser settings, but this may prevent the Growth Agent dashboard from functioning correctly.
            </p>
          </div>

          <div style={block}>
            <h2>Payments & subscriptions</h2>
            <p style={{ marginBottom: 12 }}>Paid services on Velyr:</p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Growth Agent — €29/month.</strong> This is a recurring monthly subscription. You can cancel at any time from your dashboard. Cancellation takes effect at the end of the current billing period — no partial refunds are issued for unused days.</li>
            </ul>
            <p style={{ marginTop: 12 }}>All payments are processed by Stripe. Velyr never stores your payment card details. Invoices are issued by Stripe on behalf of Velyr.</p>
          </div>

          <div style={block}>
            <h2>How long we keep your data</h2>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Email addresses</strong> associated with Growth Agent subscriptions are kept for the duration of the active subscription plus 12 months for compliance purposes.</li>
              <li><strong style={{ fontWeight: 500 }}>Growth Agent account data</strong> (GitHub token, PostHog token, Telegram chat ID, Brand Guardrails) is stored for the duration of your active subscription and deleted within 30 days of cancellation.</li>
              <li><strong style={{ fontWeight: 500 }}>Payment records</strong> are retained for 10 years as required by German tax law (§ 147 AO). These records are held by Stripe.</li>
            </ul>
            <p style={{ marginTop: 12 }}>You can request deletion of your data at any time by contacting us at <a href="mailto:info@velyr.io">info@velyr.io</a>. Note that payment records required by law cannot be deleted early.</p>
          </div>

          <div style={block}>
            <h2>Your rights (GDPR)</h2>
            <p style={{ marginBottom: 12 }}>Under the General Data Protection Regulation, you have the following rights:</p>
            <ul>
              <li>The right to access the personal data we hold about you.</li>
              <li>The right to have inaccurate data corrected.</li>
              <li>The right to have your data deleted ("right to be forgotten"), subject to legal retention requirements.</li>
              <li>The right to restrict or object to processing.</li>
              <li>The right to data portability.</li>
              <li>The right to withdraw consent at any time, without affecting the lawfulness of processing before withdrawal.</li>
            </ul>
            <p style={{ marginTop: 12 }}>To exercise any of these rights, contact us at <a href="mailto:info@velyr.io">info@velyr.io</a>. We will respond within 30 days.</p>
          </div>

          <div style={block}>
            <h2>Right to complain</h2>
            <p>You have the right to lodge a complaint with the competent supervisory authority. In Bavaria, this is the Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), Promenade 27, 91522 Ansbach, Germany. Website: <a href="https://www.lda.bayern.de" target="_blank" rel="noopener noreferrer">lda.bayern.de</a></p>
          </div>

          <div style={block}>
            <h2>Changes to this policy</h2>
            <p>We will update the date at the top of this page when significant changes are made. For material changes, we will notify active Growth Agent subscribers via email and/or Telegram.</p>
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