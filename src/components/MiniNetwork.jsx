// MiniNetwork — a small, non-interactive preview of the SiteNetwork graph.
//
// Reuses the exact d3-force layout from SiteNetwork (`settle`), run ONCE to
// convergence and then frozen — no live ticking, no drag, no zoom, no hover,
// no tooltip, no click. Renders a static SVG scaled to CONTAIN its fixed-size
// box (preserveAspectRatio="…meet"): the settled bbox is landscape (~1.6:1), so
// on a wide card meet leaves modest parchment side-margins — accepted on purpose
// so the WHOLE graph stays visible (slice cropped peripheral nodes, making the
// site look like it had fewer pages than it does). Pointer events are off — the
// parent card owns the click-through to the full Network page.
//
// A capped, counter-scaled set of labels (hub + the most prominent few; see
// MINI_MAX_LABELS) is drawn so the thumbnail reads as a real map, not bare dots.
//
// Visuals come from the shared networkGlass primitives (glass-sphere nodes, hero
// glow on the root, soft cluster halos, cluster-tinted curved edges). Because the
// card is small and on a PURE WHITE bg, halos are damped/tightened locally (see
// MINI_HALO_*) and label outlines are white (not parchment) so they stay legible.
//
// Props:
//   data:   SiteNetworkData (from buildNetworkData) — same shape SiteNetwork takes
//   style?: CSSProperties applied to the outer SVG (set height here)
//   fonts?: { sans? } — label font; defaults to DM Sans (dashboard context)

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  settle,
  hubLabelLines,
  STATUS_LOUD,
} from './SiteNetwork.jsx'
import {
  GraphDefs,
  GlassNode,
  ClusterHalo,
  CurvedEdge,
  edgeTintRgb,
} from './networkGlass.jsx'

// Max labels in the compact preview (the mini has no hover/zoom/collision pass, so
// labels can't reflow out of each other's way). The hub is ALWAYS labeled; among
// entry/status-loud candidates we keep at most this many, ranked by prominence
// (status-loud → rank → edge-degree → radius). A Shopify theme preview makes one
// entry per directory (~5–15 isEntry nodes) — our primary market — so an uncapped
// mini would pile labels on top of each other. When candidates exceed the cap we
// render hub + the top-N, never all of them. Tuned to stay legible at ~320×172px.
const MINI_MAX_LABELS = 5

// Halo tuning for the compact Overview card. The card is ~150px tall on a PURE
// WHITE bgCard (not the parchment the big canvas uses), so the shared halo
// gradient would flood this small box. Dampen locally: a group-opacity multiplier
// + a radius shrink keep halos as discrete soft pools so the thumbnail stays airy.
// Deliberately NOT the values the interactive graph will use.
const MINI_HALO_OPACITY = 0.5
const MINI_HALO_RADIUS_SCALE = 0.74

export default function MiniNetwork({ data, style, fonts = {} }) {
  const fSans = fonts.sans ?? "'DM Sans', sans-serif"

  // Measure the rendered box so label geometry can be counter-scaled to a constant
  // SCREEN size: meet scales the settled viewBox to fit, and that scale varies with
  // each customer's graph size, so a fixed unit font would render big on small
  // graphs and tiny on large ones. Measuring keeps text px-stable at any graph size.
  const svgRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // settle() is deterministic (golden-angle seeding, no Math.random) and cheap
  // for the ~20–50 nodes a site graph has, so run it synchronously here and
  // memoize on data — same arrangement as the full graph, computed once.
  const layout = useMemo(() => (data ? settle(data.nodes, data.edges) : null), [data])

  // Per-node edge degree — the prominence signal for the label cap. Preview nodes
  // have no rank/size, but a directory representative's degree = how many files
  // hang off it, so high-degree reps are the meaningful surfaces to name.
  const degree = useMemo(() => {
    const d = {}
    for (const e of (data?.edges || [])) { d[e.source] = (d[e.source] || 0) + 1; d[e.target] = (d[e.target] || 0) + 1 }
    return d
  }, [data])

  // Capped label set: hub is rendered separately (always); here we pick the most
  // prominent entry/status-loud nodes, up to MINI_MAX_LABELS.
  const labeledIds = useMemo(() => {
    if (!layout) return new Set()
    const cands = layout.nodes.filter(n => !n.isHub && (n.isEntry || STATUS_LOUD.has(n.status)))
    cands.sort((a, b) => {
      const al = STATUS_LOUD.has(a.status) ? 0 : 1, bl = STATUS_LOUD.has(b.status) ? 0 : 1
      if (al !== bl) return al - bl                       // status-loud first
      const ar = a.rank ?? Infinity, br = b.rank ?? Infinity
      if (ar !== br) return ar - br                       // then best rank (real runs)
      const ad = degree[a.id] || 0, bd = degree[b.id] || 0
      if (ad !== bd) return bd - ad                       // then busiest (preview signal)
      if (b.r !== a.r) return b.r - a.r                   // then biggest radius
      return String(a.id).localeCompare(String(b.id))     // deterministic tiebreak
    })
    return new Set(cands.slice(0, MINI_MAX_LABELS).map(n => n.id))
  }, [layout, degree])

  if (!layout) return null

  // id-less edge → target-cluster lookup by exact settled position (edge.x2/y2
  // equal the target node's x/y). Lets edges tint toward their target cluster
  // without changing settle's edge shape.
  const clusterAt = new Map()
  for (const n of layout.nodes) clusterAt.set(n.x + ',' + n.y, n.cluster)

  const { x0, y0, x1, y1 } = layout.bbox
  const vbW = x1 - x0, rawH = y1 - y0
  // Extra bottom room for the hub's below-circle label: it's up to 2 lines and
  // counter-scaled to constant screen px, so on a graph where the hub is the
  // lowest element it can exceed settle's fixed ~36-unit bottom reserve and kiss
  // the edge. Top up the viewBox bottom by the shortfall (~28px of label below the
  // hub minus the 36u reserve) plus ~12px breathing room — sized in units from a
  // pre-scale so it tracks the label's on-screen height across graph sizes.
  const preScale  = (box.w > 0 && box.h > 0) ? Math.min(box.w / vbW, box.h / rawH) : 0
  const padBottom = preScale > 0 ? Math.max(0, 28 / preScale - 36) + 12 / preScale : rawH * 0.08
  const vbH = rawH + padBottom
  const viewBox = `${x0.toFixed(1)} ${y0.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`

  // meet scale = px per viewBox unit (min of the two axes). Convert a target SCREEN
  // px to viewBox units via px / scale. Pre-measure (scale 0) we fall back to the
  // raw px as units for one frame, then the ResizeObserver corrects it.
  const scale    = (box.w > 0 && box.h > 0) ? Math.min(box.w / vbW, box.h / vbH) : 0
  const u        = (px) => (scale > 0 ? px / scale : px)
  const nodeFont = u(11)     // ~11px node labels
  const hubFont  = u(10.5)   // ~10.5px hub label
  const labelHalo = u(3)     // light outline — whiter + wider for the pure-white card
  const gap      = u(5)      // node edge → label gap
  const lineH    = u(11)     // hub second-line spacing

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ display: 'block', background: '#f7f4ef', pointerEvents: 'none', ...style }}
    >
      {/* Shared glass/halo defs — gradients + the single root blur filter. */}
      <GraphDefs />

      {/* Soft cluster halos — radialGradient pools (tint → transparent), damped
          + tightened (see MINI_HALO_*) so they hint category on the small white
          card without flooding it. Computed once from the settled blob geometry. */}
      <g opacity={MINI_HALO_OPACITY}>
        {layout.clusterBlobs.map(bl => (
          <ClusterHalo key={bl.cluster}
            blob={{ ...bl, r: bl.r * MINI_HALO_RADIUS_SCALE }} />
        ))}
      </g>

      {/* Edges — soft curved arcs, tinted toward the target cluster. */}
      <g>
        {layout.edges.map(e => {
          const tc = clusterAt.get(e.x2 + ',' + e.y2)
          return (
            <CurvedEdge key={e.key} edge={e} tint={tc ? edgeTintRgb(tc) : undefined} />
          )
        })}
      </g>

      {/* Nodes — glass spheres: hero glow on the root, specular on prominent
          nodes, tint-gradient (no highlight) on quiet leaves. (Labels below.) */}
      <g>
        {layout.nodes.map(node => (
          <GlassNode key={node.id} node={node} />
        ))}
      </g>

      {/* Labels — sparse on purpose (no hover/zoom/collision pass in the mini):
          hub domain + the MINI_MAX_LABELS most prominent entry/status-loud nodes.
          Counter-scaled to ~constant screen px (text would otherwise shrink with
          the graph). Hub label sits BELOW its circle — at this size, text inside a
          ~7px-radius hub disc would be illegible. A white stroke halo keeps it
          readable over edges, halos + glass nodes on the pure-white card. */}
      <g>
        {layout.nodes.map(node => {
          if (node.isHub) {
            const [dl1, dl2] = hubLabelLines(data.meta.domain)
            const y = node.y + node.r + gap + hubFont * 0.85
            return (
              <text key={node.id}
                x={node.x} y={y} textAnchor="middle"
                style={{
                  fontSize: hubFont, fill: '#1c1917',
                  stroke: 'rgba(255,255,255,0.95)', strokeWidth: labelHalo, paintOrder: 'stroke fill',
                  fontFamily: fSans, fontWeight: 600,
                  pointerEvents: 'none', userSelect: 'none',
                }}
              >
                <tspan x={node.x}>{dl1}</tspan>
                {dl2 ? <tspan x={node.x} dy={lineH}>{dl2}</tspan> : null}
              </text>
            )
          }
          if (!labeledIds.has(node.id)) return null
          return (
            <text key={node.id}
              x={node.x} y={node.y + node.r + gap + nodeFont * 0.85} textAnchor="middle"
              style={{
                fontSize: nodeFont, fill: '#1c1917',
                stroke: 'rgba(255,255,255,0.95)', strokeWidth: labelHalo, paintOrder: 'stroke fill',
                fontFamily: fSans, fontWeight: STATUS_LOUD.has(node.status) ? 600 : 400,
                pointerEvents: 'none', userSelect: 'none',
              }}
            >
              {node.label}
            </text>
          )
        })}
      </g>
    </svg>
  )
}
