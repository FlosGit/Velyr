import { useState, useEffect, useRef } from 'react'
import { demoData } from './data/demoData'
import SubscribeButton from './components/SubscribeButton.jsx'

const C = {
  bg:          '#f7f4ef',
  bgSecond:    '#f0ece4',
  bgCard:      '#ffffff',
  text:        '#1c1917',
  textMuted:   '#6b6460',
  textLight:   '#a09890',
  border:      'rgba(28,25,23,0.09)',
  accent:      '#2a5c45',
  accentLight: 'rgba(42,92,69,0.08)',
  warm:        '#8c7355',
  red:         '#c0392b',
  yellow:      '#d68910',
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garant:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&family=DM+Mono:wght@400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: #f7f4ef; color: #1c1917; font-family: 'Jost', sans-serif; font-weight: 300; overflow-x: hidden; -webkit-font-smoothing: antialiased; }

  @keyframes fadeUp  { from { opacity:0; transform:translateY(22px) } to { opacity:1; transform:none } }
  @keyframes float   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
  @keyframes agentPing { 0% { transform:scale(1); opacity:0.6; } 100% { transform:scale(2.2); opacity:0; } }

  .reveal { opacity:0; transform:translateY(20px); transition: opacity .6s cubic-bezier(.4,0,.2,1), transform .6s cubic-bezier(.4,0,.2,1); }
  .reveal.in { opacity:1; transform:none; }

  .btn-primary {
    background:#1c1917; color:#f7f4ef; border:none; border-radius:10px;
    padding:15px 28px; font-family:'Jost',sans-serif; font-weight:500; font-size:15px;
    cursor:pointer; width:100%; letter-spacing:.03em;
    transition: background .2s, transform .15s, box-shadow .2s;
  }
  .btn-primary:hover:not(:disabled) { background:#2a5c45; transform:translateY(-2px); box-shadow:0 12px 36px rgba(42,92,69,0.22); }
  .btn-primary:active:not(:disabled) { transform:none; }
  .btn-primary:disabled { opacity:0.6; cursor:not-allowed; }

  .btn-ghost {
    background:transparent; color:#1c1917; border:1px solid rgba(28,25,23,0.18); border-radius:10px;
    padding:14px 28px; font-family:'Jost',sans-serif; font-weight:400; font-size:15px;
    cursor:pointer; width:100%; letter-spacing:.03em;
    transition: border-color .2s, background .2s, transform .15s;
  }
  .btn-ghost:hover { border-color:rgba(28,25,23,0.35); background:rgba(28,25,23,0.03); transform:translateY(-1px); }

  ::-webkit-scrollbar { width:5px; }
  ::-webkit-scrollbar-track { background:#f7f4ef; }
  ::-webkit-scrollbar-thumb { background:rgba(28,25,23,0.12); border-radius:3px; }

  html, body { overflow-x: hidden; max-width: 100vw; }
  img, svg, video { max-width: 100%; height: auto; }

  .nav-burger { display: none; }
  .nav-mobile-panel { display: none; }

  @media (max-width: 640px) {
    nav { padding: 0 16px !important; }
    .nav-agent-link { display: none !important; }
    .nav-burger { display: flex !important; }
    .hero-section { padding: 96px 16px 48px !important; }
    .hero-stats { gap: 28px !important; }
    .section-pad { padding: 64px 16px !important; }
    .pricing-grid { grid-template-columns: 1fr !important; }
    .footer-inner { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
    .agent-bottom-grid { grid-template-columns: 1fr !important; }
    .agent-features-grid { grid-template-columns: 1fr !important; }
    .footer { padding: 24px 16px !important; }
    .footer-links { flex-wrap: wrap !important; gap: 10px !important; }
    .agent-cta-card { padding: 22px 20px !important; }
    .pricing-card { padding: 26px 22px !important; }
    .growth-section { padding: 64px 16px !important; }
    .nav-logo-text { font-size: 18px !important; }
  }

  @media (max-width: 900px) {
    .agent-bottom-grid { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 768px) {
    .dash-preview-shell .dp-leftnav { display: none !important; }
    .dash-preview-shell { flex-direction: column !important; }
    .dash-preview-shell .dp-main { padding: 18px 16px !important; }
    .dash-preview-shell .dp-overview-grid { flex-direction: column !important; }
    .dash-preview-shell .dp-rightsb { width: 100% !important; min-width: 0 !important; max-width: none !important; flex-basis: auto !important; }
    .dash-preview-shell .dp-kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .dash-preview-shell .dp-2col { flex-direction: column !important; }
    .dash-preview-shell .dp-2col > div { flex: 1 1 100% !important; width: 100% !important; max-width: 100% !important; }
    .dash-preview-shell code { display: none !important; }
  }
  @media (max-width: 480px) {
    .dash-preview-shell .dp-kpis { grid-template-columns: 1fr !important; }
    .dash-preview-shell .dp-insights-grid { grid-template-columns: 1fr !important; }
    .dash-preview-shell .dp-activity-text { white-space: normal !important; word-break: break-word !important; overflow-wrap: anywhere !important; overflow: visible !important; text-overflow: clip !important; }
    .dash-preview-shell .dp-activity-time { display: none !important; }
    .dash-preview-shell .dp-pages-row { width: 100% !important; max-width: 100% !important; overflow: hidden !important; }
    .dash-preview-shell .dp-page-chip { max-width: 100% !important; min-width: 0 !important; font-size: 9px !important; }
    .dash-preview-shell .dp-page-chip > span:first-child { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; min-width: 0 !important; }
  }
`

function useReveal(delay = 0) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect() } }, { threshold: 0.08 })
    obs.observe(el); return () => obs.disconnect()
  }, [])
  return [ref, visible]
}

function Logo({ size = 32, color = '#2a5c45' }) {
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

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ navigate }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { const fn = () => setScrolled(window.scrollY > 32); window.addEventListener('scroll', fn); return () => window.removeEventListener('scroll', fn) }, [])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  const goAndClose = (fn) => () => { setMenuOpen(false); fn() }

  return (
    <>
      <nav style={{
        position:'fixed', top:0, left:0, right:0, zIndex:100, height:60,
        padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
        background: scrolled || menuOpen ? 'rgba(247,244,239,0.93)' : 'transparent',
        backdropFilter: scrolled || menuOpen ? 'blur(16px)' : 'none',
        borderBottom: scrolled || menuOpen ? '1px solid rgba(28,25,23,0.08)' : '1px solid transparent',
        transition:'all .35s ease',
      }}>
        <div onClick={() => navigate('/')} style={{ display:'flex', alignItems:'center', gap:9, cursor:'pointer', minWidth:0, flexShrink:1 }}>
          <Logo size={24} />
          <span className="nav-logo-text" style={{ fontFamily:'Cormorant Garant, serif', fontWeight:500, fontSize:20, color:C.text, letterSpacing:'-.01em' }}>Velyr</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:20 }}>
          <button className="nav-agent-link" onClick={() => document.getElementById('pricing-section')?.scrollIntoView({ behavior:'smooth' })}
            style={{ background:'transparent', border:'1px solid rgba(42,92,69,0.35)', borderRadius:8, cursor:'pointer', fontSize:13, color:C.accent, fontFamily:'Jost,sans-serif', fontWeight:400, letterSpacing:'.01em', padding:'7px 14px', transition:'all .2s', display:'flex', alignItems:'center', gap:6 }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(42,92,69,0.08)'; e.currentTarget.style.borderColor='rgba(42,92,69,0.6)' }}
            onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='rgba(42,92,69,0.35)' }}
          >
            Growth Agent
          </button>
          <button className="nav-agent-link" onClick={() => navigate('/agent/login')}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:C.textLight, fontFamily:'Jost,sans-serif', fontWeight:300, letterSpacing:'.01em', transition:'color .2s' }}
            onMouseEnter={e => e.currentTarget.style.color=C.textMuted}
            onMouseLeave={e => e.currentTarget.style.color=C.textLight}
          >Log in</button>
          <button
            className="nav-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
            style={{
              background:'transparent', border:'1px solid rgba(28,25,23,0.15)',
              borderRadius:8, width:38, height:38, padding:0,
              alignItems:'center', justifyContent:'center', cursor:'pointer',
              transition:'all .2s', flexShrink:0,
            }}
          >
            <span style={{ position:'relative', display:'block', width:16, height:12 }}>
              <span style={{ position:'absolute', left:0, right:0, height:1.5, background:C.text, borderRadius:1, top: menuOpen ? 5 : 0, transform: menuOpen ? 'rotate(45deg)' : 'none', transition:'all .25s ease' }} />
              <span style={{ position:'absolute', left:0, right:0, height:1.5, background:C.text, borderRadius:1, top:5, opacity: menuOpen ? 0 : 1, transition:'opacity .15s ease' }} />
              <span style={{ position:'absolute', left:0, right:0, height:1.5, background:C.text, borderRadius:1, top: menuOpen ? 5 : 10, transform: menuOpen ? 'rotate(-45deg)' : 'none', transition:'all .25s ease' }} />
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      <div
        onClick={() => setMenuOpen(false)}
        style={{
          position:'fixed', inset:0, zIndex:90,
          background:'rgba(28,25,23,0.35)',
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? 'auto' : 'none',
          transition:'opacity .25s ease',
        }}
      />
      <div
        className="nav-mobile-panel-root"
        style={{
          position:'fixed', top:60, left:0, right:0, zIndex:95,
          background:'rgba(247,244,239,0.98)', backdropFilter:'blur(16px)',
          borderBottom:'1px solid rgba(28,25,23,0.08)',
          boxShadow:'0 8px 24px rgba(28,25,23,0.08)',
          padding:'16px 20px 22px',
          transform: menuOpen ? 'translateY(0)' : 'translateY(-12px)',
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? 'auto' : 'none',
          transition:'opacity .25s ease, transform .25s ease',
          display:'flex', flexDirection:'column', gap:8,
        }}
      >
        <button onClick={goAndClose(() => document.getElementById('pricing-section')?.scrollIntoView({ behavior:'smooth' }))}
          style={{ width:'100%', background:'transparent', color:C.accent, border:`1px solid rgba(42,92,69,0.35)`, borderRadius:10, padding:'13px 16px', fontSize:14, fontFamily:'Jost,sans-serif', fontWeight:400, cursor:'pointer', textAlign:'left', letterSpacing:'.01em', display:'flex', alignItems:'center', gap:8 }}
        >
          Growth Agent — €29/mo
        </button>
        <button onClick={goAndClose(() => navigate('/agent/login'))}
          style={{ width:'100%', background:'transparent', color:C.textMuted, border:'none', borderRadius:10, padding:'12px 16px', fontSize:13, fontFamily:'Jost,sans-serif', fontWeight:300, cursor:'pointer', textAlign:'left' }}
        >Log in →</button>
      </div>
    </>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ navigate }) {
  const [ref, visible] = useReveal()

  // Stats sourced from demoData.headline (the 10-week demo dataset) — not hardcoded.
  const h = demoData.headline
  const convDelta   = `+${(h.conversion_rate_now - h.conversion_rate_before).toFixed(1)}pp`
  const bounceDelta = `−${h.bounce_rate_before - h.bounce_rate_now}pp`
  const fixes       = `${h.runs_merged} / ${h.runs_total}`
  const weeks       = `${h.runs_total}`

  const stats = [
    { value: convDelta,   label: 'Conversion rate' },
    { value: bounceDelta, label: 'Bounce rate' },
    { value: fixes,       label: 'Fixes shipped' },
    { value: weeks,       label: 'Weeks running' },
  ]

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <section className="hero-section" style={{ paddingTop:120, paddingBottom:64, paddingLeft:24, paddingRight:24, background:C.bg }}>
      <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ maxWidth:1060, margin:'0 auto' }}>

        {/* Live label + pulsing dot */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18 }}>
          <div style={{ position:'relative', width:10, height:10 }}>
            <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#22c55e', animation:'agentPing 2s ease-out infinite' }} />
            <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#22c55e' }} />
          </div>
          <span style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, fontWeight:400 }}>Growth Agent</span>
        </div>

        <h1 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:'clamp(36px, 6vw, 64px)', lineHeight:1.1, letterSpacing:'-.025em', color:C.text }}>
          Conversion fixes, <em style={{ fontStyle:'italic', color:C.warm }}>shipped weekly</em>.
        </h1>

        <p style={{ fontFamily:'Jost, sans-serif', fontWeight:300, fontSize:'clamp(16px, 1.6vw, 19px)', color:C.textMuted, maxWidth:640, marginTop:24, lineHeight:1.6 }}>
          Your AI growth agent identifies the #1 conversion problem on your site each week, writes the code fix, opens a Pull Request — and reverts itself if the metric drops.
        </p>

        <div className="hero-cta-row" style={{ display:'flex', gap:12, marginTop:40, flexWrap:'wrap' }}>
          <button className="btn-primary" style={{ width:'auto' }} onClick={() => scrollTo('pricing-section')}>See pricing →</button>
          <button className="btn-ghost" style={{ width:'auto' }} onClick={() => scrollTo('growth-agent')}>How it works</button>
        </div>

        <div style={{ marginTop:56 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, fontWeight:400, marginBottom:18 }}>10-week demo</p>
          <div className="hero-stats" style={{ display:'flex', gap:48, flexWrap:'wrap', justifyContent:'flex-start' }}>
            {stats.map((s, i) => (
              <div key={i}>
                <p style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:'clamp(28px, 3vw, 40px)', color:C.text, lineHeight:1 }}>{s.value}</p>
                <p style={{ fontFamily:'DM Mono, monospace', fontSize:11, letterSpacing:'.08em', textTransform:'uppercase', color:C.textMuted, marginTop:6 }}>{s.label}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize:11, letterSpacing:'.04em', color:C.textLight, fontWeight:300, marginTop:18 }}>Example data shown — your dashboard after onboarding.</p>
        </div>
      </div>
    </section>
  )
}

// ─── Growth Agent Section ─────────────────────────────────────────────────────
function GrowthAgentSection({ navigate }) {
  const [ref, visible] = useReveal()
  const [featuresExpanded, setFeaturesExpanded] = useState(false)

  const featuresTop = [
    { icon:'📱', title:'YES or NO from Telegram', desc:'You get a Telegram message every Monday with the problem, the solution, and the PR link. Reply YES to deploy or NO to skip — done.' },
  ]

  const featuresExtra = [
    { icon:'🔍', title:'Competitor weekly scan', desc:"Track up to 2 competitors. Every Monday the agent checks for hero, CTA, and pricing changes — and tells you what they shipped that you didn't." },
    { icon:'🔥', title:'Monthly roast report', desc:"Once a month, brutal honesty: what improved, what is still embarrassingly bad versus competitors, and what you keep ignoring that the agent can't fix for you." },
    { icon:'🌐', title:'Public impact timeline', desc:'Optional public page at velyr.io/agent/your-slug showing every run and its results. Use it as social proof or share with your team.' },
  ]

  const timelinePhases = [
    {
      phase: 'Monday',
      color: C.accent,
      steps: [
        { time:'8:00 am',  icon:'📊', text:'Weekly Executive Summary sent to Telegram — traffic, bounce rate, last week\'s impact.' },
        { time:'9:00 am',  icon:'🔍', text:'Agent reads your PostHog analytics + scans every page in your GitHub repo.' },
        { time:'9:10 am',  icon:'🎯', text:'Identifies the #1 conversion problem across your full funnel.' },
        { time:'9:15 am',  icon:'✍️', text:'Writes the code fix and opens a Pull Request with a live preview link.' },
        { time:'9:20 am',  icon:'📲', text:'Telegram message arrives — problem, data, solution, PR link. Reply YES to ship, NO to skip.' },
      ]
    },
    {
      phase: 'Wednesday',
      color: C.warm,
      steps: [
        { time:'9:00 am',  icon:'📈', text:'Mid-week check: traffic update, bounce rate delta, social traffic sources.' },
      ]
    },
    {
      phase: '+48h after deploy',
      color: C.yellow,
      steps: [
        { time:'Auto',  icon:'🔄', text:'Bounce rate check — if it increased 15%+, the agent auto-reverts and notifies you.' },
      ]
    },
  ]

  return (
    <section id="growth-agent" className="growth-section" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>

        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:64 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
            <div style={{ position:'relative', width:10, height:10 }}>
              <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#22c55e', animation:'agentPing 2s ease-out infinite' }} />
              <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#22c55e' }} />
            </div>
            <span style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, fontWeight:400 }}>Growth Agent</span>
          </div>
          <h2 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:'clamp(32px, 5vw, 60px)', letterSpacing:'-.025em', lineHeight:1.08, color:C.text, marginBottom:20 }}>
            Your website,<br />
            <em style={{ fontStyle:'italic', color:C.warm }}>always improving.</em>
          </h2>
          <p style={{ fontSize:17, color:C.textMuted, lineHeight:1.72, fontWeight:300, maxWidth:520 }}>
            A semi-autonomous AI agent that analyses your analytics, writes conversion fixes, and deploys them — with your approval. Every week, automatically.
          </p>
          <p style={{ fontSize:12, color:C.textLight, fontWeight:300, marginTop:12, letterSpacing:'.01em' }}>
            Requires a React, Next.js, or Vite site hosted on GitHub + Vercel.
          </p>
        </div>

        {/* Top features always visible */}
        <div className="agent-features-grid" style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:2, marginBottom:2 }}>
          {featuresTop.map((f, i) => (
            <div key={i} style={{
              background:'#fff',
              border:`1px solid ${C.border}`,
              borderRadius: i===0 ? '14px 0 0 0' : '0 14px 0 0',
              padding:'32px 28px',
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(16px)',
              transition: `all .55s ease ${i * 0.07}s`,
            }}>
              <div style={{ fontSize:24, marginBottom:16 }}>{f.icon}</div>
              <h3 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:400, fontSize:20, color:C.text, marginBottom:10, letterSpacing:'-.01em' }}>{f.title}</h3>
              <p style={{ fontSize:14, color:C.textMuted, lineHeight:1.72, fontWeight:300 }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Expandable extra features */}
        <div style={{ maxHeight:featuresExpanded?400:0, overflow:'hidden', transition:'max-height .4s cubic-bezier(.4,0,.2,1)' }}>
          <div className="agent-features-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:2, marginBottom:2 }}>
            {featuresExtra.map((f, i) => (
              <div key={i} style={{
                background:'#fff',
                border:`1px solid ${C.border}`,
                borderRadius: i===0 ? '0 0 0 14px' : i===2 ? '0 0 14px 0' : '0',
                padding:'32px 28px',
              }}>
                <div style={{ fontSize:24, marginBottom:16 }}>{f.icon}</div>
                <h3 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:400, fontSize:20, color:C.text, marginBottom:10, letterSpacing:'-.01em' }}>{f.title}</h3>
                <p style={{ fontSize:14, color:C.textMuted, lineHeight:1.72, fontWeight:300 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <button onClick={() => setFeaturesExpanded(o=>!o)} style={{ width:'100%', background:'#fff', border:`1px solid ${C.border}`, borderRadius:'0 0 14px 14px', padding:'13px', fontFamily:'Jost,sans-serif', fontSize:13, fontWeight:300, color:C.textMuted, cursor:'pointer', transition:'all .2s', marginBottom:48, display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}
          onMouseEnter={e=>e.currentTarget.style.background=C.bgSecond}
          onMouseLeave={e=>e.currentTarget.style.background='#fff'}
        >
          {featuresExpanded ? '↑ Show less' : `↓ Show ${featuresExtra.length} more features`}
        </button>

        {/* How it works + CTA side by side */}
        <div className="agent-bottom-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>

          <div style={{
            background:'#fff', border:`1px solid ${C.border}`,
            borderRadius:16, padding:'32px 36px',
            opacity: visible ? 1 : 0,
            transform: visible ? 'none' : 'translateY(16px)',
            transition: 'all .6s ease .3s',
          }}>
            <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:C.textLight, fontWeight:400, marginBottom:28 }}>Weekly schedule</p>
            {timelinePhases.map((phase, pi) => (
              <div key={pi} style={{ marginBottom: pi < timelinePhases.length - 1 ? 28 : 0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:phase.color, flexShrink:0 }} />
                  <span style={{ fontSize:13, fontWeight:500, color:phase.color, letterSpacing:'.02em' }}>{phase.phase}</span>
                  <div style={{ flex:1, height:1, background:C.border }} />
                </div>
                <div style={{ paddingLeft:18, display:'flex', flexDirection:'column', gap:0 }}>
                  {phase.steps.map((step, si) => (
                    <div key={si} style={{
                      display:'flex', gap:14, alignItems:'flex-start',
                      paddingBottom: si < phase.steps.length - 1 ? 14 : 0,
                      marginBottom: si < phase.steps.length - 1 ? 14 : 0,
                      borderBottom: si < phase.steps.length - 1 ? `1px dashed rgba(28,25,23,0.07)` : 'none',
                    }}>
                      <div style={{ width:56, flexShrink:0, paddingTop:1 }}>
                        <span style={{ fontSize:11, color:C.textLight, fontWeight:300, fontFamily:'DM Mono, monospace' }}>{step.time}</span>
                      </div>
                      <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                        <span style={{ fontSize:14, lineHeight:1, marginTop:1 }}>{step.icon}</span>
                        <p style={{ fontSize:13, color:C.text, fontWeight:300, lineHeight:1.55 }}>{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[
              { value:'Every Monday', label:'Agent runs automatically', sub:'no manual work needed' },
              { value:'48h', label:'Auto-rollback window', sub:'reverts if metrics drop' },
              { value:'100%', label:'Approval stays with you', sub:'nothing ships without your OK' },
            ].map((stat, i) => (
              <div key={i} style={{
                background:'#fff', border:`1px solid ${C.border}`, borderRadius:14,
                padding:'22px 26px',
                opacity: visible ? 1 : 0,
                transform: visible ? 'none' : 'translateX(16px)',
                transition: `all .5s ease ${0.35 + i * 0.1}s`,
              }}>
                <p style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:30, color:C.accent, letterSpacing:'-.02em', lineHeight:1, marginBottom:6 }}>{stat.value}</p>
                <p style={{ fontSize:13, fontWeight:400, color:C.text, marginBottom:2 }}>{stat.label}</p>
                <p style={{ fontSize:12, color:C.textLight, fontWeight:300 }}>{stat.sub}</p>
              </div>
            ))}

            <div className="agent-cta-card" style={{
              background:C.accent, borderRadius:14, padding:'28px 26px',
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(12px)',
              transition: 'all .6s ease .65s',
            }}>
              <p style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:24, color:'#fff', letterSpacing:'-.015em', marginBottom:6 }}>Ready to let the agent work?</p>
              <p style={{ fontSize:13, color:'rgba(247,244,239,0.6)', fontWeight:300, marginBottom:20 }}>Set up in 5 minutes. €29/month. Cancel anytime.</p>
              <div style={{ display:'flex', gap:8, flexDirection:'column' }}>
                <button onClick={() => navigate('/agent/register')} style={{
                  background:'#f7f4ef', color:C.text, border:'none', borderRadius:10,
                  padding:'13px', fontSize:14, fontFamily:'Jost,sans-serif', fontWeight:500,
                  cursor:'pointer', letterSpacing:'.02em', transition:'all .2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background='#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.background='#f7f4ef' }}
                >Start Growth Agent →</button>
                <button onClick={() => navigate('/agent/login')} style={{
                  background:'transparent', color:'rgba(247,244,239,0.9)',
                  border:'1px solid rgba(247,244,239,0.35)', borderRadius:10,
                  padding:'12px', fontSize:13, fontFamily:'Jost,sans-serif', fontWeight:400,
                  cursor:'pointer', letterSpacing:'.02em', transition:'all .2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(247,244,239,0.6)'; e.currentTarget.style.color='#f7f4ef' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(247,244,239,0.35)'; e.currentTarget.style.color='rgba(247,244,239,0.9)' }}
                >Log in</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Agent Dashboard Preview ───────────────────────────────────────────────────
function AgentDashboardPreview({ navigate }) {
  const runs          = demoData.runs
  const funnelPages   = demoData.funnelPages
  const learnings     = demoData.learnings
  const impactMetrics = demoData.impactMetrics

  const total          = runs.length
  const deployed       = runs.filter(r => r.status === 'deployed').length
  const deployRate     = Math.round((deployed / total) * 100)
  const pendingCount   = runs.filter(r => r.status === 'waiting_approval').length
  const failedRejected = runs.filter(r => r.status === 'failed' || r.status === 'rejected').length

  const bounceImprove = impactMetrics.filter(m => m.value_before && m.value_after)
  const avgDelta = bounceImprove.length > 0
    ? Math.round(bounceImprove.reduce((s,m) => s + (m.value_before - m.value_after), 0) / bounceImprove.length)
    : null

  const topDropOff = [...funnelPages].filter(p => p.drop_off_score > 0).sort((a,b) => b.drop_off_score - a.drop_off_score)[0]
  const bestImpact = [...impactMetrics].filter(m => m.value_before > m.value_after).sort((a,b) => (b.value_before-b.value_after) - (a.value_before-a.value_after))[0]
  const bestRun    = bestImpact ? runs.find(r => r.id === bestImpact.run_id) : null

  const positiveLearnings = learnings.filter(l => l.outcome === 'positive')
  const winRate = learnings.length > 0 ? Math.round((positiveLearnings.length / learnings.length) * 100) : null

  const deployedRuns = runs.filter(r => r.status === 'deployed')
  const avgConvNum = deployedRuns.length > 0
    ? deployedRuns
        .map(r => parseFloat((r.analysis_result?.expected_improvement || '').replace(/[^0-9.]/g, '')) || 0)
        .reduce((s,v) => s+v, 0) / deployedRuns.length
    : null

  // Mirror the real dashboard's design tokens (Home.jsx fonts, AgentDashboard colors)
  const DC = {
    bg:          '#f7f4ef',
    bgCard:      '#ffffff',
    bgPanel:     '#faf8f4',
    text:        '#1a1916',
    textMuted:   '#6b6460',
    textLight:   '#a09890',
    border:      'rgba(26,25,22,0.08)',
    accent:      '#2a5c45',
    accentSoft:  'rgba(42,92,69,0.07)',
    accentMid:   'rgba(42,92,69,0.15)',
    green:       '#1e7a3c',
    greenSoft:   'rgba(30,122,60,0.07)',
    greenMid:    'rgba(30,122,60,0.2)',
    yellow:      '#c47d0e',
    yellowSoft:  'rgba(196,125,14,0.07)',
    yellowMid:   'rgba(196,125,14,0.18)',
    blue:        '#1d5fa8',
    blueSoft:    'rgba(29,95,168,0.07)',
    blueMid:     'rgba(29,95,168,0.15)',
    red:         '#b83232',
    redSoft:     'rgba(184,50,50,0.07)',
    redMid:      'rgba(184,50,50,0.18)',
    mutedSoft:   'rgba(107,100,96,0.07)',
    mutedMid:    'rgba(107,100,96,0.18)',
  }

  const STATUS_MAP = {
    deployed:         { label:'Deployed',          color:DC.green,     bg:DC.greenSoft,  border:DC.greenMid,  dot:DC.green     },
    waiting_approval: { label:'Awaiting Approval', color:DC.yellow,    bg:DC.yellowSoft, border:DC.yellowMid, dot:DC.yellow    },
    rejected:         { label:'Rejected',          color:DC.red,       bg:DC.redSoft,    border:DC.redMid,    dot:DC.red       },
    rolled_back:      { label:'Rolled Back',       color:DC.textMuted, bg:DC.mutedSoft,  border:DC.mutedMid,  dot:DC.textMuted },
  }

  const NAV_ITEMS = [
    { id:'overview',   label:'Overview',   icon:'⊙' },
    { id:'runs',       label:'Runs',       icon:'↻' },
    { id:'insights',   label:'Insights',   icon:'◈' },
    { id:'funnel',     label:'Funnel',     icon:'⬦' },
    { id:'dna',        label:'DNA',        icon:'◉' },
    { id:'guardrails', label:'Guardrails', icon:'◻' },
    { id:'settings',   label:'Settings',   icon:'⚙' },
  ]

  const AGENT_STEPS = [
    'Fetching repo',
    'Pulling analytics',
    'Scanning competitors',
    'Checking seasonal',
    'Reading Business DNA',
    'Mapping funnel',
    'Finding biggest issue',
    'Writing fix',
    'Opening pull request',
    'Sending notification',
  ]
  const inProgressIdx = AGENT_STEPS.length - 1 // last step (Sending notification) is blue / in-progress

  const kpis = [
    { label:'Total Runs',      value: total,            sub: 'All processed',     accent: false },
    { label:'Fixes Deployed',  value: deployed,         sub: '+1 this week',      accent: true  },
    { label:'Deploy Rate',     value: `${deployRate}%`, sub: 'On track',          accent: false },
    { label:'Avg. Bounce Δ',   value: avgDelta != null ? `−${avgDelta}%` : '—', sub:'After agent fixes', accent: false },
  ]

  const insights = [
    topDropOff && {
      icon:'⚠️', color:DC.yellow, bg:DC.yellowSoft, border:DC.yellowMid,
      label:'Biggest Drop-Off',
      value: topDropOff.page_path,
      sub: `${topDropOff.drop_off_score}% exit rate · ${topDropOff.views_7d} views/wk`,
      detail: 'Agent will prioritize this page next run',
    },
    bestRun && {
      icon:'📈', color:DC.green, bg:DC.greenSoft, border:DC.greenMid,
      label:'Most Improved',
      value: bestRun.analysis_result?.file_to_edit?.split('/').pop() || 'Last fix',
      sub: `Bounce −${Math.round(bestImpact.value_before-bestImpact.value_after)}% after deployment`,
      detail: '3 weeks ago',
    },
    avgConvNum != null && {
      icon:'💡', color:DC.accent, bg:DC.accentSoft, border:DC.accentMid,
      label:'Top Recommendation',
      value: runs[0]?.analysis_result?.problem?.slice(0,32) + '…',
      sub: `Est. impact: +${(Math.round(avgConvNum*10)/10)}% avg conversion`,
      detail: 'Based on last fix',
    },
    winRate != null && {
      icon:'🧠', color:DC.blue, bg:DC.blueSoft, border:DC.blueMid,
      label:'Agent Win Rate',
      value: `${winRate}%`,
      sub: `${positiveLearnings.length} of ${learnings.length} changes improved metrics`,
      detail: 'Business DNA learning',
    },
  ].filter(Boolean)

  const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime()
    const h = Math.floor(diff/3600000), d = Math.floor(h/24)
    if (d > 0) return `${d}d ago`
    if (h > 0) return `${h}h ago`
    return 'just now'
  }

  // Run history bar (oldest to latest)
  const last12 = [...runs].slice(0,12).reverse()

  return (
    <div className="dash-preview-shell" style={{
      display:'flex',
      width:'100%',
      maxWidth:'100%',
      background:DC.bg,
      border:`1px solid ${DC.border}`,
      borderRadius:16,
      overflow:'hidden',
      fontFamily:'Jost,sans-serif',
      color:DC.text,
    }}>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
      <div className="dp-leftnav" style={{
        width:160, flexShrink:0, background:DC.bgCard,
        borderRight:`1px solid ${DC.border}`,
        display:'flex', flexDirection:'column',
      }}>
        <div style={{
          padding:'18px 14px 14px',
          display:'flex', alignItems:'center', gap:9,
          borderBottom:`1px solid ${DC.border}`,
        }}>
          <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="13" stroke={DC.accent} strokeWidth="1" opacity="0.3"/>
            <circle cx="16" cy="16" r="8"  stroke={DC.accent} strokeWidth="1" opacity="0.55"/>
            <circle cx="16" cy="16" r="3"  fill={DC.accent}/>
            <line x1="16" y1="3"  x2="16" y2="8"  stroke={DC.accent} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
            <line x1="16" y1="24" x2="16" y2="29" stroke={DC.accent} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
            <line x1="3"  y1="16" x2="8"  y2="16" stroke={DC.accent} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
            <line x1="24" y1="16" x2="29" y2="16" stroke={DC.accent} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
          </svg>
          <div>
            <p style={{ fontFamily:'Cormorant Garant, serif', fontWeight:400, fontSize:17, color:DC.text, lineHeight:1 }}>Velyr</p>
            <p style={{ fontSize:9, color:DC.textLight, letterSpacing:'.06em', textTransform:'uppercase', marginTop:2 }}>Growth Agent</p>
          </div>
        </div>

        <nav style={{ padding:'10px 8px', flex:1 }}>
          {NAV_ITEMS.map(item => {
            const active = item.id === 'overview'
            return (
              <div key={item.id} style={{
                display:'flex', alignItems:'center', gap:9,
                padding:'8px 10px', borderRadius:7, marginBottom:2,
                background: active ? DC.accentSoft : 'transparent',
                color:      active ? DC.accent     : DC.textMuted,
                cursor:'default',
              }}>
                <span style={{ fontSize:13, flexShrink:0, opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                <span style={{ fontSize:12, fontWeight: active ? 500 : 400 }}>{item.label}</span>
              </div>
            )
          })}
        </nav>

        <div style={{ padding:'12px 14px', borderTop:`1px solid ${DC.border}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:DC.accent, flexShrink:0 }}/>
            <div>
              <p style={{ fontSize:11, color:DC.text, fontWeight:400 }}>Agent active</p>
              <p style={{ fontSize:9, color:DC.textLight }}>Autonomous mode</p>
            </div>
          </div>
          <div style={{
            width:'100%', marginTop:8, padding:'6px',
            borderRadius:6, fontSize:10,
            background:'transparent', color:DC.textMuted,
            border:`1px solid ${DC.border}`,
            textAlign:'center', cursor:'default',
          }}>‖ Pause</div>
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
      <div className="dp-main" style={{ flex:1, minWidth:0, padding:'22px 22px 24px' }}>

        {/* Page header */}
        <div style={{ marginBottom:18 }}>
          <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.accent, marginBottom:6 }}>Growth Agent Dashboard</p>
          <h1 style={{
            fontFamily:'Cormorant Garant, serif', fontWeight:400,
            fontSize:'clamp(22px,2.6vw,32px)', letterSpacing:'-.02em', lineHeight:1.1,
            color:DC.text, marginBottom:5,
          }}>
            Autonomous growth <em style={{ fontStyle:'italic', color:DC.accent }}>optimization.</em>
          </h1>
          <p style={{ fontSize:12, color:DC.textLight }}>Your agent analyzes, fixes and improves your website — continuously. · Auto-refreshes every 30s</p>
        </div>

        {/* Two-column: main column + right sidebar */}
        <div className="dp-overview-grid" style={{ display:'flex', gap:14, alignItems:'flex-start' }}>

          {/* Main column */}
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12 }}>

            {/* KPI bar */}
            <div className="dp-kpis" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
              {kpis.map((k,i) => (
                <div key={i} style={{
                  background: k.accent ? DC.accentSoft : DC.bgCard,
                  border: `1px solid ${k.accent ? DC.accentMid : DC.border}`,
                  borderRadius:12, padding:'13px 14px',
                }}>
                  <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color: k.accent ? DC.accent : DC.textLight, marginBottom:7 }}>{k.label}</p>
                  <p style={{ fontFamily:'Cormorant Garant, serif', fontSize:28, fontWeight:400, color: k.accent ? DC.accent : DC.text, lineHeight:1, marginBottom:3 }}>{k.value}</p>
                  <p style={{ fontSize:10, color:DC.textLight, fontWeight:300 }}>{k.sub}</p>
                </div>
              ))}
            </div>

            {/* Activity Stream + Top Insights */}
            <div className="dp-2col" style={{ display:'flex', flexDirection:'row', alignItems:'flex-start', gap:16 }}>

              {/* Activity Stream */}
              <div style={{ flex:'0 0 42%', minWidth:0, overflow:'hidden', background:DC.bgCard, border:`1px solid ${DC.border}`, borderRadius:12, padding:'14px 16px' }}>
                <div style={{ marginBottom:8 }}>
                  <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight, marginBottom:2 }}>Activity Stream</p>
                  <p style={{ fontSize:11, color:DC.textLight }}>Last actions taken</p>
                </div>
                <div>
                  {runs.map((run,i) => {
                    const s = STATUS_MAP[run.status] || STATUS_MAP.deployed
                    const a = run.analysis_result || {}
                    const file = a.file_to_edit?.split('/').pop()
                    return (
                      <div key={run.id} style={{
                        display:'flex', gap:10, alignItems:'flex-start',
                        padding:'9px 0',
                        borderBottom: i < runs.length-1 ? `1px solid ${DC.border}` : 'none',
                      }}>
                        <div style={{ width:8, height:8, borderRadius:'50%', background:s.dot, marginTop:5, flexShrink:0 }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                            <p className="dp-activity-text" style={{ fontSize:11.5, color:DC.text, lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{a.problem}</p>
                            <span className="dp-activity-time" style={{ fontSize:10, color:DC.textLight, flexShrink:0 }}>{timeAgo(run.created_at)}</span>
                          </div>
                          {a.expected_improvement && (
                            <p style={{ fontSize:10, color:DC.green, marginTop:2 }}>Expected: {a.expected_improvement}</p>
                          )}
                          {file && (
                            <code style={{ fontSize:9.5, color:DC.accent, background:DC.accentSoft, padding:'1px 5px', borderRadius:3, marginTop:3, display:'inline-block', fontFamily:'DM Mono, monospace' }}>{file}</code>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Top Insights (2x2) */}
              <div style={{ flex:'0 0 55%', minWidth:0, display:'flex', flexDirection:'column', gap:8 }}>
                <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight }}>Top Insights</p>
                <div className="dp-insights-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, width:'100%', overflow:'visible' }}>
                  {insights.map((ins,i) => (
                    <div key={i} style={{
                      minWidth:0, overflow:'hidden', wordBreak:'break-word',
                      background:ins.bg, border:`1px solid ${ins.border}`,
                      borderRadius:10, padding:'11px 12px',
                    }}>
                      <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                        <span style={{ fontSize:14, flexShrink:0 }}>{ins.icon}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:9, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:500, color:ins.color, marginBottom:3 }}>{ins.label}</p>
                          <p style={{ fontSize:11.5, fontWeight:500, color:DC.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2 }}>{ins.value}</p>
                          <p style={{ fontSize:10, color:DC.textMuted, lineHeight:1.4, marginBottom:3 }}>{ins.sub}</p>
                          <p style={{ fontSize:9, color:DC.textLight }}>{ins.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Pages Analyzed */}
            <div style={{ background:DC.bgCard, border:`1px solid ${DC.border}`, borderRadius:12, padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div>
                  <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight, marginBottom:2 }}>Pages Analyzed</p>
                  <p style={{ fontSize:11, color:DC.textLight }}>{funnelPages.length} pages · {funnelPages.filter(p => p.drop_off_score > 50).length} high-priority</p>
                </div>
                <span style={{ fontSize:11, color:DC.accent }}>Funnel ↗</span>
              </div>
              <div className="dp-pages-row" style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {funnelPages.map(p => {
                  const isHigh = p.drop_off_score > 50
                  const isMed  = !isHigh && p.drop_off_score > 30
                  return (
                    <div key={p.id} className="dp-page-chip" style={{
                      background: isHigh ? DC.redSoft  : isMed ? DC.yellowSoft : DC.accentSoft,
                      border: `1px solid ${isHigh ? DC.redMid : isMed ? DC.yellowMid : DC.accentMid}`,
                      borderRadius:6, padding:'5px 9px',
                      fontSize:10, color:DC.text, fontFamily:'DM Mono, monospace',
                      display:'flex', gap:6, alignItems:'center',
                    }}>
                      <span>{p.page_path}</span>
                      <span style={{ color: isHigh ? DC.red : isMed ? DC.yellow : DC.green, fontWeight:500 }}>{p.drop_off_score}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ─────────────────────────────────────────── */}
          <div className="dp-rightsb" style={{ minWidth:180, maxWidth:200, flexShrink:0, display:'flex', flexDirection:'column', gap:10 }}>

            {/* Status / Next run / Steps / Pause */}
            <div style={{ background:DC.bgCard, border:`1px solid ${DC.border}`, borderRadius:12, overflow:'hidden' }}>
              <div style={{
                padding:'10px 14px', background:DC.accentSoft,
                borderBottom:`1px solid ${DC.accentMid}`,
                display:'flex', alignItems:'center', justifyContent:'space-between',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:DC.accent }}/>
                  <span style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.accent }}>Idle</span>
                </div>
                <span style={{ fontSize:10, color:DC.textLight, fontFamily:'DM Mono, monospace' }}>Growth Agent</span>
              </div>

              <div style={{ padding:'12px 14px', borderBottom:`1px solid ${DC.border}` }}>
                <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight, marginBottom:8 }}>Next run in</p>
                <p style={{ fontFamily:'DM Mono, monospace', fontSize:20, color:DC.text, letterSpacing:'.02em', marginBottom:10 }}>6d 18h 40m</p>
                <div style={{ height:2, background:'rgba(42,92,69,0.1)', borderRadius:2, marginBottom:5 }}>
                  <div style={{ height:'100%', width:'12%', background:DC.accent, borderRadius:2 }}/>
                </div>
                <p style={{ fontSize:10, color:DC.textLight }}>Every Monday · 9:00 am</p>
              </div>

              <div style={{ padding:'12px 14px', borderBottom:`1px solid ${DC.border}` }}>
                <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight, marginBottom:10 }}>Last run · 18h ago</p>
                <div>
                  {AGENT_STEPS.map((step,i) => {
                    const current = i === inProgressIdx
                    const done    = !current
                    return (
                      <div key={step} style={{
                        display:'flex', gap:9, alignItems:'flex-start',
                        paddingBottom: i < AGENT_STEPS.length-1 ? 6 : 0,
                        position:'relative',
                      }}>
                        {i < AGENT_STEPS.length-1 && (
                          <div style={{
                            position:'absolute', left:7, top:15,
                            width:1, height:'calc(100% - 4px)',
                            background: done ? DC.accent : DC.border, opacity:0.3, zIndex:0,
                          }}/>
                        )}
                        <div style={{
                          width:15, height:15, borderRadius:'50%', flexShrink:0, zIndex:1,
                          background: current ? DC.blue : done ? DC.accent : 'rgba(26,25,22,0.07)',
                          border: `1px solid ${current ? DC.blue : done ? DC.accent : DC.border}`,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:8, color:'#fff',
                        }}>
                          {done && !current ? '✓' : ''}
                        </div>
                        <p style={{
                          fontSize:10.5, paddingTop:1,
                          color: current ? DC.blue : done ? DC.text : DC.textLight,
                          fontWeight: current ? 500 : 300,
                        }}>{step}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ padding:'10px 14px' }}>
                <div style={{
                  width:'100%', padding:'8px', borderRadius:7, fontSize:11,
                  background:'transparent', color:DC.textMuted,
                  border:`1px solid ${DC.border}`,
                  textAlign:'center', cursor:'default',
                }}>‖ Pause Agent</div>
              </div>
            </div>

            {/* Performance */}
            <div style={{ background:DC.bgCard, border:`1px solid ${DC.border}`, borderRadius:12, padding:'12px 14px' }}>
              <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight, marginBottom:10 }}>Performance</p>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                {[
                  { label:'Deploy rate',     value:`${deployRate}%`, color:DC.green },
                  { label:'Fixes merged',    value:deployed,         color:DC.accent },
                  { label:'Awaiting',        value:pendingCount,     color: pendingCount>0 ? DC.yellow : DC.textLight },
                  { label:'Failed/rejected', value:failedRejected,   color:DC.textLight },
                ].map((s,i) => (
                  <div key={i}>
                    <p style={{ fontFamily:'Cormorant Garant, serif', fontSize:22, fontWeight:400, color:s.color, lineHeight:1 }}>{s.value}</p>
                    <p style={{ fontSize:9, color:DC.textLight, marginTop:3 }}>{s.label}</p>
                  </div>
                ))}
              </div>

              <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.textLight, marginBottom:6 }}>Run history</p>
              <div style={{ display:'flex', gap:3, alignItems:'flex-end', height:24 }}>
                {last12.map((run,i) => {
                  const s = STATUS_MAP[run.status] || STATUS_MAP.deployed
                  const h = run.status === 'deployed' ? 24
                          : run.status === 'waiting_approval' ? 16
                          : (run.status === 'failed' || run.status === 'rejected') ? 8
                          : 14
                  return (
                    <div key={run.id} style={{
                      flex:1, height:h, background:s.dot, borderRadius:2,
                      opacity: 0.4 + (i / last12.length) * 0.6,
                    }}/>
                  )
                })}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:3 }}>
                <span style={{ fontSize:9, color:DC.textLight }}>oldest</span>
                <span style={{ fontSize:9, color:DC.textLight }}>latest</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Agent Requirements ───────────────────────────────────────────────────────
function AgentRequirements() {
  const [ref, visible] = useReveal()

  const requirements = [
    { icon:'🐙',  title:'GitHub repo',             desc:'Your website code lives in a GitHub repository the agent can read and open PRs against.' },
    { icon:'▲',  title:'Vercel deploy',           desc:'Your site is connected to Vercel so approved fixes auto-deploy after you reply YES.' },
    { icon:'⚛️',  title:'React, Next.js or Vite',  desc:'The agent writes React/JSX code. Plain HTML or other frameworks are not supported.' },
    { icon:'🔑',  title:'Admin access',             desc:'You can install GitHub Apps on the repo and merge Pull Requests.' },
    { icon:'✈️',  title:'Telegram account',         desc:'Weekly approvals arrive on Telegram — reply YES or NO to deploy or skip each fix.' },
  ]

  return (
    <section id="agent-requirements" className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:36 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Before you subscribe</p>
          <h2 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 52px)', letterSpacing:'-.02em', lineHeight:1.12 }}>Will the agent work for you?</h2>
          <p style={{ fontSize:15, color:C.textMuted, fontWeight:300, marginTop:14, maxWidth:560, lineHeight:1.65 }}>
            The Growth Agent reads your code, opens Pull Requests, and notifies you on Telegram. To do its job it needs five things — check you have them before you subscribe.
          </p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:18 }}>
          {requirements.map((r, i) => (
            <div key={i} style={{
              background:'#fff', border:`1px solid ${C.border}`, borderRadius:14,
              padding:'22px 20px',
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(14px)',
              transition: `all .5s ease ${0.05 + i * 0.06}s`,
            }}>
              <div style={{ fontSize:22, marginBottom:12 }}>{r.icon}</div>
              <p style={{ fontSize:14, fontWeight:500, color:C.text, marginBottom:6, letterSpacing:'-.005em' }}>{r.title}</p>
              <p style={{ fontSize:12.5, color:C.textMuted, fontWeight:300, lineHeight:1.6 }}>{r.desc}</p>
            </div>
          ))}
        </div>

        <div style={{
          background:'rgba(192,57,43,0.06)', border:'1px solid rgba(192,57,43,0.2)', borderRadius:12,
          padding:'14px 18px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap',
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'translateY(10px)',
          transition: 'all .5s ease .42s',
        }}>
          <span style={{ fontSize:11, letterSpacing:'.1em', textTransform:'uppercase', color:C.red, fontWeight:500, flexShrink:0 }}>✕ Not supported</span>
          <span style={{ fontSize:13, color:C.textMuted, fontWeight:300, lineHeight:1.55, flex:1, minWidth:240 }}>
            <strong style={{ color:C.text, fontWeight:500 }}>Shopify · Wix · Squarespace · Webflow</strong> — these site builders don't expose source code the agent can edit. If your site uses one of these, the Growth Agent isn't a fit yet.
          </span>
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────
function Pricing({ navigate }) {
  const [ref, visible] = useReveal()
  const [allFeaturesOpen, setAllFeaturesOpen] = useState(false)

  const agentFeaturesTop = ['AI analyses your repo + analytics weekly','Writes the code fix automatically','Reply YES or NO via Telegram','Auto-rollback if metrics drop','Competitor weekly scan']
  const agentFeaturesExtra = ['Identifies #1 conversion problem','Opens a GitHub Pull Request','Brand Guardrails — your rules enforced','Full funnel analysis (all pages)','Weekly summary on Telegram','Monthly roast report — brutal honesty','Business DNA — learns over time','Public impact timeline (shareable)']

  return (
    <section id="pricing-section" className="section-pad" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:56 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Pricing</p>
          <h2 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 52px)', letterSpacing:'-.02em' }}>Simple. No surprises.</h2>
        </div>
        <div className="pricing-grid" style={{ display:'flex', justifyContent:'center', gap:16 }}>

          {/* Growth Agent card */}
          <div className="pricing-card" style={{
            background:C.accent, border:'none', borderRadius:18, padding:32, position:'relative',
            opacity:visible?1:0, transform:visible?'none':'translateY(20px)', transition:'all .55s ease .24s',
            boxShadow:'0 8px 40px rgba(42,92,69,0.25)',
            maxWidth:420, width:'100%',
          }}>
            <div style={{ position:'absolute', top:18, right:18, background:'rgba(247,244,239,0.2)', color:'#fff', borderRadius:6, padding:'3px 10px', fontSize:11, fontWeight:500, letterSpacing:'.05em', display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:5, height:5, borderRadius:'50%', background:'#22c55e', display:'inline-block' }} />
              Autonomous
            </div>
            <p style={{ fontWeight:500, fontSize:15, marginBottom:5, color:'rgba(247,244,239,0.9)' }}>Growth Agent</p>
            <p style={{ color:'rgba(247,244,239,0.6)', fontSize:13, fontWeight:300, marginBottom:20 }}>Autonomous weekly improvements.</p>
            <span style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:52, letterSpacing:'-.03em', color:'#fff' }}>€29</span>
            <sup style={{ fontSize:14, color:'rgba(247,244,239,0.5)', fontWeight:300, marginLeft:2 }}>*</sup>
            <p style={{ color:'rgba(247,244,239,0.5)', fontSize:12, marginBottom:4, fontWeight:300, marginTop:4 }}>per month · cancel anytime</p>
            <div style={{ display:'flex', flexDirection:'column', gap:9, marginBottom:0 }}>
              {agentFeaturesTop.map((f,j) => (
                <div key={j} style={{ display:'flex', alignItems:'flex-start', gap:9, fontSize:13 }}>
                  <span style={{ color:'rgba(247,244,239,0.7)', flexShrink:0, marginTop:1 }}>✓</span>
                  <span style={{ color:'rgba(247,244,239,0.85)', fontWeight:300 }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ maxHeight: allFeaturesOpen ? 600 : 0, overflow: 'hidden', transition: 'max-height .4s cubic-bezier(.4,0,.2,1)' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:9, paddingTop:9 }}>
                {agentFeaturesExtra.map((f,j) => (
                  <div key={j} style={{ display:'flex', alignItems:'flex-start', gap:9, fontSize:13 }}>
                    <span style={{ color:'rgba(247,244,239,0.7)', flexShrink:0, marginTop:1 }}>✓</span>
                    <span style={{ color:'rgba(247,244,239,0.85)', fontWeight:300 }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setAllFeaturesOpen(o => !o)}
              style={{
                display:'block', width:'100%',
                background:'transparent', border:'none', cursor:'pointer',
                padding:0, marginTop:14, marginBottom:18,
                textAlign:'center',
                fontSize:11.5, color:'rgba(247,244,239,0.65)',
                fontWeight:300, letterSpacing:'.03em',
                fontFamily:'Jost,sans-serif',
                transition:'color .2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#f7f4ef' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(247,244,239,0.65)' }}
            >{allFeaturesOpen ? 'Hide ↑' : 'Show all features ↓'}</button>
            <a
              href="#agent-requirements"
              onClick={(e) => { e.preventDefault(); document.getElementById('agent-requirements')?.scrollIntoView({ behavior:'smooth' }) }}
              style={{
                display:'block', textAlign:'center',
                fontSize:11.5, color:'rgba(247,244,239,0.65)',
                fontWeight:300, letterSpacing:'.03em',
                textDecoration:'none', marginBottom:10,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#f7f4ef' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(247,244,239,0.65)' }}
            >See requirements ↑</a>
            <SubscribeButton type="subscription" style={{ background:'#f7f4ef', color:C.text, fontSize:15 }} />
          </div>

        </div>
      </div>
    </section>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQ() {
  const [ref, visible] = useReveal()
  const [open, setOpen] = useState(null)

  const agentItems = [
    { q:'What is the Growth Agent?', a:'The Growth Agent is a semi-autonomous AI that runs every Monday. It reads your real PostHog analytics and your GitHub repo, finds the biggest conversion problem, writes the code fix, opens a Pull Request, and sends you a Telegram message — reply YES to deploy or NO to skip. All automatically.' },
    { q:'Do I have to approve every change before it goes live?', a:'Yes, always. Nothing ships without your explicit approval. You receive a Telegram message with the problem, the data behind it, the solution, and the PR link. Reply YES to deploy it, or NO to skip it.' },
    { q:"What happens if the agent's change makes things worse?", a:'The agent checks your bounce rate 48 hours after every deployment. If it increased by 15+ percentage points, it automatically creates a rollback PR, merges it, and notifies you via Telegram. Your site reverts without any manual work.' },
    { q:'What are Brand Guardrails?', a:'Rules you set in your dashboard that the agent must follow on every run — tone of voice, things it can never do, elements it must never change. Any suggestion that violates your guardrails is automatically rejected.' },
    { q:'What is Full Funnel analysis?', a:'Instead of only looking at your homepage, the agent scans every page in your GitHub repo, cross-references them with your real analytics, and identifies where visitors are dropping off. It then prioritises the highest-leverage page to fix.' },
  ]

  const items = agentItems

  return (
    <section className="section-pad" style={{ padding:'96px 24px' }}>
      <div style={{ maxWidth:720, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:40 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>FAQ</p>
          <h2 style={{ fontFamily:'Cormorant Garant, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 48px)', letterSpacing:'-.02em' }}>Questions you might have.</h2>
        </div>

        {items.map((item, i) => (
          <div key={`agent-${i}`} style={{ borderBottom:`1px solid ${C.border}` }}>
            <button onClick={() => setOpen(open===i?null:i)} style={{ width:'100%', background:'none', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'19px 0', textAlign:'left' }}>
              <span style={{ fontWeight:400, fontSize:15, color:C.text, paddingRight:16 }}>{item.q}</span>
              <span style={{ color:C.textLight, fontSize:20, lineHeight:1, flexShrink:0, transition:'transform .25s', transform:open===i?'rotate(45deg)':'none', display:'block' }}>+</span>
            </button>
            <div style={{ maxHeight:open===i?400:0, overflow:'hidden', transition:'max-height .35s cubic-bezier(.4,0,.2,1)' }}>
              <p style={{ color:C.textMuted, fontSize:14.5, lineHeight:1.75, fontWeight:300, paddingBottom:20 }}>{item.a}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function Footer({ navigate }) {
  return (
    <footer className="footer" style={{ borderTop:`1px solid ${C.border}`, padding:'24px 24px', background:C.bg }}>
      <div className="footer-inner" style={{ maxWidth:1060, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Logo size={20} />
          <span style={{ fontFamily:'Cormorant Garant, serif', fontWeight:400, fontSize:16, color:C.text }}>Velyr</span>
        </div>
        <p style={{ fontSize:13, color:C.textLight, fontWeight:300 }}>© 2026 Velyr · <a href="mailto:info@velyr.io" style={{ color:C.textLight, textDecoration:'none' }}>info@velyr.io</a></p>
        <div className="footer-links" style={{ display:'flex', gap:20 }}>
          {[
            { label:'FAQ', path:'/faq' },
            { label:'Privacy Policy', path:'/privacy' },
            { label:'Legal Notice (Impressum)', path:'/impressum' },
            { label:'AGB', path:'/agb' },
            { label:'Agent Login →', path:'/agent/login' },
          ].map(l => (
            <button key={l.label} onClick={() => navigate(l.path)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:C.textLight, fontFamily:'Jost,sans-serif', fontWeight:300, transition:'color .2s' }}
              onMouseEnter={e=>e.target.style.color=C.textMuted}
              onMouseLeave={e=>e.target.style.color=C.textLight}
            >{l.label}</button>
          ))}
        </div>
      </div>
    </footer>
  )
}

export default function Home({ navigate, scrollToPricing }) {
  useEffect(() => {
    if (scrollToPricing) {
      setTimeout(() => {
        document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [scrollToPricing])

  return (
    <>
      <style>{CSS}</style>
      <Nav navigate={navigate} />
      <Hero navigate={navigate} />
      {/* Dashboard mock rendered directly under the Hero as immediate proof. */}
      <section className="section-pad" style={{ padding:'80px 24px', background:C.bg }}>
        <div style={{ maxWidth:1060, margin:'0 auto' }}>
          <AgentDashboardPreview navigate={navigate} />
        </div>
      </section>
      <GrowthAgentSection navigate={navigate} />
      <AgentRequirements />
      <Pricing navigate={navigate} />
      <FAQ />
      <Footer navigate={navigate} />
    </>
  )
}