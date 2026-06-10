// HeroWireframe — the landing hero's full-bleed background animation.
//
// Two movements, one composition:
//   1. ENTRANCE (once, ~2.4s, starts after first paint): an abstract site
//      sketches itself in thin green strokes — header, hero block, cards,
//      section bars, a CTA pill, form lines, footer — each stroke self-drawing.
//   2. THE LOOP (18s, seamless by construction): the agent's weekly cycle.
//      calm → the CTA pill leaks (terracotta, soft 1.1s onset) → a gold edge
//      traces from the Velyr agent mark to it → a PR chip emits → the pill's
//      stroke re-traces (rework) → settles green → "merged ✓" → over a long
//      ~6s tail the green RELAXES back to neutral ("new week, new baseline").
//      Every looping element is a CSS `18s linear infinite` keyframe whose
//      100% state equals its 0% state — t=0 ≡ t=PERIOD, no JS per frame,
//      no snap possible at the wrap.
//
// The quiet "living graph" accent: faint node dots at block anchors + whisper
// edges between clusters, breathing on the same 18s period — the built site is
// a living system (it's literally what the agent's RA1/RA2 passes produce).
//
// Perf / a11y guards:
//   · the hero <h1> renders beside this and stays the LCP element
//   · IntersectionObserver pauses ALL animation when offscreen
//   · prefers-reduced-motion renders the settled composition: built wireframe,
//     green pill, +X% shown, nothing moving
//   · the +X% counts up ONCE (~3s after entering view) and holds forever
//   · ≤900px swaps the full-bleed scene for a compact in-flow vignette
//     (fewer elements, same loop) below the hero copy
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion.jsx'

const T = {
  stroke: 'rgba(42,92,69,0.36)',   // primary wireframe stroke
  faint:  'rgba(42,92,69,0.18)',   // interior / secondary lines
  dot:    'rgba(42,92,69,0.5)',
  edge:   'rgba(42,92,69,0.13)',   // whisper graph edges
  gold:   '#c2a45f', goldRing: '#a8862e',
  terra:  '#c2573d',
  green:  '#2f6b4f', greenRing: '#1a4a2f',
  agent:  '#2a5c45',
  muted:  '#6b6460', light: '#a09890',
}
const TARGET = 3.1 // illustrative "+X%" — counts once, then holds

// Loop beat map (PERIOD = 18s; 1% = 0.18s):
//   0–11   calm · 11–17 leak onset (1.1s ease) · 14–32 leak pings
//   24–34  gold trace draws · 34 PR chip up · 37–48 rework sweep
//   46     green settled · 47–55 heal ring · 48 chip → merged
//   56–64  trace fades · 66 chip down
//   62–96  THE RELAX: green → neutral over ~6.1s · 96–100 calm (== 0%)
const CSS = `
  .hw-svg text { font-family: 'Jost', sans-serif; }
  .hw-bleed { display: block; position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }
  .hw-compact { display: none; }
  @media (max-width: 900px) {
    .hw-bleed { display: none; }
    .hw-compact { display: block; order: 1; width: min(380px, 88vw); margin: 30px auto 0; position: relative; z-index: 2; }
  }

  @keyframes hwDrawIn { from { stroke-dashoffset: 1; } }
  @keyframes hwFadeIn { from { opacity: 0; } }
  .hw-d { stroke-dasharray: 1; stroke-dashoffset: 0; animation: hwDrawIn .85s cubic-bezier(.4,0,.2,1) both; animation-delay: var(--d, 0s); }
  .hw-f { animation: hwFadeIn .7s ease both; animation-delay: var(--d, 0s); }

  /* CTA pill — entrance draw + the 18s state cycle. 62%→96% is the critical
     soft relax; 100% ≡ 0% so the loop wrap is invisible. */
  @keyframes hwPill {
    0%, 11%   { stroke: rgba(42,92,69,0.4);  fill: rgba(42,92,69,0); }
    17%, 38%  { stroke: #c2573d;             fill: rgba(194,87,61,0.06); }
    46%, 62%  { stroke: #2f6b4f;             fill: rgba(47,107,79,0.07); }
    96%, 100% { stroke: rgba(42,92,69,0.4);  fill: rgba(42,92,69,0); }
  }
  .hw-pill { stroke-dasharray: 1; animation: hwDrawIn .85s cubic-bezier(.4,0,.2,1) var(--d, 0s) both, hwPill 18s linear 2.6s infinite; }

  @keyframes hwPing {
    0%, 13%    { transform: scale(.85); opacity: 0; }
    15%        { opacity: .4; }
    22%        { transform: scale(1.65); opacity: 0; }
    23%        { transform: scale(.85);  opacity: 0; }
    25%        { opacity: .3; }
    32%        { transform: scale(1.65); opacity: 0; }
    33%, 100%  { transform: scale(.85);  opacity: 0; }
  }
  .hw-ping { transform-box: fill-box; transform-origin: center; animation: hwPing 18s linear 2.6s infinite; }

  @keyframes hwTrace {
    0%, 24%   { stroke-dashoffset: 1; opacity: 0; }
    26%       { stroke-dashoffset: 1; opacity: .9; }
    34%, 56%  { stroke-dashoffset: 0; opacity: .9; }
    64%       { stroke-dashoffset: 0; opacity: 0; }
    65%, 100% { stroke-dashoffset: 1; opacity: 0; }
  }
  .hw-trace { stroke-dasharray: 1; animation: hwTrace 18s linear 2.6s infinite; }

  /* rework — a green dash sweeps once around the pill while it heals */
  @keyframes hwRework {
    0%, 37%   { stroke-dashoffset: 1; opacity: 0; }
    39%       { opacity: .75; }
    46%       { stroke-dashoffset: 0; opacity: .75; }
    48%       { stroke-dashoffset: 0; opacity: 0; }
    50%, 100% { stroke-dashoffset: 1; opacity: 0; }
  }
  .hw-rework { animation: hwRework 18s linear 2.6s infinite; }

  @keyframes hwHeal {
    0%, 45%   { transform: scale(.9); opacity: 0; }
    47%       { opacity: .36; }
    55%       { transform: scale(1.75); opacity: 0; }
    56%, 100% { transform: scale(.9);  opacity: 0; }
  }
  .hw-heal { transform-box: fill-box; transform-origin: center; animation: hwHeal 18s linear 2.6s infinite; }

  @keyframes hwAgentPing {
    0%, 22%   { transform: scale(1); opacity: 0; }
    24%       { opacity: .35; }
    31%       { transform: scale(1.9); opacity: 0; }
    32%, 100% { transform: scale(1); opacity: 0; }
  }
  .hw-aping { transform-box: fill-box; transform-origin: center; animation: hwAgentPing 18s linear 2.6s infinite; }

  /* PR chip — rises during the trace, flips to "merged ✓", sinks away.
     The label/border swaps ramp back inside the hidden window so every
     property still satisfies state(0) == state(100). */
  @keyframes hwChip {
    0%, 30%   { opacity: 0; transform: translateY(5px); }
    34%, 60%  { opacity: 1; transform: translateY(0); }
    66%, 100% { opacity: 0; transform: translateY(5px); }
  }
  .hw-chip { transform-box: fill-box; animation: hwChip 18s linear 2.6s infinite; }
  @keyframes hwChipRect {
    0%, 44%  { stroke: rgba(168,134,46,0.75); }
    48%, 90% { stroke: rgba(26,74,47,0.55); }
    96%, 100%{ stroke: rgba(168,134,46,0.75); }
  }
  .hw-chiprect { animation: hwChipRect 18s linear 2.6s infinite; }
  @keyframes hwChipA { 0%, 44% { opacity: 1; } 47%, 94% { opacity: 0; } 98%, 100% { opacity: 1; } }
  .hw-chipa { animation: hwChipA 18s linear 2.6s infinite; }
  @keyframes hwChipB { 0%, 45% { opacity: 0; } 48%, 64% { opacity: 1; } 68%, 100% { opacity: 0; } }
  .hw-chipb { animation: hwChipB 18s linear 2.6s infinite; }

  /* the living-graph accent breathes on the same period */
  @keyframes hwBreath { 0% { opacity: .55; } 50% { opacity: 1; } 100% { opacity: .55; } }
  .hw-breath { animation: hwFadeIn .7s ease var(--d, 0s) both, hwBreath 18s linear 2.6s infinite; }

  .hw-off, .hw-off * { animation-play-state: paused !important; }

  @media (prefers-reduced-motion: reduce) {
    /* settled composition: everything drawn, nothing moving (inline styles
       below turn the pill green and show the +X%) */
    .hw-svg, .hw-svg * { animation: none !important; }
  }
`

export default function HeroWireframe() {
  const reduced = useRef(prefersReducedMotion()).current
  const bleedRef = useRef(null)
  const compactRef = useRef(null)
  const startedRef = useRef(false)
  const [live, setLive] = useState(false)
  const [pct, setPct] = useState(reduced ? TARGET : 0)

  // Pause everything when neither variant is on screen.
  useEffect(() => {
    if (reduced) return
    if (typeof IntersectionObserver === 'undefined') { setLive(true); return }
    const els = [bleedRef.current, compactRef.current].filter(Boolean)
    const vis = new Map()
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => vis.set(e.target, e.isIntersecting))
      setLive([...vis.values()].some(Boolean))
    }, { threshold: 0.12 })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [reduced])

  // The +X% counts up once (~3s in, as the sketch settles) and holds forever.
  // startedRef flips only when the timer FIRES so a StrictMode double-mount
  // can't swallow the count.
  useEffect(() => {
    if (reduced || !live || startedRef.current) return
    let raf
    const t = setTimeout(() => {
      startedRef.current = true
      let start
      const step = (ts) => {
        if (!start) start = ts
        const k = Math.min(1, (ts - start) / 1100)
        setPct(+(TARGET * (1 - Math.pow(1 - k, 3))).toFixed(1))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, 3000)
    return () => { clearTimeout(t); if (raf) cancelAnimationFrame(raf) }
  }, [live, reduced])

  // Entrance-draw helper: stroke self-draws after `delay` seconds.
  const d = (delay, extra = {}) => ({ className: 'hw-d', pathLength: 1, style: { '--d': `${delay}s` }, ...extra })
  const f = (delay) => ({ className: 'hw-f', style: { '--d': `${delay}s` } })

  const paused = !reduced && !live
  // Settled overrides for reduced motion: pill green, readout shown.
  const pillSettled = reduced ? { stroke: T.green, fill: 'rgba(47,107,79,0.07)' } : {}
  const showPct = reduced || pct > 0

  return (
    <div style={{ display: 'contents' }} aria-hidden="true">
      <style>{CSS}</style>

      {/* ── full-bleed scene (>900px) — viewBox 1200×640, meet (never crops) ── */}
      <svg ref={bleedRef} className={`hw-svg hw-bleed ${paused ? 'hw-off' : ''}`}
        viewBox="0 0 1200 640" preserveAspectRatio="xMidYMid meet">

        {/* whisper graph edges + node dots — the living-system accent */}
        <g className="hw-breath" style={{ '--d': '1.7s', opacity: .8 }}>
          <path d="M 320 87 C 520 38, 700 52, 880 100" fill="none" stroke={T.edge} strokeWidth="1" />
          <path d="M 282 354 C 520 600, 700 590, 880 452" fill="none" stroke={T.edge} strokeWidth="1" />
          {[[320, 87], [880, 100], [282, 354], [880, 452], [70, 130], [1080, 322]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.6" fill={T.dot} />
          ))}
        </g>

        {/* ── left cluster: the site sketches itself ── */}
        {/* header */}
        <rect x="70" y="70" width="250" height="34" rx="8" fill="none" stroke={T.stroke} strokeWidth="1.4" {...d(0)} />
        <g {...f(0.25)}>
          {[90, 104, 118].map(x => <circle key={x} cx={x} cy="87" r="2.4" fill={T.faint} />)}
        </g>
        <path d="M 240 87 H 268" stroke={T.faint} strokeWidth="1.2" {...d(0.25)} />
        <path d="M 278 87 H 306" stroke={T.faint} strokeWidth="1.2" {...d(0.3)} />

        {/* hero block */}
        <rect x="70" y="130" width="250" height="120" rx="10" fill="none" stroke={T.stroke} strokeWidth="1.4" {...d(0.15)} />
        <path d="M 92 165 H 262" stroke={T.faint} strokeWidth="1.6" {...d(0.35)} />
        <path d="M 92 190 H 222" stroke={T.faint} strokeWidth="1.2" {...d(0.42)} />
        <rect x="92" y="208" width="64" height="20" rx="6" fill="none" stroke={T.faint} strokeWidth="1.2" {...d(0.5)} />

        {/* cards row */}
        {[70, 158, 246].map((x, i) => (
          <g key={x}>
            <rect x={x} y="290" width="72" height="64" rx="8" fill="none" stroke={T.stroke} strokeWidth="1.3" {...d(0.45 + i * 0.13)} />
            <path d={`M ${x + 12} 330 H ${x + 52}`} stroke={T.faint} strokeWidth="1.1" {...d(0.85 + i * 0.05)} />
          </g>
        ))}

        {/* footer */}
        <path d="M 70 545 H 320" stroke={T.faint} strokeWidth="1.2" {...d(1.3)} />

        {/* agent mark — a small Velyr glyph; pings as the trace departs */}
        <g {...f(1.35)}>
          <circle cx="130" cy="455" r="19" fill="none" stroke={T.agent} strokeWidth="1" opacity=".32" />
          <circle cx="130" cy="455" r="13" fill="none" stroke={T.agent} strokeWidth="1" opacity=".55" />
          <circle cx="130" cy="455" r="3.4" fill={T.agent} />
        </g>
        {!reduced && (
          <circle className="hw-aping" cx="130" cy="455" r="19" fill="none" stroke={T.agent} strokeWidth="1.2" opacity="0" />
        )}
        <text x="130" y="492" textAnchor="middle" style={{ fontSize: 10, fontWeight: 500, fill: T.agent, letterSpacing: '.05em' }} {...f(1.5)}>Velyr agent</text>

        {/* ── right cluster ── */}
        <rect x="880" y="90" width="240" height="46" rx="8" fill="none" stroke={T.stroke} strokeWidth="1.4" {...d(0.5)} />
        <path d="M 900 113 H 1080" stroke={T.faint} strokeWidth="1.2" {...d(0.8)} />
        <rect x="880" y="152" width="240" height="46" rx="8" fill="none" stroke={T.stroke} strokeWidth="1.4" {...d(0.66)} />
        <path d="M 900 175 H 1040" stroke={T.faint} strokeWidth="1.2" {...d(0.88)} />

        {/* THE CTA pill — leak target. Leak rings, heal ring, rework sweep. */}
        {!reduced && <>
          <rect className="hw-ping" x="920" y="300" width="160" height="44" rx="17" fill="none" stroke={T.terra} strokeWidth="1.4" opacity="0" />
          <rect className="hw-heal" x="920" y="300" width="160" height="44" rx="17" fill="none" stroke={T.green} strokeWidth="1.3" opacity="0" />
        </>}
        <rect className="hw-pill" x="920" y="300" width="160" height="44" rx="17"
          fill="rgba(42,92,69,0)" stroke="rgba(42,92,69,0.4)" strokeWidth="1.7" pathLength="1"
          style={{ '--d': '0.9s', ...pillSettled }} />
        {!reduced && (
          <rect className="hw-rework" x="920" y="300" width="160" height="44" rx="17"
            fill="none" stroke={T.green} strokeWidth="1.7" pathLength="1"
            strokeDasharray="0.28 0.72" strokeDashoffset="1" opacity="0" />
        )}
        <path d="M 952 322 H 1048" stroke={T.faint} strokeWidth="1.2" {...d(1.05)} />

        {/* gold trace: agent → pill, drawn each cycle, reset while invisible */}
        {!reduced && (
          <path className="hw-trace" d="M 130 455 C 400 620, 740 560, 935 344"
            fill="none" stroke={T.gold} strokeWidth="1.8" strokeLinecap="round"
            pathLength="1" strokeDashoffset="1" opacity="0" />
        )}

        {/* PR chip */}
        {!reduced && (
          <g className="hw-chip" opacity="0">
            <rect className="hw-chiprect" x="956" y="262" width="88" height="22" rx="6" fill="#fff" stroke="rgba(168,134,46,0.75)" strokeWidth="1" />
            <text className="hw-chipa" x="1000" y="277" textAnchor="middle" style={{ fontSize: 10, fontWeight: 500, fill: '#8c7355' }}>PR #247</text>
            <text className="hw-chipb" x="1000" y="277" textAnchor="middle" opacity="0" style={{ fontSize: 10, fontWeight: 500, fill: T.green }}>merged ✓</text>
          </g>
        )}

        {/* win readout — counts once, then holds */}
        <g style={{ opacity: showPct ? 1 : 0, transition: 'opacity .6s ease' }}>
          <text x="940" y="392" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 30, fontStyle: 'italic', fill: T.green }}>+{pct.toFixed(1)}%</text>
          <text x="942" y="410" style={{ fontSize: 8.5, fill: T.light, letterSpacing: '.1em' }}>CONVERSIONS</text>
        </g>

        {/* form hairlines */}
        <path d="M 880 440 H 1100" stroke={T.faint} strokeWidth="1.2" {...d(1.1)} />
        <path d="M 880 468 H 1040" stroke={T.faint} strokeWidth="1.2" {...d(1.2)} />
      </svg>

      {/* ── compact vignette (≤900px) — same loop, fewer elements ── */}
      <svg ref={compactRef} className={`hw-svg hw-compact ${paused ? 'hw-off' : ''}`}
        viewBox="0 0 360 240" preserveAspectRatio="xMidYMid meet">

        <g {...f(0.6)}>
          <circle cx="52" cy="116" r="16" fill="none" stroke={T.agent} strokeWidth="1" opacity=".32" />
          <circle cx="52" cy="116" r="10.5" fill="none" stroke={T.agent} strokeWidth="1" opacity=".55" />
          <circle cx="52" cy="116" r="2.8" fill={T.agent} />
        </g>
        {!reduced && (
          <circle className="hw-aping" cx="52" cy="116" r="16" fill="none" stroke={T.agent} strokeWidth="1.1" opacity="0" />
        )}
        <text x="52" y="148" textAnchor="middle" style={{ fontSize: 9, fontWeight: 500, fill: T.agent, letterSpacing: '.05em' }} {...f(0.75)}>Velyr agent</text>

        <rect x="205" y="30" width="126" height="16" rx="5" fill="none" stroke={T.stroke} strokeWidth="1.2" {...d(0.1)} />
        <rect x="205" y="54" width="100" height="14" rx="5" fill="none" stroke={T.faint} strokeWidth="1.1" {...d(0.22)} />

        {!reduced && <>
          <rect className="hw-ping" x="205" y="92" width="126" height="38" rx="15" fill="none" stroke={T.terra} strokeWidth="1.3" opacity="0" />
          <rect className="hw-heal" x="205" y="92" width="126" height="38" rx="15" fill="none" stroke={T.green} strokeWidth="1.2" opacity="0" />
        </>}
        <rect className="hw-pill" x="205" y="92" width="126" height="38" rx="15"
          fill="rgba(42,92,69,0)" stroke="rgba(42,92,69,0.4)" strokeWidth="1.6" pathLength="1"
          style={{ '--d': '0.35s', ...pillSettled }} />
        {!reduced && (
          <rect className="hw-rework" x="205" y="92" width="126" height="38" rx="15"
            fill="none" stroke={T.green} strokeWidth="1.6" pathLength="1"
            strokeDasharray="0.28 0.72" strokeDashoffset="1" opacity="0" />
        )}
        <path d="M 226 111 H 310" stroke={T.faint} strokeWidth="1.1" {...d(0.5)} />

        {!reduced && (
          <path className="hw-trace" d="M 66 124 C 115 180, 162 158, 206 120"
            fill="none" stroke={T.gold} strokeWidth="1.6" strokeLinecap="round"
            pathLength="1" strokeDashoffset="1" opacity="0" />
        )}

        {!reduced && (
          <g className="hw-chip" opacity="0">
            <rect className="hw-chiprect" x="118" y="56" width="80" height="20" rx="6" fill="#fff" stroke="rgba(168,134,46,0.75)" strokeWidth="1" />
            <text className="hw-chipa" x="158" y="70" textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 500, fill: '#8c7355' }}>PR #247</text>
            <text className="hw-chipb" x="158" y="70" textAnchor="middle" opacity="0" style={{ fontSize: 9.5, fontWeight: 500, fill: T.green }}>merged ✓</text>
          </g>
        )}

        <g style={{ opacity: showPct ? 1 : 0, transition: 'opacity .6s ease' }}>
          <text x="206" y="172" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontStyle: 'italic', fill: T.green }}>+{pct.toFixed(1)}%</text>
          <text x="207" y="188" style={{ fontSize: 7.5, fill: T.light, letterSpacing: '.1em' }}>CONVERSIONS</text>
        </g>
      </svg>
    </div>
  )
}
