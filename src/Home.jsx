import { useState, useEffect, useRef } from 'react'
import SubscribeButton from './components/SubscribeButton.jsx'
import DashboardPreview from './components/DashboardPreview.jsx'
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
  .sl-shopify { margin-top: 14px; }
  .sl-shopify summary {
    list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px;
    font-family: 'Jost', sans-serif; font-weight: 400; font-size: 13.5px; color: #2a5c45;
    padding: 13px 16px; border: 1px solid rgba(42,92,69,0.2); border-radius: 12px;
    background: rgba(42,92,69,0.04); transition: background .2s, border-color .2s;
  }
  .sl-shopify summary::-webkit-details-marker { display: none; }
  .sl-shopify summary:hover { background: rgba(42,92,69,0.07); border-color: rgba(42,92,69,0.32); }
  .sl-shopify summary .sl-chev { font-size: 10px; opacity: .6; transition: transform .2s; margin-left: auto; }
  .sl-shopify[open] summary .sl-chev { transform: rotate(90deg); }
  .sl-shopify[open] summary { border-radius: 12px 12px 0 0; }
  .sl-shopify-body {
    border: 1px solid rgba(42,92,69,0.2); border-top: none; border-radius: 0 0 12px 12px;
    padding: 16px 18px; background: #fff;
    font-family: 'Jost', sans-serif; font-weight: 300; font-size: 13px; color: #6b6460; line-height: 1.72;
  }
  .sl-shopify-body ol { margin: 10px 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 5px; }

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

  /* ── §1 Trust strip — the hero's signal threading the guarantees ──────────
     A hairline connects the guarantees (draws in on scroll-enter); a soft green
     luminance travels it on a slow seamless loop (background-position, the bright
     band sits off-screen at both 0% and 100% so the wrap is invisible). Pauses on
     hover. On narrow widths the row wraps, so the line/pulse drop to a clean
     static list. Hidden + line-drawn under reduced-motion. NOT a translating ticker. */
  .trust-line { position:absolute; left:0; right:0; top:50%; height:1px; transform:translateY(-50%) scaleX(0);
    transform-origin:left center; background:rgba(42,92,69,0.16); transition:transform .9s cubic-bezier(.22,.61,.36,1); }
  .trust-rail.in .trust-line { transform:translateY(-50%) scaleX(1); }
  .trust-pulse { position:absolute; left:0; right:0; top:50%; height:3px; transform:translateY(-50%); pointer-events:none; opacity:0;
    background-image:linear-gradient(90deg, rgba(42,92,69,0) 0%, rgba(42,92,69,0.55) 50%, rgba(42,92,69,0) 100%);
    background-size:24% 100%; background-repeat:no-repeat; background-position:-30% 50%;
    transition:opacity .6s ease .35s; animation:tsGlide 7.5s linear infinite; }
  .trust-rail.in .trust-pulse { opacity:1; }
  .trust-strip:hover .trust-pulse { animation-play-state:paused; }
  @keyframes tsGlide { 0% { background-position:-30% 50%; } 100% { background-position:130% 50%; } }
  @media (max-width:1119px) { .trust-line, .trust-pulse { display:none !important; } .trust-items { justify-content:center !important; } }
  @media (prefers-reduced-motion: reduce) {
    .trust-pulse { display:none !important; }
    .trust-line { transform:translateY(-50%) scaleX(1) !important; }
  }

  /* ── §2 Why — one merged composition on a center spine. The usual-way side
     stalls (muted text, a dashed static line); the Velyr side flows — a green
     line draws top→bottom on scroll-enter and lights each ✓ in turn. Stacks to a
     plain list ≤640px; settled (line drawn, ✓s green) under reduced-motion. */
  .why-rows { position:relative; }
  .why-spine-base { position:absolute; top:6px; bottom:6px; left:50%; width:1px; transform:translateX(-50%);
    background:repeating-linear-gradient(180deg, rgba(28,25,23,0.15) 0 4px, transparent 4px 10px); }
  .why-spine-flow { position:absolute; top:6px; left:50%; width:2px; height:calc(100% - 12px); transform:translateX(-50%) scaleY(0);
    transform-origin:top center; background:#2a5c45; border-radius:2px; transition:transform 1.05s cubic-bezier(.22,.61,.36,1) .1s; }
  .why-rows.in .why-spine-flow { transform:translateX(-50%) scaleY(1); }
  .why-x { flex-shrink:0; width:21px; height:21px; border-radius:50%; border:1px solid rgba(28,25,23,0.14);
    display:flex; align-items:center; justify-content:center; color:#a09890; font-size:10px; }
  .why-check { flex-shrink:0; width:21px; height:21px; border-radius:50%; border:1px solid rgba(42,92,69,0.3);
    display:flex; align-items:center; justify-content:center; color:rgba(42,92,69,0.45); font-size:10px; background:transparent;
    transition:background .45s ease, border-color .45s ease, color .45s ease; }
  .why-rows.in .why-check { background:#2a5c45; border-color:#2a5c45; color:#fff; }
  /* equal text column on each side → the two halves wrap identically and stay
     visually balanced around the true-center spine */
  .why-rowtext { max-width:300px; }
  @media (max-width:640px) {
    .why-spine-base, .why-spine-flow { display:none; }
    .why-row { grid-template-columns:1fr !important; gap:6px !important; padding:10px 0 !important; }
    .why-cell-old { flex-direction:row-reverse !important; justify-content:flex-end !important; text-align:left !important; padding-right:0 !important; }
    .why-cell-neu { padding-left:0 !important; }
    .why-rowtext { max-width:none !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .why-spine-flow { transform:translateX(-50%) scaleY(1) !important; }
  }

  /* ── §3 How it works — sticky 5-marker spine. The right column scrolls the
     steps; an IntersectionObserver lights each marker as its step crosses centre,
     so the per-step advance is clearly visible. The pin is short (~1 viewport).
     ≤900px the rail is dropped and the steps become a plain revealed list. */
  .hiw-stage { display:grid; grid-template-columns:296px 1fr; gap:48px; align-items:start; }
  .hiw-rail { position:sticky; top:104px; align-self:start; }
  .hiw-marker { display:flex; gap:16px; align-items:flex-start; }
  .hiw-marker:not(:last-child) { min-height:86px; }
  .hiw-dotcol { display:flex; flex-direction:column; align-items:center; flex-shrink:0; align-self:stretch; }
  .hiw-dot { width:30px; height:30px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    font-family:'DM Mono',monospace; font-size:12px; border:1px solid rgba(28,25,23,0.16); background:#fff; color:#a09890;
    transition:background .4s ease, border-color .4s ease, color .4s ease, transform .4s ease, box-shadow .4s ease; }
  .hiw-dot-check { display:none; }
  .hiw-seg { width:2px; flex:1; min-height:54px; background:rgba(28,25,23,0.12); position:relative; }
  .hiw-seg::after { content:''; position:absolute; left:0; top:0; right:0; bottom:0; background:#2a5c45; transform:scaleY(0); transform-origin:top center; transition:transform .55s cubic-bezier(.22,.61,.36,1); }
  .hiw-marker.done .hiw-seg::after { transform:scaleY(1); }
  .hiw-marker.lit .hiw-dot { background:#2a5c45; border-color:#2a5c45; color:#fff; }
  .hiw-marker.lit .hiw-dot-num { display:none; }
  .hiw-marker.lit .hiw-dot-check { display:block; }
  .hiw-marker.active .hiw-dot { transform:scale(1.14); box-shadow:0 0 0 5px rgba(42,92,69,0.12); }
  .hiw-mlabel { font-size:14px; font-weight:500; color:#a09890; transition:color .4s ease; }
  .hiw-marker.lit .hiw-mlabel { color:#1c1917; }
  .hiw-msub { font-size:11.5px; color:#a09890; font-weight:300; margin-top:3px; }
  /* each step self-reveals (opacity 0 → 1 once seen); desktop dims the steps that
     are still ahead of the active marker. A per-step gate (not a column-level one)
     means an anchor jump can never leave the whole column hidden. */
  .hiw-step { opacity:0; transform:translateY(12px); transition:opacity .55s ease, transform .55s ease; }
  .hiw-step.seen { opacity:1; transform:none; }
  .hiw-step.seen.dim { opacity:0.36; }
  .hiw-below { margin-top:72px; }
  .hiw-cta { display:flex; justify-content:space-between; align-items:center; gap:22px 40px; flex-wrap:wrap; }
  @media (max-width:900px) {
    .hiw-stage { grid-template-columns:1fr; gap:0; }
    .hiw-rail { display:none; }
    .hiw-step.seen.dim { opacity:1; }   /* mobile drops the desktop dim; plain reveal only */
    .hiw-step { padding-bottom:32px !important; }
    .hiw-below { margin-top:48px; }
  }
  @media (max-width:640px) {
    .agent-stats-grid { grid-template-columns:1fr !important; }
    .hiw-cta { flex-direction:column; align-items:flex-start; }
    .hiw-step p { padding-left:0 !important; }
  }

  /* ── §4 Showcase — the dashboard "boots up" once on scroll-enter: the chrome
     border draws (an SVG perimeter, pathLength-normalised so it's size-agnostic),
     the shell + sidebar + main fade in in sequence, the KPIs count up (gated on
     the booted flag), and the approval card's ring settles last. One-time; settled
     immediately under reduced-motion (transitions collapse, booted=true at once). */
  .dash-boot { position:relative; }
  .dash-boot-border { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:4; pointer-events:none; }
  .dash-boot-border rect { stroke-dasharray:100; stroke-dashoffset:100; }
  .dash-boot.in .dash-boot-border rect { transition:stroke-dashoffset 1.05s cubic-bezier(.22,.61,.36,1); stroke-dashoffset:0; }
  .dash-boot.in .dash-boot-border { animation:dashBorderFade .5s ease 1.05s forwards; }
  @keyframes dashBorderFade { to { opacity:0; } }
  .dash-boot .dash-preview-shell { opacity:0; transition:opacity .55s ease .15s; }
  .dash-boot.in .dash-preview-shell { opacity:1; }
  .dash-boot .dp-leftnav { opacity:0; transform:translateX(-8px); transition:opacity .5s ease .4s, transform .5s ease .4s; }
  .dash-boot.in .dp-leftnav { opacity:1; transform:none; }
  .dash-boot .dp-main { opacity:0; transition:opacity .55s ease .55s; }
  .dash-boot.in .dp-main { opacity:1; }
  .dash-boot .dash-mc { box-shadow:0 10px 34px rgba(201,162,39,0.12), 0 0 0 0 rgba(201,162,39,0) !important; transition:box-shadow .55s ease .95s; }
  .dash-boot.in .dash-mc { box-shadow:0 10px 34px rgba(201,162,39,0.12), 0 0 0 3px rgba(201,162,39,0.08) !important; }
  @media (prefers-reduced-motion: reduce) {
    .dash-boot-border { display:none !important; }
    .dash-boot .dash-preview-shell, .dash-boot .dp-leftnav, .dash-boot .dp-main { opacity:1 !important; transform:none !important; }
  }

  /* ── §5 Differentiators — alternating full-width rows; each row's bespoke
     line-icon draws (stroke-dashoffset, ~600ms) on scroll-enter, then dots pop
     in. One-time, no infinite motion. Stacks ≤760px; settled under reduced-motion. */
  .diff-rows { display:flex; flex-direction:column; }
  .diff-row { display:flex; align-items:center; gap:48px; padding:38px 0; border-top:1px solid rgba(28,25,23,0.09); }
  .diff-row:last-child { border-bottom:1px solid rgba(28,25,23,0.09); }
  .diff-row.rev { flex-direction:row-reverse; }
  .diff-medallion { width:112px; height:112px; border-radius:50%; background:rgba(42,92,69,0.07); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .diff-row-text { flex:1; max-width:560px; }
  .diff-draw { stroke-dasharray:1; stroke-dashoffset:1; }
  .diff-row.in .diff-draw { stroke-dashoffset:0; transition:stroke-dashoffset .6s cubic-bezier(.4,0,.2,1); }
  .diff-dot { opacity:0; transform:scale(.3); transform-box:fill-box; transform-origin:center; }
  .diff-row.in .diff-dot { opacity:1; transform:scale(1); transition:opacity .3s ease .5s, transform .3s cubic-bezier(.22,.61,.36,1) .5s; }
  @media (max-width:760px) {
    .diff-row, .diff-row.rev { flex-direction:column; align-items:flex-start; gap:18px; padding:28px 0; }
    .diff-medallion { width:88px; height:88px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .diff-draw { stroke-dashoffset:0 !important; }
    .diff-dot { opacity:1 !important; transform:none !important; }
  }

  /* ── §6 Requirements — the "runs on your stack" chips light green in sequence
     on enter (per-chip transition-delay). Settled lit under reduced-motion. */
  .stack-chip { display:inline-flex; align-items:center; gap:8px; padding:8px 15px; border-radius:999px;
    border:1px solid rgba(28,25,23,0.15); background:transparent; font-size:13px; font-weight:400; color:#a09890;
    letter-spacing:.01em; transition:color .4s ease, border-color .4s ease, background .4s ease; }
  .stack-chip .stack-dot { width:7px; height:7px; border-radius:50%; background:rgba(28,25,23,0.2); transition:background .4s ease; }
  .stack-chips.in .stack-chip { color:#2a5c45; border-color:rgba(42,92,69,0.4); background:rgba(42,92,69,0.07); }
  .stack-chips.in .stack-chip .stack-dot { background:#2a5c45; }

  /* ── §8 Closing mark — the hero's healed green marker returns once, above the
     final CTA. A single soft ring pulse on enter (no infinite motion), settling
     to a static node + faint ring. Static under reduced-motion. */
  .close-mark { display:inline-flex; align-items:center; justify-content:center; margin-bottom:24px; }
  .close-mark .cm-pulse { transform-box:fill-box; transform-origin:center; opacity:0; }
  .close-mark.in .cm-pulse { animation:cmPulse 1.6s cubic-bezier(.22,.61,.36,1) .3s both; }
  @keyframes cmPulse { 0% { transform:scale(.55); opacity:.5; } 100% { transform:scale(2.3); opacity:0; } }
  @media (prefers-reduced-motion: reduce) { .close-mark .cm-pulse { display:none !important; } }

  ::-webkit-scrollbar { width:5px; }
  ::-webkit-scrollbar-track { background:#f7f4ef; }
  ::-webkit-scrollbar-thumb { background:rgba(28,25,23,0.12); border-radius:3px; }

  /* Keep html as the page scroll container (so position:sticky binds to it), but
     use overflow-x:clip on body/#root instead of hidden — clip still prevents
     horizontal scroll yet does NOT force overflow-y:auto, so they don't become
     nested scroll containers that would break the §3 sticky rail. Overrides the
     index.html shell rules (this <style> is injected later in the cascade). */
  html { overflow-x: hidden; max-width: 100vw; }
  body, #root { overflow-x: clip; max-width: 100vw; }
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
    deploy:   <><path d="M6.5 18a3.5 3.5 0 0 1-.4-6.98 5 5 0 0 1 9.7-1.2A3.6 3.6 0 0 1 17 18"/><path d="M12 12.5v6"/><path d="m9.5 15 2.5-2.5 2.5 2.5"/></>,
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
          Ship a conversion fix <em style={{ fontStyle:'italic', color:C.accent }}>every week</em>.
        </h1>

        <p style={{ fontFamily:'Jost, sans-serif', fontWeight:300, fontSize:'clamp(16px, 1.6vw, 18px)', color:C.textMuted, maxWidth:540, margin:'22px auto 0', lineHeight:1.6 }}>
          Velyr finds your site's biggest conversion leak, writes the fix, and sends it to Telegram. Reply YES and it goes live. Works with your GitHub repo or your Shopify store.
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

// ─── Growth Agent Section (§3: sticky 5-marker spine) ─────────────────────────
// The pinned left rail is the five-stage spine (detect → PR → approve → ship →
// measure). The right column scrolls the weekly schedule mapped to those stages;
// an IntersectionObserver lights each marker as its step crosses the viewport
// centre, so the per-step advance reads clearly. The pin is short (~1 viewport).
// ≤900px the rail is dropped and the steps become a plain revealed list. The
// stats trio + green CTA sit full-width below the spine.
function GrowthAgentSection({ navigate }) {
  const [ref, visible] = useReveal()
  const [statsRef, statsVis] = useReveal()
  const [active, setActive] = useState(PREFERS_REDUCED ? 4 : 0)
  const [seen, setSeen] = useState(() => new Set(PREFERS_REDUCED ? [0, 1, 2, 3, 4] : []))
  const stepEls = useRef([])

  const markers = [
    { label:'Detect',  sub:'reads analytics + code' },
    { label:'Fix',     sub:'writes the code change' },
    { label:'Approve', sub:'one Telegram reply' },
    { label:'Ship',    sub:'live after your YES' },
    { label:'Measure', sub:'rollback if worse' },
  ]
  const steps = [
    { n:'01', label:'Detect',  time:'Mon · 9:00',  text:'The agent reads your analytics: traffic, bounce rate, how far visitors scroll, what they click. Then it scans every page in your GitHub repo or Shopify theme to find the #1 conversion problem in your funnel.' },
    { n:'02', label:'Fix',     time:'Mon · 9:15',  text:'It writes the code change. On a GitHub repo that becomes a Pull Request with a preview deploy from your host. On a Shopify store it becomes a staged theme change for you to review.' },
    { n:'03', label:'Approve', time:'Mon · 9:20',  text:'A Telegram message shows you the problem, the data behind it, and the exact change. Reply YES to ship it or NO to skip it. Nothing goes live without you.' },
    { n:'04', label:'Ship',    time:'On your YES', text:'On GitHub the agent merges the PR and your host deploys it. On Shopify it writes the change straight to your live theme. No manual steps.' },
    { n:'05', label:'Measure', time:'48h later',   text:'It checks your bounce rate 48 hours after deploy. If it rose 15 points or more, the agent proposes a rollback and reverts it on your YES. A Wednesday check watches traffic and bounce too.' },
  ]

  // Two observers on the step blocks: a thin centre band lights the rail markers
  // (active = the step at centre; markers ≤ active are lit), and a normal-threshold
  // observer marks each step "seen" so it fades in once (never un-seen).
  useEffect(() => {
    if (PREFERS_REDUCED || typeof IntersectionObserver === 'undefined') return
    const bandIO = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setActive(Number(e.target.dataset.idx)) })
    }, { rootMargin: '-48% 0px -48% 0px', threshold: 0 })
    const seenIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) setSeen(prev => {
          const idx = Number(e.target.dataset.idx)
          if (prev.has(idx)) return prev
          const next = new Set(prev); next.add(idx); return next
        })
      })
    }, { threshold: 0.25 })
    stepEls.current.forEach(el => { if (el) { bandIO.observe(el); seenIO.observe(el) } })
    return () => { bandIO.disconnect(); seenIO.disconnect() }
  }, [])

  const stats = [
    { value:'Every Monday', label:'Agent runs automatically', sub:'plus on-demand runs anytime' },
    { value:'48h', num:48, format:(n)=>`${Math.round(n)}h`, label:'Rollback check', sub:'a fix that hurt gets reverted' },
    { value:'100%', num:100, format:(n)=>`${Math.round(n)}%`, label:'Approval stays with you', sub:'nothing ships without your OK' },
  ]

  return (
    <section id="growth-agent" className="growth-section" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>

        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:56 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:16 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:C.accent, flexShrink:0 }} />
            <span style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, fontWeight:400 }}>How it works</span>
          </div>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(32px, 5vw, 60px)', letterSpacing:'-.025em', lineHeight:1.08, color:C.text, marginBottom:20 }}>
            One fix a week,<br />
            shipped with your YES.
          </h2>
          <p style={{ fontSize:17, color:C.textMuted, lineHeight:1.72, fontWeight:300, maxWidth:520 }}>
            The agent reads your analytics, writes a conversion fix, and ships it once you approve. It runs every Monday, and on demand whenever you want.
          </p>
          <p style={{ fontSize:12, color:C.textLight, fontWeight:300, marginTop:12, letterSpacing:'.01em' }}>
            Works with a React, Next.js or Vite repo that auto-deploys (Vercel, Netlify, Render, Railway, Cloudflare Pages), or with a Shopify store connected directly. No GitHub needed for Shopify.
          </p>
        </div>

        {/* sticky 5-marker spine + scrolling steps */}
        <div className="hiw-stage">
          <div className="hiw-rail" aria-hidden="true">
            {markers.map((m, i) => (
              <div key={i} className={`hiw-marker ${i <= active ? 'lit' : ''} ${i < active ? 'done' : ''} ${i === active ? 'active' : ''}`}>
                <div className="hiw-dotcol">
                  <div className="hiw-dot">
                    <span className="hiw-dot-num">{i + 1}</span>
                    <span className="hiw-dot-check">✓</span>
                  </div>
                  {i < markers.length - 1 && <div className="hiw-seg" />}
                </div>
                <div style={{ paddingTop:3 }}>
                  <p className="hiw-mlabel">{m.label}</p>
                  <p className="hiw-msub">{m.sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="hiw-steps">
            {steps.map((s, i) => (
              <div key={i} data-idx={i} ref={el => { stepEls.current[i] = el }} className={`hiw-step ${seen.has(i) ? 'seen' : ''} ${i > active ? 'dim' : ''}`} style={{ paddingBottom: i < steps.length - 1 ? 56 : 0 }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:14, marginBottom:10 }}>
                  <span style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:34, color:C.accent, lineHeight:1, letterSpacing:'-.02em' }}>{s.n}</span>
                  <span style={{ fontSize:13, fontWeight:500, color:C.text, letterSpacing:'.02em', textTransform:'uppercase' }}>{s.label}</span>
                  <span style={{ fontSize:11.5, color:C.textLight, fontFamily:'DM Mono, monospace', marginLeft:'auto' }}>{s.time}</span>
                </div>
                <p style={{ fontSize:15, color:C.textMuted, fontWeight:300, lineHeight:1.7, maxWidth:540, paddingLeft:48 }}>{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* full-width below the spine: stats trio + green CTA */}
        <div className="hiw-below">
          <div ref={statsRef} className="agent-stats-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:16 }}>
            {stats.map((stat, i) => (
              <div key={i} style={{
                background:'#fff', border:`1px solid ${C.border}`, borderRadius:14, padding:'24px 26px',
                opacity: statsVis ? 1 : 0, transform: statsVis ? 'none' : 'translateY(14px)', transition:`all .5s ease ${i * 0.1}s`,
              }}>
                <p style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:32, color:C.accent, letterSpacing:'-.02em', lineHeight:1, marginBottom:8 }}>{stat.num != null ? <CountUp value={statsVis ? stat.num : 0} format={stat.format} /> : stat.value}</p>
                <p style={{ fontSize:13.5, fontWeight:400, color:C.text, marginBottom:3 }}>{stat.label}</p>
                <p style={{ fontSize:12, color:C.textLight, fontWeight:300 }}>{stat.sub}</p>
              </div>
            ))}
          </div>

          <div className="hiw-cta agent-cta-card" style={{ background:C.accent, borderRadius:16, padding:'28px 32px' }}>
            <div style={{ maxWidth:440 }}>
              <p style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:26, color:'#fff', letterSpacing:'-.015em', marginBottom:6 }}>Ready to let the agent work?</p>
              <p style={{ fontSize:13.5, color:'rgba(247,244,239,0.62)', fontWeight:300 }}>Set up in a few minutes. 14-day free trial, then €29/month. Cancel anytime.</p>
            </div>
            <div className="hiw-cta-actions" style={{ display:'flex', gap:10, flexShrink:0 }}>
              <button onClick={() => navigate('/agent/register')} style={{
                background:'#f7f4ef', color:C.text, border:'none', borderRadius:10,
                padding:'13px 22px', fontSize:14, fontFamily:'Jost,sans-serif', fontWeight:500,
                cursor:'pointer', letterSpacing:'.02em', transition:'all .2s', whiteSpace:'nowrap',
              }}
                onMouseEnter={e => { e.currentTarget.style.background='#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background='#f7f4ef' }}
              >Start free trial →</button>
              <button onClick={() => navigate('/agent/login')} style={{
                background:'transparent', color:'rgba(247,244,239,0.9)',
                border:'1px solid rgba(247,244,239,0.35)', borderRadius:10,
                padding:'12px 22px', fontSize:13.5, fontFamily:'Jost,sans-serif', fontWeight:400,
                cursor:'pointer', letterSpacing:'.02em', transition:'all .2s', whiteSpace:'nowrap',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(247,244,239,0.6)'; e.currentTarget.style.color='#f7f4ef' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(247,244,239,0.35)'; e.currentTarget.style.color='rgba(247,244,239,0.9)' }}
              >Log in</button>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}

// ─── Agent Requirements ───────────────────────────────────────────────────────
function AgentRequirements() {
  const [ref, visible] = useReveal()

  const requirements = [
    { icon:'git',      title:'GitHub repo or Shopify store', desc:'Your site lives in a GitHub repo (React, Next.js or Vite) or on Shopify. Either one connects in onboarding.' },
    { icon:'deploy',   title:'A way to go live',             desc:'GitHub repos auto-deploy on merge via Vercel, Netlify, Render, Railway or Cloudflare Pages. Shopify themes update directly, no deploy setup needed.' },
    { icon:'code',     title:'Code the agent can edit',      desc:'React/JSX in repos, Liquid in Shopify themes. Plain HTML and no-code builders aren’t supported.' },
    { icon:'key',      title:'Admin access',                 desc:'You can install apps on the repo or store, and approve the changes the agent proposes.' },
    { icon:'send',     title:'Telegram account',             desc:'Approvals arrive on Telegram. Reply YES to ship a fix or NO to skip it.' },
  ]

  return (
    <section id="agent-requirements" className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:26 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Before you subscribe</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4vw, 52px)', letterSpacing:'-.02em', lineHeight:1.12 }}>Will the agent work for you?</h2>
          <p style={{ fontSize:15, color:C.textMuted, fontWeight:300, marginTop:14, maxWidth:560, lineHeight:1.65 }}>
            The agent reads your code, writes fixes, and asks you on Telegram before anything ships. It needs five things. Check you have them before you subscribe.
          </p>
        </div>

        {/* "runs on your stack" — the three supported frameworks light green in sequence */}
        <div className={`stack-chips ${visible?'in':''}`} style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:30 }}>
          <span style={{ fontSize:12, color:C.textLight, fontWeight:400, letterSpacing:'.02em', marginRight:4 }}>Runs on your stack</span>
          {['React','Next.js','Vite','Shopify'].map((name, i) => (
            <span key={name} className="stack-chip" style={{ transitionDelay:`${0.15 + i*0.16}s` }}>
              <span className="stack-dot" />{name}
            </span>
          ))}
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
            <strong style={{ color:C.text, fontWeight:500 }}>Wix · Squarespace · Webflow</strong> — these site builders don't expose source code the agent can edit. If your site uses one of these, the Growth Agent isn't a fit yet.
          </span>
        </div>

        {/* Shopify — the store connects directly in onboarding (OAuth + theme picker);
            approved fixes are written to the connected theme. GitHub theme sync stays
            a supported alternative for merchants who already use it. Kept collapsed so
            non-Shopify visitors see one extra line they can ignore. */}
        <details className="sl-shopify">
          <summary>
            <span style={{ fontSize:15 }}>🛍️</span>
            <span style={{ flex:1 }}>On Shopify? Connect your store directly. No GitHub needed.</span>
            <span className="sl-chev">▶</span>
          </summary>
          <div className="sl-shopify-body">
            During onboarding you authorize Velyr on your store and pick the theme it should work on. Each week the agent reads your live theme, finds the biggest conversion problem, and sends the fix to Telegram. Reply <strong style={{ color:C.text, fontWeight:500 }}>YES</strong> and Velyr writes the change to your theme. If a fix hurts your numbers, the agent proposes a rollback and restores the previous version on your YES. No plugins, no editing theme code by hand.
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
              <p style={{ fontWeight:400, color:C.text, margin:0 }}>Prefer pull requests?</p>
              If your theme is already synced to a GitHub repo via Shopify’s official GitHub integration, connect that repo instead and every fix arrives as a pull request you merge yourself.
            </div>
          </div>
        </details>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────
function Pricing({ navigate }) {
  const [ref, visible] = useReveal()
  const [allFeaturesOpen, setAllFeaturesOpen] = useState(false)

  const agentFeaturesTop = ['Reads your analytics and your repo or Shopify theme','Writes the code fix, weekly or on demand','You approve on Telegram with YES or NO','Rollback when a fix hurts your metrics','Weekly competitor scan']
  const agentFeaturesExtra = ['Finds the #1 conversion problem each week','Ships as a GitHub PR or a Shopify theme change','Brand Guardrails: your rules, enforced','Full funnel analysis across all pages','Reads scroll depth and click behavior','Weekly summary on Telegram','Monthly roast report on what still lags','Business DNA: learns what works on your site','Public impact timeline you can share']

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
            <p style={{ color:'rgba(247,244,239,0.6)', fontSize:13, fontWeight:300, marginBottom:20 }}>One fix a week, with your approval.</p>
            <span style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:52, letterSpacing:'-.03em', color:'#fff' }}><CountUp value={visible ? 29 : 0} format={(n)=>`€${Math.round(n)}`} /></span>
            <sup style={{ fontSize:14, color:'rgba(247,244,239,0.5)', fontWeight:300, marginLeft:2 }}>*</sup>
            <p style={{ color:'rgba(247,244,239,0.5)', fontSize:12, marginBottom:4, fontWeight:300, marginTop:4 }}>per month · cancel anytime</p>
            <div style={{ display:'flex', flexDirection:'column', gap:9, marginBottom:0 }}>
              {agentFeaturesTop.map((f,j) => (
                <div key={j} style={{
                  display:'flex', alignItems:'flex-start', gap:9, fontSize:13,
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'none' : 'translateY(8px)',
                  transition: `opacity .4s ease ${0.4 + j*0.09}s, transform .4s ease ${0.4 + j*0.09}s`,
                }}>
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
    { q:'What is the Growth Agent?', a:'An AI agent that runs every Monday and on demand. It reads your PostHog analytics and your code, on GitHub or Shopify, finds the biggest conversion problem, writes the fix, and sends it to you on Telegram. Reply YES to ship it or NO to skip it.' },
    { q:'Does it work with Shopify?', a:'Yes, two ways. Connect your store directly in onboarding: Velyr reads your live theme and writes approved fixes straight to it. No GitHub needed. Or, if your theme is already synced to a GitHub repo, connect the repo and fixes arrive as pull requests.' },
    { q:'When does it start, and can I run it myself?', a:'The agent gets to work the moment you finish setup, no waiting for Monday. After that it runs every Monday morning, and you can trigger an extra run any time from the dashboard with the Run now button, up to once a day.' },
    { q:'Do I have to approve every change before it goes live?', a:'Yes, always. You get a Telegram message with the problem, the data behind it, and the exact change. Reply YES to ship it or NO to skip it. Nothing goes live without you.' },
    { q:"What happens if a change makes things worse?", a:'The agent checks your bounce rate 48 hours after every deploy. If it rose 15 percentage points or more, it proposes a rollback on Telegram and reverts the change once you approve. On GitHub that is a revert PR, on Shopify the previous theme files are restored.' },
    { q:'What are Brand Guardrails?', a:'Rules you set in your dashboard that the agent must follow on every run: tone of voice, things it can never do, elements it must never touch. Suggestions that violate them are rejected before they reach you.' },
    { q:'What is Full Funnel analysis?', a:'The agent maps every page of your site, not just the homepage, and cross-references each one with your analytics, including scroll depth and clicks. It finds where visitors drop off and fixes the highest-leverage page first.' },
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
            { label:'Imprint', path:'/impressum' },
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
// §1: the hero's green signal threads the four guarantees. A hairline connects
// them and a soft luminance pulse travels it on a slow seamless loop — pausing on
// hover, dropping to a static centered list when the row wraps (≤1119px) or under
// reduced motion. Each guarantee's cream background masks the rail, so the pulse
// reads as the signal passing through each one.
function TrustStrip() {
  const [ref, visible] = useReveal()
  const items = [
    'Powered by Claude',
    'You approve every change before it ships',
    'A fix that hurts your numbers gets rolled back',
    'Revoke access anytime',
  ]
  return (
    <section className="trust-strip" style={{ background:C.bg, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'22px 24px', overflow:'hidden' }}>
      <div ref={ref} className={`trust-rail ${visible?'in':''}`} style={{ position:'relative', maxWidth:1060, margin:'0 auto' }}>
        <div className="trust-line" aria-hidden="true" />
        <div className="trust-pulse" aria-hidden="true" />
        <div className="trust-items" style={{ position:'relative', zIndex:2, display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:'14px 22px' }}>
          {items.map((t, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:9, background:C.bg, padding:'0 14px',
              opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(8px)',
              transition: `opacity .5s ease ${0.1 + i*0.08}s, transform .5s ease ${0.1 + i*0.08}s`,
            }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:C.accent, flexShrink:0 }} />
              <span style={{ fontSize:12.5, color:C.textMuted, fontWeight:300, letterSpacing:'.01em', whiteSpace:'nowrap' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Why / problem + agency comparison ────────────────────────────────────────
// §2: the two compare cards are merged into one composition around a center
// spine. The usual-way side (left) stays muted and static (a dashed, stalled
// line); the Velyr side flows — a green line draws down the spine on scroll-enter
// and lights each ✓ in turn. Stalled vs flowing, literally.
function WhySection() {
  const [ref, visible] = useReveal()
  const [rowsRef, rowsVis] = useReveal()
  const rows = [
    { old:'Hire a CRO agency at €2–5k/mo, or never get around to it.', neu:'€29/mo. One high-impact fix every week.' },
    { old:'Receive a slide deck of recommendations to build yourself.', neu:'Get the fix already written. You approve it, it ships.' },
    { old:'Ship the change and hope it helped.', neu:'Measured after 48 hours. If it made things worse, it gets rolled back.' },
  ]
  const cellOld = { display:'flex', justifyContent:'flex-end', alignItems:'center', gap:12, paddingRight:16, textAlign:'right' }
  const cellNeu = { display:'flex', justifyContent:'flex-start', alignItems:'center', gap:12, paddingLeft:16 }
  return (
    <section className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:44, maxWidth:640 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Why Velyr</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4.5vw, 52px)', letterSpacing:'-.025em', lineHeight:1.1, color:C.text, marginBottom:18 }}>
            Every site leaks conversions.<br />Fixing them never makes the to-do list.
          </h2>
          <p style={{ fontSize:16, color:C.textMuted, fontWeight:300, lineHeight:1.7 }}>
            Conversion work is slow and easy to postpone. It waits behind the next feature, forever. Velyr does one fix a week and measures whether it worked.
          </p>
        </div>

        <div style={{ maxWidth:720, margin:'0 auto', opacity:rowsVis?1:0, transform:rowsVis?'none':'translateY(16px)', transition:'opacity .6s ease, transform .6s ease' }}>
          {/* column headers */}
          <div className="why-row" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', marginBottom:6 }}>
            <div className="why-cell-old" style={{ ...cellOld }}>
              <span style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:C.textLight, fontWeight:400 }}>The usual way</span>
            </div>
            <div className="why-cell-neu" style={{ ...cellNeu }}>
              <span style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:C.accent, fontWeight:500 }}>With Velyr</span>
            </div>
          </div>

          <div ref={rowsRef} className={`why-rows ${rowsVis?'in':''}`} style={{ position:'relative' }}>
            <div className="why-spine-base" aria-hidden="true" />
            <div className="why-spine-flow" aria-hidden="true" />
            {rows.map((r,i) => (
              <div key={i} className="why-row" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', alignItems:'center', padding:'18px 0' }}>
                <div className="why-cell-old" style={{ ...cellOld }}>
                  <p className="why-rowtext" style={{ fontSize:14, color:C.textLight, fontWeight:300, lineHeight:1.55 }}>{r.old}</p>
                  <span className="why-x">✕</span>
                </div>
                <div className="why-cell-neu" style={{ ...cellNeu }}>
                  <span className="why-check" style={{ transitionDelay:`${0.3 + i * 0.3}s` }}>✓</span>
                  <p className="why-rowtext" style={{ fontSize:14, color:C.text, fontWeight:400, lineHeight:1.55 }}>{r.neu}</p>
                </div>
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
  const [bootRef, booted] = useReveal()
  return (
    <section className="section-pad" style={{ background:C.bgSecond, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:'96px 24px' }}>
      <div style={{ maxWidth:1060, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:36, maxWidth:640 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>Your dashboard</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4.5vw, 52px)', letterSpacing:'-.025em', lineHeight:1.1, color:C.text, marginBottom:16 }}>
            See exactly what it found, fixed, <em style={{ fontStyle:'italic', color:C.warm }}>and shipped.</em>
          </h2>
          <p style={{ fontSize:16, color:C.textMuted, fontWeight:300, lineHeight:1.7 }}>
            Every run, every fix, the funnel it worked from, and a map of your whole site, in one place. <span style={{ color:C.text }}>Click around</span> — every tab, run and toggle works. The figures are example data.
          </p>
        </div>

        {/* the dashboard boots up once on scroll-enter (see .dash-boot CSS) */}
        <div ref={bootRef} className={`dash-boot ${booted?'in':''}`}>
          <svg className="dash-boot-border" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
            <rect x="0" y="0" width="100%" height="100%" rx="16" ry="16" fill="none" stroke={C.accent} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pathLength="100" />
          </svg>
          <DashboardPreview booted={booted} />
        </div>
        <p style={{ fontSize:11.5, color:C.textLight, fontWeight:300, marginTop:12, textAlign:'center', letterSpacing:'.02em' }}>
          Interactive preview with example data. Your real dashboard appears here after onboarding.
        </p>
      </div>
    </section>
  )
}

// ─── Differentiators (beyond the weekly fix) ──────────────────────────────────
// §5: each differentiator is a full-width row with sides alternating. A bespoke
// line-icon draws itself (stroke-dashoffset) on scroll-enter, then any accent
// dots pop in. One-time only.
function DiffIcon({ name }) {
  const s = { width:72, height:72, viewBox:'0 0 72 72', fill:'none', stroke:C.accent, strokeWidth:1.6, strokeLinecap:'round', strokeLinejoin:'round' }
  if (name === 'chat') return (
    <svg {...s} aria-hidden="true">
      <path className="diff-draw" pathLength="1" d="M16 16 h40 a8 8 0 0 1 8 8 v16 a8 8 0 0 1 -8 8 H34 l-11 9 v-9 h-7 a8 8 0 0 1 -8 -8 V24 a8 8 0 0 1 8 -8 z" />
      <path className="diff-draw" pathLength="1" d="M25 32 l7 7 14 -14" />
    </svg>
  )
  if (name === 'scan') return (
    <svg {...s} aria-hidden="true">
      <circle className="diff-draw" pathLength="1" cx="36" cy="36" r="23" />
      <circle className="diff-draw" pathLength="1" cx="36" cy="36" r="13" />
      <path className="diff-draw" pathLength="1" d="M36 36 L55 23" />
      <circle className="diff-dot" cx="49" cy="46" r="3" fill={C.accent} stroke="none" />
    </svg>
  )
  if (name === 'report') return (
    <svg {...s} aria-hidden="true">
      <path className="diff-draw" pathLength="1" d="M24 13 h18 l11 11 v33 a3 3 0 0 1 -3 3 H24 a3 3 0 0 1 -3 -3 V16 a3 3 0 0 1 3 -3 z" />
      <path className="diff-draw" pathLength="1" d="M42 13 v11 h11" />
      <path className="diff-draw" pathLength="1" d="M28 36 h17" />
      <path className="diff-draw" pathLength="1" d="M28 44 h17" />
      <path className="diff-draw" pathLength="1" d="M28 52 h9" />
    </svg>
  )
  if (name === 'share') return (
    <svg {...s} aria-hidden="true">
      <path className="diff-draw" pathLength="1" d="M14 55 H58" />
      <path className="diff-draw" pathLength="1" d="M16 50 L30 40 L44 30 L57 17" />
      <path className="diff-draw" pathLength="1" d="M50 17 h7 v7" />
      <circle className="diff-dot" cx="30" cy="40" r="3" fill="#fff" stroke={C.accent} strokeWidth="1.6" />
      <circle className="diff-dot" cx="44" cy="30" r="3" fill="#fff" stroke={C.accent} strokeWidth="1.6" />
    </svg>
  )
  return null
}

function DiffRow({ item, i }) {
  const [ref, vis] = useReveal()
  return (
    <div ref={ref} className={`diff-row ${i % 2 === 1 ? 'rev' : ''} ${vis ? 'in' : ''}`}>
      <div className="diff-medallion"><DiffIcon name={item.icon} /></div>
      <div className="diff-row-text" style={{ opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateY(12px)', transition: 'opacity .5s ease .15s, transform .5s ease .15s' }}>
        <h3 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:400, fontSize:26, color:C.text, marginBottom:10, letterSpacing:'-.01em' }}>{item.title}</h3>
        <p style={{ fontSize:15, color:C.textMuted, lineHeight:1.72, fontWeight:300 }}>{item.desc}</p>
      </div>
    </div>
  )
}

function DifferentiatorsSection() {
  const [ref, visible] = useReveal()
  const rows = [
    { icon:'chat',   title:'Approval on Telegram', desc:'Every Monday you get the problem, the data, the fix and the link in Telegram. Reply YES to ship it or NO to skip it. Nothing goes live without you.' },
    { icon:'scan',   title:'Competitor weekly scan', desc:"Track up to 2 competitors. The agent watches their hero, CTA and pricing each week and tells you what they shipped that you didn't." },
    { icon:'report', title:'Monthly roast report', desc:'Once a month the agent tells you straight what improved, what still looks weak next to your competitors, and what you keep ignoring.' },
    { icon:'share',  title:'Public impact timeline', desc:'An optional public page at velyr.io/agent/your-slug that shows every run and its result. Use it as social proof.' },
  ]
  return (
    <section className="section-pad" style={{ background:C.bg, padding:'96px 24px' }}>
      <div style={{ maxWidth:1000, margin:'0 auto' }}>
        <div ref={ref} className={`reveal ${visible?'in':''}`} style={{ marginBottom:24, maxWidth:640 }}>
          <p style={{ fontSize:11, letterSpacing:'.14em', textTransform:'uppercase', color:C.accent, marginBottom:14, fontWeight:400 }}>More than a weekly fix</p>
          <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(30px, 4.5vw, 52px)', letterSpacing:'-.025em', lineHeight:1.1, color:C.text }}>
            The rest of the job.
          </h2>
        </div>
        <div className="diff-rows">
          {rows.map((r, i) => <DiffRow key={i} item={r} i={i} />)}
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
        {/* the hero's healed green marker, returning as the closing mark */}
        <div className={`close-mark ${visible?'in':''}`} aria-hidden="true">
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <circle className="cm-pulse" cx="26" cy="26" r="10" stroke={C.accent} strokeWidth="1.4" />
            <circle cx="26" cy="26" r="17" stroke={C.accent} strokeWidth="1" opacity="0.22" />
            <circle cx="26" cy="26" r="5" fill={C.accent} stroke={C.bgSecond} strokeWidth="1.5" />
          </svg>
        </div>
        <h2 style={{ fontFamily:'Cormorant Garamond, serif', fontWeight:300, fontSize:'clamp(32px, 5vw, 56px)', letterSpacing:'-.025em', lineHeight:1.08, color:C.text, marginBottom:18 }}>
          Let the agent ship your <em style={{ fontStyle:'italic', color:C.warm }}>next win.</em>
        </h2>
        <p style={{ fontSize:16, color:C.textMuted, fontWeight:300, lineHeight:1.7, marginBottom:32, maxWidth:520, marginLeft:'auto', marginRight:'auto' }}>
          Connect your repo or your Shopify store and get the first fix this week. Nothing ships without your YES.
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