// HeroLoop — the landing hero's "living growth loop".
//
// A slow, deliberate demonstration of the product mechanic itself, echoing the
// dashboard's SiteNetwork graph so marketing + product read as one world:
//   visitors flow down a funnel → one node leaks (terracotta) → the agent traces
//   to it → a fix emits (PR) → the node heals to green → conversions tick up
//   (+X%) → subtle reset → repeat.
//
// Built with inline SVG + CSS keyframes + a tiny JS phase clock (no animation
// library, no canvas). Performance guards:
//   · the hero <h1> remains the LCP element — this mounts beside it and never
//     blocks first paint
//   · an IntersectionObserver pauses the whole thing (timer + CSS) when scrolled
//     offscreen
//   · prefers-reduced-motion renders the settled "after" state — green node,
//     +X% shown, nothing moving — and never starts a timer
//
// Tokens mirror SiteNetwork.jsx (FILL/RING) so the colour story is identical.
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion.jsx'

const T = {
  edge:        '42,92,69',
  neutralFill: '#b9b4ac', neutralRing: '#8a857e',
  problemFill: '#c2573d', problemRing: '#8a2820',
  greenFill:   '#2f6b4f', greenRing:   '#1a4a2f',
  gold:        '#c2a45f', goldRing:    '#a8862e',
  agent:       '#2a5c45',
  ink: '#1c1917', muted: '#6b6460', light: '#a09890', warm: '#8c7355',
}

// Slow + calm. One full cycle ≈ 12.7s. Durations in ms.
const PHASES = [
  { name: 'flow',  ms: 3200 },  // visitors moving, all calm
  { name: 'leak',  ms: 2600 },  // sign-up node leaks (terracotta)
  { name: 'trace', ms: 2000 },  // agent traces to it, PR emits
  { name: 'heal',  ms: 1700 },  // node heals to green, PR merged
  { name: 'win',   ms: 3200 },  // conversion figure ticks up
]
const TARGET = 3.1 // the "+X%" the loop reveals

// Geometry (viewBox 0 0 340 432)
const SPINE = 210
const NODES = {
  landing:   { y: 66,  r: 14, label: 'Landing',   status: 'neutral' },
  pricing:   { y: 168, r: 15, label: 'Pricing',   status: 'green'   },
  signup:    { y: 270, r: 18, label: 'Sign-up',   status: 'dynamic' },
  activated: { y: 372, r: 16, label: 'Activated', status: 'green'   },
}
const HUB = { x: 66, y: 210, r: 19 }

export default function HeroLoop() {
  const reduced = useRef(prefersReducedMotion()).current
  const wrapRef = useRef(null)
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [active, setActive] = useState(false)
  const [pct, setPct] = useState(reduced ? TARGET : 0)

  // Pause entirely when offscreen (perf).
  useEffect(() => {
    if (reduced) return
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setActive(true); return }
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  // Phase clock — chained timeouts so each beat can have its own length. Local
  // `i` (not state) drives scheduling so it's immune to StrictMode double-mounts;
  // the story restarts from the first beat whenever the loop re-enters view.
  useEffect(() => {
    if (reduced || !active) return
    let id, i = 0
    setPhaseIdx(0)
    const tick = () => { id = setTimeout(() => { i = (i + 1) % PHASES.length; setPhaseIdx(i); tick() }, PHASES[i].ms) }
    tick()
    return () => clearTimeout(id)
  }, [active, reduced])

  const phase = reduced ? 'win' : PHASES[phaseIdx].name

  // Count the "+X%" up each time we enter the win beat (rAF easeOutCubic).
  useEffect(() => {
    if (reduced) return
    if (phase !== 'win') { setPct(0); return }
    let raf, start
    const dur = 1100
    const step = (ts) => {
      if (!start) start = ts
      const t = Math.min(1, (ts - start) / dur)
      setPct(+(TARGET * (1 - Math.pow(1 - t, 3))).toFixed(1))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [phase, reduced])

  // Derived visual state.
  const leaking = phase === 'leak' || phase === 'trace'
  const healed  = phase === 'heal' || phase === 'win'
  const traceOn = phase === 'trace' || phase === 'heal' || phase === 'win'
  const prState = phase === 'trace' ? 'open' : (phase === 'heal' || phase === 'win') ? 'merged' : 'none'
  const showWin = phase === 'win'

  const signupFill = leaking ? T.problemFill : healed ? T.greenFill : T.neutralFill
  const signupRing = leaking ? T.problemRing : healed ? T.greenRing : T.neutralRing

  const fillFor = (s) => s === 'green' ? T.greenFill : T.neutralFill
  const ringFor = (s) => s === 'green' ? T.greenRing : T.neutralRing

  const css = `
    .hl-svg text { font-family: 'Jost', sans-serif; }
    .hl-dot { animation: hlFlow 5s linear infinite; }
    .hl-dot.d2 { animation-delay: -1.25s; }
    .hl-dot.d3 { animation-delay: -2.5s; }
    .hl-dot.d4 { animation-delay: -3.75s; }
    @keyframes hlFlow {
      0%   { transform: translateY(66px);  opacity: 0; }
      7%   { opacity: 1; }
      93%  { opacity: 1; }
      100% { transform: translateY(372px); opacity: 0; }
    }
    .hl-paused .hl-dot { animation-play-state: paused; }
    .hl-leaking .hl-dot { opacity: .22; transition: opacity .6s ease; }
    @keyframes hlPing { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(2.1); opacity: 0; } }
    .hl-ping { transform-box: fill-box; transform-origin: center; animation: hlPing 1.8s ease-out infinite; }
    .hl-fade { transition: opacity .6s ease; }
    .hl-node circle { transition: fill .8s ease, stroke .8s ease; }
    .hl-trace { transition: stroke-dashoffset .9s cubic-bezier(.4,0,.2,1), opacity .5s ease; }
    .hl-chip { transition: opacity .5s ease, transform .5s ease; transform-box: fill-box; }
    @media (prefers-reduced-motion: reduce) {
      /* static "after" frame: no flow dots, nothing moving */
      .hl-dot { animation: none !important; opacity: 0 !important; }
      .hl-ping { animation: none !important; }
    }
  `

  const wrapClass = ['hl-wrap', reduced ? '' : (!active ? 'hl-paused' : ''), leaking ? 'hl-leaking' : '']
    .filter(Boolean).join(' ')

  return (
    <div ref={wrapRef} className={wrapClass} aria-hidden="true"
      style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}>
      <style>{css}</style>
      <svg className="hl-svg" viewBox="0 0 340 432" width="100%" style={{ display: 'block', overflow: 'visible' }}>

        {/* faint structural edges: agent hub → each spine node */}
        <g stroke={`rgba(${T.edge},0.10)`} strokeWidth="1" fill="none">
          {Object.values(NODES).map((n, i) => (
            <path key={i} d={`M${HUB.x} ${HUB.y} Q ${(HUB.x + SPINE) / 2 - 18} ${(HUB.y + n.y) / 2} ${SPINE} ${n.y}`} />
          ))}
        </g>

        {/* funnel spine edges (node → node) */}
        <g stroke={`rgba(${T.edge},0.22)`} strokeWidth="1.4" fill="none">
          <line x1={SPINE} y1={NODES.landing.y} x2={SPINE} y2={NODES.pricing.y} />
          <line x1={SPINE} y1={NODES.pricing.y} x2={SPINE} y2={NODES.signup.y} />
          <line x1={SPINE} y1={NODES.signup.y} x2={SPINE} y2={NODES.activated.y} />
        </g>

        {/* agent trace edge → sign-up (draws in during the trace beat) */}
        <path className="hl-trace"
          d={`M${HUB.x} ${HUB.y} Q ${(HUB.x + SPINE) / 2 - 18} ${(HUB.y + NODES.signup.y) / 2} ${SPINE} ${NODES.signup.y}`}
          fill="none" stroke={T.gold} strokeWidth="1.8" strokeLinecap="round"
          pathLength="1" strokeDasharray="1" strokeDashoffset={traceOn ? 0 : 1}
          style={{ opacity: traceOn ? 1 : 0 }} />

        {/* visitor dots flowing down the spine */}
        <g>
          {[1, 2, 3, 4].map(i => (
            <circle key={i} className={`hl-dot d${i}`} cx={SPINE} cy={0} r={3}
              fill={`rgba(${T.edge},0.55)`} />
          ))}
        </g>

        {/* leak pulse ring on sign-up */}
        {(leaking) && (
          <circle className="hl-ping" cx={SPINE} cy={NODES.signup.y} r={NODES.signup.r}
            fill="none" stroke={T.problemFill} strokeWidth="1.5" />
        )}

        {/* agent hub — a mini Velyr mark */}
        <g>
          <circle cx={HUB.x} cy={HUB.y} r={HUB.r} fill="none" stroke={T.agent} strokeWidth="1" opacity="0.32" />
          <circle cx={HUB.x} cy={HUB.y} r={HUB.r - 6} fill="none" stroke={T.agent} strokeWidth="1" opacity="0.55" />
          <circle cx={HUB.x} cy={HUB.y} r={3.4} fill={T.agent} />
          <text x={HUB.x} y={HUB.y + HUB.r + 15} textAnchor="middle"
            style={{ fontSize: 10, fontWeight: 500, fill: T.agent, letterSpacing: '.04em' }}>Velyr agent</text>
        </g>

        {/* spine nodes */}
        {Object.entries(NODES).map(([key, n]) => {
          const isSignup = key === 'signup'
          const fill = isSignup ? signupFill : fillFor(n.status)
          const ring = isSignup ? signupRing : ringFor(n.status)
          return (
            <g key={key} className="hl-node">
              <circle cx={SPINE} cy={n.y} r={n.r} fill={fill} stroke={ring} strokeWidth="1.8" />
              {/* the goal node's label gives way to the conversion readout during the win beat */}
              <text x={SPINE + n.r + 11} y={n.y + 4} textAnchor="start" className="hl-fade"
                style={{ fontSize: 11.5, fontWeight: 300, fill: T.muted, opacity: (key === 'activated' && showWin) ? 0 : 1 }}>{n.label}</text>
            </g>
          )
        })}

        {/* PR chip — emits during trace, becomes "merged" on heal */}
        <g className="hl-chip" style={{ opacity: prState === 'none' ? 0 : 1, transform: prState === 'none' ? 'translateY(4px)' : 'none' }}>
          <rect x={92} y={NODES.signup.y - 11} rx={6} width={86} height={22}
            fill="#fff" stroke={prState === 'merged' ? T.greenRing : T.goldRing} strokeWidth="1" />
          <text x={135} y={NODES.signup.y + 4} textAnchor="middle"
            style={{ fontSize: 10, fontWeight: 500, fill: prState === 'merged' ? T.greenFill : T.warm }}>
            {prState === 'merged' ? 'merged ✓' : 'PR #247'}
          </text>
        </g>

        {/* win readout — conversion figure ticks up beside the goal node (replaces its label during the win beat) */}
        <g className="hl-fade" style={{ opacity: showWin ? 1 : 0 }}>
          <text x={SPINE + NODES.activated.r + 12} y={NODES.activated.y + 3} textAnchor="start"
            style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 27, fontWeight: 400, fontStyle: 'italic', fill: T.greenFill }}>
            +{pct.toFixed(1)}%
          </text>
          <text x={SPINE + NODES.activated.r + 13} y={NODES.activated.y + 17} textAnchor="start"
            style={{ fontSize: 8.5, fontWeight: 400, fill: T.light, letterSpacing: '.09em', textTransform: 'uppercase' }}>conversions</text>
        </g>
      </svg>
    </div>
  )
}
