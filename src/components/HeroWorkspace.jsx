// HeroWorkspace — the landing hero's full-bleed dimensional workspace.
//
// Four real product panels float in layered 3D perspective behind the centered
// foreground copy (which lives in Home.jsx's <Hero>). The panels carry actual
// UI substance — a live conversion chart, a KPI tile, a PR diff, a Telegram
// approval card — angled inward to face center at different depths.
//
// MOVEMENT, three independent systems that never fight over a transform:
//   1. PLACEMENT  — each panel's static 3D position (translate/translateZ/
//      rotateY/scale) lives in a CSS class on the .hwx-panel wrapper.
//   2. DRIFT      — a gentle vertical float (translateY only) on an inner
//      .hwx-float element via a CSS `infinite` keyframe whose 0% == 100%, so it
//      is seamless and never touches the placement transform.
//   3. NARRATIVE  — one requestAnimationFrame time-clock drives the ~9s story by
//      writing opacity/colour/transform DIRECTLY to a handful of ref'd
//      sub-elements (chart marker, leak ring, win tag, diff glow, YES chip).
//      No per-frame React render. Every property is a pure function of
//      (elapsed mod PERIOD); state(0) ≡ state(PERIOD) → the loop never snaps.
//   +  PARALLAX   — a separate rAF-throttled, transform-only tilt on the .hwx-
//      stage, desktop / non-touch only.
//
// Perf / a11y:
//   · the hero <h1> renders beside this and stays the LCP element; this whole
//     scene mounts only AFTER first paint (the `mounted` gate returns null).
//   · IntersectionObserver pauses the narrative rAF AND the CSS drift offscreen.
//   · the conversion % counts up ONCE (3.0→3.4) on first paint, then holds.
//   · prefers-reduced-motion renders a settled composition: panels placed,
//     marker green, YES highlighted, % final, zero motion.
//   · ≤768px drops to 2 panels, flatter perspective, no parallax.
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion.jsx'

const PERIOD = 9000 // ms — the narrative loop
const PCT_FROM = 3.0
const PCT_TO = 3.4

const T = {
  card:    '#ffffff',
  green:   '#2a5c45',
  greenLn: '#2f6b4f',
  terra:   '#c2573d',
  gold:    '#c2a45f',
  ink:     '#1c1917',
  muted:   '#6b6460',
  light:   '#a09890',
  border:  'rgba(28,25,23,0.10)',
}
const GREEN_RGB = [47, 107, 79]
const TERRA_RGB = [194, 87, 61]

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
// 0 → ramp up over [a,b] → hold 1 → ramp down over [c,d] → 0.
// Returns 0 at p<a and p>=d, so a loop built from these is seamless at the wrap.
function envelope(p, a, b, c, d) {
  if (p < a || p >= d) return 0
  if (p < b) return smooth((p - a) / (b - a))
  if (p < c) return 1
  return 1 - smooth((p - c) / (d - c))
}
function mix(c1, c2, t) {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t)
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t)
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t)
  return `rgb(${r},${g},${b})`
}

const CSS = `
  .hwx-scene { position:absolute; inset:0; z-index:0; overflow:hidden; pointer-events:none;
    perspective:1500px; perspective-origin:50% 44%; }
  .hwx-stage { position:absolute; inset:0; transform-style:preserve-3d; will-change:transform;
    transition:transform .5s cubic-bezier(.22,.61,.36,1); }
  .hwx-panel { position:absolute; transform-style:preserve-3d; animation:hwxFade 1s ease both; animation-delay:var(--in,0s); }
  .hwx-float { will-change:transform; }
  .hwx-card { background:#fff; border:1px solid rgba(28,25,23,0.10); border-radius:14px;
    box-shadow:0 22px 60px rgba(28,25,23,0.11), 0 4px 14px rgba(28,25,23,0.05); }

  @keyframes hwxFade { from { opacity:0; } to { opacity:1; } }
  @keyframes hwxFloatA { 0%,100% { transform:translateY(0); }   50% { transform:translateY(-12px); } }
  @keyframes hwxFloatB { 0%,100% { transform:translateY(0); }   50% { transform:translateY(-7px); } }
  @keyframes hwxFloatC { 0%,100% { transform:translateY(0); }   50% { transform:translateY(-9px); } }
  @keyframes hwxFloatD { 0%,100% { transform:translateY(0); }   50% { transform:translateY(-6px); } }

  /* ── placement: desktop ── (front panels carry +translateZ, which enlarges &
     pushes them outward under perspective, so they sit further IN from the edge
     than the back panels) */
  .hwx-chart { width:248px; left:5%;   top:51%; transform:translateY(-50%) translateZ(56px)   rotateY(13deg); }
  .hwx-kpi   { width:182px; left:9%;   top:21%; transform:translateY(-50%) translateZ(-134px) rotateY(13deg)  scale(.92); }
  .hwx-diff  { width:270px; right:5%;  top:43%; transform:translateY(-50%) translateZ(64px)   rotateY(-13deg); }
  .hwx-tg    { width:222px; right:10%; top:76%; transform:translateY(-50%) translateZ(-120px) rotateY(-13deg) scale(.92); }

  .hwx-paused .hwx-float, .hwx-paused .hwx-panel { animation-play-state:paused !important; }

  /* tablet: the 780px text block fills the width, so frame it from the four
     corners instead of sitting behind it (chart TL, telegram TR, kpi BL, diff BR) */
  @media (max-width:900px) {
    .hwx-scene { perspective:1300px; perspective-origin:50% 50%; }
    .hwx-chart { width:208px; left:2%;  top:13%;  bottom:auto; transform:translateZ(34px)  rotateY(10deg)  scale(.9); }
    .hwx-tg    { width:178px; right:3%; top:14%;  bottom:auto; transform:translateZ(-44px) rotateY(-10deg) scale(.86); }
    .hwx-kpi   { width:152px; left:5%;  top:auto; bottom:15%;  transform:translateZ(-44px) rotateY(10deg)  scale(.86); }
    .hwx-diff  { width:228px; right:2%; top:auto; bottom:12%;  transform:translateZ(34px)  rotateY(-10deg) scale(.9); }
  }
  @media (max-width:768px) {
    .hwx-scene { perspective:1000px; perspective-origin:50% 50%; }
    .hwx-kpi, .hwx-tg { display:none; }
    .hwx-chart { width:170px; left:2%;  top:11%;  transform:translateZ(0) rotateY(9deg)  scale(.84); }
    .hwx-diff  { width:198px; right:2%; top:auto; bottom:5%; transform:translateZ(0) rotateY(-9deg) scale(.84); }
  }

  @media (prefers-reduced-motion:reduce) {
    .hwx-panel, .hwx-float { animation:none !important; }
    .hwx-stage { transform:none !important; transition:none !important; }
  }
`

// One floating panel: wrapper (placement + entrance fade) > dim (static depth
// opacity) > float (drift) > card content.
function Panel({ cls, drift, dur, delay, inDelay, dim = 1, children }) {
  return (
    <div className={`hwx-panel ${cls}`} style={{ '--in': `${inDelay}s` }}>
      <div style={{ opacity: dim }}>
        <div className="hwx-float" style={{
          animationName: drift, animationDuration: dur, animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite', animationDelay: delay,
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function HeroWorkspace() {
  const reduced = useRef(prefersReducedMotion()).current
  const [mounted, setMounted] = useState(false)
  const [live, setLive] = useState(false)
  const [pct, setPct] = useState(reduced ? PCT_TO : PCT_FROM)

  const sceneRef = useRef(null)
  const stageRef = useRef(null)
  const liveRef = useRef(false)
  const t0Ref = useRef(null)
  const countDone = useRef(false)

  // narrative targets
  const markerRef = useRef(null)
  const ringRef = useRef(null)
  const tagRef = useRef(null)
  const glowRef = useRef(null)
  const yesRef = useRef(null)

  // Mount the scene only after the first paint, so the hero <h1> (LCP) is never
  // blocked by it.
  useEffect(() => { setMounted(true) }, [])

  // Pause when the scene scrolls offscreen.
  useEffect(() => {
    if (reduced || !mounted) return
    const el = sceneRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setLive(true); liveRef.current = true; return }
    const io = new IntersectionObserver(([e]) => { setLive(e.isIntersecting); liveRef.current = e.isIntersecting }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [reduced, mounted])

  // THE narrative clock — one rAF. Pure function of (elapsed mod PERIOD).
  useEffect(() => {
    if (reduced || !mounted || !live) return
    let raf = 0
    const tick = (ts) => {
      if (t0Ref.current == null) t0Ref.current = ts
      const p = (((ts - t0Ref.current) % PERIOD) / PERIOD)

      const L = envelope(p, 0.12, 0.22, 0.66, 0.80)   // leak intensity (marker red)
      const Y = envelope(p, 0.50, 0.585, 0.70, 0.80)  // Telegram YES highlight
      const TAG = envelope(p, 0.70, 0.79, 0.90, 0.985)// "+0.4% after fix" win tag
      const D = envelope(p, 0.31, 0.39, 0.49, 0.57)   // PR diff "writing" glow

      // single expanding leak ring, 0 at both window edges
      let ringO = 0, ringS = 0.55
      if (p >= 0.12 && p < 0.34) { const k = (p - 0.12) / 0.22; ringO = Math.sin(Math.PI * k) * 0.5; ringS = 0.55 + k * 1.2 }

      if (markerRef.current) markerRef.current.style.fill = mix(GREEN_RGB, TERRA_RGB, L)
      if (ringRef.current) { ringRef.current.style.opacity = ringO.toFixed(3); ringRef.current.style.transform = `scale(${ringS.toFixed(3)})` }
      if (glowRef.current) glowRef.current.style.opacity = (D * 0.85).toFixed(3)
      if (tagRef.current) { tagRef.current.style.opacity = TAG.toFixed(3); tagRef.current.style.transform = `translateY(${((1 - TAG) * 5).toFixed(2)}px)` }
      if (yesRef.current) {
        const el = yesRef.current
        el.style.backgroundColor = `rgba(42,92,69,${(0.06 + Y * 0.94).toFixed(3)})`
        el.style.color = mix([107, 100, 96], [247, 244, 239], Y)
        el.style.borderColor = `rgba(42,92,69,${(0.25 + Y * 0.75).toFixed(3)})`
        el.style.transform = `scale(${(1 + Y * 0.04).toFixed(3)})`
        el.style.boxShadow = Y > 0.02 ? `0 4px 14px rgba(42,92,69,${(Y * 0.3).toFixed(3)})` : 'none'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced, mounted, live])

  // The conversion % counts up ONCE (~0.9s after the scene appears) and holds.
  useEffect(() => {
    if (reduced) { setPct(PCT_TO); return }
    if (!mounted || !live || countDone.current) return
    let raf, start
    const t = setTimeout(() => {
      countDone.current = true
      const step = (ts) => {
        if (!start) start = ts
        const k = Math.min(1, (ts - start) / 1100)
        setPct(+(PCT_FROM + (PCT_TO - PCT_FROM) * (1 - Math.pow(1 - k, 3))).toFixed(2))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, 900)
    return () => { clearTimeout(t); if (raf) cancelAnimationFrame(raf) }
  }, [reduced, mounted, live])

  // Mouse-parallax — desktop / non-touch only, rAF-throttled, transform-only.
  useEffect(() => {
    if (reduced || !mounted) return
    if (typeof window === 'undefined' || !window.matchMedia) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    if (window.matchMedia('(max-width: 768px)').matches) return
    const scene = sceneRef.current, stage = stageRef.current
    if (!scene || !stage) return
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0
    const apply = () => {
      raf = 0
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12
      stage.style.transform = `rotateX(${(-cy * 4.5).toFixed(2)}deg) rotateY(${(cx * 6.5).toFixed(2)}deg)`
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(apply)
    }
    const onMove = (e) => {
      if (!liveRef.current) return
      const r = scene.getBoundingClientRect()
      tx = (e.clientX - r.left) / r.width - 0.5
      ty = (e.clientY - r.top) / r.height - 0.5
      if (!raf) raf = requestAnimationFrame(apply)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf); if (stage) stage.style.transform = '' }
  }, [reduced, mounted])

  if (!mounted) return null

  const paused = !reduced && !live
  // Settled (reduced-motion) values: healed green, YES approved, tag shown.
  const markerFill = T.greenLn
  const ringInit = { opacity: 0 }
  const tagInit = reduced ? { opacity: 1, transform: 'none' } : { opacity: 0, transform: 'translateY(5px)' }
  const glowInit = { opacity: 0 }
  const yesInit = reduced
    ? { backgroundColor: 'rgba(42,92,69,1)', color: '#f7f4ef', borderColor: 'rgba(42,92,69,1)', transform: 'scale(1.04)', boxShadow: '0 4px 14px rgba(42,92,69,0.3)' }
    : { backgroundColor: 'rgba(42,92,69,0.06)', color: T.muted, borderColor: 'rgba(42,92,69,0.25)', transform: 'none', boxShadow: 'none' }

  const lbl = { fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, color: T.light }

  return (
    <div className="hwx-scene" ref={sceneRef} aria-hidden="true">
      <style>{CSS}</style>
      <div className={`hwx-stage ${paused ? 'hwx-paused' : ''}`} ref={stageRef}>

        {/* ── LEFT-BACK · KPI tile ─────────────────────────────────────── */}
        <Panel cls="hwx-kpi" drift="hwxFloatB" dur="13s" delay="-4s" inDelay={0.32} dim={0.7}>
          <div className="hwx-card" style={{ padding: '13px 15px' }}>
            <p style={lbl}>Fixes live</p>
            <p style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 38, color: T.green, lineHeight: 1, margin: '4px 0 9px' }}>4</p>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 22 }}>
              {[10, 14, 9, 18, 13, 22].map((h, i) => (
                <div key={i} style={{ flex: 1, height: h, background: i === 5 ? T.green : 'rgba(42,92,69,0.28)', borderRadius: 2 }} />
              ))}
            </div>
          </div>
        </Panel>

        {/* ── LEFT-FRONT · live conversion chart ───────────────────────── */}
        <Panel cls="hwx-chart" drift="hwxFloatA" dur="11s" delay="0s" inDelay={0.08}>
          <div className="hwx-card" style={{ padding: '15px 16px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <p style={lbl}>Conversion rate</p>
              <p style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 27, color: T.green, lineHeight: 1 }}>{pct.toFixed(1)}%</p>
            </div>
            <svg viewBox="0 0 200 74" width="100%" style={{ display: 'block', overflow: 'visible' }}>
              <defs>
                <linearGradient id="hwxFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="rgba(42,92,69,0.16)" />
                  <stop offset="1" stopColor="rgba(42,92,69,0)" />
                </linearGradient>
              </defs>
              {[24, 44].map((y) => <line key={y} x1="6" y1={y} x2="194" y2={y} stroke="rgba(28,25,23,0.05)" strokeWidth="1" />)}
              <path d="M6 60 C 30 56,44 50,66 44 C 92 37,108 33,130 26 C 152 19,168 17,180 14 L180 70 L6 70 Z" fill="url(#hwxFill)" />
              <path d="M6 60 C 30 56,44 50,66 44 C 92 37,108 33,130 26 C 152 19,168 17,180 14"
                fill="none" stroke={T.greenLn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle ref={ringRef} cx="180" cy="14" r="6.5" fill="none" stroke={T.terra} strokeWidth="1.4"
                style={{ transformBox: 'fill-box', transformOrigin: 'center', ...ringInit }} />
              <circle ref={markerRef} cx="180" cy="14" r="4" fill={markerFill} stroke="#fff" strokeWidth="1.4"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
            </svg>
            <div ref={tagRef} style={{
              position: 'absolute', top: 44, right: 14,
              background: 'rgba(42,92,69,0.1)', border: '1px solid rgba(42,92,69,0.28)', color: T.green,
              borderRadius: 7, padding: '2px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '.02em',
              ...tagInit,
            }}>+0.4% after fix</div>
          </div>
        </Panel>

        {/* ── RIGHT-FRONT · PR diff card ───────────────────────────────── */}
        <Panel cls="hwx-diff" drift="hwxFloatC" dur="10s" delay="-3s" inDelay={0.18}>
          <div className="hwx-card" style={{ padding: '13px 15px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.gold, flexShrink: 0 }} />
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11.5, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>HeroScroll.jsx</span>
              </div>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: T.muted, flexShrink: 0 }}>PR #247</span>
            </div>
            <div ref={glowRef} style={{ position: 'absolute', left: 0, right: 0, top: 32, bottom: 0, background: 'radial-gradient(ellipse 70% 60% at 30% 60%, rgba(42,92,69,0.14), rgba(42,92,69,0))', opacity: 0, pointerEvents: 'none' }} />
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, lineHeight: 1.75, position: 'relative' }}>
              <p style={{ color: T.terra, textDecoration: 'line-through', opacity: 0.85 }}>− generic hero headline</p>
              <p style={{ color: T.greenLn }}>+ value-led headline</p>
              <p style={{ color: T.greenLn }}>+ primary CTA above fold</p>
            </div>
          </div>
        </Panel>

        {/* ── RIGHT-BACK · Telegram approval card ──────────────────────── */}
        <Panel cls="hwx-tg" drift="hwxFloatD" dur="15s" delay="-7s" inDelay={0.42} dim={0.72}>
          <div className="hwx-card" style={{ padding: '13px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9z" />
              </svg>
              <span style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, color: T.muted }}>Telegram</span>
            </div>
            <p style={{ fontSize: 12.5, color: T.ink, fontWeight: 400, marginBottom: 11, lineHeight: 1.4 }}>Approve fix for PR&nbsp;#247?</p>
            <div style={{ display: 'flex', gap: 7 }}>
              <span ref={yesRef} style={{ padding: '4px 16px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: '1px solid', letterSpacing: '.04em', ...yesInit }}>YES</span>
              <span style={{ padding: '4px 16px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: `1px solid ${T.border}`, color: T.light, letterSpacing: '.04em' }}>NO</span>
            </div>
          </div>
        </Panel>

      </div>
    </div>
  )
}
