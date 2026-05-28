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

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'

// ─── simulation constants ─────────────────────────────────────────────────────

const SIM_W = 840   // widened from 600 to fill the ~1032px dashboard content panel
const SIM_H = 480
const VIEW_PAD_X = 40  // extra horizontal margin so cluster labels and edge nodes don't clip

// Cluster target positions. Hub fixed at (0,0).
// x-values scaled ×1.4 from the original 600-wide space.
const CLUSTER_POS = {
  core:      { x:   0,  y:  -55 },
  marketing: { x: 227,  y:  -88 },
  auth:      { x: 241,  y:   62 },
  product:   { x: 109,  y:  158 },
  content:   { x: -189, y:  122 },
  utility:   { x: -249, y:    0 },
  legal:     { x:  -73, y:  202 },
  other:     { x: 140,  y: -185 },
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
  'fix-in-flight': 'Fix in flight',
  optimized:       'Optimized',
  problem:         'Regression',
  tracked:         'Watching',
}

const EDGE_COLOR = {
  import:     'rgba(42,92,69,0.22)',
  structural: 'rgba(42,92,69,0.10)',
}

// ─── layout helpers ───────────────────────────────────────────────────────────

function calcR(node) {
  if (node.isHub)     return 22
  if (node.isGrouped) return 10 + Math.min(6, Math.sqrt(node.groupCount || 0))
  let r = node.isEntry ? 10 : 7
  if (node.rank      != null) r += Math.max(0, 7 - node.rank * 0.8)
  if (node.dropOffScore != null) r += node.dropOffScore * 3.5
  return Math.max(5, Math.min(Math.round(r), 22))
}

function permanentLabel(node) {
  return node.isHub || node.isEntry || node.isGrouped || (node.rank != null && node.rank <= 3)
}

function splitDomain(domain) {
  const dot = domain.lastIndexOf('.')
  if (dot === -1) return [domain.slice(0, 10), '']
  const body = domain.slice(0, dot)
  const tld  = domain.slice(dot)
  return [body.length > 10 ? body.slice(0, 9) + '…' : body, tld]
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

  const clusterStr = d =>
    d.isHub ? 0 : 0.18 / Math.sqrt(clusterCount[d.cluster] || 1)

  const sim = forceSimulation(simNodes)
    .force('link',    forceLink(simEdges).id(d => d.id).distance(52).strength(0.18))
    .force('charge',  forceManyBody().strength(d => -(d.r ** 1.8) * 0.65))
    .force('collide', forceCollide(d => d.r + 9).strength(0.9))
    .force('x',       forceX(d => CLUSTER_POS[d.cluster]?.x ?? 0).strength(clusterStr))
    .force('y',       forceY(d => CLUSTER_POS[d.cluster]?.y ?? 0).strength(clusterStr))
    .stop()

  for (let i = 0; i < 300; i++) sim.tick()

  return {
    nodes: simNodes,
    edges: simEdges.map(e => {
      const s = e.source  // D3 resolved to node object
      const t = e.target
      return {
        key:  `${s.id}--${t.id}--${e.kind}`,
        kind:  e.kind,
        x1: s.x, y1: s.y,
        x2: t.x, y2: t.y,
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

function NodeTooltip({ node, x, y, cw, ch, fSans, fSerif, fMono }) {
  const flipLeft = x + node.r + 18 + TOOLTIP_W > cw
  const tipX = flipLeft ? x - node.r - TOOLTIP_W - 8 : x + node.r + 10
  const tipY = Math.max(4, Math.min(ch - 150, y - 38))

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
        fontSize: 15, color: '#1c1917', marginBottom: 2, lineHeight: 1.2,
      }}>
        {node.label}
      </div>

      {node.route && (
        <div style={{
          fontSize: 11, color: '#6b6460', marginBottom: 5,
          fontFamily: fMono, letterSpacing: '.02em',
        }}>
          {node.route}
        </div>
      )}

      {STATUS_COPY[node.status] && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: FILL[node.status], flexShrink: 0,
          }} />
          <span style={{ fontSize: 11, color: '#6b6460' }}>{STATUS_COPY[node.status]}</span>
        </div>
      )}

      {node.rank != null && (
        <div style={{ fontSize: 11, color: '#6b6460', marginBottom: node.rankReason ? 3 : 0 }}>
          Priority #{node.rank}
        </div>
      )}

      {node.rankReason && (
        <div style={{
          fontSize: 11, color: '#8a857e', lineHeight: 1.55,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {node.rankReason}
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

  const presentClusters = layout
    ? [...new Set(layout.nodes.map(n => n.cluster))].filter(c => c !== 'core')
    : []

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
          viewBox={`${-SIM_W / 2 - VIEW_PAD_X} ${-SIM_H / 2} ${SIM_W + VIEW_PAD_X * 2} ${SIM_H}`}
          width="100%"
          height="100%"
          style={{ display: 'block', overflow: 'visible' }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Faint cluster section labels, behind nodes */}
          {presentClusters.map(c => {
            const cp = CLUSTER_POS[c]
            if (!cp) return null
            return (
              <text key={c}
                x={cp.x} y={cp.y - 42}
                textAnchor="middle"
                style={{
                  fontSize: 8, fill: 'rgba(42,92,69,0.18)',
                  fontFamily: fSans, fontWeight: 500,
                  letterSpacing: '0.12em', userSelect: 'none',
                  pointerEvents: 'none',
                }}
              >
                {CLUSTER_NAME[c]?.toUpperCase()}
              </text>
            )
          })}

          {/* Edges */}
          <g>
            {layout.edges.map(e => (
              <line key={e.key}
                x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                stroke={EDGE_COLOR[e.kind]}
                strokeWidth={e.kind === 'import' ? 1.2 : 0.7}
              />
            ))}
          </g>

          {/* Nodes */}
          <g>
            {layout.nodes.map(node => {
              const isHov   = tooltip?.node?.id === node.id
              const fill    = node.isHub ? '#2a5c45' : FILL[node.status]
              const stroke  = node.isHub ? 'none'    : RING[node.status]
              const sw      = node.isEntry && !node.isHub ? 2.0 : 1.5
              const [dl1, dl2] = node.isHub ? splitDomain(data.meta.domain) : []

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
                    fill={fill} stroke={stroke} strokeWidth={sw}
                  />

                  {/* Hub: two-line domain label inside circle */}
                  {node.isHub && (
                    <text
                      x={node.x} y={node.y}
                      textAnchor="middle"
                      style={{
                        fontSize: 7, fill: 'rgba(247,244,239,0.92)',
                        fontFamily: fSans, fontWeight: 500,
                        letterSpacing: '0.04em',
                        pointerEvents: 'none', userSelect: 'none',
                      }}
                    >
                      <tspan x={node.x} dy="-3">{dl1}</tspan>
                      <tspan x={node.x} dy="10">{dl2}</tspan>
                    </text>
                  )}

                  {/* External label for entry points, grouped, top 3 ranked */}
                  {!node.isHub && permanentLabel(node) && (
                    <text
                      x={node.x} y={node.y + node.r + 12}
                      textAnchor="middle"
                      style={{
                        fontSize: 10,
                        fill: '#1c1917',
                        stroke: 'rgba(247,244,239,0.88)',
                        strokeWidth: 3,
                        paintOrder: 'stroke fill',
                        fontFamily: fSans,
                        fontWeight: node.rank === 1 ? 500 : 300,
                        pointerEvents: 'none', userSelect: 'none',
                      }}
                    >
                      {node.label}
                    </text>
                  )}
                </g>
              )
            })}
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
          fSans={fSans}
          fSerif={fSerif}
          fMono={fMono}
        />
      )}
    </div>
  )
}

export default SiteNetwork
