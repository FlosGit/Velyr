// ─── Velyr shared motion system ───────────────────────────────────────────────
// Single source of truth for UI motion across the authenticated surfaces
// (AgentDashboard, AgentPublic, AgentOnboarding). Each page concatenates
// MOTION_CSS into its own <style> block and uses the same count-up primitive, so
// motion is defined once instead of hand-rolled per component.
//
// Design rules baked in:
//  · animate entrance + numeric reveal + primary-action state changes only
//  · count-up fires ONCE on first appearance and never snaps back to 0 on a
//    background refresh (e.g. the dashboard's 30s poll) — it tweens old→new
//  · prefers-reduced-motion is respected everywhere (global guard + hook short-circuit)
import { useState, useEffect, useRef } from 'react'

// SSR-safe reduced-motion probe.
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Appended to each page's existing <style>. `v-` namespaced so it can never clash
// with a page's own keyframes/classes. The reduced-motion block is the key
// cross-surface fix — pages previously guarded only their mobile drawer.
export const MOTION_CSS = `
  @keyframes vBarGrow { from { width: 0; } to { width: var(--v-w, 100%); } }
  @keyframes vFadeUp  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  /* Bar fill-on-appear: set --v-w to the target width, add .v-bar-fill. */
  .v-bar-fill { animation: vBarGrow .8s cubic-bezier(.22,.61,.36,1) both; }
  .v-rise     { animation: vFadeUp .45s cubic-bezier(.22,.61,.36,1) both; }
  /* Sequenced entrance: parent .v-stagger, children fade-up with an index delay. */
  .v-stagger > * { animation: vFadeUp .45s cubic-bezier(.22,.61,.36,1) both; animation-delay: calc(var(--v-i, 0) * 55ms); }
  .v-stagger > *:nth-child(1){--v-i:0}.v-stagger > *:nth-child(2){--v-i:1}.v-stagger > *:nth-child(3){--v-i:2}
  .v-stagger > *:nth-child(4){--v-i:3}.v-stagger > *:nth-child(5){--v-i:4}.v-stagger > *:nth-child(6){--v-i:5}
  .v-stagger > *:nth-child(7){--v-i:6}.v-stagger > *:nth-child(8){--v-i:7}
  /* Primary-action affordance: hover lift + shadow, active press. */
  .v-press { transition: transform .15s ease, box-shadow .2s ease, background .2s ease, filter .2s ease; }
  .v-press:hover:not(:disabled) { transform: translateY(-1px); }
  .v-press:active:not(:disabled) { transform: translateY(0) scale(.985); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      animation-delay: 0ms !important;
      transition-duration: .01ms !important;
      scroll-behavior: auto !important;
    }
  }
`

// Count-up tween that:
//  · animates 0 → value the first time a real number appears (entrance)
//  · on later renders with the SAME value, does nothing (no reset)
//  · on a CHANGED value, tweens previous → new (old→new, never from 0)
//  · jumps straight to the value under reduced-motion
// Non-numeric `target` is returned unchanged (no animation).
export function useCountUp(target, { duration = 900 } = {}) {
  const numeric = typeof target === 'number' && isFinite(target) ? target : null
  const reducedInit = prefersReducedMotion()
  const [display, setDisplay] = useState(reducedInit ? (numeric ?? 0) : 0)
  const fromRef = useRef(reducedInit ? (numeric ?? 0) : 0) // value to tween FROM
  const rafRef = useRef(null)

  useEffect(() => {
    if (numeric == null) return
    if (prefersReducedMotion()) { setDisplay(numeric); fromRef.current = numeric; return }
    const from = fromRef.current
    if (from === numeric) { setDisplay(numeric); return } // unchanged → no re-animation
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setDisplay(from + (numeric - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else { fromRef.current = numeric; setDisplay(numeric) }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [numeric, duration])

  return numeric == null ? target : display
}

// <CountUp value={42} format={n => `${Math.round(n)}%`} />
// `value` must be numeric to animate; otherwise it renders as-is. `format`
// receives the live tweened number.
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), className, style }) {
  const live = useCountUp(value)
  const out = typeof value === 'number' && isFinite(value) ? format(live) : value
  return <span className={className} style={style}>{out}</span>
}
