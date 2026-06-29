// networkGlass — shared "glass sphere + soft cluster halo" visual primitives.
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
// Design rules honoured here (see the rework brief):
//  1. Node FILL still encodes status exactly as the existing render decides it —
//     glass is layered on top, never changes which colour a node shows.
//  2. Cluster identity = a tinted soft halo (+ label), never the node fill. The
//     halo palette (CLUSTER_HALO) is a SEPARATE derived set — node fills stay grey.
//  3. Only the root (hub) gets a real glow (feGaussianBlur) + hero-green glass.
//  4. Labels get a faint light stroke backdrop (paint-order: stroke) for legibility.
//  6. No animation here; any future pulse must be gated on prefers-reduced-motion.
//
// PERFORMANCE: one shared <defs> (GraphDefs) — one radial gradient per status
// colour + per cluster tint + per cluster halo, one shared specular, one hero
// gradient, ONE root blur filter. All gradients use objectBoundingBox units so a
// single def serves every node size. NEVER a per-node gradient/filter.

import {
  FILL,
  RING,
  CLUSTER_TINT,
  CLUSTER_RING,
  STATUS_LOUD,
  EDGE_RGB,
  EDGE_BASE_OPACITY,
  edgeFade,
} from './SiteNetwork.jsx'

// NOTE (Stage 3): SiteNetwork will import the renderers below, creating an
// import cycle SiteNetwork ⇄ networkGlass. It is benign ONLY because nothing in
// this module reads the imported palettes at module top-level — every palette
// read happens inside a function/component body. Keep it that way.

// ─── hero / root tokens (rule 3) ────────────────────────────────────────────────
// Reuse of existing brand tokens: hub fill #2a5c45 (= C.accent / EDGE_RGB green),
// rim #1e4433 (= C.accentDark). No new brand colour invented.
const HERO_BASE = '#2a5c45'
const HERO_RIM  = '#1e4433'

// ─── cluster halo palette (rule 2) ──────────────────────────────────────────────
// DERIVED, halo-only. Deliberately cooler / more pastel than the warm parchment
// and offset from the status hues (green #2f6b4f / gold #c2a45f / terracotta
// #c2573d) so a loud node never dissolves into its own halo. Does NOT replace
// CLUSTER_TINT — node fills keep using the grey CLUSTER_TINT unchanged; these feed
// ONLY the halo gradients.
export const CLUSTER_HALO = {
  core:      '#c4c8c6', // (core has no blob, kept for completeness)
  marketing: '#b9c2e0', // cool periwinkle — away from warm gold
  auth:      '#aecfd0', // pale teal
  product:   '#b3c6dd', // soft blue
  content:   '#c8bdda', // pale lavender
  utility:   '#bcc3cb', // cool grey-blue
  legal:     '#c2c4cf', // pale slate
  other:     '#c0c8cf', // muted blue-grey
}

// ─── shared <defs> ids ──────────────────────────────────────────────────────────
// Pure string builders (no palette dependency) so node renderers and GraphDefs
// agree on ids without sharing state.
export const HERO_GLASS_ID = 'vn-glass-hero'
export const SPECULAR_ID   = 'vn-specular'
export const ROOT_GLOW_ID  = 'vn-root-glow'
export const statusGlassId = (status)  => `vn-glass-${status}`
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

// Blend the brand-green edge colour a little toward a target cluster's halo hue
// (rule: edges "tinted toward the target cluster"). Returns an "r,g,b" string to
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

// ─── shared defs block ──────────────────────────────────────────────────────────

function GlassGradient({ id, base, rim }) {
  // objectBoundingBox radial, focal point pulled top-left for a lit-sphere look:
  // lightened top → base → darker rim. One def serves any node radius.
  return (
    <radialGradient id={id} cx="0.5" cy="0.5" r="0.7" fx="0.34" fy="0.30">
      <stop offset="0%"   stopColor={lighten(base, 0.5)} />
      <stop offset="45%"  stopColor={base} />
      <stop offset="100%" stopColor={rim} />
    </radialGradient>
  )
}

function HaloGradient({ id, tint }) {
  return (
    <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%"   stopColor={tint} stopOpacity="0.22" />
      <stop offset="55%"  stopColor={tint} stopOpacity="0.08" />
      <stop offset="100%" stopColor={tint} stopOpacity="0" />
    </radialGradient>
  )
}

// All shared gradients + the single root blur filter. Render ONCE per <svg>.
export function GraphDefs() {
  const loudStatuses = Object.keys(FILL).filter(s => STATUS_LOUD.has(s))
  const clusters     = Object.keys(CLUSTER_TINT)
  return (
    <defs>
      {/* glossy white specular dot (objectBoundingBox → scales per highlight) */}
      <radialGradient id={SPECULAR_ID} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.6" />
        <stop offset="70%"  stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>

      {/* hero (root) glass */}
      <GlassGradient id={HERO_GLASS_ID} base={HERO_BASE} rim={HERO_RIM} />

      {/* one glass gradient per loud status (base = FILL, rim = RING) */}
      {loudStatuses.map(s => (
        <GlassGradient key={s} id={statusGlassId(s)} base={FILL[s]} rim={RING[s]} />
      ))}

      {/* one glass gradient per cluster tint (grey base for quiet/neutral nodes) */}
      {clusters.map(c => (
        <GlassGradient key={c} id={clusterFillId(c)} base={CLUSTER_TINT[c]} rim={CLUSTER_RING[c] || RING.neutral} />
      ))}

      {/* one soft halo gradient per cluster (tint → transparent) */}
      {clusters.map(c => (
        <HaloGradient key={c} id={clusterHaloId(c)} tint={CLUSTER_HALO[c] || CLUSTER_TINT[c]} />
      ))}

      {/* the ONLY blur filter — root glow (rule 3) */}
      <filter id={ROOT_GLOW_ID} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5.5" />
      </filter>
    </defs>
  )
}

// ─── glass-sphere node ──────────────────────────────────────────────────────────

// "Prominent" nodes (hub, status-loud, entry points, ranked) get the full glass
// sphere + specular highlight; quiet leaves get the same radial-gradient tint but
// NO highlight (subtle shading, not a matte dot) and recede at 0.65 opacity —
// matching the existing fillOpacity rule exactly so this is a drop-in for the
// inline <circle>. Renders the sphere visual only; the caller keeps its own hover
// ring / hit-area / hub text wrapper.
export function GlassNode({ node }) {
  const isHub   = !!node.isHub
  const loud    = STATUS_LOUD.has(node.status)
  const prominent = isHub || loud || node.isEntry || node.rank != null  // ⇔ fillOpacity 1

  const fill = isHub                       ? `url(#${HERO_GLASS_ID})`
             : loud                        ? `url(#${statusGlassId(node.status)})`
             : CLUSTER_TINT[node.cluster]  ? `url(#${clusterFillId(node.cluster)})`
             : (FILL[node.status] || FILL.neutral)               // literal fallback
  const stroke = isHub ? 'none'
               : loud  ? RING[node.status]
               : (CLUSTER_RING[node.cluster] || RING[node.status])
  const sw = node.isEntry && !isHub ? 2.0 : 1.5
  const fillOpacity = prominent ? 1 : 0.65

  return (
    <>
      {isHub && (
        <circle cx={node.x} cy={node.y} r={node.r * 1.7}
          fill={HERO_BASE} opacity={0.45} filter={`url(#${ROOT_GLOW_ID})`} />
      )}
      <circle cx={node.x} cy={node.y} r={node.r}
        fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={sw} />
      {prominent && (
        <circle
          cx={node.x - node.r * 0.32}
          cy={node.y - node.r * 0.36}
          r={node.r * 0.55}
          fill={`url(#${SPECULAR_ID})`}
        />
      )}
    </>
  )
}

// ─── cluster halo + label ───────────────────────────────────────────────────────
// Halo and label are SEPARATE renderers consuming settle's two distinct arrays
// (clusterBlobs centred on the cluster; clusterLabels pushed radially outward).
// One combined renderer would have to invent a paired structure and would lose
// settle's label placement — so they stay split (constraint 1).

export function ClusterHalo({ blob }) {
  return (
    <circle cx={blob.cx} cy={blob.cy} r={blob.r}
      fill={`url(#${clusterHaloId(blob.cluster)})`} />
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
// Same geometry/opacity as the existing edge render (so it's a drop-in); optional
// `tint` ("r,g,b") leans the colour toward the target cluster — pass
// edgeTintRgb(targetCluster); defaults to the brand-green EDGE_RGB.
export function CurvedEdge({ edge, tint }) {
  const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1
  const len = Math.hypot(dx, dy) || 1
  const off = len * 0.12
  const mx = (edge.x1 + edge.x2) / 2 + (-dy / len) * off
  const my = (edge.y1 + edge.y2) / 2 + ( dx / len) * off
  const opacity = (EDGE_BASE_OPACITY[edge.kind] ?? 0.1) * edgeFade(edge.maxDeg)
  return (
    <path
      d={`M${edge.x1.toFixed(1)} ${edge.y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${edge.x2.toFixed(1)} ${edge.y2.toFixed(1)}`}
      fill="none"
      stroke={`rgba(${tint || EDGE_RGB},${opacity.toFixed(3)})`}
      strokeWidth={edge.kind === 'import' ? 0.8 : 0.55}
    />
  )
}
