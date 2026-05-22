import { useState, useEffect } from 'react'

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@300;400;500&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; color: #1c1917; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:none; } }
  @keyframes spin   { to { transform:rotate(360deg); } }
  .unlock-blur { filter:blur(5px); user-select:none; pointer-events:none; opacity:0.45; }
  .email-input:focus { border-color: #2a5c45 !important; box-shadow: 0 0 0 3px rgba(42,92,69,0.08); outline: none; }
  .share-btn:hover { background: #1c1917 !important; border-color: #1c1917 !important; color: #f7f4ef !important; }

  /* Mobile */
  @media (max-width: 600px) {
    .report-page-pad   { padding: 32px 16px 72px !important; }
    .report-nav        { padding: 0 16px !important; }
    .report-footer     { padding: 20px 16px !important; }
    .score-hero        { flex-direction: column !important; align-items: center !important; gap: 20px !important; padding: 24px 16px !important; text-align: center; }
    .score-hero-text   { min-width: 0 !important; width: 100% !important; }
    .section-card      { padding: 20px 16px !important; }
    .chips-row         { gap: 8px !important; }
    .chip              { padding: 10px 10px !important; min-width: 0 !important; flex: 1 1 calc(50% - 4px) !important; max-width: calc(50% - 4px) !important; }
    .chip-value        { font-size: 17px !important; }
    .bm-row            { gap: 8px !important; }
    .bm-label          { font-size: 12px !important; }
    .email-capture     { flex-direction: column !important; gap: 16px !important; padding: 22px 16px !important; }
    .email-right       { min-width: 0 !important; width: 100% !important; }
    .unlock-card       { padding: 32px 20px !important; }
    .share-row         { flex-wrap: wrap !important; }
    .check-tags        { gap: 6px !important; }
    .action-card       { padding: 16px !important; }
    .data-table td, .data-table th { padding: 8px 10px !important; font-size: 12px !important; }
    .bm-row            { grid-template-columns: 1fr auto !important; gap: 6px !important; }
    .bm-col-hide       { display: none !important; }
    .report-footer-links { flex-wrap: wrap !important; gap: 10px !important; }
  }
`

const C = {
  bg:     '#f7f4ef',
  text:   '#1c1917',
  muted:  '#6b6460',
  light:  '#a09890',
  border: 'rgba(28,25,23,0.08)',
  accent: '#2a5c45',
  white:  '#ffffff',
  red:    '#c0392b',
  yellow: '#d68910',
  green:  '#1e8449',
}

const sev = {
  critical:  { color: '#c0392b', bg: '#fdf2f2', label: '🔴 Critical',  border: '#f5c6c6' },
  important: { color: '#d68910', bg: '#fefdf2', label: '🟡 Important', border: '#f5e6a3' },
  quickwin:  { color: '#1e8449', bg: '#f2fdf5', label: '🟢 Quick Win', border: '#a9dfbf' },
}

function getScoreImpactLine(score) {
  if (score >= 80) return `At ${score}/100, your site is performing well — but the remaining gaps are costing you real conversions.`
  if (score >= 65) return `At ${score}/100, your site looks fine on the surface — but visitors who don't convert probably never will without these fixes.`
  if (score >= 45) return `At ${score}/100, you're likely losing 4 in 10 visitors before they read a single word. These are fixable problems.`
  if (score >= 30) return `At ${score}/100, you're losing more than half your visitors to preventable issues. Every day costs you potential customers.`
  return `At ${score}/100, your site is actively driving visitors away. Google is likely already penalising your ranking for these issues.`
}


// Fix #2: Logo SVG — identical to Home.jsx
function Logo({ size = 24, color = '#2a5c45' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const r = 54, circ = 2 * Math.PI * r, dash = (score / 100) * circ
  const color = score >= 70 ? '#2a5c45' : score >= 40 ? '#d68910' : '#c0392b'
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(28,25,23,0.08)" strokeWidth="8"/>
      <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ * 0.25}
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)' }}/>
      <text x="70" y="66" textAnchor="middle" fontFamily="Cormorant Garant, serif" fontSize="32" fontWeight="300" fill="#1c1917">{score}</text>
      <text x="70" y="82" textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="11" fontWeight="300" fill="#a09890" letterSpacing="2">/100</text>
    </svg>
  )
}

function Chip({ label, value, sub, highlight }) {
  return (
    <div className="chip" style={{
      background: highlight ? 'rgba(42,92,69,0.06)' : C.white,
      border: `1px solid ${highlight ? 'rgba(42,92,69,0.2)' : C.border}`,
      borderRadius: 10, padding: '13px 16px', flex: 1, minWidth: 100,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: C.light, marginBottom: 5, fontWeight: 400 }}>{label}</div>
      <div className="chip-value" style={{ fontSize: 19, fontFamily: 'Cormorant Garant, serif', fontWeight: 400, color: C.text, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: highlight ? C.accent : C.light, marginTop: 3, fontWeight: 300 }}>{sub}</div>}
    </div>
  )
}

function MiniBar({ label, value, max = 100, unit = '' }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  const color = pct >= 70 ? C.green : pct >= 40 ? C.yellow : C.red
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{ width: 110, fontSize: 12, color: C.muted, fontWeight: 300, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 5, background: 'rgba(28,25,23,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 1.1s cubic-bezier(0.4,0,0.2,1)' }}/>
      </div>
      <div style={{ width: 40, fontSize: 12, color, fontWeight: 400, textAlign: 'right' }}>{value}{unit}</div>
    </div>
  )
}

function CheckTag({ label, ok, title }) {
  return (
    <span title={title} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: ok ? '#f2fdf5' : '#fdf2f2', color: ok ? C.green : C.red, border: `1px solid ${ok ? '#a9dfbf' : '#f5c6c6'}`, cursor: title ? 'help' : 'default' }}>
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

function IssueTag({ text }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: '#fdf2f2', borderRadius: 8, border: '1px solid #f5c6c6' }}>
      <span style={{ color: C.red, flexShrink: 0, fontSize: 12, marginTop: 1 }}>✗</span>
      <span style={{ fontSize: 13, color: C.muted, fontWeight: 300, lineHeight: 1.5 }}>{text}</span>
    </div>
  )
}

function BenchmarkRow({ b }) {
  const isAbove = b.direction === 'above'
  return (
    <div className="bm-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid rgba(28,25,23,0.06)' }}>
      <div>
        <span className="bm-label" style={{ fontSize: 13, color: C.muted, fontWeight: 300, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.platform} · {b.metric}</span>
        {b.percentileLabel && (
          <span style={{ fontSize: 11, color: isAbove ? C.accent : C.red, fontWeight: 400 }}>{b.percentileLabel}</span>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: C.text, fontFamily: 'Cormorant Garant, serif' }}>{b.yours}</div>
        <div style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.06em' }}>yours</div>
      </div>
      <div className="bm-col-hide" style={{ textAlign: 'center' }}>
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: isAbove ? 'rgba(42,92,69,0.1)' : 'rgba(192,57,43,0.08)', color: isAbove ? C.accent : C.red, fontWeight: 500 }}>
          {isAbove ? '↑' : '↓'} {b.diff}
        </span>
      </div>
      <div className="bm-col-hide" style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 300, color: C.light }}>{b.benchmark}</div>
        <div style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.06em' }}>avg</div>
      </div>
    </div>
  )
}

function ActionCard({ issue }) {
  const cfg = sev[issue.severity] || sev.quickwin
  return (
    <div className="action-card" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '18px 22px' }}>
      <span style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: cfg.color, fontWeight: 500, display: 'block', marginBottom: 5 }}>{cfg.label}</span>
      <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 5 }}>{issue.title}</p>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, fontWeight: 300 }}>{issue.description}</p>
    </div>
  )
}

function LockedActionCard({ issue }) {
  const cfg = sev[issue.severity] || sev.quickwin
  return (
    <div className="action-card" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '18px 22px', position: 'relative' }}>
      <span style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: cfg.color, fontWeight: 500, display: 'block', marginBottom: 5 }}>{cfg.label}</span>
      <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 5 }}>{issue.title}</p>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, fontWeight: 300, filter: 'blur(4px)', userSelect: 'none', pointerEvents: 'none' }}>
        {issue.description || 'Unlock to see the exact fix and step-by-step instructions for this issue.'}
      </p>
    </div>
  )
}

// ─── PUNKT 3: UnlockBlock — konvertierender CTA + vollständige Feature-Liste ──
function UnlockBlock({ lockedCount, navigate }) {
  const totalIssues = (lockedCount || 0) + 2
  return (
    <div style={{ marginTop: 16, background: C.white, border: '1px solid rgba(42,92,69,0.2)', borderRadius: 18, padding: '36px 32px', boxShadow: '0 8px 40px rgba(42,92,69,0.09)', textAlign: 'center' }} className="unlock-card">
      <div style={{ fontSize: 24, marginBottom: 12 }}>🔒</div>
      <h3 style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 400, fontSize: 26, letterSpacing: '-.015em', marginBottom: 10, color: C.text }}>
        Get the full report — €9
      </h3>
      {/* One sentence that sells the next step, not features */}
      <p style={{ fontSize: 15, fontWeight: 500, color: C.text, lineHeight: 1.6, maxWidth: 380, margin: '0 auto 20px' }}>
        You've seen the problems. Here's exactly how to fix all {totalIssues}.
      </p>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, fontWeight: 300, maxWidth: 360, margin: '0 auto 24px' }}>
        Step-by-step, copy-paste ready — no guessing, no generic advice.
      </p>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, fontWeight: 300, maxWidth: 340, margin: '0 auto 20px', background: 'rgba(42,92,69,0.05)', borderRadius: 10, padding: '12px 16px', border: '1px solid rgba(42,92,69,0.12)' }}>
        💬 Most business owners fix their top 3 issues within a week of getting the full report — and see measurable improvements in traffic and conversions within a month.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 340, margin: '0 auto 28px', textAlign: 'left' }}>
        {[
          { text: 'Exact fix for every issue — copy-paste ready', soon: false },
          { text: 'Hook quality analysis — post by post', soon: false },
          { text: 'Engagement benchmarks vs. similar accounts', soon: false },
          { text: 'Caption & CTA feedback with rewrite suggestions', soon: false },
          { text: 'Brand clarity score + specific improvements', soon: false },
          { text: 'Competitor comparison scan', soon: true },
          { text: 'Score history — track progress as you fix issues', soon: true },
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: C.accent, fontSize: 13, marginTop: 2, flexShrink: 0 }}>✓</span>
            <span style={{ fontSize: 13, color: C.muted, fontWeight: 300 }}>
              {item.text}
              {item.soon && (
                <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(42,92,69,0.1)', color: C.accent, padding: '1px 6px', borderRadius: 4, fontWeight: 500, letterSpacing: '.04em', verticalAlign: 'middle' }}>COMING SOON</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <button
        onClick={() => navigate('/premium')}
        style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 10, padding: '15px 36px', fontSize: 15, fontFamily: 'Jost, sans-serif', fontWeight: 500, cursor: 'pointer', letterSpacing: '.02em', width: '100%', maxWidth: 320, display: 'block', margin: '0 auto 12px', transition: 'background .2s' }}
        onMouseEnter={e => e.currentTarget.style.background = C.accent}
        onMouseLeave={e => e.currentTarget.style.background = C.text}
      >
        Get the full report — €9
      </button>
      <p style={{ fontSize: 12, color: C.light, fontWeight: 300 }}>One-time · No subscription · Instant access</p>
    </div>
  )
}

function Section({ title, children, delay, visible, noPad }) {
  return (
    <div className="section-card" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: noPad ? 0 : '28px', marginBottom: 16, opacity: 0, animation: visible ? `fadeUp 0.6s ease ${delay}s forwards` : 'none', overflow: 'hidden' }}>
      {title && (
        <div style={{ padding: noPad ? '20px 24px 14px' : '0 0 16px', borderBottom: noPad ? `1px solid ${C.border}` : 'none' }}>
          <p style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: C.light, fontWeight: 500 }}>{title}</p>
        </div>
      )}
      <div style={{ padding: noPad ? '20px 24px' : 0 }}>{children}</div>
    </div>
  )
}

function ScoreHero({ score, headline, summary, perfPercentile, benchmarkData, visible }) {
  const scoreColor = score >= 70 ? C.accent : score >= 40 ? C.yellow : C.red
  const scoreLabel = score >= 70 ? 'Strong' : score >= 40 ? 'Needs Work' : 'Critical Issues'

  const contextLine = benchmarkData?.benchmarks?.[0]?.percentileLabel
    || (perfPercentile ? `Faster than ${perfPercentile}% of mobile pages` : null)

  const impactLine = getScoreImpactLine(score)

  return (
    <div className="score-hero" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: '36px 40px', marginBottom: 16, display: 'flex', gap: 36, alignItems: 'center', flexWrap: 'wrap', opacity: 0, animation: visible ? 'fadeUp 0.6s ease 0.08s forwards' : 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <ScoreRing score={score} />
        <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: scoreColor, fontWeight: 500 }}>{scoreLabel}</span>
        {contextLine && (
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 300, textAlign: 'center', maxWidth: 140, lineHeight: 1.4 }}>{contextLine}</span>
        )}
      </div>
      <div className="score-hero-text" style={{ flex: 1, minWidth: 200 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: scoreColor, marginBottom: 10, lineHeight: 1.45 }}>{impactLine}</p>
        {headline && (
          <h2 style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 400, fontSize: 20, letterSpacing: '-.01em', marginBottom: 10, lineHeight: 1.3, color: C.text }}>{headline}</h2>
        )}
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.75, fontWeight: 300 }}>{summary}</p>
      </div>
    </div>
  )
}

// ─── PUNKT 6: BenchmarkBlock — perfSlowerThan Fallback ───────────────────────
function BenchmarkBlock({ benchmarkData, website, visible, delay }) {
  const hasBm = benchmarkData?.benchmarks?.length > 0
  const hasPerfPct = benchmarkData?.perfPercentile != null

  if (!hasBm && !hasPerfPct) return null

  // Fallback: wenn perfSlowerThan fehlt (ältere gespeicherte Reports), aus perfPercentile berechnen
  const perfSlowerThan = benchmarkData.perfSlowerThan ?? (100 - benchmarkData.perfPercentile)

  return (
    <div className="section-card" style={{ background: C.white, border: `1px solid rgba(42,92,69,0.18)`, borderRadius: 16, marginBottom: 16, overflow: 'hidden', opacity: 0, animation: visible ? `fadeUp 0.6s ease ${delay}s forwards` : 'none' }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <p style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, fontWeight: 500, marginBottom: 2 }}>Market Benchmarks</p>
          {benchmarkData?.industryLabel && (
            <p style={{ fontSize: 12, color: C.muted, fontWeight: 300 }}>vs. {benchmarkData.industryLabel} accounts we've scanned</p>
          )}
        </div>
        <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 20, background: 'rgba(42,92,69,0.08)', color: C.accent, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', flexShrink: 0 }}>
          Reference data
        </span>
      </div>
      <div style={{ padding: '8px 24px 16px' }}>
        {hasPerfPct && website && (
          <div className="bm-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: `1px solid rgba(28,25,23,0.06)` }}>
            <div>
              <span className="bm-label" style={{ fontSize: 13, color: C.muted, fontWeight: 300, display: 'block' }}>Website · Mobile Performance</span>
              <span style={{ fontSize: 11, color: benchmarkData.perfPercentile >= 50 ? C.accent : C.red, fontWeight: 400 }}>
                {benchmarkData.perfPercentile >= 50
                  ? `Faster than ${benchmarkData.perfPercentile}% of mobile pages`
                  : `Slower than ${perfSlowerThan}% of mobile pages`}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: C.text, fontFamily: 'Cormorant Garant, serif' }}>{website.performanceScore}/100</div>
              <div style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.06em' }}>yours</div>
            </div>
            <div className="bm-col-hide" style={{ textAlign: 'center' }}>
              <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: website.performanceScore >= 50 ? 'rgba(42,92,69,0.1)' : 'rgba(192,57,43,0.08)', color: website.performanceScore >= 50 ? C.accent : C.red, fontWeight: 500 }}>
                {website.performanceScore >= 50 ? '↑' : '↓'} {Math.abs(website.performanceScore - 45)}pts
              </span>
            </div>
            <div className="bm-col-hide" style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 300, color: C.light }}>45/100</div>
              <div style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.06em' }}>avg</div>
            </div>
          </div>
        )}
        {hasBm && benchmarkData.benchmarks.map((b, i) => <BenchmarkRow key={i} b={b} />)}
      </div>
    </div>
  )
}

function ErrorScreen({ navigate, error, onRetry }) {
  const errorInfo = (() => {
    if (error?.code === 'unreachable') return { icon: '🌐', title: 'Website couldn\'t be reached', message: 'We couldn\'t connect to this URL. Double-check the address and make sure the site is live.', retry: true }
    if (error?.code === 'timeout')     return { icon: '⏱',  title: 'Scan took too long',            message: 'The website took longer than expected to respond. Try again — it usually works on the second attempt.', retry: true }
    if (error?.code === 'no_data')     return { icon: '📭', title: 'Not enough data',               message: 'We scanned the site but couldn\'t extract enough information. This sometimes happens with heavily JS-rendered pages.', retry: false }
    return { icon: '⚠️', title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.', retry: true }
  })()
  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg }}>
        <nav className="report-nav" style={{ borderBottom: `1px solid ${C.border}`, padding: '0 40px', height: 60, display: 'flex', alignItems: 'center', background: 'rgba(247,244,239,0.95)', position: 'sticky', top: 0, zIndex: 100 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={24} />
            <span style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 500, fontSize: 20, color: C.text, letterSpacing: '-.01em' }}>Velyr</span>
          </button>
        </nav>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 24 }}>{errorInfo.icon}</div>
          <h1 style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 300, fontSize: 28, letterSpacing: '-.02em', marginBottom: 16, color: C.text }}>{errorInfo.title}</h1>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.75, fontWeight: 300, marginBottom: 36 }}>{errorInfo.message}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {errorInfo.retry && onRetry && (
              <button onClick={onRetry} style={{ background: C.accent, color: C.white, border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 14, fontFamily: 'Jost, sans-serif', fontWeight: 500, cursor: 'pointer' }}>↻ Try again</button>
            )}
            <button onClick={() => navigate('/')} style={{ background: 'none', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 28px', fontSize: 14, fontFamily: 'Jost, sans-serif', fontWeight: 300, cursor: 'pointer' }}>← Scan a different URL</button>
          </div>
        </div>
      </div>
    </>
  )
}

function EmailCapture({ reportId, visible, navigate }) {
  const [email, setEmail]               = useState('')
  const [emailSent, setEmailSent]       = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError]     = useState('')
  if (!reportId) return null
  const handleSubmit = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError('Please enter a valid email address.'); return }
    setEmailError(''); setEmailLoading(true)
    try {
      const res = await fetch('/api/stripe?action=email_report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId, email }) })
      const data = await res.json()
      if (data.ok) setEmailSent(true)
      else setEmailError(data.error || 'Something went wrong. Try again.')
    } catch { setEmailError('Something went wrong. Try again.') }
    finally { setEmailLoading(false) }
  }
  return (
    <div className="email-capture" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: '24px 28px', marginBottom: 16, opacity: 0, animation: visible ? 'fadeUp 0.6s ease 0.12s forwards' : 'none', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>Save this report to your inbox</p>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, fontWeight: 300 }}>
          Get a permanent link to this report — so you can track your score as you fix issues.
        </p>
      </div>
      <div className="email-right" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
        {emailSent ? (
          <div style={{ fontSize: 14, color: C.accent, fontWeight: 400, padding: '10px 0' }}>✓ Sent — check your inbox.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="email-input" type="email" placeholder="your@email.com" value={email}
                onChange={e => { setEmail(e.target.value); setEmailError('') }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{ flex: 1, border: `1px solid ${emailError ? C.red : C.border}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: 300, color: C.text, background: C.bg, outline: 'none', minWidth: 0 }}
              />
              <button onClick={handleSubmit} disabled={emailLoading}
                style={{ background: C.accent, color: C.white, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: 500, cursor: emailLoading ? 'default' : 'pointer', opacity: emailLoading ? 0.7 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {emailLoading ? '…' : 'Send report'}
              </button>
            </div>
            {emailError && <p style={{ fontSize: 12, color: C.red, fontWeight: 300, margin: 0 }}>{emailError}</p>}
            <p style={{ fontSize: 11, color: C.light, fontWeight: 300, margin: 0 }}>No spam. Just your report, saved.</p>
            <p style={{ fontSize: 11, color: C.light, fontWeight: 300, margin: 0, lineHeight: 1.55 }}>
              Your email is used only to send your report. See our{' '}
              {navigate ? (
                <button
                  onClick={() => navigate('/privacy')}
                  style={{ background: 'none', border: 'none', padding: 0, color: C.accent, fontSize: 11, fontFamily: 'Jost, sans-serif', fontWeight: 300, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)' }}
                >Privacy Policy</button>
              ) : (
                <a href="/privacy" style={{ color: C.accent, textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)' }}>Privacy Policy</a>
              )}.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function ShareButton({ reportId }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = reportId ? `${window.location.origin}/report/${reportId}` : window.location.href
  const handleShare = async () => {
    try { await navigator.clipboard.writeText(shareUrl) }
    catch { const ta = document.createElement('textarea'); ta.value = shareUrl; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta) }
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div className="share-row" style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="share-btn" onClick={handleShare}
        style={{ display: 'flex', alignItems: 'center', gap: 7, background: copied ? C.accent : C.white, color: copied ? C.white : C.text, border: `1px solid ${copied ? C.accent : C.border}`, borderRadius: 9, padding: '9px 18px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: 400, cursor: 'pointer', transition: 'all .2s' }}>
        {copied ? '✓ Link copied!' : '↗ Share this report'}
      </button>
      {reportId && <span style={{ fontSize: 12, color: C.light, fontWeight: 300, wordBreak: 'break-all' }}>velyr.io/report/{reportId.slice(0, 8)}…</span>}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Report({ navigate, scanData, reportData, websiteUrl, reportId, scanError, onRetry }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { setTimeout(() => setVisible(true), 100) }, [])

  if (scanError) return <ErrorScreen navigate={navigate} error={scanError} onRetry={onRetry} />

  if (!scanData || !reportData) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div style={{ width: 32, height: 32, border: '2px solid rgba(28,25,23,0.15)', borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
          <p style={{ fontSize: 14, color: C.light, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Loading your report…</p>
        </div>
      </>
    )
  }

  const { score, website, content, tiktok, instagram, youtube, twitter, benchmarkData } = scanData
  const { headline, summary, websiteAnalysis, copyAnalysis, socialAnalysis, topIssues }  = reportData

  const hasSocial      = tiktok || instagram || youtube || twitter
  const hasBenchmarks  = benchmarkData?.benchmarks?.length > 0
  const hasBenchmarkBlock = hasBenchmarks || benchmarkData?.perfPercentile != null

  const visibleActions = topIssues?.slice(0, 2) || []
  const lockedActions  = topIssues?.slice(2)    || []

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg }}>

        <nav className="report-nav" style={{ borderBottom: `1px solid ${C.border}`, padding: '0 40px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(247,244,239,0.95)', position: 'sticky', top: 0, zIndex: 100 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={24} />
            <span style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 500, fontSize: 20, color: C.text, letterSpacing: '-.01em' }}>Velyr</span>
          </button>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.light, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>← New scan</button>
        </nav>

        <div className="report-page-pad" style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 96px' }}>

          <div style={{ marginBottom: 36, opacity: 0, animation: visible ? 'fadeUp 0.6s ease 0s forwards' : 'none' }}>
            <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 10, fontWeight: 500 }}>
              Audit Report{benchmarkData?.industryLabel ? ` · ${benchmarkData.industryLabel}` : ''}
            </p>
            <h1 style={{ fontFamily: 'Cormorant Garant, serif', fontWeight: 300, fontSize: 'clamp(18px,4vw,36px)', letterSpacing: '-.02em', lineHeight: 1.1, marginBottom: 6, wordBreak: 'break-word' }}>{websiteUrl}</h1>
            <p style={{ fontSize: 12, color: C.light }}>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <ShareButton reportId={reportId} />
          </div>

          <ScoreHero
            score={score}
            headline={headline}
            summary={summary}
            perfPercentile={benchmarkData?.perfPercentile}
            benchmarkData={benchmarkData}
            visible={visible}
          />

          <EmailCapture reportId={reportId} visible={visible} navigate={navigate} />

          {hasBenchmarkBlock && (
            <BenchmarkBlock
              benchmarkData={benchmarkData}
              website={website}
              visible={visible}
              delay={0.18}
            />
          )}

          {(website || content) && (
            <Section title="Score Breakdown" delay={0.22} visible={visible}>
              <div style={{ paddingTop: 4 }}>
                {website        && <MiniBar label="Performance"  value={website.performanceScore} />}
                {content?.seo   && <MiniBar label="SEO"          value={content.seo.score} />}
                {content?.copy  && <MiniBar label="Copy & UX"    value={content.copy.score} />}
                {website        && <MiniBar label="Accessibility" value={website.accessibilityScore} />}
              </div>
              <p style={{ fontSize: 12, color: C.light, marginTop: 12, fontWeight: 300, lineHeight: 1.6, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                Your overall score weighs all areas together. A high SEO score won't fully compensate for a slow site or weak copy — every area matters for real visitors.
              </p>
            </Section>
          )}

          {website && (
            <Section title="Website Performance" delay={0.26} visible={visible}>
              <div className="chips-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                <Chip label="Performance"   value={`${website.performanceScore}/100`} sub="mobile score"
                  highlight={benchmarkData?.perfPercentile != null}
                />
                <Chip label="Accessibility" value={`${website.accessibilityScore}/100`} />
                <Chip label="LCP"           value={website.coreWebVitals.lcp} sub="target: <2.5s" />
                <Chip label="FCP"           value={website.coreWebVitals.fcp} sub="target: <1.8s" />
                <Chip label="CLS"           value={website.coreWebVitals.cls} sub="target: <0.1" />
              </div>
              <div className="check-tags" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
                <CheckTag label="Secure (HTTPS)" ok={website.technical.hasHttps} title="Your site uses HTTPS — visitors' data is encrypted and Google ranks secure sites higher" />
                <CheckTag label="Mobile-friendly" ok={website.technical.mobileOptimized} title="Your site adapts to phone screens — over 60% of visitors are on mobile" />
                <CheckTag label="No intrusive popups" ok={website.technical.noIntrusive} title="Popups that block content on mobile cause Google to rank your site lower" />
                <CheckTag label="Readable text size" ok={website.technical.fontSizeOk} title="Text is large enough to read on mobile without zooming" />
              </div>
              {websiteAnalysis && (
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, fontWeight: 300, borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 4 }}>{websiteAnalysis}</p>
              )}
            </Section>
          )}

          {content?.seo && (
            <Section title="SEO Analysis" delay={0.3} visible={visible}>
              <div className="chips-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
                <Chip label="SEO Score"    value={`${content.seo.score}/100`} sub="our deep scan" />
                <Chip label="Title"        value={`${content.seo.titleLength}c`} sub={content.seo.titleLength >= 30 && content.seo.titleLength <= 65 ? '✓ ideal length' : '✗ off (30–65)'} />
                <Chip label="Meta desc"    value={content.seo.metaDesc ? `${content.seo.metaDescLength}c` : 'Missing'} sub={content.seo.metaDesc ? (content.seo.metaDescLength >= 120 && content.seo.metaDescLength <= 160 ? '✓ ideal' : '✗ off (120–160)') : '✗ not found'} />
                <Chip label="Alt coverage" value={`${content.seo.imgAltScore}%`} sub={`${content.seo.imgsWithoutAlt} missing`} />
                <Chip label="H1 tags"      value={content.seo.h1s.length} sub={content.seo.h1s.length === 1 ? '✓ correct' : content.seo.h1s.length === 0 ? '✗ none found' : '✗ too many'} />
              </div>
              {content.seo.title && (
                <div style={{ background: 'rgba(28,25,23,0.03)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, border: '1px solid rgba(28,25,23,0.07)' }}>
                  <p style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Page title</p>
                  <p style={{ fontSize: 13, color: C.text, fontWeight: 300 }}>"{content.seo.title}"</p>
                </div>
              )}
              {content.seo.metaDesc && (
                <div style={{ background: 'rgba(28,25,23,0.03)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, border: '1px solid rgba(28,25,23,0.07)' }}>
                  <p style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Meta description</p>
                  <p style={{ fontSize: 13, color: C.text, fontWeight: 300 }}>"{content.seo.metaDesc.slice(0, 120)}{content.seo.metaDesc.length > 120 ? '…' : ''}"</p>
                </div>
              )}
              <div className="check-tags" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: content.seo.issues.length ? 14 : 0 }}>
                <CheckTag label="No duplicate pages" ok={content.seo.canonicalPresent} title="Canonical tag — tells Google which version of a page is the original, preventing duplicate content penalties" />
                <CheckTag label="Social sharing preview" ok={content.seo.ogTitlePresent} title="Open Graph tags — control how your page looks when shared on Facebook, LinkedIn, etc." />
                <CheckTag label="Rich search results" ok={content.seo.structuredData} title="Schema.org structured data — helps Google show extra info (ratings, prices) in search results" />
              </div>
              {content.seo.issues.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
                  {content.seo.issues.map((issue, i) => <IssueTag key={i} text={issue} />)}
                </div>
              )}
            </Section>
          )}

          {content?.copy && (
            <Section title="Copy & UX" delay={0.34} visible={visible}>
              <div className="chips-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
                <Chip label="Copy Score" value={`${content.copy.score}/100`} sub="out of 100" />
                {!content.copy.isSPA && <Chip label="Word count" value={content.copy.wordCount} sub="on page" />}
              </div>
              {content.copy.isSPA && (
                <div style={{ background: 'rgba(42,92,69,0.05)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, border: '1px solid rgba(42,92,69,0.12)' }}>
                  <p style={{ fontSize: 12, color: C.accent, fontWeight: 300 }}>ℹ️ Your site loads content with JavaScript — we analysed what was visible to search engines and our scanner. Some copy details may not be available.</p>
                </div>
              )}
              {content.copy.heroHeadline && (
                <div style={{ background: content.copy.isOutcomeFocused ? 'rgba(42,92,69,0.05)' : 'rgba(192,57,43,0.05)', borderRadius: 8, padding: '12px 14px', marginBottom: 14, border: `1px solid ${content.copy.isOutcomeFocused ? 'rgba(42,92,69,0.15)' : 'rgba(192,57,43,0.15)'}` }}>
                  <p style={{ fontSize: 10, color: C.light, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>
                    Hero headline — {content.copy.isOutcomeFocused ? '✓ outcome-focused' : '✗ not outcome-focused'}
                  </p>
                  <p style={{ fontSize: 14, color: C.text, fontWeight: 300, fontStyle: 'italic' }}>"{content.copy.heroHeadline}"</p>
                </div>
              )}
              <div className="check-tags" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                <CheckTag label="Clear CTA"       ok={content.copy.hasCTA} />
                <CheckTag label="Social proof"    ok={content.copy.hasSocialProof} />
                <CheckTag label="Price visible"   ok={content.copy.hasPriceVisible} />
                <CheckTag label="Outcome headline" ok={content.copy.isOutcomeFocused} />
              </div>
              {copyAnalysis && (
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, fontWeight: 300, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>{copyAnalysis}</p>
              )}
              {content.copy.issues.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
                  {content.copy.issues.map((issue, i) => <IssueTag key={i} text={issue} />)}
                </div>
              )}
            </Section>
          )}

          {/* ── PUNKT 5: socialAnalysis Guard — kein String-'null'-Check mehr ─── */}
          {hasSocial && (
            <Section title={`Social Media${benchmarkData?.industryLabel ? ` · ${benchmarkData.industryLabel}` : ''}`} delay={0.38} visible={visible}>
              {(benchmarkData?.tiktokIsNewAccount || benchmarkData?.instagramIsNewAccount) && (
                <div style={{ background: 'rgba(42,92,69,0.05)', border: '1px solid rgba(42,92,69,0.15)', borderRadius: 8, padding: '9px 14px', marginBottom: 14 }}>
                  <p style={{ fontSize: 12, color: C.accent, fontWeight: 300, lineHeight: 1.55 }}>
                    🌱 <strong style={{ fontWeight: 500 }}>New account detected.</strong> Benchmarks are based on established accounts — your numbers will look low at this stage, and that's completely normal. Focus on consistency over the next 90 days.
                  </p>
                </div>
              )}
              <div className="chips-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {tiktok    && <Chip label="TikTok"      value={tiktok.followers?.toLocaleString()}    sub={`${tiktok.engagementRate ?? '?'}% interaction`} />}
                {tiktok    && <Chip label="Avg Views"   value={tiktok.avgViews?.toLocaleString()}     sub="per video" />}
                {instagram && <Chip label="Instagram"   value={instagram.followers?.toLocaleString()} sub={`${instagram.engagementRate ?? '?'}% interaction`} />}
                {youtube   && <Chip label="YouTube"     value={youtube.subscribers?.toLocaleString()} sub="subscribers" />}
                {twitter   && <Chip label="X / Twitter" value={twitter.followers?.toLocaleString()}   sub="followers" />}
              </div>
              {socialAnalysis && (
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, fontWeight: 300, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>{socialAnalysis}</p>
              )}
            </Section>
          )}

          <div style={{ opacity: 0, animation: visible ? 'fadeUp 0.6s ease 0.42s forwards' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <p style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: C.light, fontWeight: 500 }}>Priority Actions</p>
              <p style={{ fontSize: 11, color: C.light, fontWeight: 300 }}>2 of {topIssues?.length || 5} shown</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleActions.map((issue, i) => <ActionCard key={i} issue={issue} />)}
            </div>

            {lockedActions.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {lockedActions.map((issue, i) => <LockedActionCard key={i} issue={issue} />)}
                </div>
                <UnlockBlock lockedCount={lockedActions.length} navigate={navigate} />
              </div>
            )}
          </div>

          <div style={{ marginTop: 52, textAlign: 'center', opacity: 0, animation: visible ? 'fadeUp 0.6s ease 0.5s forwards' : 'none' }}>
            <button onClick={() => navigate('/')}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 28px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: 300, cursor: 'pointer', color: C.muted, transition: 'all .2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(28,25,23,0.3)'; e.currentTarget.style.color = C.text }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
            >← Run another scan</button>
          </div>
        </div>

        <div className="report-footer" style={{ borderTop: `1px solid ${C.border}`, padding: '24px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13, color: C.light, fontWeight: 300 }}>© 2026 Velyr</span>
          <div className="report-footer-links" style={{ display: 'flex', gap: 20 }}>
            <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.light, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
            <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.light, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Legal Notice (Impressum)</button>
            <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.light, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>AGB</button>
          </div>
        </div>

      </div>
    </>
  )
}