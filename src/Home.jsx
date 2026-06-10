import { useState, useEffect, useRef } from 'react'
import { demoData } from './data/demoData'
import SubscribeButton from './components/SubscribeButton.jsx'
import SiteNetwork from './components/SiteNetwork.jsx'
import { mockSiteNetworkData } from './data/mockSiteNetwork.js'
import { CountUp, MOTION_CSS } from './lib/motion.jsx'
import HeroWorkspace from './components/HeroWorkspace.jsx'

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
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Instrument+Serif:ital@0;1&family=Jost:wght@300;400;500&family=DM+Mono:wght@400&display=swap');
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

  /* Solid-green variant — the hero's primary CTA leads with the brand green. */
  .btn-primary.btn-green { background:#2a5c45; }
  .btn-primary.btn-green:hover:not(:disabled) { background:#234d3a; box-shadow:0 12px 36px rgba(42,92,69,0.28); }

  .btn-ghost {
    background:transparent; color:#1c1917; border:1px solid rgba(28,25,23,0.18); border-radius:10px;
    padding:14px 28px; font-family:'Jost',sans-serif; font-weight:400; font-size:15px;
    cursor:pointer; width:100%; letter-spacing:.03em;
    transition: border-color .2s, background .2s, transform .15s;
  }
  .btn-ghost:hover { border-color:rgba(28,25,23,0.35); background:rgba(28,25,23,0.03); transform:translateY(-1px); }
  .btn-primary:focus-visible, .btn-ghost:focus-visible { outline:2px solid rgba(42,92,69,0.55); outline-offset:3px; }

  /* Card hover lift — GPU-cheap (transform + shadow only), calm timing. The
     entrance reveal lives on a wrapper, so this transition carries no stagger
     delay and stays snappy on hover. */
  .lift { transition: transform .25s cubic-bezier(.4,0,.2,1), box-shadow .25s cubic-bezier(.4,0,.2,1), border-color .25s ease; }
  .lift:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(28,25,23,0.09); border-color: rgba(28,25,23,0.16); }

  /* Dashboard mock: fade/rise the tab content on switch (keyed remount). */
  @keyframes tabIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .dp-tab { animation: tabIn .3s cubic-bezier(.4,0,.2,1); }

  /* "How it works" scrollytelling anchor — pins the value/CTA column while the
     schedule scrolls beside it (native sticky, no scroll-jacking). */
  .hiw-anchor { position: sticky; top: 84px; align-self: start; }

  /* Feathered cream wash between the hero animation and the centered copy —
     keeps the headline fully legible without ever reading as a box. */
  .hero-wash {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    background: radial-gradient(ellipse 680px 380px at 50% 47%,
      rgba(247,244,239,0.96) 0%, rgba(247,244,239,0.76) 50%, rgba(247,244,239,0) 77%);
  }

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
    .hero-section { padding: 110px 16px 64px !important; min-height: min(90vh, 660px) !important; }
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
    .why-compare { grid-template-columns: 1fr !important; }
    .diff-grid { grid-template-columns: 1fr !important; }
  }

  @media (max-width: 900px) {
    .agent-bottom-grid { grid-template-columns: 1fr !important; }
    .hero-section { min-height: min(88vh, 780px) !important; padding-top: 124px !important; padding-bottom: 72px !important; }
    .hero-wash { background: radial-gradient(ellipse 420px 300px at 50% 44%, rgba(247,244,239,0.96) 0%, rgba(247,244,239,0.78) 50%, rgba(247,244,239,0) 78%) !important; }
    .hiw-anchor { position: static !important; top: auto !important; }
  }
  @media (max-width: 640px) {
    .hero-wash { background: radial-gradient(ellipse 320px 360px at 50% 50%, rgba(247,244,239,0.95) 0%, rgba(247,244,239,0.74) 54%, rgba(247,244,239,0) 80%) !important; }
  }
  @media (max-width: 768px) {
    .dash-preview-shell .dp-leftnav { display: none !important; }
    .dash-preview-shell { flex-direction: column !important; }
    .dash-preview-shell .dp-main { padding: 18px 16px !important; }
    .dash-preview-shell .dp-overview-grid { flex-direction: column !important; }
    .dash-preview-shell .dp-rightsb { width: 100% !important; min-width: 0 !important; max-width: none !important; flex-basis: auto !important; }
    .dash-preview-shell .dp-kpis { grid-template-columns: repeat(2, 1fr) !important; }
    .dash-preview-shell .dp-2col { flex-direction: column !important; }
    .dash-preview-shell .dp-mc-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
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

  /* ── prefers-reduced-motion: hard static fallback ────────────────────────────
     Nothing moves. Reveals render at final state (useReveal also returns
     visible=true immediately), transitions/animations collapse to instant,
     smooth scroll is disabled, and hover lifts/translations are neutralized so
     even pointer interaction produces no movement (shadow cue only). */
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto !important; }
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      transition-delay: 0ms !important;
      scroll-behavior: auto !important;
    }
    .reveal { opacity: 1 !important; transform: none !important; }
    .lift:hover { transform: none !important; }
    .btn-primary:hover:not(:disabled) { transform: none !important; }
    .btn-ghost:hover { transform: none !important; }
  }
  ${MOTION_CSS}
`

// Reduced-motion: evaluated once at module load. Drives both useReveal (start
// visible, skip the observer) and any inline opacity/transform reveal that keys
// off `visible` — so nothing is animated or transiently hidden for these users.
const PREFERS_REDUCED = typeof window !== 'undefined' &&
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useReveal(delay = 0) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(PREFERS_REDUCED)
  useEffect(() => {
    if (PREFERS_REDUCED) return
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

// ─── Card icon — thin-stroke line glyphs in brand accent (replaces emoji) ─────
function CardIcon({ name, size = 22 }) {
  const common = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:C.accent, strokeWidth:1.4, strokeLinecap:'round', strokeLinejoin:'round' }
  const paths = {
    chat:     <><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.4A8 8 0 1 1 21 11.5z"/><path d="M8.8 11.8l2.1 2.1 4.3-4.3"/></>,
    scan:     <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/></>,
    report:   <><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/><path d="M9 12.5h6M9 16h4"/></>,
    share:    <><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M7.9 11l8.2-4M7.9 13l8.2 4"/></>,
    git:      <><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="17" cy="8" r="2.2"/><path d="M6 8.2v7.6"/><path d="M17 10.2c0 4-4.4 3.6-6.4 5"/></>,
    triangle: <path d="M12 4.5 20.5 19.5H3.5z"/>,
    code:     <><path d="M9 8.5 5.5 12 9 15.5"/><path d="M15 8.5 18.5 12 15 15.5"/></>,
    key:      <><circle cx="8" cy="15" r="3.2"/><path d="M10.3 12.7 20 3"/><path d="M16.5 6.5l2.5 2.5"/><path d="M14 9l2 2"/></>,
    send:     <><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.7 18-3.8-8.2L2.3 9.2 21 3z"/></>,
  }
  return (
    <div style={{ width:40, height:40, borderRadius:10, background:C.accentLight, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <svg {...common}>{paths[name] || null}</svg>
    </div>
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
          <span className="nav-logo-text" style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:500, fontSize:20, color:C.text, letterSpacing:'-.01em' }}>Velyr</span>
        </div>
        {/* Centered link — absolutely positioned so the left logo and right group stay put.
            Hidden on mobile via .nav-agent-link; appears in the mobile panel below. */}
        <button className="nav-agent-link" onClick={() => navigate('/blog')}
          style={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)', background:'none', border:'none', cursor:'pointer', fontSize:13, color:C.textLight, fontFamily:'Jost,sans-serif', fontWeight:300, letterSpacing:'.01em', transition:'color .2s' }}
          onMouseEnter={e => e.currentTarget.style.color=C.textMuted}
          onMouseLeave={e => e.currentTarget.style.color=C.textLight}
        >Blog</button>
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
        <button onClick={goAndClose(() => navigate('/blog'))}
          style={{ width:'100%', background:'transparent', color:C.textMuted, border:'none', borderRadius:10, padding:'12px 16px', fontSize:13, fontFamily:'Jost,sans-serif', fontWeight:300, cursor:'pointer', textAlign:'left' }}
        >Blog →</button>
        <button onClick={goAndClose(() => navigate('/agent/login'))}
          style={{ width:'100%', background:'transparent', color:C.textMuted, border:'none', borderRadius:10, padding:'12px 16px', fontSize:13, fontFamily:'Jost,sans-serif', fontWeight:300, cursor:'pointer', textAlign:'left' }}
        >Log in →</button>
      </div>
    </>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────────
// Centered copy over the full-bleed HeroWireframe animation. A feathered cream
// wash (.hero-wash) sits between the art and the text so the headline stays
// fully legible at every width — soft radial falloff, never a visible box.
// ≤900px the full-bleed scene is replaced by HeroWireframe's compact vignette,
// which flexes below the copy (order:1).
function Hero({ navigate }) {
  const [ref, visible] = useReveal()
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <section className="hero-section" style={{
      position:'relative', overflow:'hidden', background:C.bg,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      minHeight:'min(94vh, 880px)', padding:'140px 24px 96px',
    }}>
      <HeroWorkspace />
      <div className="hero-wash" aria-hidden="true" />

      <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ position:'relative', zIndex:2, maxWidth:780, margin:'0 auto', textAlign:'center' }}>
        {/* Brand eyebrow — calm, static (no live-activity implication) */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:9, marginBottom:18 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:C.accent, flexShrink:0 }} />
          <span style={{ fontSize:11, letterSpacing:'.16em', textTransform:'uppercase', color:C.accent, fontWeight:400 }}>AI Growth Agent</span>
        </div>

        <h1 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(38px, 5.6vw, 66px)', lineHeight:1.08, letterSpacing:'-.025em', color:C.text }}>
          Conversion fixes, <em style={{ fontStyle:'italic', color:C.accent }}>shipped weekly</em>.
        </h1>

        <p style={{ fontFamily:'Jost, sans-serif', fontWeight:300, fontSize:'clamp(16px, 1.6vw, 18px)', color:C.textMuted, maxWidth:540, margin:'22px auto 0', lineHeight:1.6 }}>
          An AI agent that finds your site's biggest conversion leak each week and writes the fix as a Pull Request — you approve it with one Telegram reply.
        </p>

        <div className="hero-cta-row" style={{ display:'flex', gap:12, marginTop:34, flexWrap:'wrap', alignItems:'center', justifyContent:'center' }}>
          <button className="btn-primary btn-green" style={{ width:'auto' }} onClick={() => navigate('/agent/register')}>Start free trial →</button>
          <button className="btn-ghost" style={{ width:'auto' }} onClick={() => scrollTo('growth-agent')}>See how it works</button>
        </div>
        <p style={{ fontSize:12.5, color:C.textLight, fontWeight:300, marginTop:14, letterSpacing:'.01em' }}>
          14-day free trial · You approve every change · Cancel anytime
        </p>
      </div>
    </section>
  )
}

// One phase block of the weekly schedule, revealing as it scrolls into view.
// Used by the "How it works" sticky scrollytelling (each phase advances as you
// scroll past the pinned value/CTA anchor).
function SchedulePhase({ phase }) {
  const [ref, vis] = useReveal()
  return (
    <div ref={ref} style={{
      background:'#fff', border:`1px solid ${C.border}`, borderRadius:16, padding:'22px 26px',
      opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateY(20px)',
      transition: 'opacity .6s cubic-bezier(.22,.61,.36,1), transform .6s cubic-bezier(.22,.61,.36,1)',
    }}>
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
  )
}

// ─── Growth Agent Section ─────────────────────────────────────────────────────
function GrowthAgentSection({ navigate }) {
  const [ref, visible] = useReveal()

  const timelinePhases = [
    {
      phase: 'Monday',
      color: C.accent,
      steps: [
        { time:'8:00 am',  icon:'📊', text:'Weekly Executive Summary sent to Telegram — traffic, bounce rate, last week\'s impact.' },
        { time:'9:00 am',  icon:'🔍', text:'Agent reads your PostHog analytics — traffic, bounce, plus how far visitors scroll and what they click — and scans every page in your GitHub repo.' },
        { time:'9:10 am',  icon:'🎯', text:'Identifies the #1 conversion problem across your full funnel.' },
        { time:'9:15 am',  icon:'✍️', text:'Writes the code fix and opens a Pull Request with a Vercel preview link.' },
        { time:'9:20 am',  icon:'📲', text:'Telegram message arrives — problem, data, solution, PR link. Reply YES to ship, NO to skip.' },
      ]
    },
    {
      phase: 'Wednesday',
      color: C.warm,
      steps: [
        { time:'9:00 am',  icon:'📈', text:'Mid-week check: traffic trend, bounce rate, and top traffic sources.' },
      ]
    },
    {
      phase: '+48h after deploy',
      color: C.yellow,
      steps: [
        { time:'Auto',  icon:'🔄', text:'Bounce rate check — if it rose 15 percentage points or more, the agent auto-reverts and notifies you.' },
      ]
    },
  ]

  return (
    <section id="growth-agent" className="growth-section" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>

        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:64 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:16 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:C.accent, flexShrink:0 }} />
            <span style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, fontWeight:400 }}>How it works</span>
          </div>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(32px, 5vw, 60px)', letterSpacing:'-.025em', lineHeight:1.08, color:C.text, marginBottom:20 }}>
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

        {/* How it works + CTA side by side */}
        <div className="agent-bottom-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>

          <div className="hiw-schedule" style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:C.textLight, fontWeight:400, marginBottom:2 }}>Weekly schedule</p>
            {timelinePhases.map((phase, pi) => (
              <SchedulePhase key={pi} phase={phase} />
            ))}
          </div>

          <div className="hiw-anchor" style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[
              { value:'Every Monday', label:'Agent runs automatically', sub:'no manual work needed' },
              { value:'48h', num:48, format:(n)=>`${Math.round(n)}h`, label:'Auto-rollback window', sub:'reverts if metrics drop' },
              { value:'100%', num:100, format:(n)=>`${Math.round(n)}%`, label:'Approval stays with you', sub:'nothing ships without your OK' },
            ].map((stat, i) => (
              <div key={i} style={{
                background:'#fff', border:`1px solid ${C.border}`, borderRadius:14,
                padding:'22px 26px',
                opacity: visible ? 1 : 0,
                transform: visible ? 'none' : 'translateX(16px)',
                transition: `all .5s ease ${0.35 + i * 0.1}s`,
              }}>
                <p style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:30, color:C.accent, letterSpacing:'-.02em', lineHeight:1, marginBottom:6 }}>{stat.num != null ? <CountUp value={visible ? stat.num : 0} format={stat.format} /> : stat.value}</p>
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
              <p style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:24, color:'#fff', letterSpacing:'-.015em', marginBottom:6 }}>Ready to let the agent work?</p>
              <p style={{ fontSize:13, color:'rgba(247,244,239,0.6)', fontWeight:300, marginBottom:20 }}>Set up in a few minutes. 14-day free trial, then €29/month. Cancel anytime.</p>
              <div style={{ display:'flex', gap:8, flexDirection:'column' }}>
                <button onClick={() => navigate('/agent/register')} style={{
                  background:'#f7f4ef', color:C.text, border:'none', borderRadius:10,
                  padding:'13px', fontSize:14, fontFamily:'Jost,sans-serif', fontWeight:500,
                  cursor:'pointer', letterSpacing:'.02em', transition:'all .2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background='#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.background='#f7f4ef' }}
                >Start free trial →</button>
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

// ─── Mock "mission control" ───────────────────────────────────────────────────
// The elevated pending-PR star — mirrors the real dashboard's PRMissionControl
// (Awaiting approval · Problem / Fix / Expected impact + confidence + rollback).
// Serif numerals use Instrument Serif to match the live dashboard exactly.
function MockMissionControl({ run, DC }) {
  const a = run.analysis_result || {}
  const conf = a.confidence_score
  const lbl = { fontSize:9.5, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, color:DC.textLight, marginBottom:6 }
  return (
    <div style={{
      background:DC.bgCard, border:`1px solid ${DC.yellowMid}`, borderRadius:12, overflow:'hidden',
      boxShadow:`0 10px 34px rgba(196,125,14,0.13), 0 0 0 3px ${DC.yellowSoft}`,
    }}>
      <div style={{ background:DC.yellowSoft, borderBottom:`1px solid ${DC.yellowMid}`, padding:'9px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:DC.yellow, display:'inline-block', flexShrink:0, animation:'pulse 2s ease-in-out infinite' }}/>
          <span style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, color:DC.yellow }}>Awaiting your approval · PR #{run.pr_number}</span>
        </div>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
          <span style={{ fontSize:10.5, color:DC.accent, background:DC.accentSoft, border:`1px solid ${DC.accentMid}`, borderRadius:6, padding:'3px 9px', fontWeight:500 }}>View on GitHub ↗</span>
          <span style={{ fontSize:10.5, color:DC.yellow, background:DC.yellowSoft, border:`1px solid ${DC.yellowMid}`, borderRadius:6, padding:'3px 9px' }}>Reply <code style={{ fontFamily:'DM Mono,monospace', fontSize:9.5 }}>YES</code> / <code style={{ fontFamily:'DM Mono,monospace', fontSize:9.5 }}>NO</code> on Telegram</span>
        </div>
      </div>
      <div className="dp-mc-grid" style={{ padding:'15px 16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
        <div>
          <p style={lbl}>Problem identified</p>
          <p style={{ fontSize:12.5, fontWeight:500, color:DC.text, lineHeight:1.45, marginBottom:5 }}>{a.problem}</p>
          <p style={{ fontSize:10.5, color:DC.textMuted, lineHeight:1.5 }}>{a.data_insight}</p>
        </div>
        <div>
          <p style={lbl}>Fix applied</p>
          <p style={{ fontSize:11.5, color:DC.text, lineHeight:1.45, marginBottom:8 }}>{a.solution}</p>
          <code style={{ fontSize:10, color:DC.accent, background:DC.accentSoft, padding:'3px 7px', borderRadius:5, border:`1px solid ${DC.accentMid}`, display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'DM Mono,monospace' }}>{a.file_to_edit}</code>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          <p style={{ ...lbl, marginBottom:0 }}>Expected impact</p>
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ fontFamily:'Instrument Serif, serif', fontSize:30, color:DC.green, lineHeight:1 }}>{a.expected_improvement}</span>
            <span style={{ fontSize:10.5, color:DC.textMuted }}>conversion</span>
          </div>
          {conf != null && (
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:9.5, color:DC.textLight }}>Confidence</span>
                <span style={{ fontSize:9.5, fontWeight:500, color:DC.text }}>{conf}%</span>
              </div>
              <div style={{ height:4, background:'rgba(26,25,22,0.08)', borderRadius:2 }}>
                <div className="v-bar-fill" style={{ height:'100%', width:`${conf}%`, '--v-w':`${conf}%`, background:conf>75?DC.green:conf>50?DC.yellow:DC.red, borderRadius:2 }}/>
              </div>
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:9.5 }}>
            <span style={{ color:DC.textLight }}>Auto-rollback</span>
            <span style={{ color:DC.textMuted }}>48h if no uplift</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Tiny trend sparkline for the accent KPI tile (echoes the real KPIBar's spark).
function MiniSpark({ data, color, w = 46, h = 20 }) {
  if (!data || !data.length) return null
  const max = Math.max(...data, 1)
  const step = w / Math.max(1, data.length - 1)
  const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(h - (d / max) * h * 0.8 - 2).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} style={{ display:'block', overflow:'visible' }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  )
}

// ─── Agent Dashboard Preview ───────────────────────────────────────────────────
function AgentDashboardPreview({ navigate }) {
  const runs          = demoData.runs
  const funnelPages   = demoData.funnelPages
  const learnings     = demoData.learnings
  const impactMetrics = demoData.impactMetrics

  // A pending PR for the elevated mission-control card. Kept LOCAL to this
  // marketing mock (deliberately NOT added to demoData) so the live
  // /agent?demo=true dashboard is unaffected. Shape mirrors a real agent_runs row.
  const pendingRun = {
    id: 'demo-pending', status: 'waiting_approval', pr_number: 251,
    pr_url: 'https://github.com/taskloop/web/pull/251',
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    analysis_result: {
      problem: 'Pricing page has no plan comparison table',
      data_insight: 'Visitors spend 24s on /pricing vs 1m08s on competitor pages with a side-by-side table — 58% leave without reaching a CTA.',
      solution: 'Add a 3-column plan comparison table with feature checkmarks and a "most popular" highlight above the pricing CTAs.',
      expected_improvement: '+0.3pp CVR',
      file_to_edit: 'src/pages/Pricing.tsx',
      confidence_score: 84,
    },
  }
  const allRuns = [pendingRun, ...runs]

  const total          = allRuns.length
  const deployed       = runs.filter(r => r.status === 'deployed').length
  const deployRate     = Math.round((deployed / runs.length) * 100)
  const pendingCount   = allRuns.filter(r => r.status === 'waiting_approval').length
  const failedRejected = runs.filter(r => r.status === 'failed' || r.status === 'rejected').length

  const topDropOff = [...funnelPages].filter(p => p.drop_off_score > 0).sort((a,b) => b.drop_off_score - a.drop_off_score)[0]
  const bestImpact = [...impactMetrics].filter(m => m.value_before > m.value_after).sort((a,b) => (b.value_before-b.value_after) - (a.value_before-a.value_after))[0]
  const bestRun    = bestImpact ? runs.find(r => r.id === bestImpact.run_id) : null

  const positiveLearnings = learnings.filter(l => l.outcome === 'positive')
  const winRate = learnings.length > 0 ? Math.round((positiveLearnings.length / learnings.length) * 100) : null

  // Outcome-led KPI inputs — mirror the live dashboard's KPIBar
  // (Fixes Live / Avg Uplift on Wins / Runs), not the old process metrics.
  const winDeltas = positiveLearnings.filter(l => l.delta).map(l => l.delta)
  const avgUplift = winDeltas.length ? Math.round(winDeltas.reduce((s,v) => s+v, 0) / winDeltas.length) : null
  const sparkData = [...runs].slice(0,8).reverse().map(r => r.status === 'deployed' ? 1 : 0.35)

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

  const [tab, setTab] = useState('overview')

  // Only Overview, Insights, Funnel and Network are wired in this landing mock;
  // the rest are visible-but-inert, matching the real dashboard's look.
  const NAV_ITEMS = [
    { id:'overview',   label:'Overview',   icon:'⊙', wired:true },
    { id:'runs',       label:'Runs',       icon:'↻' },
    { id:'insights',   label:'Insights',   icon:'◈', wired:true },
    { id:'funnel',     label:'Funnel',     icon:'⬦', wired:true },
    { id:'network',    label:'Network',    icon:'⬡', wired:true },
    { id:'dna',        label:'DNA',        icon:'◉' },
    { id:'guardrails', label:'Guardrails', icon:'◻' },
    { id:'settings',   label:'Settings',   icon:'⚙' },
  ]

  const HEADER = {
    overview: { kicker:'Growth Agent Dashboard', title:<>Autonomous growth <em style={{ fontStyle:'italic', color:DC.accent }}>optimization.</em></>, sub:'Your agent analyzes, fixes and improves your website — continuously. · Auto-refreshes every 30s' },
    insights: { kicker:'Insights',               title:<>What the agent <em style={{ fontStyle:'italic', color:DC.accent }}>learned.</em></>, sub:'Patterns and recommendations distilled from your runs and outcomes.' },
    funnel:   { kicker:'Funnel',                 title:<>Where visitors <em style={{ fontStyle:'italic', color:DC.accent }}>drop off.</em></>, sub:'Every page cross-referenced with analytics to find the biggest leak.' },
    network:  { kicker:'Site Network',           title:<>The map the agent <em style={{ fontStyle:'italic', color:DC.accent }}>works from.</em></>, sub:'Every page in your repo and how visitors move between them.' },
  }
  const head = HEADER[tab] || HEADER.overview

  const AGENT_STEPS = [
    'Fetching repo',
    'Pulling analytics',
    'Scanning competitors',
    'Reading Business DNA',
    'Mapping funnel',
    'Finding biggest issue',
    'Writing fix',
    'Opening pull request',
    'Sending notification',
  ]
  const inProgressIdx = AGENT_STEPS.length - 1 // last step (Sending notification) is blue / in-progress

  const kpis = [
    { label:'Fixes Live',          value: deployed,                                  sub:'+1 this week',                            accent: true,  spark: true },
    { label:'Avg Uplift on Wins',  value: avgUplift != null ? `+${avgUplift}%` : '—', sub:`across ${winDeltas.length} winning fixes`, accent: false },
    { label:'Runs',                value: total,                                      sub:'Analyzed since launch',                   accent: false },
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
  const last12 = [...allRuns].slice(0,12).reverse()

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
            <p style={{ fontFamily:'Instrument Serif, serif', fontWeight:400, fontSize:18, color:DC.text, lineHeight:1 }}>Velyr</p>
            <p style={{ fontSize:9, color:DC.textLight, letterSpacing:'.06em', textTransform:'uppercase', marginTop:2 }}>Growth Agent</p>
          </div>
        </div>

        <nav style={{ padding:'10px 8px', flex:1 }}>
          {NAV_ITEMS.map(item => {
            const active = item.id === tab
            return (
              <div
                key={item.id}
                onClick={item.wired ? () => setTab(item.id) : undefined}
                style={{
                  display:'flex', alignItems:'center', gap:9,
                  padding:'8px 10px', borderRadius:7, marginBottom:2,
                  background: active ? DC.accentSoft : 'transparent',
                  color:      active ? DC.accent     : DC.textMuted,
                  cursor: item.wired ? 'pointer' : 'default',
                  transition:'background .15s, color .15s',
                }}
                onMouseEnter={e => { if (item.wired && !active) e.currentTarget.style.background = DC.mutedSoft }}
                onMouseLeave={e => { if (item.wired && !active) e.currentTarget.style.background = 'transparent' }}
              >
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

        {/* Page header (changes per tab) */}
        <div style={{ marginBottom:18 }}>
          <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color:DC.accent, marginBottom:6 }}>{head.kicker}</p>
          <h1 style={{
            fontFamily:'Instrument Serif, serif', fontWeight:400,
            fontSize:'clamp(22px,2.8vw,33px)', letterSpacing:'-.01em', lineHeight:1.1,
            color:DC.text, marginBottom:5,
          }}>
            {head.title}
          </h1>
          <p style={{ fontSize:12, color:DC.textLight }}>{head.sub}</p>
        </div>

        {/* Tab content — keyed so each switch fades/rises in (see .dp-tab). */}
        <div key={tab} className="dp-tab">

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
        {tab === 'overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* The elevated star: a PR awaiting approval (mirrors the live dashboard) */}
          <MockMissionControl run={pendingRun} DC={DC} />

          <div className="dp-overview-grid" style={{ display:'flex', gap:14, alignItems:'flex-start' }}>

          {/* Main column */}
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12 }}>

            {/* KPI bar */}
            <div className="dp-kpis" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {kpis.map((k,i) => (
                <div key={i} style={{
                  background: k.accent ? DC.accentSoft : DC.bgCard,
                  border: `1px solid ${k.accent ? DC.accentMid : DC.border}`,
                  borderRadius:12, padding:'13px 14px',
                  boxShadow: k.accent ? '0 4px 18px rgba(42,92,69,0.10)' : 'none',
                }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:7 }}>
                    <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:500, color: k.accent ? DC.accent : DC.textLight }}>{k.label}</p>
                    {k.spark && <MiniSpark data={sparkData} color={DC.accent} />}
                  </div>
                  <p style={{ fontFamily:'Instrument Serif, serif', fontSize:32, fontWeight:400, color: k.accent ? DC.accent : DC.text, lineHeight:1, marginBottom:3 }}>
                    <CountUp value={k.value} />
                  </p>
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
                  {allRuns.map((run,i) => {
                    const s = STATUS_MAP[run.status] || STATUS_MAP.deployed
                    const a = run.analysis_result || {}
                    const file = a.file_to_edit?.split('/').pop()
                    return (
                      <div key={run.id} style={{
                        display:'flex', gap:10, alignItems:'flex-start',
                        padding:'9px 0',
                        borderBottom: i < allRuns.length-1 ? `1px solid ${DC.border}` : 'none',
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
                    <p style={{ fontFamily:'Instrument Serif, serif', fontSize:24, fontWeight:400, color:s.color, lineHeight:1 }}>{s.value}</p>
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
        )}

        {/* ── INSIGHTS TAB ─────────────────────────────────────────────── */}
        {tab === 'insights' && (
          <div className="dp-insights-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {insights.map((ins,i) => (
              <div key={i} style={{ background:ins.bg, border:`1px solid ${ins.border}`, borderRadius:12, padding:'18px 20px', minWidth:0 }}>
                <div style={{ display:'flex', gap:11, alignItems:'flex-start' }}>
                  <span style={{ fontSize:17, flexShrink:0 }}>{ins.icon}</span>
                  <div style={{ minWidth:0 }}>
                    <p style={{ fontSize:9.5, letterSpacing:'.08em', textTransform:'uppercase', fontWeight:600, color:ins.color, marginBottom:5 }}>{ins.label}</p>
                    <p style={{ fontFamily:'Instrument Serif, serif', fontSize:22, fontWeight:400, color:DC.text, marginBottom:5, lineHeight:1.15, wordBreak:'break-word' }}>{ins.value}</p>
                    <p style={{ fontSize:12, color:DC.textMuted, lineHeight:1.5, marginBottom:5 }}>{ins.sub}</p>
                    <p style={{ fontSize:10, color:DC.textLight }}>{ins.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── FUNNEL TAB ───────────────────────────────────────────────── */}
        {tab === 'funnel' && (
          <div style={{ background:DC.bgCard, border:`1px solid ${DC.border}`, borderRadius:12, padding:'18px 20px' }}>
            <p style={{ fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600, color:DC.textLight, marginBottom:3 }}>Drop-off by page</p>
            <p style={{ fontSize:11.5, color:DC.textLight, marginBottom:18 }}>{funnelPages.length} pages mapped · sorted by exit rate</p>
            {[...funnelPages].sort((a,b) => b.drop_off_score - a.drop_off_score).map((p) => {
              const isHigh = p.drop_off_score > 50
              const isMed  = !isHigh && p.drop_off_score > 30
              const col    = isHigh ? DC.red : isMed ? DC.yellow : DC.green
              return (
                <div key={p.id} style={{ marginBottom:15 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginBottom:6 }}>
                    <span style={{ fontFamily:'DM Mono, monospace', fontSize:11.5, color:DC.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.page_path}</span>
                    <span style={{ fontSize:11.5, color:col, fontWeight:500, flexShrink:0 }}>{p.drop_off_score}% exit · {p.views_7d} views/wk</span>
                  </div>
                  <div style={{ height:6, background:DC.mutedSoft, borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Math.min(100, p.drop_off_score)}%`, background:col, borderRadius:3 }}/>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── NETWORK TAB (reuses the real SiteNetwork component) ───────── */}
        {tab === 'network' && (
          <div>
            <div style={{ background:DC.bgCard, border:`1px solid ${DC.border}`, borderRadius:12, overflow:'hidden' }}>
              <SiteNetwork
                data={mockSiteNetworkData}
                style={{ height:420 }}
                fonts={{ sans:'Jost, sans-serif', serif:'Instrument Serif, serif', mono:'DM Mono, monospace' }}
              />
            </div>
            <p style={{ fontSize:10.5, color:DC.textLight, marginTop:9, lineHeight:1.5 }}>
              Every page in your repo and how visitors move between them. <span style={{ color:DC.yellow }}>Gold</span> = fix awaiting your approval · <span style={{ color:DC.green }}>green</span> = optimized and holding.
            </p>
          </div>
        )}
        </div>{/* /.dp-tab */}
      </div>
    </div>
  )
}

// ─── Agent Requirements ───────────────────────────────────────────────────────
function AgentRequirements() {
  const [ref, visible] = useReveal()

  const requirements = [
    { icon:'git',      title:'GitHub repo',             desc:'Your website code lives in a GitHub repository the agent can read and open PRs against.' },
    { icon:'triangle', title:'Vercel deploy',           desc:'Your site is connected to Vercel so approved fixes auto-deploy after you reply YES.' },
    { icon:'code',     title:'React, Next.js or Vite',  desc:'The agent writes React/JSX code. Plain HTML or other frameworks are not supported.' },
    { icon:'key',      title:'Admin access',             desc:'You can install GitHub Apps on the repo and merge Pull Requests.' },
    { icon:'send',     title:'Telegram account',         desc:'Weekly approvals arrive on Telegram — reply YES or NO to deploy or skip each fix.' },
  ]

  return (
    <section id="agent-requirements" className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:36 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Before you subscribe</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 52px)', letterSpacing:'-.02em', lineHeight:1.12 }}>Will the agent work for you?</h2>
          <p style={{ fontSize:15, color:C.textMuted, fontWeight:300, marginTop:14, maxWidth:560, lineHeight:1.65 }}>
            The Growth Agent reads your code, opens Pull Requests, and notifies you on Telegram. To do its job it needs five things — check you have them before you subscribe.
          </p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:18 }}>
          {requirements.map((r, i) => (
            <div key={i} style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(14px)',
              transition: `opacity .5s ease ${0.05 + i * 0.06}s, transform .5s ease ${0.05 + i * 0.06}s`,
            }}>
              <div className="lift" style={{
                height:'100%', background:'#fff', border:`1px solid ${C.border}`, borderRadius:14, padding:'22px 20px',
              }}>
                <div style={{ marginBottom:12 }}><CardIcon name={r.icon} size={20} /></div>
                <p style={{ fontSize:14, fontWeight:500, color:C.text, marginBottom:6, letterSpacing:'-.005em' }}>{r.title}</p>
                <p style={{ fontSize:12.5, color:C.textMuted, fontWeight:300, lineHeight:1.6 }}>{r.desc}</p>
              </div>
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
  const agentFeaturesExtra = ['Identifies #1 conversion problem','Opens a GitHub Pull Request','Brand Guardrails — your rules enforced','Full funnel analysis (all pages)','Reads scroll depth + click behavior','Weekly summary on Telegram','Monthly roast report — brutal honesty','Business DNA — learns over time','Public impact timeline (shareable)']

  return (
    <section id="pricing-section" className="section-pad" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:56 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Pricing</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 52px)', letterSpacing:'-.02em' }}>Simple. No surprises.</h2>
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
            <span style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:52, letterSpacing:'-.03em', color:'#fff' }}><CountUp value={visible ? 29 : 0} format={(n)=>`€${Math.round(n)}`} /></span>
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
    { q:'What is Full Funnel analysis?', a:'Instead of only looking at your homepage, the agent scans every page in your GitHub repo and cross-references them with your real analytics — including how far visitors scroll and what they click on each page — to identify where visitors are dropping off. It then prioritises the highest-leverage page to fix.' },
  ]

  const items = agentItems

  return (
    <section className="section-pad" style={{ padding:'96px 24px' }}>
      <div style={{ maxWidth:720, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:40 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>FAQ</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 48px)', letterSpacing:'-.02em' }}>Questions you might have.</h2>
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
          <span style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:400, fontSize:16, color:C.text }}>Velyr</span>
        </div>
        <p style={{ fontSize:13, color:C.textLight, fontWeight:300 }}>© 2026 Velyr · <a href="mailto:info@velyr.io" style={{ color:C.textLight, textDecoration:'none' }}>info@velyr.io</a></p>
        <div className="footer-links" style={{ display:'flex', gap:20 }}>
          {[
            { label:'Blog', path:'/blog' },
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

// ─── Trust strip (honest signals only) ────────────────────────────────────────
function TrustStrip() {
  const items = [
    'Powered by Claude',
    'You approve every change before it ships',
    'Auto-reverts if the metric drops',
    'Read + Pull-Request access only — revoke anytime',
  ]
  return (
    <section style={{ background:C.bg, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'18px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto', display:'flex', flexWrap:'wrap', gap:'12px 32px', alignItems:'center', justifyContent:'center' }}>
        {items.map((t, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:9 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:C.accent, flexShrink:0 }} />
            <span style={{ fontSize:12.5, color:C.textMuted, fontWeight:300, letterSpacing:'.01em' }}>{t}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Why / problem + agency comparison ────────────────────────────────────────
function WhySection() {
  const [ref, visible] = useReveal()
  const rows = [
    { old:'Hire a CRO agency at €2–5k/mo — or never get around to it.', neu:'€29/mo. One high-impact fix every week, automatically.' },
    { old:'Receive a slide deck of recommendations to build yourself.', neu:'Receive a ready-to-merge Pull Request with the code already written.' },
    { old:'Ship the change and hope it helped.', neu:'Measured 48h later — it auto-reverts if it made things worse.' },
  ]
  return (
    <section className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:40, maxWidth:640 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Why Velyr</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4.5vw, 52px)', letterSpacing:'-.025em', lineHeight:1.1, color:C.text, marginBottom:18 }}>
            Every site leaks conversions.<br /><em style={{ fontStyle:'italic', color:C.warm }}>Fixing them never makes the to-do list.</em>
          </h2>
          <p style={{ fontSize:16, color:C.textMuted, fontWeight:300, lineHeight:1.7 }}>
            Conversion work is slow, manual, and easy to postpone — so it waits behind the next feature, forever. Velyr does it for you, one fix a week, and proves whether it worked.
          </p>
        </div>

        <div className="why-compare" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'stretch' }}>
          <div style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:16, padding:'28px 30px', opacity:visible?1:0, transform:visible?'none':'translateY(16px)', transition:'all .55s ease .15s' }}>
            <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:C.textLight, fontWeight:400, marginBottom:20 }}>The usual way</p>
            {rows.map((r,i) => (
              <div key={i} style={{ display:'flex', gap:11, alignItems:'flex-start', paddingBottom: i<rows.length-1?14:0, marginBottom: i<rows.length-1?14:0, borderBottom: i<rows.length-1?`1px dashed rgba(28,25,23,0.08)`:'none' }}>
                <span style={{ color:C.textLight, flexShrink:0, marginTop:1, fontSize:13 }}>✕</span>
                <p style={{ fontSize:14, color:C.textMuted, fontWeight:300, lineHeight:1.6 }}>{r.old}</p>
              </div>
            ))}
          </div>
          <div style={{ background:C.accent, borderRadius:16, padding:'28px 30px', opacity:visible?1:0, transform:visible?'none':'translateY(16px)', transition:'all .55s ease .28s', boxShadow:'0 8px 30px rgba(42,92,69,0.18)' }}>
            <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'rgba(247,244,239,0.7)', fontWeight:400, marginBottom:20 }}>With Velyr</p>
            {rows.map((r,i) => (
              <div key={i} style={{ display:'flex', gap:11, alignItems:'flex-start', paddingBottom: i<rows.length-1?14:0, marginBottom: i<rows.length-1?14:0, borderBottom: i<rows.length-1?`1px dashed rgba(247,244,239,0.18)`:'none' }}>
                <span style={{ color:'#fff', flexShrink:0, marginTop:1, fontSize:13 }}>✓</span>
                <p style={{ fontSize:14, color:'rgba(247,244,239,0.92)', fontWeight:300, lineHeight:1.6 }}>{r.neu}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Showcase: dashboard mock + site network (example data) ───────────────────
function ShowcaseSection({ navigate }) {
  const [ref, visible] = useReveal()
  return (
    <section className="section-pad" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:36, maxWidth:640 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Your dashboard</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4.5vw, 52px)', letterSpacing:'-.025em', lineHeight:1.1, color:C.text, marginBottom:16 }}>
            See exactly what it found, fixed, <em style={{ fontStyle:'italic', color:C.warm }}>and shipped.</em>
          </h2>
          <p style={{ fontSize:16, color:C.textMuted, fontWeight:300, lineHeight:1.7 }}>
            Every run, every fix, the funnel it worked from, and the map of your whole site — in one place. <span style={{ color:C.text }}>Click the tabs</span> to look around. Figures are example data to show the layout.
          </p>
        </div>

        <div style={{ opacity:visible?1:0, transform:visible?'none':'translateY(20px)', transition:'all .6s ease .12s' }}>
          <AgentDashboardPreview navigate={navigate} />
        </div>
        <p style={{ fontSize:11.5, color:C.textLight, fontWeight:300, marginTop:12, textAlign:'center', letterSpacing:'.02em' }}>
          Interactive preview with example data — your real dashboard appears here after onboarding.
        </p>
      </div>
    </section>
  )
}

// ─── Differentiators (beyond the weekly fix) ──────────────────────────────────
function DifferentiatorsSection() {
  const [ref, visible] = useReveal()
  const cards = [
    { icon:'chat',   title:'One-tap Telegram approval', desc:'Every Monday you get the problem, the data, the fix and the PR link in Telegram. Reply YES to ship or NO to skip — nothing goes live without you.' },
    { icon:'scan',   title:'Competitor weekly scan', desc:"Track up to 2 competitors. The agent watches their hero, CTA and pricing each week and tells you what they shipped that you didn't." },
    { icon:'report', title:'Monthly roast report', desc:'Once a month, brutal honesty: what improved, what is still embarrassingly bad versus competitors, and what you keep ignoring.' },
    { icon:'share',  title:'Public impact timeline', desc:'An optional shareable page at velyr.io/agent/your-slug showing every run and its result. Use it as social proof.' },
  ]
  return (
    <section className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:36, maxWidth:640 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>More than a weekly fix</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4.5vw, 52px)', letterSpacing:'-.025em', lineHeight:1.1, color:C.text }}>
            Always watching, <em style={{ fontStyle:'italic', color:C.warm }}>always honest.</em>
          </h2>
        </div>
        <div className="diff-grid" style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:16 }}>
          {cards.map((c,i) => (
            <div key={i} style={{
              opacity:visible?1:0, transform:visible?'none':'translateY(16px)',
              transition:`opacity .5s ease ${0.1 + i*0.08}s, transform .5s ease ${0.1 + i*0.08}s`,
            }}>
              <div className="lift" style={{
                height:'100%', background:'#fff', border:`1px solid ${C.border}`, borderRadius:16, padding:'30px 30px',
              }}>
                <div style={{ marginBottom:16 }}><CardIcon name={c.icon} /></div>
                <h3 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:400, fontSize:21, color:C.text, marginBottom:10, letterSpacing:'-.01em' }}>{c.title}</h3>
                <p style={{ fontSize:14, color:C.textMuted, lineHeight:1.72, fontWeight:300 }}>{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Closing CTA ──────────────────────────────────────────────────────────────
function ClosingCTA({ navigate }) {
  const [ref, visible] = useReveal()
  return (
    <section className="section-pad" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ maxWidth:680, margin:'0 auto', textAlign:'center' }}>
        <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(32px, 5vw, 56px)', letterSpacing:'-.025em', lineHeight:1.08, color:C.text, marginBottom:18 }}>
          Let the agent ship your <em style={{ fontStyle:'italic', color:C.warm }}>next win.</em>
        </h2>
        <p style={{ fontSize:16, color:C.textMuted, fontWeight:300, lineHeight:1.7, marginBottom:32, maxWidth:520, marginLeft:'auto', marginRight:'auto' }}>
          Connect your repo and get your first conversion fix this week. You approve every change — nothing ships without your YES.
        </p>
        <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
          <button className="btn-primary" style={{ width:'auto' }} onClick={() => navigate('/agent/register')}>Start free trial →</button>
          <button className="btn-ghost" style={{ width:'auto' }} onClick={() => document.getElementById('pricing-section')?.scrollIntoView({ behavior:'smooth' })}>See pricing</button>
        </div>
        <p style={{ fontSize:12.5, color:C.textLight, fontWeight:300, marginTop:16 }}>14-day free trial · €29/month after · Cancel anytime</p>
      </div>
    </section>
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
      <TrustStrip />
      <WhySection />
      <GrowthAgentSection navigate={navigate} />
      <ShowcaseSection navigate={navigate} />
      <DifferentiatorsSection />
      <AgentRequirements />
      <Pricing navigate={navigate} />
      <FAQ />
      <ClosingCTA navigate={navigate} />
      <Footer navigate={navigate} />
    </>
  )
}