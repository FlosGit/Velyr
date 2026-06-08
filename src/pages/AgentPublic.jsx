import { useEffect, useState, useMemo } from 'react'
import { MOTION_CSS, CountUp } from '../lib/motion.jsx'

const C = {
  bg:        '#f7f4ef',
  card:      '#ffffff',
  text:      '#1c1917',
  textLight: '#6b6460',
  textFaint: '#a09890',
  accent:    '#2a5c45',
  accentSoft:'rgba(42,92,69,0.06)',
  accentMid: 'rgba(42,92,69,0.18)',
  border:    'rgba(28,25,23,0.08)',
  green:     '#1e7a3c',
  greenSoft: 'rgba(30,122,60,0.08)',
  yellow:    '#d68910',
  yellowSoft:'rgba(214,137,16,0.08)',
  red:       '#c0392b',
  redSoft:   'rgba(192,57,43,0.08)',
}

const STATUS_BADGE = {
  deployed:         { label: 'Deployed',     color: C.green,  bg: C.greenSoft  },
  approved:         { label: 'Deployed',     color: C.green,  bg: C.greenSoft  },
  rolled_back:      { label: 'Rolled Back',  color: C.red,    bg: C.redSoft    },
  rejected:         { label: 'Rolled Back',  color: C.red,    bg: C.redSoft    },
  waiting_approval: { label: 'Pending',      color: C.yellow, bg: C.yellowSoft },
  running:          { label: 'In Progress',  color: C.yellow, bg: C.yellowSoft },
  failed:           { label: 'Failed',       color: C.red,    bg: C.redSoft    },
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatRelative(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30)  return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

// ─── SVG line chart ──────────────────────────────────────────────────────────
function LineChart({ data, label, color = C.accent, suffix = '', invertColor = false }) {
  if (!data || data.length < 2) return null
  const W = 560, H = 140, P = 28
  const xs = data.map((_, i) => P + (i * (W - P * 2)) / (data.length - 1))
  const values = data.map(d => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const ys = values.map(v => H - P - ((v - min) / range) * (H - P * 2))
  const points = xs.map((x, i) => `${x},${ys[i]}`).join(' ')
  const last = data[data.length - 1].value
  const first = data[0].value
  const delta = last - first
  const isGood = invertColor ? delta < 0 : delta > 0
  const deltaColor = delta === 0 ? C.textFaint : (isGood ? C.green : C.red)
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textFaint, fontWeight: 500 }}>{label}</p>
        <p style={{ fontSize: 12, color: deltaColor, fontWeight: 500 }}>
          {first}{suffix} → {last}{suffix} · {delta > 0 ? '+' : ''}{delta}{suffix}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r="3" fill={color} />
        ))}
      </svg>
    </div>
  )
}

// ─── Run card ─────────────────────────────────────────────────────────────────
function RunCard({ run }) {
  const [showCompetitor, setShowCompetitor] = useState(false)
  const badge = STATUS_BADGE[run.status] || { label: run.status, color: C.textLight, bg: 'rgba(28,25,23,0.06)' }
  const bounceDelta = (run.bounce_rate_before != null && run.bounce_rate_after != null)
    ? run.bounce_rate_after - run.bounce_rate_before : null
  const bounceArrow = bounceDelta == null ? null : (bounceDelta < 0 ? '↓' : bounceDelta > 0 ? '↑' : '→')
  const bounceColor = bounceDelta == null ? C.textLight : (bounceDelta < 0 ? C.green : bounceDelta > 0 ? C.red : C.textLight)

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 26px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ fontSize: 12, color: C.textFaint, fontWeight: 400 }}>{formatDate(run.date)}</p>
        <span style={{
          fontSize: 11, fontWeight: 500, color: badge.color, background: badge.bg,
          borderRadius: 6, padding: '4px 10px', letterSpacing: '.02em',
        }}>{badge.label}</span>
      </div>

      <p style={{ fontFamily: 'Cormorant Garant, serif', fontSize: 22, fontWeight: 300, color: C.text, lineHeight: 1.3, letterSpacing: '-.01em', marginBottom: 18 }}>
        {run.problem || 'No problem description'}
      </p>

      {run.ab_test && (
        <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 500, color: C.accent, background: C.accentSoft, border: `1px solid ${C.accentMid}`, borderRadius: 5, padding: '3px 8px', marginBottom: 14, letterSpacing: '.04em', textTransform: 'uppercase' }}>
          A/B Test · winner: {run.ab_test.winner}
        </span>
      )}

      {(run.screenshot_before || run.screenshot_after) && (
        <div className="ap-screenshot-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textFaint, fontWeight: 500, marginBottom: 6 }}>Before</p>
            {run.screenshot_before
              ? <img src={run.screenshot_before} alt="Before" style={{ width: '100%', borderRadius: 8, border: `1px solid ${C.border}`, display: 'block' }} />
              : <div style={{ aspectRatio: '16/10', background: C.bg, borderRadius: 8, border: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.textFaint }}>No screenshot</div>}
          </div>
          <div>
            <p style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textFaint, fontWeight: 500, marginBottom: 6 }}>After</p>
            {run.screenshot_after
              ? <img src={run.screenshot_after} alt="After" style={{ width: '100%', borderRadius: 8, border: `1px solid ${C.border}`, display: 'block' }} />
              : <div style={{ aspectRatio: '16/10', background: C.bg, borderRadius: 8, border: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.textFaint }}>{run.status === 'deployed' ? 'Capturing soon…' : 'Not captured'}</div>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 4 }}>
        {bounceDelta != null && (
          <p style={{ fontSize: 13, color: C.text, fontWeight: 400 }}>
            {/* Stage 5: honest labeling — this is the SITE-WIDE bounce rate
                measured around the change, not attributable to this single
                edit. See api/agent/run.js handleRollbackCheck. */}
            Site-wide bounce rate: <span style={{ color: bounceColor, fontWeight: 500 }}>{run.bounce_rate_before}% {bounceArrow} {run.bounce_rate_after}%</span>
            <span style={{ color: C.textLight, fontWeight: 300 }}> (correlation, not attributed to this change)</span>
          </p>
        )}
        {run.pr_url && (
          <a href={run.pr_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: C.accent, textDecoration: 'none', fontWeight: 500 }}>
            View code change →
          </a>
        )}
      </div>

      {run.competitor_changes?.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <button onClick={() => setShowCompetitor(s => !s)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 11, fontWeight: 500, color: C.yellow, letterSpacing: '.04em', textTransform: 'uppercase',
          }}>
            ⚠️ Competitor changes that week ({run.competitor_changes.length}) {showCompetitor ? '▴' : '▾'}
          </button>
          {showCompetitor && (
            <div style={{ marginTop: 10 }}>
              {run.competitor_changes.map((c, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{c.url}</p>
                  {c.diffs?.map((d, j) => <p key={j} style={{ fontSize: 12, color: C.textLight, fontWeight: 300, marginLeft: 12 }}>· {d}</p>)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AgentPublic({ navigate, slug }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/agent/run?action=public-timeline&slug=${encodeURIComponent(slug)}`)
      .then(r => r.json().then(b => ({ ok: r.ok, status: r.status, body: b })))
      .then(({ ok, status, body }) => {
        if (!ok) { setError(status === 404 ? 'not_found' : 'generic'); setData(null) }
        else     { setData(body); setError(null) }
      })
      .catch(() => setError('generic'))
      .finally(() => setLoading(false))
  }, [slug])

  const scoreSeries  = useMemo(() => data?.runs?.filter(r => r.score_after != null).reverse().map(r => ({ x: r.date, value: r.score_after })) || [], [data])
  const bounceSeries = useMemo(() => data?.runs?.filter(r => r.bounce_rate_after != null).reverse().map(r => ({ x: r.date, value: r.bounce_rate_after })) || [], [data])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Jost, sans-serif' }}>
        <p style={{ fontSize: 13, color: C.textFaint, fontWeight: 300 }}>Loading timeline…</p>
      </div>
    )
  }

  if (error === 'not_found') {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Jost, sans-serif', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <p style={{ fontFamily: 'Cormorant Garant, serif', fontSize: 36, fontWeight: 300, color: C.text, marginBottom: 12 }}>Not found</p>
          <p style={{ fontSize: 14, color: C.textLight, fontWeight: 300, marginBottom: 24 }}>This public agent timeline doesn't exist or has been made private.</p>
          <button className="v-press" onClick={() => navigate('/')} style={{ background: C.text, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: 500, cursor: 'pointer' }}>
            ← Back to Velyr
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ap-page-root" style={{ minHeight: '100vh', background: C.bg, fontFamily: 'Jost, sans-serif', color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@300;400&family=Jost:wght@300;400;500&display=swap');
        html, body { overflow-x: hidden; max-width: 100vw; }
        img, svg, video { max-width: 100%; }
        .ap-page-root { overflow-x: hidden; }
        @media (max-width: 600px) {
          .ap-hero-h1 { font-size: 30px !important; word-break: break-word; }
          .ap-dna-grid { grid-template-columns: 1fr !important; }
          .ap-footer-cta { padding: 28px 20px !important; flex-direction: column !important; align-items: flex-start !important; }
          .ap-screenshot-grid { grid-template-columns: 1fr !important; }
          .ap-nav { padding: 12px 16px !important; }
          .ap-nav-cta { font-size: 11px !important; padding: 7px 12px !important; }
          .ap-main { padding: 40px 16px 64px !important; }
        }
        ${MOTION_CSS}
      `}</style>

      {/* Sticky nav */}
      <nav className="ap-nav" style={{
        position: 'sticky', top: 0, zIndex: 10, background: `${C.bg}f0`, backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${C.border}`, padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }} style={{ fontFamily: 'Cormorant Garant, serif', fontSize: 18, fontWeight: 400, color: C.text, textDecoration: 'none', letterSpacing: '-.01em' }}>
          Velyr
        </a>
        <button className="ap-nav-cta v-press" onClick={() => navigate('/agent/register')} style={{
          background: C.accent, color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 16px', fontSize: 12, fontFamily: 'Jost, sans-serif', fontWeight: 500, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}>
          Get your own Growth Agent →
        </button>
      </nav>

      <main className="ap-main" style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px 80px' }}>
        {/* Hero */}
        <div style={{ marginBottom: 48 }}>
          <p style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.accent, fontWeight: 500, marginBottom: 10 }}>
            Growth Agent · Public Timeline
          </p>
          <h1 className="ap-hero-h1" style={{ fontFamily: 'Cormorant Garant, serif', fontSize: 44, fontWeight: 300, color: C.text, lineHeight: 1.1, letterSpacing: '-.02em', marginBottom: 8 }}>
            {data?.website_url || ''}
          </h1>
          <p style={{ fontSize: 14, color: C.textLight, fontWeight: 300 }}>
            Running since {formatDate(data?.created_at)}{formatRelative(data?.created_at) ? ` · ${formatRelative(data.created_at)}` : ''}
          </p>
        </div>

        {/* Charts */}
        {scoreSeries.length >= 2  && <LineChart data={scoreSeries}  label="Score over time"        color={C.accent} suffix="" />}
        {bounceSeries.length >= 2 && <LineChart data={bounceSeries} label="Site-wide bounce rate over time" color={C.accent} suffix="%" invertColor />}

        {/* Runs */}
        <div className="v-stagger" style={{ marginTop: 36, marginBottom: 36 }}>
          <p style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, fontWeight: 500, marginBottom: 16 }}>
            Activity (<CountUp value={data?.runs?.length || 0} /> runs)
          </p>
          {(!data?.runs || data.runs.length === 0)
            ? <p style={{ fontSize: 13, color: C.textLight, fontWeight: 300 }}>No runs yet — check back after the next Monday run.</p>
            : data.runs.map(r => <RunCard key={r.id} run={r} />)}
        </div>

        {/* Business DNA */}
        {data?.business_dna?.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <p style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.textFaint, fontWeight: 500, marginBottom: 16 }}>
              What this site has learned
            </p>
            <div className="ap-dna-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px' }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: C.green, marginBottom: 12 }}>What works</p>
                {data.business_dna.filter(d => d.success > 0).length === 0
                  ? <p style={{ fontSize: 12, color: C.textFaint, fontWeight: 300 }}>None recorded yet</p>
                  : data.business_dna.filter(d => d.success > 0).map(d => (
                      <p key={d.fix_type} style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
                        <span style={{ fontWeight: 500 }}>{d.fix_type}</span>
                        <span style={{ color: C.textLight, fontWeight: 300 }}> · {d.success} success{d.success > 1 ? 'es' : ''}</span>
                      </p>
                    ))}
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px' }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: C.red, marginBottom: 12 }}>What was rolled back</p>
                {data.business_dna.filter(d => d.rollback > 0).length === 0
                  ? <p style={{ fontSize: 12, color: C.textFaint, fontWeight: 300 }}>None recorded yet</p>
                  : data.business_dna.filter(d => d.rollback > 0).map(d => (
                      <p key={d.fix_type} style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
                        <span style={{ fontWeight: 500 }}>{d.fix_type}</span>
                        <span style={{ color: C.textLight, fontWeight: 300 }}> · {d.rollback} rollback{d.rollback > 1 ? 's' : ''}</span>
                      </p>
                    ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer CTA */}
        <div className="ap-footer-cta" style={{
          background: C.text, color: '#fff', borderRadius: 16, padding: '40px 36px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap',
        }}>
          <div>
            <p style={{ fontFamily: 'Cormorant Garant, serif', fontSize: 28, fontWeight: 300, marginBottom: 6, letterSpacing: '-.02em', color: '#fff' }}>
              Want this for your website?
            </p>
            <p style={{ fontSize: 14, color: 'rgba(247,244,239,0.7)', fontWeight: 300 }}>
              €29 / month · cancel anytime
            </p>
          </div>
          <button className="v-press" onClick={() => navigate('/agent/register')} style={{
            background: C.bg, color: C.text, border: 'none', borderRadius: 10,
            padding: '14px 26px', fontSize: 14, fontFamily: 'Jost, sans-serif', fontWeight: 500, cursor: 'pointer', letterSpacing: '.02em',
          }}>
            Start Growth Agent →
          </button>
        </div>
      </main>

      {/* Legal footer (§5 TMG — Impressum must be reachable from every public page) */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: C.bg }}>
        <span style={{ fontSize: 13, color: C.textFaint, fontWeight: 300, fontFamily: 'Jost, sans-serif' }}>© 2026 Velyr</span>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textFaint, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
          <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textFaint, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Legal Notice (Impressum)</button>
          <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textFaint, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>AGB</button>
        </div>
      </div>
    </div>
  )
}
