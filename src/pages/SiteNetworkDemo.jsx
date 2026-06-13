// Stage 2 demo page — renders SiteNetwork against mock data in isolation.
// Route: /demo/network  (dev only; not linked from any public nav)

import { useState } from 'react'
import { SiteNetwork } from '../components/SiteNetwork.jsx'
import { mockSiteNetworkData } from '../data/mockSiteNetwork.js'

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&family=DM+Mono:wght@400&display=swap');`

const STATUS_FILL = {
  neutral:         '#a8a39a',
  tracked:         '#ccc8c3',
  'fix-in-flight': '#c2a45f',
  optimized:       '#2f6b4f',
}

export default function SiteNetworkDemo({ navigate }) {
  const [lastClicked, setLastClicked] = useState(null)

  function handleNodeClick(node) {
    setLastClicked(node)
    console.log('[SiteNetwork] node clicked:', node)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f7f4ef',
      fontFamily: 'Jost, sans-serif',
    }}>
      <style>{FONTS}</style>
      <style>{`*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`}</style>

      {/* Header */}
      <div style={{
        borderBottom: '1px solid rgba(28,25,23,0.08)',
        padding: '16px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#f7f4ef',
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#2a5c45', marginBottom: 4, fontWeight: 500 }}>
            Stage 2 — Component preview
          </div>
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 22, fontWeight: 400, color: '#1c1917' }}>
            Site Network
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          {/* Legend */}
          {Object.entries(STATUS_FILL).map(([status, color]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#6b6460', textTransform: 'capitalize' }}>
                {status === 'fix-in-flight' ? 'Fix in flight' : status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Graph */}
      <SiteNetwork
        data={mockSiteNetworkData}
        onNodeClick={handleNodeClick}
        style={{ height: 'calc(100vh - 120px)' }}
      />

      {/* Footer bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        borderTop: '1px solid rgba(28,25,23,0.08)',
        background: 'rgba(247,244,239,0.97)', backdropFilter: 'blur(8px)',
        padding: '10px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 12, color: '#6b6460', fontWeight: 300 }}>
          {mockSiteNetworkData.meta.totalNodes} nodes · {mockSiteNetworkData.meta.totalEdges} edges ·{' '}
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11 }}>
            {mockSiteNetworkData.meta.framework}
          </span>
          {' · '}mock data
        </div>
        {lastClicked ? (
          <div style={{ fontSize: 12, color: '#1c1917', fontWeight: 300 }}>
            Clicked:{' '}
            <span style={{ fontWeight: 500, color: '#2a5c45' }}>
              {lastClicked.label}
            </span>
            {lastClicked.route && (
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#6b6460', marginLeft: 6 }}>
                {lastClicked.route}
              </span>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#a09890', fontWeight: 300 }}>
            Hover to inspect · click to stub onNodeClick
          </div>
        )}
      </div>
    </div>
  )
}
