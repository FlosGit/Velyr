// networkGlass — shared "flat-shaded node + bounded cluster region" visual
// primitives. (The filename is legacy — the locked look is flat/modern, NOT the
// old glossy glass: no specular highlight, no heavy dark rim.)
//
// Consumed by BOTH d3-force renders (SiteNetwork interactive tab + MiniNetwork
// Overview thumbnail). PRESENTATION ONLY: these helpers never touch data, layout
// (settle), or status/cluster logic — they only paint what settle() already
// produced. Stage 1 builds them; Stage 2 wires MiniNetwork, Stage 3 wires the
// interactive graph.
//
// They consume the EXACT shapes settle() emits (no new intermediate structure):
//   node        { x, y, r, cluster, status, isHub, isEntry, rank }   (+ ignores the rest)
//   clusterBlob { cluster, cx, cy, r }                               (settle.clusterBlobs[])
//   clusterLabel{ cluster, x, y }  → caller passes the resolved label text
//   edge        { kind, x1, y1, x2, y2, maxDeg }                     (settle.edges[])
//
// Locked visual (see the rework brief):
//  1. NODES — flat, clean, subtle depth. Fill = a BARELY-perceptible radial shade
//     of the SAME status/cluster colour (light stop = colour +~15%, base stop =
//     colour, radial pulled top-left). NO specular dot, NO dark rim. Thin 1px
//     low-contrast stroke (slightly darker than the fill). The "which colour
//     shows" decision is byte-for-byte the old behaviour; CLUSTER_TINT untouched.
//  2. CLUSTER REGIONS — bounded with a DEFINED edge: a soft radial fill (centre
//     ~0.20 → edge ~0.05) PLUS a thin stroke in the cluster colour (~0.5). The
//     stroke is what makes each region read as a region, not indistinct fog.
//  3. EDGES — tinted toward the TARGET cluster (caller resolves it from an id→node
//     map); hub-outgoing edges lean green (caller passes EDGE_RGB). ~1.1px, ~0.55.
//  4. CLUSTER LABELS — tinted in a darker shade of their OWN region colour
//     (clusterLabelColor), not uniform grey.
//  5. HUB (root) — the single focal point: flat green fill + a thin concentric
//     ring + the one soft green glow (the only feGaussianBlur). No glossy dot.
//  6. No animation here; any future pulse must be gated on prefers-reduced-motion.
//
// PERFORMANCE: one shared <defs> (GraphDefs) — one subtle radial fill gradient per
// status colour + per cluster tint + per cluster halo, one hero fill, ONE root
// blur filter. All gradients use objectBoundingBox units so a single def serves
// every node size. NEVER a per-node gradient/filter; no specular highlights.

import {
  FILL,
  CLUSTER_TINT,
  STATUS_LOUD,
  EDGE_RGB,
  edgeFade,
} from './SiteNetwork.jsx'

// NOTE (Stage 3): SiteNetwork will import the renderers below, creating an
// import cycle SiteNetwork ⇄ networkGlass. It is benign ONLY because nothing in
// this module reads the imported palettes at module top-level — every palette
// read happens inside a function/component body. Keep it that way.

// ─── hero / root token (rule 5) ─────────────────────────────────────────────────
// Reuse of an existing brand token: hub fill #2a5c45 (= C.accent / EDGE_RGB green).
const HERO_BASE = '#2a5c45'

// ─── cluster region palette (rule 2) ────────────────────────────────────────────
// NEW region palette: muted dusty jewel tones that harmonize with the warm
// parchment AND stay clear of the status hues (green #2f6b4f / gold #c2a45f /
// terracotta #c2573d) so a loud node never dissolves into its own region. Anchored
// on slate / dusty teal / mauve / blue-violet; the full 8-cluster set lives in the
// same cool/dusty register. Feeds ONLY the region fill+stroke (and, darkened, the
// region labels) — does NOT replace CLUSTER_TINT, which keeps node fills grey.
export const CLUSTER_HALO = {
  core:      '#8190c8', // slate (core has no blob, kept for completeness)
  marketing: '#8f8ac0', // blue-violet — away from warm gold
  auth:      '#6fa89a', // dusty teal
  product:   '#7d9ec9', // dusty sky-slate
  content:   '#a884b4', // mauve
  utility:   '#7e9ba1', // grey-teal / steel
  legal:     '#9692c2', // soft slate-violet
  other:     '#8196bb', // dusty blue
}

// ─── shared <defs> ids ──────────────────────────────────────────────────────────
// Pure string builders (no palette dependency) so node renderers and GraphDefs
// agree on ids without sharing state.
export const HERO_FILL_ID = 'vn-fill-hero'
export const ROOT_GLOW_ID = 'vn-root-glow'
export const statusFillId  = (status)  => `vn-fill-status-${status}`
export const clusterFillId = (cluster) => `vn-fill-${cluster}`
export const clusterHaloId = (cluster) => `vn-halo-${cluster}`

// ─── colour math (pure) ─────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const int = parseInt(n, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}
function mixHex(hex, withHex, t) {
  const a = hexToRgb(hex), b = hexToRgb(withHex)
  const m = i => Math.round(a[i] + (b[i] - a[i]) * t)
  return '#' + [m(0), m(1), m(2)].map(v => v.toString(16).padStart(2, '0')).join('')
}
const lighten = (hex, t) => mixHex(hex, '#ffffff', t)

// Blend the brand-green edge colour a little toward a target cluster's region hue
// (rule 3: edges "tinted toward the target cluster"). Returns an "r,g,b" string to
// drop straight into rgba(...). Caller resolves the target cluster from an id→node
// map (no change to the edge shape). Falls back to plain green for unknown clusters.
export function edgeTintRgb(cluster) {
  const halo = CLUSTER_HALO[cluster]
  if (!halo) return EDGE_RGB
  const [r, g, b]   = hexToRgb(halo)
  const [er, eg, eb] = EDGE_RGB.split(',').map(Number)
  const t = 0.35
  const m = (e, c) => Math.round(e + (c - e) * t)
  return `${m(er, r)},${m(eg, g)},${m(eb, b)}`
}

// Region label colour (rule 4): a darker, still-tinted shade of the region's own
// hue so each cluster label reads in its category colour, not uniform grey.
export function clusterLabelColor(cluster) {
  const base = CLUSTER_HALO[cluster] || CLUSTER_TINT[cluster] || '#5b5b5b'
  return mixHex(base, '#1a1916', 0.5)
}

// ─── shared defs block ──────────────────────────────────────────────────────────

function FillGradient({ id, base }) {
  // Flat/clean node fill: a radial shade of the SAME colour, focal point pulled
  // top-left, light stop only ~15% over base → a BARELY-perceptible hint of depth
  // (no specular, no dark rim, no bright dot). One objectBoundingBox def serves
  // any node radius.
  return (
    <radialGradient id={id} cx="0.38" cy="0.32" r="0.75">
      <stop offset="0%"   stopColor={lighten(base, 0.15)} />
      <stop offset="100%" stopColor={base} />
    </radialGradient>
  )
}

function HaloGradient({ id, tint }) {
  // Bounded region FILL (rule 2): a calm radial wash from a low centre alpha to a
  // small-but-nonzero edge alpha. The defined boundary comes from ClusterHalo's
  // STROKE, not from this fading to zero — so the fill can stay soft and the
  // region still reads as a region. This is the shared baseline; each surface
  // attenuates DOWN via ClusterHalo's fillOpacity prop (an opacity can't exceed
  // it, so it's the ceiling).
  return (
    <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stopColor={tint} stopOpacity="0.20" />
      <stop offset="100%" stopColor={tint} stopOpacity="0.05" />
    </radialGradient>
  )
}

// All shared gradients + the single root blur filter. Render ONCE per <svg>.
export function GraphDefs() {
  const loudStatuses = Object.keys(FILL).filter(s => STATUS_LOUD.has(s))
  const clusters     = Object.keys(CLUSTER_TINT)
  return (
    <defs>
      {/* hero (root) fill */}
      <FillGradient id={HERO_FILL_ID} base={HERO_BASE} />

      {/* one subtle fill gradient per loud status (base = FILL) */}
      {loudStatuses.map(s => (
        <FillGradient key={s} id={statusFillId(s)} base={FILL[s]} />
      ))}

      {/* one subtle fill gradient per cluster tint (grey base for PROMINENT
          neutral/tracked nodes; quiet leaves use a flat literal fill) */}
      {clusters.map(c => (
        <FillGradient key={c} id={clusterFillId(c)} base={CLUSTER_TINT[c]} />
      ))}

      {/* one soft region fill gradient per cluster (tint wash, centre → edge) */}
      {clusters.map(c => (
        <HaloGradient key={c} id={clusterHaloId(c)} tint={CLUSTER_HALO[c] || CLUSTER_TINT[c]} />
      ))}

      {/* the ONLY blur filter — root glow (rule 5) */}
      <filter id={ROOT_GLOW_ID} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5.5" />
      </filter>
    </defs>
  )
}

// ─── node ─────────────────────────────────────────────────────────────────────

// Clean, flat node: a filled circle in its status/cluster colour with a thin,
// low-contrast stroke. Prominent nodes (hub, status-loud, entry, ranked) get the
// VERY subtle top-left fill gradient for a hint of depth; quiet leaves get a flat
// literal fill and recede at 0.65 opacity. NO specular, NO dark rim. The "which
// colour shows" decision is byte-for-byte the old behaviour. The hub is the single
// focal point: flat green disc + a thin concentric ring + the one soft glow.
export function GlassNode({ node }) {
  const isHub   = !!node.isHub
  const loud    = STATUS_LOUD.has(node.status)
  const prominent = isHub || loud || node.isEntry || node.rank != null  // ⇔ fillOpacity 1

  // Base colour — unchanged status/cluster decision.
  const base = isHub ? HERO_BASE
             : loud  ? FILL[node.status]
             : (CLUSTER_TINT[node.cluster] || FILL[node.status] || FILL.neutral)
  // Thin, low-contrast edge: a slightly darker shade of the fill (modern, calm).
  const stroke = mixHex(base, '#1a1916', 0.16)

  if (isHub) {
    return (
      <>
        {/* the one soft glow — marks the single focal point (rule 5) */}
        <circle cx={node.x} cy={node.y} r={node.r * 1.7}
          fill={HERO_BASE} opacity={0.4} filter={`url(#${ROOT_GLOW_ID})`} />
        {/* flat-shaded green disc */}
        <circle cx={node.x} cy={node.y} r={node.r}
          fill={`url(#${HERO_FILL_ID})`} stroke={stroke} strokeWidth={1} />
        {/* thin concentric accent ring */}
        <circle cx={node.x} cy={node.y} r={node.r + 2.5}
          fill="none" stroke={HERO_BASE} strokeOpacity={0.6} strokeWidth={1} />
      </>
    )
  }

  // Prominent → subtle top-left gradient; quiet → flat literal fill at 0.65.
  const fillId = loud ? statusFillId(node.status)
               : CLUSTER_TINT[node.cluster] ? clusterFillId(node.cluster) : null
  const fill = prominent && fillId ? `url(#${fillId})` : base
  const sw = node.isEntry ? 1.5 : 1
  const fillOpacity = prominent ? 1 : 0.65

  return (
    <circle cx={node.x} cy={node.y} r={node.r}
      fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={sw} />
  )
}

// ─── cluster region + label ───────────────────────────────────────────────────
// Region and label are SEPARATE renderers consuming settle's two distinct arrays
// (clusterBlobs centred on the cluster; clusterLabels pushed radially outward).
// One combined renderer would have to invent a paired structure and would lose
// settle's label placement — so they stay split.

// Bounded region (rule 2): the radial fill wash + a thin defined stroke in the
// cluster colour. fillOpacity / strokeOpacity / strokeWidth are per-surface knobs
// (the small white mini damps them more than the big parchment canvas) — the
// defaults are the interactive-canvas baseline.
export function ClusterHalo({ blob, fillOpacity = 1, strokeOpacity = 0.5, strokeWidth = 1.2 }) {
  const ring = CLUSTER_HALO[blob.cluster] || CLUSTER_TINT[blob.cluster] || '#9a958e'
  return (
    <circle cx={blob.cx} cy={blob.cy} r={blob.r}
      fill={`url(#${clusterHaloId(blob.cluster)})`} fillOpacity={fillOpacity}
      stroke={ring} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} />
  )
}

export function ClusterLabel({
  label, x, y,
  font = 'sans-serif',
  fontSize = 9,
  fill = 'rgba(42,92,69,0.6)',
  strokeWidth = 2.6,
}) {
  return (
    <text
      x={x} y={y} textAnchor="middle"
      style={{
        fontSize, fill,
        stroke: 'rgba(247,244,239,0.85)', strokeWidth, paintOrder: 'stroke fill',
        fontFamily: font, fontWeight: 500, letterSpacing: '0.14em',
        userSelect: 'none', pointerEvents: 'none',
      }}
    >
      {label}
    </text>
  )
}

// ─── soft curved edge ───────────────────────────────────────────────────────────
// Same geometry as the existing edge render (so it's a drop-in); optional `tint`
// ("r,g,b") leans the colour toward the target cluster — pass edgeTintRgb(target),
// or EDGE_RGB for hub-outgoing edges (rule 3). ~1.1px, ~0.55 opacity; the opacity
// still fades with endpoint degree so busy fans recede (edgeFade ≤ 1, so 0.55 is
// the ceiling).
export function CurvedEdge({ edge, tint }) {
  const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1
  const len = Math.hypot(dx, dy) || 1
  const off = len * 0.12
  const mx = (edge.x1 + edge.x2) / 2 + (-dy / len) * off
  const my = (edge.y1 + edge.y2) / 2 + ( dx / len) * off
  const opacity = 0.55 * edgeFade(edge.maxDeg)
  return (
    <path
      d={`M${edge.x1.toFixed(1)} ${edge.y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${edge.x2.toFixed(1)} ${edge.y2.toFixed(1)}`}
      fill="none"
      stroke={`rgba(${tint || EDGE_RGB},${opacity.toFixed(3)})`}
      strokeWidth={1.1}
    />
  )
}
