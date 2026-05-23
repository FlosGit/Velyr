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

export default function AGB({ navigate }) {
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
          <h1 style={{ marginBottom: 12 }}>Terms & Conditions</h1>
          <p style={{ marginBottom: 8, color: '#a09890', fontSize: 13 }}>Last updated: May 2026</p>
          <p style={{ marginBottom: 48, color: '#a09890', fontSize: 13 }}>These Terms & Conditions apply to all services offered by Velyr, operated by Florian Rappold, Maikäferstraße 3f, 85551 Kirchheim bei München, Germany (hereinafter "Velyr", "we", "us").</p>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 1 */}
          <div style={block}>
            <h2>§ 1 — Scope & Services</h2>
            <p style={{ marginBottom: 12 }}>Velyr provides AI-powered business audit and website optimisation services. The following services are offered:</p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Free Scan</strong> — a free, automated analysis of your website and public social media profiles, providing an overall score and 2 priority issues. No account or payment required.</li>
              <li><strong style={{ fontWeight: 500 }}>Full Report (€9, one-time)</strong> — a comprehensive audit including all 5 priority actions, deep social media analysis, hook analysis, caption rewrites, brand clarity scoring, and an effort plan.</li>
              <li><strong style={{ fontWeight: 500 }}>Growth Agent (€29/month)</strong> — a semi-autonomous AI agent that analyses your GitHub repository and PostHog analytics weekly, identifies the highest-impact conversion issue, writes a code fix, opens a Pull Request, and notifies you via Telegram (reply YES to deploy or NO to skip). Nothing is deployed without your explicit approval. Additional features include: competitor weekly scanning of up to 2 sites you choose; an optional public timeline page; and a brutally honest monthly roast report summarising progress and gaps.</li>
            </ul>
            <p style={{ marginTop: 12 }}>All services are provided as-is based on publicly available data and automated AI analysis. Results are informational only and do not constitute legal, financial, or professional business advice.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 2 */}
          <div style={block}>
            <h2>§ 2 — Contract Formation</h2>
            <p style={{ marginBottom: 12 }}>A contract is formed as follows:</p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Free Scan:</strong> By submitting your website URL in the scan form. No registration required.</li>
              <li><strong style={{ fontWeight: 500 }}>Full Report:</strong> By completing payment via Stripe. The contract is formed at the moment Stripe confirms your payment.</li>
              <li><strong style={{ fontWeight: 500 }}>Growth Agent:</strong> By completing the onboarding process and confirming your first monthly subscription payment via Stripe. The contract is formed at the moment Stripe confirms your payment.</li>
            </ul>
            <p style={{ marginTop: 12 }}>By using any paid service, you confirm that you are at least 18 years old and legally entitled to enter into this contract.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 3 */}
          <div style={block}>
            <h2>§ 3 — Prices & Payment</h2>
            <ul>
              <li>Die angegebenen Preise sind Endpreise. Gemäß § 19 UStG erheben wir keine Umsatzsteuer und weisen diese folglich auch nicht aus.</li>
              <li>The <strong style={{ fontWeight: 500 }}>Full Report</strong> costs €9 as a one-time payment. You are charged once at purchase. No recurring charges.</li>
              <li>The <strong style={{ fontWeight: 500 }}>Growth Agent</strong> costs €29 per month, billed monthly in advance via Stripe. The subscription renews automatically each month until cancelled.</li>
              <li>All payments are processed by Stripe Payments Europe, Ltd. Velyr never stores your card details.</li>
              <li>In case of a failed payment for the Growth Agent, Stripe will retry according to its standard retry schedule. If payment cannot be collected, the subscription will be paused and you will be notified by email.</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 4 */}
          <div style={block}>
            <h2>§ 4 — Right of Withdrawal (Widerrufsrecht)</h2>
            <p style={{ marginBottom: 12 }}>As a consumer within the EU, you generally have a 14-day right of withdrawal from distance contracts. However, please note the following:</p>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Full Report:</strong> By completing payment, you expressly request immediate performance of the service. You acknowledge that your right of withdrawal expires upon delivery of the completed report, in accordance with § 356 Abs. 5 BGB and Art. 16(m) of Directive 2011/83/EU.</li>
              <li><strong style={{ fontWeight: 500 }}>Growth Agent:</strong> You have a 14-day right of withdrawal from the date of contract formation. If you expressly request that the service begin immediately, you acknowledge that your right of withdrawal expires once the service has been fully performed. If you withdraw before the first agent run, you will receive a full refund. If the agent has already run at least once, a proportional fee for the service rendered may be retained.</li>
            </ul>
            <p style={{ marginTop: 12 }}>To exercise your right of withdrawal, contact us at <a href="mailto:info@velyr.io">info@velyr.io</a> within 14 days of contract formation. No specific form is required.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 4a — Statutory Widerrufsbelehrung */}
          <div style={block}>
            <h2>§ 4a — Widerrufsbelehrung (Muster gemäß Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB)</h2>

            <p style={{ marginTop: 4, marginBottom: 12, fontWeight: 500, color: '#1c1917' }}>Widerrufsrecht</p>
            <p style={{ marginBottom: 12 }}>
              Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.
            </p>
            <p style={{ marginBottom: 12 }}>
              Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.
            </p>
            <p style={{ marginBottom: 12 }}>
              Um Ihr Widerrufsrecht auszuüben, müssen Sie uns
            </p>
            <p style={{ marginBottom: 12, paddingLeft: 16 }}>
              Florian Rappold<br />
              Maikäferstraße 3f<br />
              85551 Kirchheim bei München<br />
              Deutschland<br />
              Telefon: +49 151 61893139<br />
              E-Mail: <a href="mailto:info@velyr.io">info@velyr.io</a>
            </p>
            <p style={{ marginBottom: 12 }}>
              mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.
            </p>
            <p style={{ marginBottom: 12 }}>
              Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.
            </p>

            <p style={{ marginTop: 18, marginBottom: 12, fontWeight: 500, color: '#1c1917' }}>Folgen des Widerrufs</p>
            <p style={{ marginBottom: 12 }}>
              Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.
            </p>
            <p style={{ marginBottom: 12 }}>
              Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.
            </p>

            <p style={{ marginTop: 18, marginBottom: 12, fontWeight: 500, color: '#1c1917' }}>Vorzeitiges Erlöschen des Widerrufsrechts bei digitalen Inhalten</p>
            <p style={{ marginBottom: 12 }}>
              Bei einem Vertrag über die Lieferung von nicht auf einem körperlichen Datenträger befindlichen digitalen Inhalten (Full Report, €9) erlischt das Widerrufsrecht auch dann, wenn der Unternehmer mit der Ausführung des Vertrags begonnen hat, nachdem Sie
            </p>
            <ul>
              <li>ausdrücklich zugestimmt haben, dass der Unternehmer mit der Ausführung des Vertrags vor Ablauf der Widerrufsfrist beginnt, und</li>
              <li>Ihre Kenntnis davon bestätigt haben, dass Sie durch Ihre Zustimmung mit Beginn der Ausführung des Vertrags Ihr Widerrufsrecht verlieren (§ 356 Abs. 5 BGB).</li>
            </ul>
            <p style={{ marginTop: 12 }}>
              Diese Zustimmung und Kenntnisbestätigung holen wir vor jeder kostenpflichtigen Bestellung des Full Reports per Checkbox ausdrücklich ein.
            </p>

            <p style={{ marginTop: 24, marginBottom: 12, fontWeight: 500, color: '#1c1917' }}>Muster-Widerrufsformular (Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 EGBGB)</p>
            <p style={{ marginBottom: 12, fontStyle: 'italic' }}>
              Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.
            </p>
            <div style={{ border: '1px solid rgba(28,25,23,0.12)', borderRadius: 10, padding: '16px 18px', background: 'rgba(28,25,23,0.02)' }}>
              <p style={{ marginBottom: 10 }}>An<br />
                Florian Rappold<br />
                Maikäferstraße 3f<br />
                85551 Kirchheim bei München<br />
                Deutschland<br />
                E-Mail: <a href="mailto:info@velyr.io">info@velyr.io</a>
              </p>
              <p style={{ marginBottom: 10 }}>
                Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*) / die Erbringung der folgenden Dienstleistung (*):
              </p>
              <p style={{ marginBottom: 10 }}>
                _______________________________________________________
              </p>
              <p style={{ marginBottom: 6 }}>Bestellt am (*) / erhalten am (*): ____________________</p>
              <p style={{ marginBottom: 6 }}>Name des/der Verbraucher(s): ____________________</p>
              <p style={{ marginBottom: 6 }}>Anschrift des/der Verbraucher(s): ____________________</p>
              <p style={{ marginBottom: 6 }}>Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): ____________________</p>
              <p style={{ marginBottom: 0 }}>Datum: ____________________</p>
              <p style={{ marginTop: 12, fontSize: 13, color: '#a09890' }}>(*) Unzutreffendes streichen.</p>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 5 */}
          <div style={block}>
            <h2>§ 5 — Cancellation & Refunds</h2>
            <ul>
              <li><strong style={{ fontWeight: 500 }}>Full Report:</strong> No refunds after the report has been delivered, as the service is fully performed at that point.</li>
              <li><strong style={{ fontWeight: 500 }}>Growth Agent:</strong> You can cancel your subscription at any time from your dashboard. Cancellation takes effect at the end of the current billing period. No partial refunds are issued for unused days in the current period. After cancellation, the agent will stop running and your data will be deleted within 30 days.</li>
              <li>If Velyr is unable to perform the service due to a technical error on our side, you are entitled to a full refund for the affected period.</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 6 */}
          <div style={block}>
            <h2>§ 6 — Growth Agent — User Responsibilities</h2>
            <p style={{ marginBottom: 12 }}>By using the Growth Agent, you agree to the following:</p>
            <ul>
              <li>You are the owner of, or have full authorisation to grant access to, the GitHub repository and PostHog project you connect to Velyr.</li>
              <li>You understand that the Growth Agent will open Pull Requests on your GitHub repository. No changes are merged or deployed without your explicit approval via Telegram (reply YES to deploy or NO to skip).</li>
              <li>You are solely responsible for reviewing and approving any Pull Request before merging. Velyr is not liable for the outcome of code changes you approve (YES) and deploy.</li>
              <li>You are responsible for ensuring that your Brand Guardrails are accurate and up to date. The agent follows them as written.</li>
              <li>The auto-rollback feature is a safety measure, not a guarantee. Velyr is not liable for any business impact resulting from a deployed change, whether or not a rollback occurs.</li>
              <li>You must not use the Growth Agent to violate any third-party terms of service, including GitHub's and PostHog's.</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 7 */}
          <div style={block}>
            <h2>§ 7 — Availability & Service Levels</h2>
            <ul>
              <li>Velyr aims for high availability but does not guarantee uninterrupted service. Scheduled maintenance will be communicated in advance where possible.</li>
              <li>The Growth Agent is designed to run every Monday at 9:00 AM. Velyr does not guarantee that every run will complete successfully. If a run fails due to a technical error on our side, no charge is made for that week and the agent will retry the following Monday.</li>
              <li>Velyr reserves the right to modify, update, or discontinue features with reasonable notice. For material changes to paid services, at least 30 days' notice will be given.</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 8 */}
          <div style={block}>
            <h2>§ 8 — Limitation of Liability</h2>
            <p style={{ marginBottom: 12 }}>Velyr's liability is limited as follows:</p>
            <ul>
              <li>Velyr is not liable for business decisions made on the basis of the audit reports or Growth Agent recommendations.</li>
              <li>Velyr is not liable for the accuracy of publicly available social media data retrieved from third-party platforms.</li>
              <li>Velyr is not liable for indirect, consequential, or incidental damages, including but not limited to loss of revenue, loss of data, or reputational damage.</li>
              <li>Velyr's total liability for any claim related to a paid service is limited to the amount paid by you for that service in the 3 months preceding the claim.</li>
              <li>Nothing in these Terms limits liability for death or personal injury caused by negligence, or for fraud or fraudulent misrepresentation.</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 9 */}
          <div style={block}>
            <h2>§ 9 — Intellectual Property</h2>
            <ul>
              <li>The Velyr platform, its design, and all content produced by Velyr (excluding your own website content and social media data) remain the intellectual property of Florian Rappold.</li>
              <li>The audit reports and Growth Agent analyses generated for you are licensed to you for personal and commercial use. You may share them freely.</li>
              <li>You may not reverse-engineer, resell, or redistribute the Velyr platform or its outputs as your own product or service.</li>
            </ul>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 10 */}
          <div style={block}>
            <h2>§ 10 — Prohibited Use</h2>
            <p style={{ marginBottom: 12 }}>You may not use Velyr to:</p>
            <ul>
              <li>Scan websites or social media accounts you do not own or have explicit permission to audit.</li>
              <li>Attempt to circumvent, reverse-engineer, or exploit the platform.</li>
              <li>Submit false or misleading information in the scan form.</li>
              <li>Use the Growth Agent on a GitHub repository you are not authorised to modify.</li>
              <li>Violate any applicable law or regulation.</li>
            </ul>
            <p style={{ marginTop: 12 }}>Velyr reserves the right to terminate access immediately and without refund in the event of a material breach of these Terms.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 11 */}
          <div style={block}>
            <h2>§ 11 — Changes to These Terms</h2>
            <p>Velyr reserves the right to update these Terms at any time. For material changes, active subscribers will be notified by email at least 30 days in advance. Continued use of the service after the effective date constitutes acceptance of the updated Terms. If you do not agree with the changes, you may cancel your subscription before the effective date and receive a prorated refund for the remaining period.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 12 */}
          <div style={block}>
            <h2>§ 12 — Governing Law & Dispute Resolution</h2>
            <p style={{ marginBottom: 12 }}>These Terms are governed by German law, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). The place of jurisdiction is Munich, Germany, to the extent permitted by law.</p>
            <p style={{ marginBottom: 12 }}>For consumers within the EU: Nothing in these Terms affects your rights as a consumer under the mandatory consumer protection laws of your country of residence.</p>
            <p>The European Commission provides an online dispute resolution platform: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>. We are not obliged to participate in dispute resolution proceedings before a consumer arbitration board, but we are willing to attempt resolution by email first. Contact us at <a href="mailto:info@velyr.io">info@velyr.io</a>.</p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(28,25,23,0.09)', margin: '8px 0 36px' }} />

          {/* § 13 */}
          <div style={block}>
            <h2>§ 13 — Contact</h2>
            <p>Florian Rappold<br />Maikäferstraße 3f<br />85551 Kirchheim bei München<br />Germany<br /><a href="mailto:info@velyr.io">info@velyr.io</a></p>
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