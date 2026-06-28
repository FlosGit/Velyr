// MiniNetwork — a small, non-interactive preview of the SiteNetwork graph.
//
// Reuses the exact d3-force layout from SiteNetwork (`settle`), run ONCE to
// convergence and then frozen — no live ticking, no drag, no zoom, no hover,
// no tooltip, no click. Renders a static SVG scaled to COVER its fixed-size
// box (preserveAspectRatio="…slice"): the settled bbox is landscape (~1.7:1),
// so a compact full-width band would otherwise pillarbox; slice fills the card
// edge-to-edge with a mild centre crop (the hub sits at the centroid, so the
// focal point always survives). Pointer events are off — the parent card owns
// the click-through to the full Network page.
//
// Props:
//   data:   SiteNetworkData (from buildNetworkData) — same shape SiteNetwork takes
//   style?: CSSProperties applied to the outer SVG (set height here)

import { useMemo } from 'react'
import {
  settle,
  FILL,
  RING,
  CLUSTER_TINT,
  CLUSTER_RING,
  STATUS_LOUD,
  EDGE_RGB,
  EDGE_BASE_OPACITY,
  edgeFade,
} from './SiteNetwork.jsx'

export default function MiniNetwork({ data, style }) {
  // settle() is deterministic (golden-angle seeding, no Math.random) and cheap
  // for the ~20–50 nodes a site graph has, so run it synchronously here and
  // memoize on data — same arrangement as the full graph, computed once.
  const layout = useMemo(() => (data ? settle(data.nodes, data.edges) : null), [data])
  if (!layout) return null

  const { x0, y0, x1, y1 } = layout.bbox
  const viewBox = `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`

  return (
    <svg
      viewBox={viewBox}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ display: 'block', background: '#f7f4ef', pointerEvents: 'none', ...style }}
    >
      {/* Soft cluster region blobs — a whisper of category structure. */}
      <g>
        {layout.clusterBlobs.map(bl => (
          <circle key={bl.cluster}
            cx={bl.cx} cy={bl.cy} r={bl.r}
            fill={CLUSTER_TINT[bl.cluster] || '#9a958e'}
            fillOpacity={0.06}
          />
        ))}
      </g>

      {/* Edges — faint curved arcs; opacity fades with endpoint degree. */}
      <g fill="none">
        {layout.edges.map(e => {
          const dx = e.x2 - e.x1, dy = e.y2 - e.y1
          const len = Math.hypot(dx, dy) || 1
          const off = len * 0.12
          const mx = (e.x1 + e.x2) / 2 + (-dy / len) * off
          const my = (e.y1 + e.y2) / 2 + ( dx / len) * off
          const opacity = (EDGE_BASE_OPACITY[e.kind] ?? 0.1) * edgeFade(e.maxDeg)
          return (
            <path key={e.key}
              d={`M${e.x1.toFixed(1)} ${e.y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`}
              stroke={`rgba(${EDGE_RGB},${opacity.toFixed(3)})`}
              strokeWidth={e.kind === 'import' ? 0.8 : 0.55}
            />
          )
        })}
      </g>

      {/* Nodes — status colour dominates, else cluster tint. No labels. */}
      <g>
        {layout.nodes.map(node => {
          const statusLoud = STATUS_LOUD.has(node.status)
          const fill = node.isHub ? '#2a5c45'
                     : statusLoud ? FILL[node.status]
                     : (CLUSTER_TINT[node.cluster] || FILL[node.status])
          const stroke = node.isHub ? 'none'
                       : statusLoud ? RING[node.status]
                       : (CLUSTER_RING[node.cluster] || RING[node.status])
          const sw = node.isEntry && !node.isHub ? 2.0 : 1.5
          const fillOpacity = (node.isHub || node.isEntry || node.rank != null || statusLoud) ? 1 : 0.65
          return (
            <circle key={node.id}
              cx={node.x} cy={node.y} r={node.r}
              fill={fill} fillOpacity={fillOpacity}
              stroke={stroke} strokeWidth={sw}
            />
          )
        })}
      </g>
    </svg>
  )
}
