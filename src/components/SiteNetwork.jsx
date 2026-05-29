// SiteNetwork — radial graph of a customer's site.
// Pure presentational: no data fetching. Accepts SiteNetworkData via props.
//
// Props:
//   data:          SiteNetworkData (see src/data/mockSiteNetwork.js for shape)
//   onNodeClick?:  (node) => void  — click-through stub; wired to detail panel in Stage 4+
//   style?:        CSSProperties   — applied to the outer container (set height here)
//   fonts?:        { sans?, serif?, mono? }
//                  Defaults to Jost/Cormorant Garant/DM Mono (onboarding context).
//                  Pass DM Sans/Instrument Serif/DM Mono for dashboard context.
//
// Layout: d3-force simulation run synchronously to convergence.
// Stage 3 will add a `live` prop for the onboarding build animation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'

// ─── simulation constants ─────────────────────────────────────────────────────

// Cluster anchor positions that shape the radial arrangement. The render no
// longer uses a fixed viewBox — settle() fits the viewBox to the settled node
// bbox — so these only steer relative cluster placement, not absolute framing.
const CLUSTER_POS = {
  core:      { x:    0, y:  -70 },
  marketing: { x:  340, y: -110 },
  auth:      { x:  360, y:   60 },
  product:   { x:  150, y:  175 },
  content:   { x: -320, y:  130 },
  utility:   { x: -370, y:  -10 },
  legal:     { x: -130, y:  195 },
  other:     { x:  230, y: -190 },
}

const CLUSTER_NAME = {
  core: 'Core', marketing: 'Marketing', auth: 'Auth',
  product: 'Product', content: 'Content', utility: 'Utilities',
  legal: 'Legal', other: 'Other',
}

// ─── visual tokens ────────────────────────────────────────────────────────────

const FILL = {
  neutral:         '#a8a39a',
  tracked:         '#ccc8c3',
  'fix-in-flight': '#c2a45f',
  optimized:       '#2f6b4f',
  problem:         '#c2573d',
}

const RING = {
  neutral:         '#8a857e',
  tracked:         '#b0aaa4',
  'fix-in-flight': '#a8862e',
  optimized:       '#1a4a2f',
  problem:         '#8a2820',
}

const STATUS_COPY = {
  neutral:         'Watching',
  tracked:         'Tracked',
  'fix-in-flight': 'Fix in progress',
  optimized:       'Optimized',
  problem:         'Regression',
}

// Per-cluster low-saturation tints — a whisper of category. Used as the fill for
// non-status (neutral/tracked) nodes and, at very low alpha, as the soft region
// blob behind each cluster. Status colours (gold/green/terracotta) override the
// node fill so they always shout over the tint.
// Low-saturation (near-grey, hint of hue) so a solid tinted node never reads as
// a saturated status colour. Deliberately kept clear of gold #c2a45f, green
// #2f6b4f, terracotta #c2573d so status always stays the loudest thing.
const CLUSTER_TINT = {
  core:      '#838c86',
  marketing: '#979084',
  auth:      '#878d94',
  product:   '#838d87',
  content:   '#8f8a91',
  utility:   '#8d8983',
  legal:     '#8b8983',
  other:     '#8d8983',
}
const CLUSTER_RING = {
  core:      '#646c67',
  marketing: '#737065',
  auth:      '#686e74',
  product:   '#656e68',
  content:   '#6f6a71',
  utility:   '#6c6963',
  legal:     '#6b6963',
  other:     '#6c6963',
}
const STATUS_LOUD = new Set(['fix-in-flight', 'optimized', 'problem'])

const EDGE_RGB = '42,92,69'
// Base stroke opacity per edge kind, before the degree-fade multiplier. Kept
// low so edges whisper; high-degree fans fade further (see edgeFade()).
const EDGE_BASE_OPACITY = { import: 0.16, structural: 0.09 }

// Continuous degree fade — NOT a fitted threshold. Edges touching a busy node
// (App, a shared util, etc.) recede smoothly; low-degree links stay legible.
// exp decay on the busier endpoint's degree, floored so nothing fully vanishes.
function edgeFade(maxDeg) {
  return Math.max(0.22, Math.exp(-(maxDeg - 1) / 6))
}


// ─── layout helpers ───────────────────────────────────────────────────────────

function calcR(node) {
  if (node.isHub)     return 24
  if (node.isGrouped) return 11 + Math.min(6, Math.sqrt(node.groupCount || 0))
  // Rank drives radius with real contrast: top ranks clearly large, tail small.
  // r1 ≈ 16 → r10 ≈ 9; unranked leaves 5 (entry-but-unranked floored at 9).
  let r
  if (node.rank != null) r = 17 - Math.min(node.rank, 12) * 0.8
  else                   r = node.isEntry ? 9 : 5
  if (node.dropOffScore != null) r += node.dropOffScore * 3   // funnel signal, when present
  return Math.max(5, Math.min(Math.round(r), 24))
}

// Which nodes get an always-on SVG label: hub, entry points, grouped nodes,
// every status-coloured node (gold/green/regression — always named), and the
// top ~9 by rank. The rest reveal their label on hover. Overlap among the
// always-on labels is resolved by collision avoidance at render time.
const MAX_RANK_LABELS = 9
function computeLabeledIds(nodes) {
  const ids = new Set()
  for (const n of nodes) {
    if (n.isHub || n.isEntry || n.isGrouped || STATUS_LOUD.has(n.status)) ids.add(n.id)
  }
  nodes
    .filter(n => n.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_RANK_LABELS)
    .forEach(n => ids.add(n.id))
  return ids
}

// Two-line hub label. Dotted domains split body / .tld; dotless deploy slugs
// (test-iota-drab-18) wrap at the hyphen nearest the middle. Lines too long to
// fit the hub circle ellipsize cleanly — never a hard mid-word cut.
function hubLabelLines(domain) {
  const cap = s => (s.length > 12 ? s.slice(0, 11) + '…' : s)
  if (domain.includes('.')) {
    const dot = domain.lastIndexOf('.')
    return [cap(domain.slice(0, dot)), domain.slice(dot)]
  }
  const parts = domain.split('-')
  if (parts.length >= 2) {
    let best = 1, bestDiff = Infinity
    for (let i = 1; i < parts.length; i++) {
      const diff = Math.abs(parts.slice(0, i).join('-').length - parts.slice(i).join('-').length)
      if (diff < bestDiff) { bestDiff = diff; best = i }
    }
    return [cap(parts.slice(0, best).join('-')), cap(parts.slice(best).join('-'))]
  }
  return [cap(domain), '']
}

// Run D3 force simulation to convergence; returns flat renderable snapshot.
function settle(rawNodes, rawEdges) {
  const clusterCount = {}
  rawNodes.forEach(n => { clusterCount[n.cluster] = (clusterCount[n.cluster] || 0) + 1 })

  const simNodes = rawNodes.map((n, i) => {
    const cp = CLUSTER_POS[n.cluster] ?? { x: 0, y: 0 }
    const a  = i * 2.399  // golden-angle: deterministic, no Math.random
    return {
      ...n,
      x:  n.isHub ? 0 : cp.x + Math.cos(a) * 8,
      y:  n.isHub ? 0 : cp.y + Math.sin(a) * 8,
      fx: n.isHub ? 0 : null,
      fy: n.isHub ? 0 : null,
      r:  calcR(n),
    }
  })

  const validIds = new Set(simNodes.map(n => n.id))
  const simEdges = rawEdges
    .filter(e => validIds.has(e.source) && validIds.has(e.target))
    .map(e => ({ ...e }))

  // Node degree (for the continuous edge fade — busy nodes' fans recede).
  const degree = {}
  for (const id of validIds) degree[id] = 0
  for (const e of simEdges) { degree[e.source]++; degree[e.target]++ }

  const clusterStr = d =>
    d.isHub ? 0 : 0.18 / Math.sqrt(clusterCount[d.cluster] || 1)

  // Charge/collide/link bumped from the earlier (0.65 / +9 / 52) tuning so dense
  // clusters — notably the 14-node product cluster whose members all import App
  // — push apart instead of knotting. The fit-to-content viewBox (below)
  // absorbs the larger spread, so a bigger layout just fills the panel the same.
  const sim = forceSimulation(simNodes)
    .force('link',    forceLink(simEdges).id(d => d.id).distance(60).strength(0.11))
    .force('charge',  forceManyBody().strength(d => -(d.r ** 1.8) * 1.0))
    .force('collide', forceCollide(d => d.r + 13).strength(0.95))
    .force('x',       forceX(d => CLUSTER_POS[d.cluster]?.x ?? 0).strength(clusterStr))
    .force('y',       forceY(d => CLUSTER_POS[d.cluster]?.y ?? 0).strength(clusterStr))
    .stop()

  for (let i = 0; i < 300; i++) sim.tick()

  // ── Cluster labels pushed radially outward from the graph centroid ──────────
  // (was: at the cluster centroid, which printed over the cluster's own nodes
  // and the hub when clusters crowd the centre). We project past the cluster's
  // outermost node along the centroid→cluster direction so the label clears it.
  const nonHub = simNodes.filter(n => !n.isHub)
  const gx = nonHub.reduce((s, n) => s + n.x, 0) / (nonHub.length || 1)
  const gy = nonHub.reduce((s, n) => s + n.y, 0) / (nonHub.length || 1)

  const clusterAgg = {}
  for (const n of nonHub) {
    const a = clusterAgg[n.cluster] || (clusterAgg[n.cluster] = { sx: 0, sy: 0, n: 0, nodes: [] })
    a.sx += n.x; a.sy += n.y; a.n += 1; a.nodes.push(n)
  }
  // Cluster labels sit ADJACENT to their cluster (centroid nudged outward by a
  // small amount so they're beside the nodes, not floating in empty space), and
  // cluster blobs are faint tinted regions behind the nodes for gentle structure.
  const clusterLabels = []
  const clusterBlobs = []
  for (const [cluster, a] of Object.entries(clusterAgg)) {
    const cx = a.sx / a.n, cy = a.sy / a.n
    let dx = cx - gx, dy = cy - gy
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    let reach = 0           // farthest node-edge distance from centroid (any direction)
    for (const n of a.nodes) {
      const dist = Math.hypot(n.x - cx, n.y - cy) + n.r
      if (dist > reach) reach = dist
    }
    // label: adjacent — centroid nudged outward by a modest amount, capped
    const push = Math.min(reach * 0.55 + 6, 40)
    clusterLabels.push({ cluster, x: cx + dx * push, y: cy + dy * push })
    if (cluster !== 'core') clusterBlobs.push({ cluster, cx, cy, r: reach + 26 })
  }

  // ── Content bbox (nodes + their radii + cluster labels) ─────────────────────
  // The render expands this to the live panel's aspect ratio (cw/ch) so meet
  // never pillarboxes — graph stays centred AND fills the panel at any aspect.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of simNodes) {
    if (n.x - n.r < minX) minX = n.x - n.r
    if (n.x + n.r > maxX) maxX = n.x + n.r
    if (n.y - n.r < minY) minY = n.y - n.r
    if (n.y + n.r > maxY) maxY = n.y + n.r
  }
  // fold in cluster-label points (with rough text half-extent) and node labels below
  for (const cl of clusterLabels) {
    if (cl.x - 36 < minX) minX = cl.x - 36
    if (cl.x + 36 > maxX) maxX = cl.x + 36
    if (cl.y - 8  < minY) minY = cl.y - 8
    if (cl.y + 4  > maxY) maxY = cl.y + 4
  }
  maxY += 14  // node labels render ~12px below the node circle
  const bbox = { x0: minX, y0: minY, x1: maxX, y1: maxY }

  return {
    bbox,
    clusterLabels,
    clusterBlobs,
    nodes: simNodes,
    edges: simEdges.map(e => {
      const s = e.source  // D3 resolved to node object
      const t = e.target
      return {
        key:  `${s.id}--${t.id}--${e.kind}`,
        kind:  e.kind,
        x1: s.x, y1: s.y,
        x2: t.x, y2: t.y,
        maxDeg: Math.max(degree[s.id] || 0, degree[t.id] || 0),
      }
    }),
  }
}

// ─── mobile cluster list ──────────────────────────────────────────────────────

function NetworkList({ nodes, onNodeClick, fSans }) {
  const byCluster = {}
  nodes.forEach(n => { (byCluster[n.cluster] = byCluster[n.cluster] || []).push(n) })

  const sorted = (list) =>
    [...list].sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank
      if (a.rank != null) return -1
      if (b.rank != null) return 1
      return 0
    })

  return (
    <div style={{ padding: '20px', fontFamily: fSans }}>
      {Object.keys(CLUSTER_POS)
        .filter(c => byCluster[c]?.length)
        .map(cluster => (
          <div key={cluster} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase',
              color: '#2a5c45', marginBottom: 9, fontWeight: 500,
            }}>
              {CLUSTER_NAME[cluster]}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {sorted(byCluster[cluster]).map(n => (
                <button key={n.id}
                  onClick={() => onNodeClick?.(n)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', borderRadius: 20,
                    background: 'rgba(255,255,255,0.7)',
                    border: `1.5px solid ${RING[n.status] || '#ccc'}`,
                    cursor: onNodeClick ? 'pointer' : 'default',
                    fontSize: 12, color: '#1c1917', fontWeight: 300,
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: FILL[n.status], flexShrink: 0,
                  }} />
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

// ─── tooltip ──────────────────────────────────────────────────────────────────

const TOOLTIP_W = 214

function NodeTooltip({ node, x, y, cw, ch, rankUnique, fSans, fSerif, fMono }) {
  const flipLeft = x + node.r + 18 + TOOLTIP_W > cw
  const tipX = flipLeft ? x - node.r - TOOLTIP_W - 8 : x + node.r + 10
  const tipY = Math.max(4, Math.min(ch - 150, y - 38))

  const isFile = !node.isHub && !String(node.id).startsWith('__')

  return (
    <div style={{
      position: 'absolute', left: tipX, top: tipY, width: TOOLTIP_W,
      background: 'rgba(247,244,239,0.97)', backdropFilter: 'blur(8px)',
      border: '1px solid rgba(28,25,23,0.10)', borderRadius: 10,
      padding: '10px 13px', pointerEvents: 'none', zIndex: 50,
      boxShadow: '0 4px 20px rgba(28,25,23,0.10)',
      fontFamily: fSans,
    }}>
      <div style={{
        fontFamily: fSerif, fontWeight: 500,
        fontSize: 15, color: '#1c1917', marginBottom: isFile ? 3 : 0, lineHeight: 1.2,
      }}>
        {node.label}
      </div>

      {isFile && (
        <div style={{
          fontSize: 10.5, color: '#8a857e', marginBottom: 5,
          fontFamily: fMono, letterSpacing: '.01em', wordBreak: 'break-all',
        }}>
          {node.id}
        </div>
      )}

      {!node.isHub && STATUS_COPY[node.status] && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: rankUnique ? 3 : 0 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: FILL[node.status], flexShrink: 0,
          }} />
          <span style={{ fontSize: 11, color: '#6b6460' }}>{STATUS_COPY[node.status]}</span>
        </div>
      )}

      {/* Priority shown ONLY when the rank is genuinely unique (no tied score). */}
      {rankUnique && (
        <div style={{ fontSize: 11, color: '#6b6460' }}>
          Priority #{node.rank}
        </div>
      )}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export function SiteNetwork({ data, onNodeClick, style, fonts = {} }) {
  const fSans  = fonts.sans  ?? 'Jost, sans-serif'
  const fSerif = fonts.serif ?? 'Cormorant Garant, serif'
  const fMono  = fonts.mono  ?? 'DM Mono, monospace'

  const containerRef = useRef(null)
  const svgRef       = useRef(null)

  const [cw,      setCw]      = useState(700)
  const [ch,      setCh]      = useState(500)
  const [layout,  setLayout]  = useState(null)
  const [tooltip, setTooltip] = useState(null)  // { node, x, y }

  const prefersReduced = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => { setCw(el.offsetWidth); setCh(el.offsetHeight) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Build layout on data change.
  // prefers-reduced-motion: set layout synchronously (no rAF, no loading flash).
  // Stage 3 contract: when `live` prop is added for the build animation, check
  // prefersReduced before starting the frame-by-frame sim loop — if true, call
  // settle() once and render the final state without ticking live.
  useEffect(() => {
    if (!data) return
    if (prefersReduced) {
      setLayout(settle(data.nodes, data.edges))
      return
    }
    setLayout(null)
    const raf = requestAnimationFrame(() => {
      setLayout(settle(data.nodes, data.edges))
    })
    return () => cancelAnimationFrame(raf)
  }, [data])

  const showTooltip = useCallback((node) => {
    const svgEl  = svgRef.current
    const contEl = containerRef.current
    if (!svgEl || !contEl) return
    const ctm = svgEl.getScreenCTM()
    if (!ctm) return
    const pt = svgEl.createSVGPoint()
    pt.x = node.x
    pt.y = node.y
    const screen = pt.matrixTransform(ctm)
    const rect   = contEl.getBoundingClientRect()
    setTooltip({ node, x: screen.x - rect.left, y: screen.y - rect.top })
  }, [])

  const hideTooltip = useCallback(() => setTooltip(null), [])

  // Node ids that get an always-on label (top ~9 ranked + anchors + status).
  const labeledIds = useMemo(
    () => (layout ? computeLabeledIds(layout.nodes) : new Set()),
    [layout],
  )

  // Resolve label positions with greedy collision avoidance: place higher-priority
  // labels first (status → entry → rank), each below its node by default; if that
  // box overlaps an already-placed label, try above, then nudge further out.
  const labelPlacements = useMemo(() => {
    if (!layout) return []
    const nodes = layout.nodes
      .filter(n => !n.isHub && labeledIds.has(n.id))
      .sort((a, b) => {
        const pa = STATUS_LOUD.has(a.status) ? 0 : a.isEntry ? 1 : (a.rank ?? 999)
        const pb = STATUS_LOUD.has(b.status) ? 0 : b.isEntry ? 1 : (b.rank ?? 999)
        return pa - pb
      })
    const placed = []
    const overlaps = (a) => placed.some(b =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
    const out = []
    for (const n of nodes) {
      const w = n.label.length * 5.6 + 4, h = 12
      // candidate baselines (text y); box top = baseline - 9
      const cands = [
        n.y + n.r + 11,   // below
        n.y - n.r - 5,    // above
        n.y + n.r + 24,   // below, nudged
        n.y - n.r - 18,   // above, nudged
      ]
      let chosen = cands[0]
      for (const ty of cands) {
        const box = { x: n.x - w / 2, y: ty - 9, w, h }
        if (!overlaps(box)) { chosen = ty; placed.push(box); break }
        if (ty === cands[cands.length - 1]) { chosen = ty; placed.push(box) }  // last resort
      }
      out.push({ id: n.id, label: n.label, x: n.x, y: chosen, anchor: 'middle', bold: n.rank === 1 || STATUS_LOUD.has(n.status) })
    }
    return out
  }, [layout, labeledIds])

  // Node ids whose rank is genuinely unique (no other ranked node shares its
  // rankReason — our proxy for a tied score). Only these show a "Priority #N";
  // tied nodes omit the line rather than print misleadingly-distinct numbers.
  const uniqueRankIds = useMemo(() => {
    if (!layout) return new Set()
    const reasonCount = {}
    for (const n of layout.nodes) {
      if (n.rank != null && n.rankReason) reasonCount[n.rankReason] = (reasonCount[n.rankReason] || 0) + 1
    }
    const ids = new Set()
    for (const n of layout.nodes) {
      if (n.rank != null && (!n.rankReason || reasonCount[n.rankReason] === 1)) ids.add(n.id)
    }
    return ids
  }, [layout])

  // Aspect-matched viewBox: expand the settled content bbox on its short axis to
  // the live panel's aspect (cw/ch) and centre it, so preserveAspectRatio="meet"
  // has nothing to pillarbox — the graph fills any panel shape, not just the
  // one the probe happened to test.
  const viewBox = useMemo(() => {
    if (!layout) return '0 0 1 1'
    const { x0, y0, x1, y1 } = layout.bbox
    const cxC = (x0 + x1) / 2, cyC = (y0 + y1) / 2
    let w = x1 - x0, h = y1 - y0
    const panelAspect = (cw > 0 && ch > 0) ? cw / ch : w / h
    if (panelAspect > w / h) w = h * panelAspect   // panel wider → add horizontal margin
    else                     h = w / panelAspect   // panel taller → add vertical margin
    return `${(cxC - w / 2).toFixed(1)} ${(cyC - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`
  }, [layout, cw, ch])

  return (
    <div ref={containerRef} style={{ position: 'relative', background: '#f7f4ef', ...style }}>

      {/* Loading state */}
      {!layout && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <style>{`@keyframes _sn_spin { to { transform: rotate(360deg) } }`}</style>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            border: '2px solid rgba(42,92,69,0.15)',
            borderTopColor: '#2a5c45',
            animation: prefersReduced ? 'none' : '_sn_spin 0.8s linear infinite',
          }} />
        </div>
      )}

      {/* Mobile: cluster list, sorted by rank */}
      {layout && cw < 600 && (
        <NetworkList nodes={layout.nodes} onNodeClick={onNodeClick} fSans={fSans} />
      )}

      {/* Desktop: SVG graph */}
      {layout && cw >= 600 && (
        <svg
          ref={svgRef}
          viewBox={viewBox}
          width="100%"
          height="100%"
          style={{ display: 'block', overflow: 'visible' }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Soft cluster region blobs — a whisper of category structure behind
              the nodes. Very low alpha so status colours always read over them. */}
          <g>
            {layout.clusterBlobs.map(bl => (
              <circle key={bl.cluster}
                cx={bl.cx} cy={bl.cy} r={bl.r}
                fill={CLUSTER_TINT[bl.cluster] || '#9a958e'}
                fillOpacity={0.06}
              />
            ))}
          </g>

          {/* Cluster section labels — readable muted ink, adjacent to nodes */}
          {layout.clusterLabels.filter(cl => cl.cluster !== 'core').map(cl => (
            <text key={cl.cluster}
              x={cl.x} y={cl.y}
              textAnchor="middle"
              style={{
                fontSize: 9, fill: 'rgba(42,92,69,0.55)',
                fontFamily: fSans, fontWeight: 500,
                letterSpacing: '0.14em', userSelect: 'none',
                pointerEvents: 'none',
              }}
            >
              {CLUSTER_NAME[cl.cluster]?.toUpperCase()}
            </text>
          ))}

          {/* Edges — faint curved arcs; opacity fades with endpoint degree so
              busy fans recede. Curve = control point offset perpendicular to
              the midpoint by ~12% of edge length. */}
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

          {/* Nodes */}
          <g>
            {layout.nodes.map(node => {
              const isHov   = tooltip?.node?.id === node.id
              const statusLoud = STATUS_LOUD.has(node.status)
              // Status colour dominates; otherwise the node wears its cluster tint.
              const fill   = node.isHub ? '#2a5c45'
                           : statusLoud ? FILL[node.status]
                           : (CLUSTER_TINT[node.cluster] || FILL[node.status])
              const stroke = node.isHub ? 'none'
                           : statusLoud ? RING[node.status]
                           : (CLUSTER_RING[node.cluster] || RING[node.status])
              const sw      = node.isEntry && !node.isHub ? 2.0 : 1.5
              const [dl1, dl2] = node.isHub ? hubLabelLines(data.meta.domain) : []
              // Hierarchy via opacity: ranked nodes + anchors lead; leaves recede
              // to 0.65. Status-coloured nodes (gold/green/regression) stay full.
              const fillOpacity = (node.isHub || node.isEntry || node.rank != null || statusLoud) ? 1 : 0.65

              return (
                <g key={node.id}
                  style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
                  onMouseEnter={() => showTooltip(node)}
                  onMouseLeave={hideTooltip}
                  onClick={() => onNodeClick?.(node)}
                >
                  <circle cx={node.x} cy={node.y} r={node.r + 5} fill="transparent" />

                  {isHov && (
                    <circle cx={node.x} cy={node.y} r={node.r + 4}
                      fill="none" stroke="rgba(42,92,69,0.22)" strokeWidth={1.5}
                    />
                  )}

                  <circle
                    cx={node.x} cy={node.y} r={node.r}
                    fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={sw}
                  />

                  {/* Hub: two-line domain label inside circle */}
                  {node.isHub && (
                    <text
                      x={node.x} y={node.y}
                      textAnchor="middle"
                      style={{
                        fontSize: 7.5, fill: 'rgba(247,244,239,0.92)',
                        fontFamily: fSans, fontWeight: 500,
                        letterSpacing: '0.04em',
                        pointerEvents: 'none', userSelect: 'none',
                      }}
                    >
                      <tspan x={node.x} dy="-3">{dl1}</tspan>
                      <tspan x={node.x} dy="10">{dl2}</tspan>
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          {/* Node labels — collision-avoided, drawn above all nodes */}
          <g>
            {labelPlacements.map(pl => (
              <text key={pl.id}
                x={pl.x} y={pl.y}
                textAnchor={pl.anchor}
                style={{
                  fontSize: 10,
                  fill: '#1c1917',
                  stroke: 'rgba(247,244,239,0.9)',
                  strokeWidth: 3,
                  paintOrder: 'stroke fill',
                  fontFamily: fSans,
                  fontWeight: pl.bold ? 500 : 300,
                  pointerEvents: 'none', userSelect: 'none',
                }}
              >
                {pl.label}
              </text>
            ))}
          </g>
        </svg>
      )}

      {/* HTML tooltip */}
      {layout && cw >= 600 && tooltip && (
        <NodeTooltip
          node={tooltip.node}
          x={tooltip.x}
          y={tooltip.y}
          cw={cw}
          ch={ch}
          rankUnique={uniqueRankIds.has(tooltip.node.id)}
          fSans={fSans}
          fSerif={fSerif}
          fMono={fMono}
        />
      )}
    </div>
  )
}

export default SiteNetwork
