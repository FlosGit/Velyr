import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { demoData } from '../data/demoData'
import { startCheckout } from '../utils/startCheckout.js'
import CheckoutConfirmModal from '../components/CheckoutConfirmModal.jsx'
import { SiteNetwork } from '../components/SiteNetwork.jsx'
import { buildNetworkData, hubDomainFromUrl } from '../lib/siteNetworkData.js'

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg:          '#f5f2ec',
  bgCard:      '#ffffff',
  bgPanel:     '#faf8f4',
  bgDark:      '#1a1916',
  text:        '#1a1916',
  textMuted:   '#6b6460',
  textLight:   '#a09890',
  border:      'rgba(26,25,22,0.08)',
  borderMed:   'rgba(26,25,22,0.13)',
  borderStrong:'rgba(26,25,22,0.2)',
  accent:      '#2a5c45',
  accentDark:  '#1e4433',
  accentSoft:  'rgba(42,92,69,0.07)',
  accentMid:   'rgba(42,92,69,0.15)',
  red:         '#b83232',
  redSoft:     'rgba(184,50,50,0.07)',
  redMid:      'rgba(184,50,50,0.15)',
  yellow:      '#c47d0e',
  yellowSoft:  'rgba(196,125,14,0.07)',
  yellowMid:   'rgba(196,125,14,0.18)',  // FIX #1: was missing — caused undefined borders/backgrounds everywhere yellowMid was used
  green:       '#1e7a3c',
  greenSoft:   'rgba(30,122,60,0.07)',
  blue:        '#1d5fa8',
  blueSoft:    'rgba(29,95,168,0.07)',
  blueMid:     'rgba(29,95,168,0.15)',
}

const STATUS = {
  running:          { label: 'Running',           color: C.blue,      bg: C.blueSoft,   border: C.blueMid,    dot: C.blue },
  waiting_approval: { label: 'Awaiting Approval', color: C.yellow,    bg: C.yellowSoft, border: C.yellowMid,  dot: C.yellow },
  deployed:         { label: 'Deployed',          color: C.green,     bg: C.greenSoft,  border: 'rgba(30,122,60,0.2)', dot: C.green },
  rejected:         { label: 'Rejected',          color: C.red,       bg: C.redSoft,    border: C.redMid,     dot: C.red },
  failed:           { label: 'Failed',            color: C.red,       bg: C.redSoft,    border: C.redMid,     dot: C.red },
  pending:          { label: 'Pending',           color: C.textLight, bg: 'rgba(26,25,22,0.04)', border: C.border, dot: C.textLight },
  approved:         { label: 'Approved',          color: C.green,     bg: C.greenSoft,  border: 'rgba(30,122,60,0.2)', dot: C.green },
  rolled_back:      { label: 'Rolled Back',       color: C.textMuted, bg: 'rgba(107,100,96,0.07)', border: 'rgba(107,100,96,0.18)', dot: C.textMuted },
}

const PAGE_TYPE_EMOJI = {
  landing:'🏠', pricing:'💰', checkout:'🛒', blog:'📝',
  about:'ℹ️', lead_magnet:'🎁', auth:'🔐', dashboard:'📊', other:'📄'
}

const AGENT_STEPS = [
  { id:'fetch_repo',  label:'Fetching repo',           desc:'Reading GitHub repository structure' },
  { id:'fetch_ph',    label:'Pulling analytics',       desc:'Loading PostHog pageview & session data' },
  { id:'scan_comp',   label:'Scanning competitors',    desc:'Checking tracked competitor sites for changes' },
  { id:'seasonal',    label:'Checking seasonal',       desc:'Picking the right priority for this month' },
  { id:'read_dna',    label:'Reading Business DNA',    desc:'Loading what works and what to avoid' },
  { id:'map_funnel',  label:'Mapping funnel',          desc:'Detecting pages and conversion flow' },
  { id:'analyze',     label:'Finding biggest issue',   desc:'Claude analyzing drop-off & opportunities' },
  { id:'screenshot',  label:'Taking before screenshot',desc:'Capturing the page before any changes' },
  { id:'write_fix',   label:'Writing fix',             desc:'Editing file and generating patch' },
  { id:'open_pr',     label:'Opening pull request',    desc:'Pushing branch and creating PR on GitHub' },
  { id:'notify',      label:'Sending notification',    desc:'Telegram message — reply YES or NO' },
]

const NAV_ITEMS = [
  { id:'overview',    label:'Overview',    icon:'⊙' },
  { id:'runs',        label:'Runs',        icon:'↻' },
  { id:'insights',    label:'Insights',    icon:'◈' },
  { id:'network',     label:'Network',     icon:'◎' },
  { id:'funnel',      label:'Funnel',      icon:'⬦' },
  { id:'dna',         label:'DNA',         icon:'◉' },
  { id:'guardrails',  label:'Guardrails',  icon:'◻' },
  { id:'settings',    label:'Settings',    icon:'⚙' },
]

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { background: #f5f2ec; color: #1a1916; font-family: 'DM Sans', sans-serif; font-weight: 400; -webkit-font-smoothing: antialiased; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  img, svg, video { max-width: 100%; }
  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes pulse   { 0%,100%{opacity:1}50%{opacity:0.25} }
  @keyframes fadeUp  { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none} }
  @keyframes fadeIn  { from{opacity:0}to{opacity:1} }
  @keyframes slideIn { from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none} }
  @keyframes popIn   { from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)} }
  @keyframes streamIn{ from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none} }
  @keyframes barGrow { from{width:0}to{width:var(--w)} }
  .fade-up   { animation: fadeUp .3s ease both; }
  .pop-in    { animation: popIn .25s ease both; }
  .stream-in { animation: streamIn .2s ease both; }
  .slide-in  { animation: slideIn .25s ease both; }
  .pulse-dot { animation: pulse 2s ease infinite; }
  .spin      { animation: spin 0.7s linear infinite; }
  .nav-item  { cursor:pointer; transition: all .15s; border:none; background:none; width:100%; text-align:left; }
  .nav-item:hover { background: rgba(42,92,69,0.06); }
  .run-row   { cursor:pointer; transition: background .12s; }
  .run-row:hover { background: rgba(26,25,22,0.025) !important; }
  .btn       { cursor:pointer; transition: all .15s; border:none; font-family:'DM Sans',sans-serif; }
  .btn:hover { filter: brightness(0.92); }
  .btn:active{ transform: scale(0.98); }
  .card-hover{ transition: box-shadow .2s, transform .15s; }
  .card-hover:hover{ box-shadow: 0 4px 20px rgba(26,25,22,0.07); transform: translateY(-1px); }
  .tag-remove{ cursor:pointer; color:#a09890; }
  .tag-remove:hover{ color:#b83232; }
  ::-webkit-scrollbar { width:3px; height:3px; }
  ::-webkit-scrollbar-thumb { background:rgba(26,25,22,0.15); border-radius:3px; }
  ::-webkit-scrollbar-track { background:transparent; }
  input, textarea { font-family:'DM Sans',sans-serif; outline:none; }
  input:focus, textarea:focus { border-color: rgba(42,92,69,0.4) !important; box-shadow: 0 0 0 3px rgba(42,92,69,0.08); }
  a { color: ${C.accent}; }

  /* Drawer affordances are hidden on desktop; the ≤900 block reveals them. */
  .dash-hamburger { display: none; }
  .dash-scrim { display: none; }
  .dash-drawer-close { display: none; }

  /* ── Mobile responsiveness ── */
  @media (max-width: 900px) {
    /* Sidebar → off-canvas slide-in drawer with the full vertical nav (no
       horizontal scroll). Hamburger in the header opens it; scrim + close
       button + tab-select dismiss it. */
    .dash-sidebar {
      position: fixed !important; top: 0 !important; left: 0 !important;
      height: 100vh !important; width: 270px !important; max-width: 84vw;
      transform: translateX(-100%);
      transition: transform .28s cubic-bezier(.4,0,.2,1);
      z-index: 80;
      border-right: 1px solid rgba(26,25,22,0.08) !important;
    }
    .dash-shell.drawer-open .dash-sidebar {
      transform: translateX(0);
      box-shadow: 0 12px 40px rgba(26,25,22,0.18);
    }
    .dash-sidebar .nav-item { min-height: 44px !important; padding: 8px 12px !important; }
    .dash-scrim {
      display: block; position: fixed; inset: 0; z-index: 70;
      background: rgba(26,25,22,0.42);
      opacity: 0; pointer-events: none;
      transition: opacity .28s ease;
    }
    .dash-shell.drawer-open .dash-scrim { opacity: 1; pointer-events: auto; }
    .dash-hamburger { display: inline-flex !important; }
    .dash-drawer-close { display: flex !important; }
    .dash-main { width: 100% !important; }
    .dash-main > div:first-child { padding: 0 16px !important; }
    .dash-content { padding: 16px !important; }
    .dash-content [style*="grid-template-columns"] { grid-template-columns: 1fr 1fr !important; }
    .dash-content [style*="grid-template-columns: 1fr auto auto"] { grid-template-columns: 1fr !important; gap: 6px !important; }
  }
  /* Drawer slide + scrim fade are instant for reduced-motion users (landing rule). */
  @media (prefers-reduced-motion: reduce) {
    .dash-sidebar, .dash-scrim { transition: none !important; }
  }
  @media (max-width: 600px) {
    .dash-content [style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
  }
  /* Grid-blowout guard: collapsed single-column tracks default to
     minmax(auto,1fr), so a child's min-content (nowrap text, file chips) can
     force the card wider than the viewport — invisible only because body
     overflow-x is hidden. min-width:0 lets the track shrink to the container.
     Applies to every mobile grid (incl. KPI 2×2). */
  @media (max-width: 900px) {
    .dash-content [style*="grid-template-columns"] > * { min-width: 0 !important; }
  }
  /* Overview: stack main column + contextual sidebar instead of crushing main
     to a sliver. The sidebar (next-run / steps / performance) drops below. */
  @media (max-width: 768px) {
    .dash-overview-row { flex-direction: column !important; }
    .dash-overview-row > * { width: 100% !important; min-width: 0 !important; }
    .dash-ctx-sidebar { width: 100% !important; position: static !important; top: auto !important; }
  }
  /* KPI tiles stay 2×2 on phones (the generic ≤600 rule above would otherwise
     collapse them to a 4-tall column). Placed after it to win on source order. */
  @media (max-width: 600px) {
    .dash-content .dash-kpi-grid { grid-template-columns: 1fr 1fr !important; }
  }
`

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff/60000), h = Math.floor(m/60), d = Math.floor(h/24)
  if (d>0) return `${d}d ago`; if (h>0) return `${h}h ago`; if (m>0) return `${m}m ago`; return 'just now'
}

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
}

function nextMonday9am() {
  const now=new Date(), day=now.getDay()
  const daysUntil = day===1?(now.getHours()<9?0:7):(8-day)%7||7
  const next=new Date(now); next.setDate(now.getDate()+daysUntil); next.setHours(9,0,0,0); return next
}

function useCountdown(target) {
  const [r,setR] = useState({str:''})
  useEffect(()=>{
    function tick(){
      const diff=target-Date.now()
      if(diff<=0){setR({str:'Running soon…'});return}
      const d=Math.floor(diff/86400000),h=Math.floor((diff%86400000)/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000)
      setR({str:d>0?`${d}d ${h}h ${m}m`:h>0?`${h}h ${m}m ${s}s`:`${m}m ${s}s`})
    }
    tick(); const id=setInterval(tick,1000); return()=>clearInterval(id)
  },[target])
  return r
}

// Maps edge-function current_step values + legacy ids to AGENT_STEPS ids.
const CURRENT_STEP_TO_ID = {
  fetching_repo:         'fetch_repo',
  pulling_analytics:     'fetch_ph',
  scanning_competitors:  'scan_comp',
  checking_seasonal:     'seasonal',
  reading_dna:           'read_dna',
  mapping_funnel:        'map_funnel',
  finding_biggest_issue: 'analyze',
  taking_screenshot:     'screenshot',
  writing_fix:           'write_fix',
  opening_pr:            'open_pr',
  sending_notification:  'notify',
  // Legacy short ids kept for backwards-compat with older runs in the DB
  fetch_repo:'fetch_repo', fetch_ph:'fetch_ph', map_funnel:'map_funnel',
  write_fix:'write_fix',   open_pr:'open_pr',   notify:'notify',
}

function deriveAgentStep(run) {
  if (!run) return -1
  const stepIndexById = Object.fromEntries(AGENT_STEPS.map((s, i) => [s.id, i]))
  const lastIdx = AGENT_STEPS.length - 1
  const midIdx  = Math.floor(lastIdx / 2)
  switch (run.status) {
    case 'running': {
      const id = CURRENT_STEP_TO_ID[run.current_step]
      return id != null && stepIndexById[id] != null ? stepIndexById[id] : midIdx
    }
    case 'waiting_approval':
    case 'deployed':
    case 'approved':
    case 'rejected':
    case 'rolled_back':
      return lastIdx
    case 'failed':
      return midIdx
    default:
      return -1
  }
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function VelyrLogo({ size=22, color=C.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="13" stroke={color} strokeWidth="1" opacity="0.3"/>
      <circle cx="16" cy="16" r="8"  stroke={color} strokeWidth="1" opacity="0.55"/>
      <circle cx="16" cy="16" r="3"  fill={color}/>
      <line x1="16" y1="3"  x2="16" y2="8"  stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
      <line x1="16" y1="24" x2="16" y2="29" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
      <line x1="3"  y1="16" x2="8"  y2="16" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
      <line x1="24" y1="16" x2="29" y2="16" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
    </svg>
  )
}

function StatusBadge({ status, small }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{
      fontSize:small?10:11, fontWeight:500, letterSpacing:'.03em',
      padding:small?'2px 7px':'3px 9px', borderRadius:5,
      background:s.bg, color:s.color, border:`1px solid ${s.border}`,
      whiteSpace:'nowrap', display:'inline-flex', alignItems:'center', gap:5,
    }}>
      <span style={{
        width:small?4:5,height:small?4:5,borderRadius:'50%',background:s.dot,display:'inline-block',
        animation:status==='running'?'pulse 2s ease infinite':'none'
      }}/>
      {s.label}
    </span>
  )
}

function Spinner({size=18}) {
  return <div style={{width:size,height:size,border:`1.5px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}/>
}

function SectionLabel({children, style}) {
  return <p style={{fontSize:10,letterSpacing:'.1em',textTransform:'uppercase',fontWeight:500,color:C.textLight,...style}}>{children}</p>
}

function Card({children,style,className}) {
  return (
    <div className={className} style={{
      background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:12,
      ...style
    }}>
      {children}
    </div>
  )
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({data, color=C.accent, height=32, width=80}) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data), min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((v,i) => {
    const x = (i/(data.length-1))*width
    const y = height - ((v-min)/range)*(height-4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{overflow:'visible'}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
    </svg>
  )
}

// ─── MINI SPARKLINE BAR ───────────────────────────────────────────────────────
function RunHistoryBar({runs}) {
  const last12 = [...runs].slice(0,12).reverse()
  return (
    <div style={{display:'flex',gap:3,alignItems:'flex-end',height:24}}>
      {last12.map((run,i) => {
        const s = STATUS[run.status]||STATUS.pending
        const h = run.status==='deployed'||run.status==='approved'?24:run.status==='waiting_approval'?16:run.status==='failed'||run.status==='rejected'?8:14
        return <div key={run.id} title={`${run.status} · ${timeAgo(run.created_at)}`} style={{
          flex:1,height:h,background:s.dot,borderRadius:2,
          opacity:0.4+(i/12)*0.6,
        }}/>
      })}
    </div>
  )
}

// ─── LIVE ACTIVITY STREAM ─────────────────────────────────────────────────────
function LiveActivityStream({runs, activeRun}) {
  const streamItems = []

  if (activeRun) {
    const stepIdx = deriveAgentStep(activeRun)
    AGENT_STEPS.forEach((step, i) => {
      const done = i < stepIdx
      const current = i === stepIdx
      streamItems.push({
        id: `step-${i}`,
        type: 'step',
        done, current,
        label: step.label,
        desc: current ? step.desc : null,
        time: current ? 'now' : done ? '✓' : null,
      })
    })
  }

  runs.slice(0,8).forEach(run => {
    if (run.status==='running') return
    const analysis = run.analysis_result||{}
    streamItems.push({
      id: run.id,
      type: 'run',
      status: run.status,
      label: analysis.problem || 'Run completed',
      sub: analysis.expected_improvement ? `Expected: ${analysis.expected_improvement}` : null,
      time: timeAgo(run.created_at),
      file: analysis.file_to_edit?.split('/').pop(),
    })
  })

  return (
    <div style={{display:'flex',flexDirection:'column',gap:0}}>
      {streamItems.map((item, i) => (
        <div key={item.id} className="stream-in" style={{
          animationDelay:`${i*0.04}s`,
          display:'flex',gap:12,alignItems:'flex-start',
          padding:'10px 0',
          borderBottom:i<streamItems.length-1?`1px solid ${C.border}`:'none',
        }}>
          <div style={{width:20,flexShrink:0,display:'flex',justifyContent:'center',paddingTop:2}}>
            {item.type==='step' ? (
              <div style={{
                width:item.current?10:8, height:item.current?10:8,
                borderRadius:'50%',
                background: item.done ? C.accent : item.current ? C.blue : 'rgba(26,25,22,0.1)',
                border: item.current?`2px solid ${C.blue}`:`1px solid ${item.done?C.accent:C.border}`,
                animation: item.current?'pulse 2s ease infinite':'none',
              }}/>
            ) : (
              <div style={{width:8,height:8,borderRadius:'50%',background:(STATUS[item.status]||STATUS.pending).dot,marginTop:1}}/>
            )}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
              <p style={{
                fontSize:12,fontWeight:item.type==='step'&&item.current?500:400,
                color:item.type==='step'?(item.done?C.textMuted:item.current?C.blue:C.textLight):C.text,
                lineHeight:1.4,
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,
              }}>
                {item.label}
              </p>
              {item.time && (
                <span style={{fontSize:10,color:item.time==='now'?C.blue:item.time==='✓'?C.accent:C.textLight,fontWeight:item.time==='now'?500:300,flexShrink:0}}>
                  {item.time}
                </span>
              )}
            </div>
            {item.desc && <p style={{fontSize:10,color:C.textMuted,marginTop:2}}>{item.desc}</p>}
            {item.sub && <p style={{fontSize:10,color:C.green,marginTop:2}}>{item.sub}</p>}
            {item.file && <code style={{fontSize:10,color:C.accent,background:C.accentSoft,padding:'1px 5px',borderRadius:3,marginTop:3,display:'inline-block'}}>{item.file}</code>}
          </div>
        </div>
      ))}
      {streamItems.length===0 && (
        <p style={{fontSize:12,color:C.textLight,padding:'16px 0',textAlign:'center'}}>No activity yet. Agent runs every Monday.</p>
      )}
    </div>
  )
}

// ─── PR MISSION CONTROL ───────────────────────────────────────────────────────
function PRMissionControl({run}) {
  const analysis = run.analysis_result || {}
  const confidence = analysis.confidence_score || analysis.confidence || 'High'
  const confNum = typeof confidence === 'number' ? confidence : 88

  return (
    <div style={{
      background:C.bgCard,
      border:`1px solid ${C.yellowMid}`,
      borderRadius:12,
      overflow:'hidden',
      boxShadow:`0 0 0 3px ${C.yellowSoft}`,
    }}>
      <div style={{
        background:C.yellowSoft,
        borderBottom:`1px solid ${C.yellowMid}`,
        padding:'10px 18px',
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,
        flexWrap:'wrap',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="pulse-dot" style={{width:7,height:7,borderRadius:'50%',background:C.yellow,display:'inline-block',flexShrink:0}}/>
          <SectionLabel style={{color:C.yellow,marginBottom:0}}>Awaiting your approval · PR #{run.pr_number||'—'}</SectionLabel>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <a href={run.pr_url} target="_blank" rel="noreferrer" style={{
            fontSize:11,color:C.accent,background:C.accentSoft,
            border:`1px solid ${C.accentMid}`,borderRadius:6,padding:'4px 10px',
            textDecoration:'none',fontWeight:500,
          }}>View on GitHub ↗</a>
          <span style={{fontSize:11,color:C.yellow,background:C.yellowSoft,border:`1px solid ${C.yellowMid}`,borderRadius:6,padding:'4px 10px'}}>
            Reply <code style={{fontFamily:'DM Mono,monospace',fontSize:10}}>YES</code> or <code style={{fontFamily:'DM Mono,monospace',fontSize:10}}>NO</code> on Telegram
          </span>
        </div>
      </div>

      <div style={{padding:'16px 18px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
        <div>
          <SectionLabel style={{marginBottom:6}}>Problem identified</SectionLabel>
          <p style={{fontSize:13,fontWeight:500,color:C.text,lineHeight:1.5,marginBottom:6}}>
            {analysis.problem || 'Conversion issue detected'}
          </p>
          {analysis.data_insight && (
            <p style={{fontSize:11,color:C.textMuted,lineHeight:1.55}}>{analysis.data_insight}</p>
          )}
        </div>

        <div>
          <SectionLabel style={{marginBottom:6}}>Fix applied</SectionLabel>
          <p style={{fontSize:12,color:C.text,lineHeight:1.5,marginBottom:8}}>
            {analysis.solution || 'Code changes applied'}
          </p>
          {analysis.file_to_edit && (
            <code style={{fontSize:11,color:C.accent,background:C.accentSoft,padding:'3px 8px',borderRadius:5,border:`1px solid ${C.accentMid}`,display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {analysis.file_to_edit}
            </code>
          )}
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <SectionLabel style={{marginBottom:0}}>Expected impact</SectionLabel>
          <div style={{display:'flex',alignItems:'baseline',gap:6}}>
            <span style={{fontFamily:'Instrument Serif,serif',fontSize:32,color:C.green,lineHeight:1}}>
              {analysis.expected_improvement || '+?%'}
            </span>
            <span style={{fontSize:11,color:C.textMuted}}>conversion</span>
          </div>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:10,color:C.textLight}}>Confidence</span>
              <span style={{fontSize:10,fontWeight:500,color:C.text}}>{confNum}%</span>
            </div>
            <div style={{height:4,background:'rgba(26,25,22,0.08)',borderRadius:2}}>
              <div style={{height:'100%',width:`${confNum}%`,background:confNum>75?C.green:confNum>50?C.yellow:C.red,borderRadius:2,transition:'width .5s'}}/>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}>
            <span style={{color:C.textLight}}>Auto-rollback</span>
            <span style={{color:C.textMuted}}>48h if no uplift</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── KPI BAR ──────────────────────────────────────────────────────────────────
function KPIBar({runs, impactMetrics}) {
  const total    = runs.length
  const deployed = runs.filter(r=>r.status==='deployed'||r.status==='approved').length
  const pending  = runs.filter(r=>r.status==='waiting_approval').length
  const rate     = total>0?Math.round((deployed/total)*100):0

  const bounceImprove = impactMetrics.filter(m=>m.metric_type==='bounce_rate'&&m.value_before&&m.value_after)
  const avgDelta = bounceImprove.length>0
    ? Math.round(bounceImprove.reduce((s,m)=>s+(m.value_before-m.value_after),0)/bounceImprove.length)
    : null

  const sparkData = [...runs].slice(0,8).reverse().map(r=>r.status==='deployed'||r.status==='approved'?1:0)

  // FIX #12: proper Date object comparison instead of fragile ISO string comparison
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000)

  const kpis = [
    {
      label:'Total Runs', value:total, sub:`${pending>0?`${pending} awaiting`:'All processed'}`,
      accent:false, sparkData:null,
    },
    {
      label:'Fixes Deployed', value:deployed,
      sub:`+${runs.filter(r=>new Date(r.created_at)>oneWeekAgo&&(r.status==='deployed'||r.status==='approved')).length} this week`,
      accent:true, sparkData,
    },
    {
      label:'Deploy Rate', value:`${rate}%`, sub:rate>=70?'On track':'Needs review',
      accent:false, sparkData:null,
    },
    {
      label:'Avg. Bounce Δ', value:avgDelta!=null?`−${avgDelta}%`:'—', sub:avgDelta!=null?'After agent fixes':'No data yet',
      accent:false, sparkData:null,
    },
  ]

  return (
    <div className="dash-kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
      {kpis.map((k,i)=>(
        <div key={i} className="card-hover fade-up" style={{
          animationDelay:`${i*0.06}s`,
          background:k.accent?C.accentSoft:C.bgCard,
          border:`1px solid ${k.accent?C.accentMid:C.border}`,
          borderRadius:12, padding:'16px 18px',
        }}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}>
            <SectionLabel style={{color:k.accent?C.accent:C.textLight,marginBottom:0}}>{k.label}</SectionLabel>
            {k.sparkData && <Sparkline data={k.sparkData} color={k.accent?C.accent:C.textLight} height={24} width={50}/>}
          </div>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:36,fontWeight:400,color:k.accent?C.accent:C.text,lineHeight:1,marginBottom:4}}>
            {k.value}
          </p>
          <p style={{fontSize:10,color:C.textLight,fontWeight:300}}>{k.sub}</p>
        </div>
      ))}
    </div>
  )
}

// ─── TOP INSIGHTS PANEL ───────────────────────────────────────────────────────
function TopInsights({runs, funnelPages, learnings, impactMetrics}) {
  const deployed = runs.filter(r=>r.status==='deployed'||r.status==='approved')
  const pending  = runs.filter(r=>r.status==='waiting_approval')

  const topDropOff = [...funnelPages].filter(p=>p.drop_off_score>0).sort((a,b)=>b.drop_off_score-a.drop_off_score)[0]

  const bestImpact = [...impactMetrics].filter(m=>m.value_before>m.value_after).sort((a,b)=>(b.value_before-b.value_after)-(a.value_before-a.value_after))[0]
  const bestRun = bestImpact ? runs.find(r=>r.id===bestImpact.run_id) : null

  const avgConvStr = deployed.map(r=>r.analysis_result?.expected_improvement).filter(Boolean)
  const avgConvNum = avgConvStr.length>0
    ? avgConvStr.reduce((s,v)=>{const n=parseFloat(v.replace(/[^0-9.]/g,''));return s+(isNaN(n)?0:n)},0)/avgConvStr.length
    : null

  const positiveLearnings = learnings.filter(l=>l.outcome==='positive')
  const winRate = learnings.length>0?Math.round((positiveLearnings.length/learnings.length)*100):null

  const insights = [
    topDropOff && {
      icon:'⚠️', color:C.yellow, bg:C.yellowSoft, border:C.yellowMid,
      label:'Biggest Drop-off',
      value: topDropOff.page_path,
      sub: `${topDropOff.drop_off_score}% exit rate · ${topDropOff.views_7d||0} views/week`,
      detail: 'Agent will prioritize this page next run',
    },
    bestRun && {
      icon:'📈', color:C.green, bg:C.greenSoft, border:'rgba(30,122,60,0.2)',
      label:'Most Improved',
      value: bestRun.analysis_result?.file_to_edit?.split('/').pop() || 'Last fix',
      sub: `Bounce −${Math.round(bestImpact.value_before-bestImpact.value_after)}% after deployment`,
      detail: timeAgo(bestRun.completed_at),
    },
    pending.length>0 && {
      icon:'🔔', color:C.yellow, bg:C.yellowSoft, border:C.yellowMid,
      label:'Awaiting Review',
      value:`${pending.length} PR${pending.length>1?'s':''}`,
      sub: pending[0]?.analysis_result?.problem?.slice(0,55)||'Fix ready to deploy',
      detail: 'Reply YES or NO on Telegram',
    },
    avgConvNum!=null && {
      icon:'💡', color:C.accent, bg:C.accentSoft, border:C.accentMid,
      label:'Top Recommendation',
      value: deployed[0]?.analysis_result?.problem?.slice(0,35)||'No runs yet',
      sub: `Est. impact: +${Math.round(avgConvNum)}% avg conversion`,
      detail: 'Based on last fix',
    },
    winRate!=null && {
      icon:'🧠', color:C.blue, bg:C.blueSoft, border:C.blueMid,
      label:'Agent Win Rate',
      value:`${winRate}%`,
      sub: `${positiveLearnings.length} of ${learnings.length} changes improved metrics`,
      detail: 'Business DNA learning',
    },
    funnelPages.length>0 && {
      icon:'🗺️', color:C.textMuted, bg:'rgba(26,25,22,0.04)', border:C.border,
      label:'Pages Analyzed',
      value: funnelPages.length,
      sub: `${funnelPages.filter(p=>p.drop_off_score>50).length} high-priority pages`,
      detail: 'Funnel map updated last run',
    },
  ].filter(Boolean)

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
      {insights.map((ins,i)=>(
        <div key={i} className="card-hover fade-up" style={{
          animationDelay:`${i*0.05}s`,
          background:ins.bg, border:`1px solid ${ins.border}`,
          borderRadius:10, padding:'13px 15px',
        }}>
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <span style={{fontSize:16,flexShrink:0}}>{ins.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <SectionLabel style={{color:ins.color,marginBottom:4}}>{ins.label}</SectionLabel>
              <p style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>
                {ins.value}
              </p>
              <p style={{fontSize:11,color:C.textMuted,lineHeight:1.4,marginBottom:4}}>{ins.sub}</p>
              <p style={{fontSize:10,color:C.textLight}}>{ins.detail}</p>
            </div>
          </div>
        </div>
      ))}
      {insights.length===0 && (
        <div style={{gridColumn:'1/-1',padding:'24px',textAlign:'center'}}>
          <p style={{fontSize:13,color:C.textLight}}>Insights will appear after the first agent run.</p>
        </div>
      )}
    </div>
  )
}

// ─── REVENUE IMPACT ESTIMATOR ─────────────────────────────────────────────────
function RevenueEstimator({runs, impactMetrics}) {
  const [monthlyVisitors, setMonthlyVisitors] = useState(5000)
  const [convRate, setConvRate] = useState(3)
  const [avgOrderValue, setAvgOrderValue] = useState(50)

  const deployed = runs.filter(r=>r.status==='deployed'||r.status==='approved')
  const avgImprovementStr = deployed.map(r=>r.analysis_result?.expected_improvement).filter(Boolean)
  const avgImprovementNum = avgImprovementStr.length>0
    ? avgImprovementStr.reduce((s,v)=>{const n=parseFloat(v.replace(/[^0-9.]/g,''));return s+(isNaN(n)?0:n)},0)/avgImprovementStr.length
    : 12

  // FIX #7: clamp to 0 so negative inputs can't produce nonsense revenue numbers
  const safeVisitors = Math.max(0, monthlyVisitors)
  const safeConvRate = Math.max(0, convRate)
  const safeAOV      = Math.max(0, avgOrderValue)

  const baseRevenue     = safeVisitors * (safeConvRate / 100) * safeAOV
  const improvedConvRate = safeConvRate * (1 + avgImprovementNum / 100)
  const improvedRevenue = safeVisitors * (improvedConvRate / 100) * safeAOV
  const delta           = improvedRevenue - baseRevenue

  const inp = {
    background:'rgba(26,25,22,0.04)', border:`1px solid ${C.border}`,
    borderRadius:6, padding:'7px 10px', fontSize:13, color:C.text,
    width:'100%', fontFamily:'DM Sans,sans-serif',
  }

  return (
    <Card style={{padding:'20px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
        <SectionLabel style={{marginBottom:0}}>Revenue Impact Estimator</SectionLabel>
        <span style={{fontSize:10,color:C.textLight,background:'rgba(26,25,22,0.06)',padding:'2px 6px',borderRadius:4}}>
          based on {deployed.length} deployed fixes · avg +{Math.round(avgImprovementNum)}%
        </span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
        <div>
          <label style={{fontSize:10,color:C.textLight,display:'block',marginBottom:5}}>Monthly visitors</label>
          {/* FIX #7: min="0" prevents negative values at the browser level */}
          <input type="number" min="0" value={monthlyVisitors} onChange={e=>setMonthlyVisitors(+e.target.value)} style={inp}/>
        </div>
        <div>
          <label style={{fontSize:10,color:C.textLight,display:'block',marginBottom:5}}>Current conv. rate %</label>
          <input type="number" min="0" step="0.1" value={convRate} onChange={e=>setConvRate(+e.target.value)} style={inp}/>
        </div>
        <div>
          <label style={{fontSize:10,color:C.textLight,display:'block',marginBottom:5}}>Avg. order value (€)</label>
          <input type="number" min="0" value={avgOrderValue} onChange={e=>setAvgOrderValue(+e.target.value)} style={inp}/>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
        <div style={{background:'rgba(26,25,22,0.04)',borderRadius:8,padding:'12px 14px'}}>
          <p style={{fontSize:10,color:C.textLight,marginBottom:4}}>Current revenue</p>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:26,color:C.text,lineHeight:1}}>
            €{Math.round(baseRevenue).toLocaleString()}
          </p>
          <p style={{fontSize:10,color:C.textLight,marginTop:2}}>/month</p>
        </div>
        <div style={{background:C.accentSoft,border:`1px solid ${C.accentMid}`,borderRadius:8,padding:'12px 14px'}}>
          <p style={{fontSize:10,color:C.accent,marginBottom:4}}>After Velyr fixes</p>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:26,color:C.accent,lineHeight:1}}>
            €{Math.round(improvedRevenue).toLocaleString()}
          </p>
          <p style={{fontSize:10,color:C.accent,marginTop:2}}>/month</p>
        </div>
        <div style={{background:C.greenSoft,border:`1px solid rgba(30,122,60,0.2)`,borderRadius:8,padding:'12px 14px'}}>
          <p style={{fontSize:10,color:C.green,marginBottom:4}}>Estimated uplift</p>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:26,color:C.green,lineHeight:1}}>
            +€{Math.round(delta).toLocaleString()}
          </p>
          <p style={{fontSize:10,color:C.green,marginTop:2}}>/month</p>
        </div>
      </div>
    </Card>
  )
}

// ─── AGENT STATUS SIDEBAR ─────────────────────────────────────────────────────
function AgentSidebar({subscription, runs, onTogglePause, actionLoading, onSelectRun}) {
  const isPaused  = subscription?.status==='paused'
  const activeRun = runs.find(r=>r.status==='running')
  const isRunning = !!activeRun
  const lastRun   = runs[0]||null
  const pending   = runs.filter(r=>r.status==='waiting_approval')

  // FIX #4: memoize so nextMonday9am() is not recomputed on every render cycle
  const target = useMemo(() => nextMonday9am(), [])
  const countdown = useCountdown(target)
  const stepIdx   = isRunning ? deriveAgentStep(activeRun) : (lastRun ? deriveAgentStep(lastRun) : -1)

  const now = new Date()
  const weekMs = 7*24*3600000
  const weekProgress = Math.min(100,Math.max(0,((now-(new Date(target.getTime()-weekMs)))/weekMs)*100))

  const deployed = runs.filter(r=>r.status==='deployed'||r.status==='approved').length
  const total    = runs.length
  const rate     = total>0?Math.round((deployed/total)*100):0

  return (
    <div className="dash-ctx-sidebar" style={{width:272,flexShrink:0,position:'sticky',top:20,alignSelf:'flex-start',display:'flex',flexDirection:'column',gap:10}}>

      <Card style={{overflow:'hidden'}}>
        <div style={{
          padding:'12px 16px',
          background: isPaused?C.yellowSoft:isRunning?C.blueSoft:C.accentSoft,
          borderBottom:`1px solid ${isPaused?C.yellowMid:isRunning?C.blueMid:C.accentMid}`,
          display:'flex',alignItems:'center',justifyContent:'space-between',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className={isRunning?'pulse-dot':''} style={{
              width:7,height:7,borderRadius:'50%',display:'inline-block',
              background:isPaused?C.yellow:isRunning?C.blue:C.accent,
            }}/>
            <span style={{fontSize:10,letterSpacing:'.1em',textTransform:'uppercase',fontWeight:500,color:isPaused?C.yellow:isRunning?C.blue:C.accent}}>
              {isPaused?'Paused':isRunning?'Running now':'Idle'}
            </span>
          </div>
          <span style={{fontSize:10,color:C.textLight,fontFamily:'DM Mono,monospace'}}>Growth Agent</span>
        </div>

        <div style={{padding:'14px 16px',borderBottom:`1px solid ${C.border}`}}>
          {isPaused ? (
            <p style={{fontSize:12,color:C.textMuted,lineHeight:1.6}}>Agent is paused. Resume to run again next Monday.</p>
          ) : isRunning ? (
            <div>
              <SectionLabel style={{marginBottom:8}}>Currently running</SectionLabel>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                <Spinner size={13}/>
                <p style={{fontSize:13,color:C.text,fontWeight:500}}>{AGENT_STEPS[stepIdx]?.label||'Analyzing…'}</p>
              </div>
              <p style={{fontSize:11,color:C.textMuted}}>{AGENT_STEPS[stepIdx]?.desc||''}</p>
            </div>
          ) : (
            <div>
              <SectionLabel style={{marginBottom:8}}>Next run in</SectionLabel>
              <p style={{fontFamily:'DM Mono,monospace',fontSize:22,color:C.text,letterSpacing:'.02em',marginBottom:10}}>{countdown.str}</p>
              <div style={{height:2,background:'rgba(42,92,69,0.1)',borderRadius:2,marginBottom:5}}>
                <div style={{height:'100%',width:`${weekProgress}%`,background:C.accent,borderRadius:2,transition:'width 1s'}}/>
              </div>
              <p style={{fontSize:10,color:C.textLight}}>Every Monday · 9:00 am</p>
            </div>
          )}
        </div>

        {lastRun && (
          <div style={{padding:'13px 16px',borderBottom:`1px solid ${C.border}`}}>
            <SectionLabel style={{marginBottom:11}}>{isRunning?'Live steps':'Last run · '+timeAgo(lastRun.created_at)}</SectionLabel>
            <div style={{display:'flex',flexDirection:'column',gap:0}}>
              {AGENT_STEPS.map((step,i)=>{
                const done = i<stepIdx
                const current = i===stepIdx
                const failed = (lastRun.status==='failed')&&i===stepIdx
                return (
                  <div key={step.id} style={{
                    display:'flex',gap:9,alignItems:'flex-start',
                    paddingBottom:i<AGENT_STEPS.length-1?8:0,
                    position:'relative',
                  }}>
                    {i<AGENT_STEPS.length-1&&(
                      <div style={{position:'absolute',left:7,top:15,width:1,height:'calc(100% - 4px)',background:done?C.accent:C.border,opacity:0.3,zIndex:0}}/>
                    )}
                    <div style={{
                      width:15,height:15,borderRadius:'50%',flexShrink:0,zIndex:1,
                      background:failed?C.red:current?C.blue:done?C.accent:'rgba(26,25,22,0.07)',
                      border:`1px solid ${failed?C.red:current?C.blue:done?C.accent:C.border}`,
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:8,color:'#fff',
                      animation:current?'pulse 2s ease infinite':'none',
                    }}>
                      {done&&!current?'✓':''}
                    </div>
                    <p style={{
                      fontSize:11,paddingTop:1,
                      color:failed?C.red:current?C.blue:done?C.text:C.textLight,
                      fontWeight:current?500:300,
                    }}>{step.label}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {pending.length>0&&(
          <div style={{padding:'12px 16px',borderBottom:`1px solid ${C.border}`,background:C.yellowSoft}}>
            <SectionLabel style={{color:C.yellow,marginBottom:8}}>🔔 {pending.length} awaiting approval</SectionLabel>
            {pending.slice(0,2).map(run=>(
              <div key={run.id} onClick={()=>onSelectRun(run)} style={{cursor:'pointer',padding:'6px 0',borderBottom:`1px solid rgba(196,125,14,0.1)`}}>
                <p style={{fontSize:11,color:C.text,fontWeight:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:1}}>
                  {run.analysis_result?.problem||'Fix pending review'}
                </p>
                <p style={{fontSize:10,color:C.textMuted,fontFamily:'DM Mono,monospace'}}>
                  {run.pr_url?`PR #${run.pr_number}`:''} · {timeAgo(run.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}

        <div style={{padding:'12px 16px'}}>
          <button className="btn" onClick={onTogglePause} disabled={actionLoading} style={{
            width:'100%',padding:'9px',borderRadius:7,fontSize:12,
            background:isPaused?C.accent:'transparent',
            color:isPaused?'#fff':C.textMuted,
            border:`1px solid ${isPaused?C.accent:C.border}`,
            opacity:actionLoading?0.5:1,cursor:actionLoading?'not-allowed':'pointer',
          }}>
            {actionLoading?'…':isPaused?'▶ Resume Agent':'⏸ Pause Agent'}
          </button>
        </div>
      </Card>

      <Card style={{padding:'14px 16px'}}>
        <SectionLabel style={{marginBottom:12}}>Performance</SectionLabel>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          {[
            {label:'Deploy rate',value:`${rate}%`,color:C.green},
            {label:'Fixes merged',value:deployed,color:C.accent},
            {label:'Awaiting',value:pending.length,color:pending.length>0?C.yellow:C.textLight},
            {label:'Failed/rejected',value:runs.filter(r=>r.status==='failed'||r.status==='rejected').length,color:C.textLight},
          ].map((s,i)=>(
            <div key={i}>
              <p style={{fontFamily:'Instrument Serif,serif',fontSize:24,fontWeight:400,color:s.color,lineHeight:1}}>{s.value}</p>
              <p style={{fontSize:10,color:C.textLight,marginTop:3}}>{s.label}</p>
            </div>
          ))}
        </div>
        {runs.length>0&&(
          <>
            <SectionLabel style={{marginBottom:6}}>Run history</SectionLabel>
            <RunHistoryBar runs={runs}/>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:3}}>
              <span style={{fontSize:9,color:C.textLight}}>oldest</span>
              <span style={{fontSize:9,color:C.textLight}}>latest</span>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ─── OVERVIEW PAGE ────────────────────────────────────────────────────────────
function OverviewPage({runs, subscription, funnelPages, learnings, impactMetrics, onSelectRun, onTogglePause, actionLoading}) {
  const activeRun = runs.find(r=>r.status==='running')
  const pendingRun = runs.find(r=>r.status==='waiting_approval')

  return (
    <div className="dash-overview-row" style={{display:'flex',gap:16,alignItems:'flex-start'}}>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:14}}>

        {pendingRun && <div className="fade-up"><PRMissionControl run={pendingRun}/></div>}

        <div className="fade-up" style={{animationDelay:'.05s'}}>
          <KPIBar runs={runs} impactMetrics={impactMetrics}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
          <Card className="fade-up" style={{padding:'16px 18px',animationDelay:'.1s'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
              <div>
                <SectionLabel style={{marginBottom:2}}>
                  {activeRun?'🟢 Agent is running':'Activity Stream'}
                </SectionLabel>
                <p style={{fontSize:11,color:C.textLight}}>
                  {activeRun?'Real-time progress':'Last actions taken'}
                </p>
              </div>
              {activeRun&&<div style={{display:'flex',gap:6,alignItems:'center'}}>
                <Spinner size={13}/>
                <span style={{fontSize:10,color:C.blue}}>Live</span>
              </div>}
            </div>
            <LiveActivityStream runs={runs} activeRun={activeRun}/>
          </Card>

          <div className="fade-up" style={{animationDelay:'.12s',display:'flex',flexDirection:'column',gap:10}}>
            <SectionLabel>Top Insights</SectionLabel>
            <TopInsights runs={runs} funnelPages={funnelPages} learnings={learnings} impactMetrics={impactMetrics}/>
          </div>
        </div>

        <div className="fade-up" style={{animationDelay:'.15s'}}>
          <RevenueEstimator runs={runs} impactMetrics={impactMetrics}/>
        </div>

        <AgentLearningStrip learnings={learnings}/>
      </div>

      <AgentSidebar
        subscription={subscription}
        runs={runs}
        onTogglePause={onTogglePause}
        actionLoading={actionLoading}
        onSelectRun={onSelectRun}
      />
    </div>
  )
}

// ─── AGENT LEARNING STRIP ────────────────────────────────────────────────────
function AgentLearningStrip({learnings}) {
  // FIX #13: early return BEFORE any derived calculations to avoid NaN / division-by-zero
  if (learnings.length===0) return null

  const wins    = learnings.filter(l=>l.outcome==='positive').length
  const losses  = learnings.filter(l=>l.outcome==='negative').length
  const rate    = Math.round((wins/learnings.length)*100)
  const posAvgDelta = learnings.filter(l=>l.outcome==='positive'&&l.delta)
  const avgLift = posAvgDelta.length>0?Math.round(posAvgDelta.reduce((s,l)=>s+(l.delta||0),0)/posAvgDelta.length):null

  return (
    <Card className="fade-up" style={{padding:'16px 18px',borderColor:C.accentMid,background:C.accentSoft}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <span style={{fontSize:18}}>🧠</span>
        <div>
          <SectionLabel style={{color:C.accent,marginBottom:1}}>Business DNA · Agent is learning</SectionLabel>
          <p style={{fontSize:11,color:C.textMuted}}>Every fix makes the agent smarter for your site</p>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
        <div>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:28,color:C.accent,lineHeight:1}}>{learnings.length}</p>
          <p style={{fontSize:10,color:C.textMuted,marginTop:3}}>total learnings</p>
        </div>
        <div>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:28,color:C.green,lineHeight:1}}>{rate}%</p>
          <p style={{fontSize:10,color:C.textMuted,marginTop:3}}>win rate</p>
        </div>
        <div>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:28,color:C.green,lineHeight:1}}>{avgLift!=null?`+${avgLift}%`:'—'}</p>
          <p style={{fontSize:10,color:C.textMuted,marginTop:3}}>avg improvement on wins</p>
        </div>
        <div>
          <p style={{fontFamily:'Instrument Serif,serif',fontSize:28,color:C.textMuted,lineHeight:1}}>{losses}</p>
          <p style={{fontSize:10,color:C.textMuted,marginTop:3}}>rolled back / avoided</p>
        </div>
      </div>
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:6}}>
        {learnings.slice(0,3).map((l,i)=>(
          <div key={l.id||i} style={{display:'flex',alignItems:'center',gap:10,fontSize:11}}>
            <span style={{color:l.outcome==='positive'?C.green:C.red,flexShrink:0}}>{l.outcome==='positive'?'✓':'✕'}</span>
            <span style={{color:C.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.summary}</span>
            {l.delta&&<span style={{color:l.outcome==='positive'?C.green:C.red,flexShrink:0,fontWeight:500}}>{l.outcome==='positive'?'+':''}{l.delta}%</span>}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── RUNS PAGE ────────────────────────────────────────────────────────────────
function RunsPage({runs, loading, onSelect}) {
  const [filter, setFilter] = useState('all')
  const filters = ['all','deployed','waiting_approval','failed','rejected','rolled_back']

  const filtered = filter==='all'?runs:runs.filter(r=>r.status===filter)

  function weekLabel(iso) {
    const d=new Date(iso),now=new Date(),diff=Math.floor((now-d)/86400000)
    if(diff<7)return'This week'; if(diff<14)return'Last week'
    return d.toLocaleDateString('en-GB',{month:'long',year:'numeric'})
  }
  const grouped=[]; let cur=null
  filtered.forEach(run=>{
    const lbl=weekLabel(run.created_at)
    if(!cur||cur.label!==lbl){cur={label:lbl,runs:[]}; grouped.push(cur)}
    cur.runs.push(run)
  })

  return (
    <Card style={{overflow:'hidden'}}>
      <div style={{padding:'14px 18px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <div>
          <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:1}}>Activity Log</p>
          <p style={{fontSize:11,color:C.textLight}}>Click any run for full details</p>
        </div>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          {filters.map(f=>(
            <button key={f} className="btn" onClick={()=>setFilter(f)} style={{
              background:filter===f?C.text:'transparent',
              color:filter===f?C.bg:C.textMuted,
              border:`1px solid ${filter===f?C.text:C.border}`,
              borderRadius:5, padding:'3px 9px', fontSize:10,
              fontFamily:'DM Sans,sans-serif',fontWeight:filter===f?500:400,
              textTransform:'capitalize',
            }}>
              {f==='all'?'All':STATUS[f]?.label||f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{padding:'48px',display:'flex',justifyContent:'center'}}><Spinner/></div>
      ) : filtered.length===0 ? (
        <div style={{padding:'48px',textAlign:'center'}}>
          <p style={{fontSize:13,color:C.textLight}}>{filter==='all'?'No runs yet.':'No runs with this filter.'}</p>
        </div>
      ) : grouped.map((group,gi)=>(
        <div key={gi}>
          <div style={{padding:'10px 18px 5px',display:'flex',alignItems:'center',gap:10,background:'rgba(26,25,22,0.02)'}}>
            <span style={{fontSize:10,letterSpacing:'.1em',textTransform:'uppercase',color:C.textLight,fontWeight:500,whiteSpace:'nowrap'}}>{group.label}</span>
            <div style={{flex:1,height:1,background:C.border}}/>
            <span style={{fontSize:10,color:C.textLight}}>{group.runs.length} run{group.runs.length!==1?'s':''}</span>
          </div>
          {group.runs.map((run,i)=>{
            const analysis=run.analysis_result||{}
            const s=STATUS[run.status]||STATUS.pending
            const bounceDelta = (run.bounce_rate_before != null && run.bounce_rate_after != null)
              ? run.bounce_rate_after - run.bounce_rate_before : null
            // A/B testing is vestigial (no cron creates A/B runs); kept only so
            // historical run_type='ab_test' rows still render. No badge is shown.
            const hasAB        = !!run.ab_test_variants
            const hasCompetitor= Array.isArray(run.competitor_changes) && run.competitor_changes.length > 0
            return (
              <div key={run.id} className="run-row fade-up" onClick={()=>onSelect(run)}
                style={{
                  animationDelay:`${(gi*4+i)*0.03}s`,
                  display:'flex',gap:0,background:'#fff',
                  borderBottom:i<group.runs.length-1?`1px solid ${C.border}`:'none',
                }}
              >
                <div style={{width:40,display:'flex',flexDirection:'column',alignItems:'center',paddingTop:18,flexShrink:0,position:'relative'}}>
                  {i<group.runs.length-1&&(
                    <div style={{position:'absolute',top:28,bottom:0,left:'50%',width:1,background:C.border,transform:'translateX(-50%)'}}/>
                  )}
                  <div style={{
                    width:9,height:9,borderRadius:'50%',zIndex:1,
                    background:s.dot,border:`2px solid #fff`,boxShadow:`0 0 0 1.5px ${s.dot}44`,
                    animation:run.status==='running'?'pulse 2s ease infinite':'none',
                  }}/>
                </div>
                {run.screenshot_before && (
                  <img src={run.screenshot_before} alt="Before"
                    style={{ width:80, height:50, objectFit:'cover', borderRadius:6, border:`1px solid ${C.border}`, marginTop:14, marginRight:12, flexShrink:0 }} />
                )}
                <div style={{flex:1,padding:'14px 18px 14px 0',minWidth:0}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,marginBottom:5}}>
                    <p style={{fontSize:13,fontWeight:400,color:C.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {analysis.problem||'Analysis pending…'}
                    </p>
                    <StatusBadge status={run.status} small/>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:5}}>
                    {hasCompetitor && (
                      <span style={{fontSize:10,color:C.yellow,background:C.yellowSoft,border:`1px solid ${C.yellowMid}`,padding:'1px 7px',borderRadius:4,fontWeight:500,letterSpacing:'.04em',textTransform:'uppercase'}}>
                        ⚠ Competitor change
                      </span>
                    )}
                    {bounceDelta != null && (
                      <span style={{fontSize:10, color: bounceDelta < 0 ? C.green : bounceDelta > 0 ? C.red : C.textLight, fontWeight:500}}>
                        Bounce {run.bounce_rate_before}% → {run.bounce_rate_after}% {bounceDelta < 0 ? '↓' : bounceDelta > 0 ? '↑' : '→'}
                      </span>
                    )}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                    {analysis.file_to_edit&&(
                      <code style={{fontSize:10,color:C.accent,background:C.accentSoft,padding:'1px 6px',borderRadius:4,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'inline-block'}}>
                        {analysis.file_to_edit.split('/').pop()}
                      </code>
                    )}
                    {analysis.expected_improvement&&(
                      <span style={{fontSize:10,color:C.green}}>↑ {analysis.expected_improvement}</span>
                    )}
                    {run.pr_url&&(
                      <a href={run.pr_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:10,color:C.accent,textDecoration:'none'}}>
                        PR #{run.pr_number} ↗
                      </a>
                    )}
                    <span style={{fontSize:10,color:C.textLight,marginLeft:'auto',whiteSpace:'nowrap'}}>{fmt(run.created_at)}</span>
                  </div>
                  {analysis.data_insight&&(
                    <p style={{fontSize:11,color:C.textMuted,marginTop:5,lineHeight:1.5,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
                      {analysis.data_insight}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </Card>
  )
}

// ─── INSIGHTS PAGE ────────────────────────────────────────────────────────────
function InsightsPage({runs, impactMetrics, learnings, funnelPages}) {
  const deployed = runs.filter(r=>r.status==='deployed'||r.status==='approved')

  const impactData = impactMetrics.map(m=>{
    const run = runs.find(r=>r.id===m.run_id)
    return {...m, run}
  }).filter(m=>m.run&&m.value_before&&m.value_after)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>

      <RevenueEstimator runs={runs} impactMetrics={impactMetrics}/>

      {impactData.length>0&&(
        <Card style={{padding:'16px 18px'}}>
          <SectionLabel style={{marginBottom:14}}>Before / After Impact</SectionLabel>
          <div style={{display:'flex',flexDirection:'column',gap:0}}>
            {impactData.map((m,i)=>{
              const improvement = m.value_before - m.value_after
              const isGood = improvement > 0
              return (
                <div key={m.id} style={{
                  display:'grid',gridTemplateColumns:'1fr auto auto',gap:16,alignItems:'center',
                  padding:'12px 0',borderBottom:i<impactData.length-1?`1px solid ${C.border}`:'none',
                }}>
                  <div>
                    <p style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:2}}>
                      {m.run?.analysis_result?.problem||'Change'}
                    </p>
                    <p style={{fontSize:10,color:C.textMuted}}>
                      {m.metric_type==='bounce_rate'?'Bounce rate':m.metric_type} · {timeAgo(m.measured_at)}
                    </p>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10,fontSize:12}}>
                    <span style={{color:C.textMuted}}>{m.value_before}%</span>
                    <span style={{color:C.textLight}}>→</span>
                    <span style={{color:isGood?C.green:C.red,fontWeight:500}}>{m.value_after}%</span>
                  </div>
                  <span style={{
                    fontSize:12,fontWeight:500,
                    color:isGood?C.green:C.red,
                    background:isGood?C.greenSoft:C.redSoft,
                    border:`1px solid ${isGood?'rgba(30,122,60,0.2)':C.redMid}`,
                    borderRadius:5,padding:'3px 8px',whiteSpace:'nowrap',
                  }}>
                    {isGood?'−':'+'}{ Math.abs(Math.round(improvement))}%
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <AgentLearningStrip learnings={learnings}/>

      {learnings.length>0&&(
        <Card style={{overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:`1px solid ${C.border}`}}>
            <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:1}}>Agent Learnings</p>
            <p style={{fontSize:11,color:C.textLight}}>Every outcome improves future decisions</p>
          </div>
          {learnings.map((l,i)=>(
            <div key={l.id||i} style={{
              display:'flex',alignItems:'flex-start',gap:12,padding:'12px 18px',
              borderBottom:i<learnings.length-1?`1px solid ${C.border}`:'none',
              background:l.outcome==='positive'?C.greenSoft:C.redSoft,
            }}>
              <span style={{fontSize:14,color:l.outcome==='positive'?C.green:C.red,flexShrink:0,paddingTop:1}}>
                {l.outcome==='positive'?'✓':'✕'}
              </span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{fontSize:12,color:C.text,marginBottom:2}}>{l.summary}</p>
                <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:10,color:C.textMuted}}>{l.change_type}</span>
                  {l.delta&&<span style={{fontSize:10,color:l.outcome==='positive'?C.green:C.red,fontWeight:500}}>{l.outcome==='positive'?'+':''}{l.delta}% {l.metric_type}</span>}
                  <span style={{fontSize:10,color:C.textLight}}>{l.confidence} confidence</span>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

// ─── FUNNEL PAGE ──────────────────────────────────────────────────────────────
// FIX #6: removed internal Supabase fetch — data already fetched by parent fetchData(),
//         passed via props to avoid double network requests and state inconsistency
function FunnelPage({funnelPages, loading}) {
  if(loading) return <div style={{padding:'48px',display:'flex',justifyContent:'center'}}><Spinner/></div>
  if(!funnelPages.length) return (
    <div style={{padding:'40px',textAlign:'center'}}>
      <p style={{fontSize:24,marginBottom:10}}>🗺️</p>
      <p style={{fontSize:13,color:C.text,marginBottom:4}}>No funnel data yet</p>
      <p style={{fontSize:11,color:C.textLight}}>Funnel analysis runs automatically every Monday.</p>
    </div>
  )

  const biggestOpp = [...funnelPages].filter(p=>p.drop_off_score>0).sort((a,b)=>b.drop_off_score-a.drop_off_score)[0]
  const maxScore = Math.max(...funnelPages.map(p=>p.drop_off_score||0),1)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {biggestOpp&&(
        <div style={{background:C.yellowSoft,border:`1px solid ${C.yellowMid}`,borderRadius:10,padding:'14px 18px'}}>
          <SectionLabel style={{color:C.yellow,marginBottom:6}}>⚠️ Biggest Opportunity</SectionLabel>
          <p style={{fontSize:14,color:C.text,fontWeight:500,marginBottom:3}}>{PAGE_TYPE_EMOJI[biggestOpp.page_type]} {biggestOpp.page_path}</p>
          <p style={{fontSize:11,color:C.textMuted}}>{biggestOpp.drop_off_score}% drop-off · {biggestOpp.views_7d||0} views/week</p>
          {biggestOpp.ai_insight&&<p style={{fontSize:11,color:C.textMuted,marginTop:6,fontStyle:'italic'}}>{biggestOpp.ai_insight}</p>}
        </div>
      )}

      <Card style={{overflow:'hidden'}}>
        <div style={{padding:'12px 18px',borderBottom:`1px solid ${C.border}`}}>
          <p style={{fontSize:12,fontWeight:500,color:C.text}}>{funnelPages.length} pages in funnel</p>
        </div>
        {funnelPages.map((page,i)=>{
          const dropColor = page.drop_off_score>=60?C.red:page.drop_off_score>=30?C.yellow:C.green
          const barW = Math.round(((page.drop_off_score||0)/maxScore)*100)
          return (
            <div key={page.id} style={{padding:'12px 18px',borderBottom:i<funnelPages.length-1?`1px solid ${C.border}`:'none'}}>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
                <span style={{fontSize:15,flexShrink:0}}>{PAGE_TYPE_EMOJI[page.page_type]||'📄'}</span>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:12,color:C.text,fontFamily:'DM Mono,monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{page.page_path}</p>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  {page.views_7d>0&&<p style={{fontSize:11,color:C.text,fontWeight:400}}>{page.views_7d} views</p>}
                  {page.drop_off_score>0&&<p style={{fontSize:10,color:dropColor,marginTop:1}}>{page.drop_off_score}% drop-off</p>}
                </div>
              </div>
              {page.drop_off_score>0&&(
                <div style={{height:3,background:'rgba(26,25,22,0.07)',borderRadius:2}}>
                  <div style={{height:'100%',width:`${barW}%`,background:dropColor,borderRadius:2,opacity:0.6}}/>
                </div>
              )}
            </div>
          )
        })}
      </Card>
    </div>
  )
}

// ─── NETWORK PAGE — helpers ───────────────────────────────────────────────────
// clusterFromPath / labelFromNode / hubDomainFromUrl / buildNetworkData now live
// in ../lib/siteNetworkData.js (shared with the onboarding first-connect finale).

// Humanized node status copy (mirrors SiteNetwork's STATUS_COPY) for the panel.
const NODE_STATUS_COPY = {
  neutral:         'Watching',
  tracked:         'Tracked',
  'fix-in-flight': 'Fix in progress',
  optimized:       'Optimized',
  problem:         'Regression',
}
const NODE_STATUS_DOT = {
  neutral:         '#a8a39a',
  tracked:         '#ccc8c3',
  'fix-in-flight': '#c2a45f',
  optimized:       '#2f6b4f',
  problem:         '#c2573d',
}

// ─── NETWORK PAGE ─────────────────────────────────────────────────────────────
function NetworkPage({ runs, siteNetwork, websiteUrl }) {
  const [selectedNode, setSelectedNode] = useState(null)
  const activeRun = runs.find(r => r.status === 'running') || null
  const isRunning = !!activeRun
  const lastRun   = runs[0] || null

  // Most-recent active run drives fix-in-flight + the panel's PR link.
  // runs is created_at desc; running takes priority over waiting_approval.
  const inflightRun = runs.find(r => r.status === 'running')
                   || runs.find(r => r.status === 'waiting_approval')
                   || null

  // Status line
  let statusText, statusColor
  if (isRunning) {
    const stepId    = activeRun.current_step && CURRENT_STEP_TO_ID[activeRun.current_step]
    const stepLabel = stepId
      ? (AGENT_STEPS.find(s => s.id === stepId)?.label || activeRun.current_step)
      : 'Running'
    statusText  = `Running now · ${stepLabel.toLowerCase()}`
    statusColor = C.blue
  } else if (lastRun) {
    const next = nextMonday9am()
    const nextLabel = next.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    statusText  = `Last run ${fmt(lastRun.created_at)} · next Mon ${nextLabel}`
    statusColor = C.textLight
  } else {
    statusText  = 'No runs yet'
    statusColor = C.textLight
  }

  // Hub label (deploy-subdomain aware) + shared transform → SiteNetworkData.
  const domain = hubDomainFromUrl(websiteUrl)
  const networkData = buildNetworkData(siteNetwork, { domain, inflightRun })

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        {isRunning && (
          <span className="pulse-dot" style={{
            width: 6, height: 6, borderRadius: '50%',
            background: C.blue, display: 'inline-block', flexShrink: 0,
          }} />
        )}
        <span style={{ fontSize: 11, color: statusColor, fontWeight: isRunning ? 500 : 400 }}>
          {statusText}
        </span>
      </div>

      {/* Graph card */}
      <div style={{
        position: 'relative',
        background: C.bgCard, borderRadius: 12,
        border: `1px solid ${C.border}`, overflow: 'hidden',
      }}>
        {networkData ? (
          <SiteNetwork
            data={networkData}
            onNodeClick={(n) => { if (!n.isHub) setSelectedNode(n) }}
            fonts={{
              sans:  "'DM Sans', sans-serif",
              serif: "'Instrument Serif', serif",
              mono:  "'DM Mono', monospace",
            }}
            style={{ height: 'calc(100vh - 150px)', minHeight: 360 }}
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '64px 24px', textAlign: 'center',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: C.accentSoft, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16, fontSize: 20, color: C.accent,
            }}>◎</div>
            <p style={{
              fontFamily: 'Instrument Serif, serif', fontWeight: 400,
              fontSize: 20, color: C.text, marginBottom: 8,
            }}>
              {isRunning ? 'Mapping your site…' : 'Your network graph appears here'}
            </p>
            <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.7, maxWidth: 340 }}>
              {isRunning
                ? 'The agent is building an import graph of your repository. Check back in a few minutes.'
                : "Your first network graph will appear after Monday's run. The agent maps every route, component, and relationship in your codebase."
              }
            </p>
          </div>
        )}

        {/* Slide-in node detail panel */}
        {selectedNode && (() => {
          const prUrl = selectedNode.status === 'fix-in-flight' ? inflightRun?.pr_url : null
          const prNum = inflightRun?.pr_number
          return (
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 320, maxWidth: '85%',
              background: C.bgCard, borderLeft: `1px solid ${C.border}`,
              boxShadow: '-8px 0 28px rgba(26,25,22,0.08)', zIndex: 20,
              padding: '20px 22px', overflowY: 'auto',
              animation: 'slideInRight .22s ease both',
            }}>
              <style>{`@keyframes slideInRight { from { opacity:0; transform:translateX(16px) } to { opacity:1; transform:none } }`}</style>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <p style={{ fontFamily: 'Instrument Serif, serif', fontWeight: 400, fontSize: 22, color: C.text, lineHeight: 1.15 }}>
                  {selectedNode.label}
                </p>
                <button className="btn" onClick={() => setSelectedNode(null)} style={{
                  background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
                  width: 26, height: 26, fontSize: 14, color: C.textMuted, flexShrink: 0, lineHeight: 1,
                }}>×</button>
              </div>

              <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: C.textMuted, wordBreak: 'break-all', marginTop: 6, marginBottom: 16 }}>
                {selectedNode.id}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: prUrl ? 18 : 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: NODE_STATUS_DOT[selectedNode.status], flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: C.text }}>{NODE_STATUS_COPY[selectedNode.status] || 'Watching'}</span>
              </div>

              {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  background: C.yellowSoft, border: `1px solid ${C.yellowMid}`, borderRadius: 8,
                  padding: '9px 13px', fontSize: 12, color: C.yellow, fontWeight: 500, textDecoration: 'none',
                }}>
                  View open PR{prNum ? ` #${prNum}` : ''} →
                </a>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ─── GUARDRAILS PAGE ──────────────────────────────────────────────────────────
function GuardrailsPage({subscriptionId}) {
  const [saving,setSaving]=useState(false), [saved,setSaved]=useState(false)
  const [tone,setTone]=useState('')
  const [forbidden,setForbidden]=useState([]), [forbInput,setForbInput]=useState('')
  const [protected_,setProtected]=useState([]), [protInput,setProtInput]=useState('')
  const [customRules,setCustomRules]=useState('')

  useEffect(()=>{
    if(!subscriptionId)return
    supabase.from('agent_brand_guardrails').select('*').eq('subscription_id',subscriptionId).single()
      .then(({data})=>{
        if(data){setTone(data.tone||'');setForbidden(data.forbidden_patterns||[]);setProtected(data.protected_elements||[]);setCustomRules(data.custom_rules||'')}
      })
  },[subscriptionId])

  function addTag(list,setList,input,setInput){const v=input.trim();if(v&&!list.includes(v))setList([...list,v]);setInput('')}
  function removeTag(list,setList,val){setList(list.filter(v=>v!==val))}

  async function handleSave(){
    setSaving(true)
    await supabase.from('agent_brand_guardrails').upsert({subscription_id:subscriptionId,tone:tone||null,forbidden_patterns:forbidden,protected_elements:protected_,custom_rules:customRules||null,updated_at:new Date().toISOString()},{onConflict:'subscription_id'})
    setSaving(false);setSaved(true);setTimeout(()=>setSaved(false),2500)
  }

  const inp = {width:'100%',background:'rgba(26,25,22,0.04)',border:`1px solid ${C.border}`,borderRadius:7,padding:'9px 11px',fontSize:13,fontFamily:'DM Sans,sans-serif',color:C.text}
  const lbl = {fontSize:10,letterSpacing:'.08em',textTransform:'uppercase',color:C.textLight,fontWeight:500,display:'block',marginBottom:7}

  return (
    <Card style={{padding:'22px'}}>
      <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7,marginBottom:20}}>
        These rules are enforced on every run — the agent will not make changes that violate them.
      </p>
      <div style={{display:'flex',flexDirection:'column',gap:18}}>
        <div>
          <label style={lbl}>Tone of voice</label>
          <input value={tone} onChange={e=>setTone(e.target.value)} placeholder='"friendly but direct", "professional, no fluff"' style={inp}/>
        </div>
        {[
          {label:'Never do these',list:forbidden,setList:setForbidden,input:forbInput,setInput:setForbInput,placeholder:'"clickbait headlines"'},
          {label:'Never change these',list:protected_,setList:setProtected,input:protInput,setInput:setProtInput,placeholder:'"brand colors"'},
        ].map(({label,list,setList,input,setInput,placeholder})=>(
          <div key={label}>
            <label style={lbl}>{label}</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
              {list.map(tag=>(
                <span key={tag} style={{display:'inline-flex',alignItems:'center',gap:5,background:'rgba(26,25,22,0.06)',border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 9px',fontSize:12}}>
                  {tag}<span className="tag-remove" onClick={()=>removeTag(list,setList,tag)}>×</span>
                </span>
              ))}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTag(list,setList,input,setInput)} placeholder={`e.g. ${placeholder} — press Enter`} style={{...inp,flex:1}}/>
              <button className="btn" onClick={()=>addTag(list,setList,input,setInput)} style={{background:C.text,color:C.bg,borderRadius:7,padding:'9px 13px',fontSize:13,fontFamily:'DM Sans,sans-serif'}}>Add</button>
            </div>
          </div>
        ))}
        <div>
          <label style={lbl}>Additional rules</label>
          <textarea value={customRules} onChange={e=>setCustomRules(e.target.value)} placeholder="Any other instructions for the agent..." rows={3} style={{...inp,resize:'vertical',lineHeight:1.6}}/>
        </div>
        <button className="btn" onClick={handleSave} disabled={saving} style={{
          background:saved?C.green:C.accent,color:'#fff',borderRadius:8,
          padding:'12px',fontSize:14,fontFamily:'DM Sans,sans-serif',fontWeight:500,
          opacity:saving?0.7:1,transition:'background .25s',
        }}>
          {saving?'Saving…':saved?'✓ Saved':'Save Guardrails'}
        </button>
      </div>
    </Card>
  )
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
// ─── BUSINESS DNA PAGE (Part 5) ──────────────────────────────────────────────
function DNAPage({ subscriptionId }) {
  const [dna, setDna]               = useState([])
  const [loading, setLoading]       = useState(true)
  const [showPlaybook, setShowPlaybook] = useState(false)
  const [playbook, setPlaybook]     = useState(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState(null)
  const [copied, setCopied]         = useState(false)

  useEffect(() => {
    if (!subscriptionId) return
    setLoading(true)
    supabase.from('agent_business_dna')
      .select('id, fix_type, outcome, notes, created_at, run_id')
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setDna(data || []); setLoading(false) })
  }, [subscriptionId])

  const grouped = useMemo(() => {
    const out = { success: {}, rollback: {}, pending: {} }
    for (const d of dna) {
      if (!out[d.outcome]) continue
      if (!out[d.outcome][d.fix_type]) out[d.outcome][d.fix_type] = []
      out[d.outcome][d.fix_type].push(d)
    }
    return out
  }, [dna])

  async function generatePlaybook() {
    setGenerating(true); setGenError(null); setShowPlaybook(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/agent/run?action=export-dna', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.playbook) setPlaybook(data.playbook)
      else               setGenError(data.error || 'Failed to generate playbook')
    } catch (e) { setGenError(e.message || 'Network error') }
    finally       { setGenerating(false) }
  }

  function copyPlaybook() {
    if (!playbook) return
    navigator.clipboard.writeText(playbook).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return <p style={{ fontSize: 12, color: C.textMuted, fontWeight: 300 }}>Loading DNA…</p>

  const renderGroup = (title, color, bg, fixTypes, isPending = false) => {
    const types = Object.keys(fixTypes)
    if (types.length === 0) return null
    return (
      <div style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color, marginBottom: 12, letterSpacing: '.02em' }}>{title}</p>
        {types.map(type => {
          const entries = fixTypes[type]
          return (
            <div key={type} style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, color: C.text, fontWeight: 500, marginBottom: 4 }}>
                {type.replace(/_/g, ' ')} <span style={{ color: C.textLight, fontWeight: 300 }}>· {entries.length} {isPending ? 'pending' : title.toLowerCase().includes('works') ? `success${entries.length > 1 ? 'es' : ''}` : `rollback${entries.length > 1 ? 's' : ''}`}</span>
              </p>
              {entries.slice(0, 2).map(e => (
                <p key={e.id} style={{ fontSize: 11, color: C.textMuted, fontWeight: 300, marginLeft: 10, lineHeight: 1.5 }}>
                  · {e.notes || 'no note'}
                </p>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.7, marginBottom: 14 }}>
        Your site's accumulated learnings. Successes are doubled down on; rollbacks are avoided. The agent reads this on every run.
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={generatePlaybook} disabled={dna.length === 0} style={{
          background: C.accent, color: '#fff', border: 'none', borderRadius: 7,
          padding: '8px 16px', fontSize: 12, fontFamily: 'DM Sans,sans-serif', fontWeight: 400,
          cursor: dna.length === 0 ? 'not-allowed' : 'pointer', opacity: dna.length === 0 ? 0.5 : 1,
        }}>
          📖 Generate Website Playbook
        </button>
      </div>

      {dna.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300 }}>
            No DNA recorded yet. Entries appear after the agent's fixes are deployed, evaluated, or rolled back.
          </p>
        </div>
      )}

      {renderGroup('What works for this site', C.green, C.greenSoft, grouped.success)}
      {renderGroup('Never do again',           C.red,   C.redSoft,   grouped.rollback)}
      {renderGroup('Pending',                  C.yellow,C.yellowSoft,grouped.pending, true)}

      {dna.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', marginTop: 18 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 12 }}>Timeline</p>
          {dna.slice(0, 30).map(d => {
            const badgeColor = d.outcome === 'success' ? C.green : d.outcome === 'rollback' ? C.red : C.yellow
            const badgeBg    = d.outcome === 'success' ? C.greenSoft : d.outcome === 'rollback' ? C.redSoft : C.yellowSoft
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 10, color: C.textLight, fontFamily: 'DM Mono,monospace', minWidth: 70 }}>
                  {new Date(d.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </span>
                <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{d.fix_type.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 10, color: badgeColor, background: badgeBg, border: `1px solid ${badgeColor}33`, borderRadius: 5, padding: '2px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {d.outcome}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Playbook modal */}
      {showPlaybook && (
        <div onClick={() => setShowPlaybook(false)} style={{
          position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(26,25,22,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} className="pop-in" style={{
            background: '#fff', borderRadius: 16, padding: '28px 30px', maxWidth: 640, width: '100%',
            maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(26,25,22,0.15)', position: 'relative',
          }}>
            <button onClick={() => setShowPlaybook(false)} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.textLight }}>×</button>
            <p style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.accent, fontWeight: 500, marginBottom: 8 }}>Website Playbook</p>
            <p style={{ fontFamily: 'Instrument Serif,serif', fontSize: 26, fontWeight: 400, color: C.text, marginBottom: 18, letterSpacing: '-.01em' }}>
              90-day strategic recommendations
            </p>
            {generating && <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300 }}>Generating playbook…</p>}
            {genError   && <p style={{ fontSize: 13, color: C.red }}>{genError}</p>}
            {playbook && (
              <>
                <div style={{ background: 'rgba(26,25,22,0.02)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '20px 22px', fontSize: 13, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: 14 }}>
                  {playbook}
                </div>
                <button onClick={copyPlaybook} style={{
                  background: copied ? C.green : C.text, color: '#fff', border: 'none', borderRadius: 7,
                  padding: '8px 16px', fontSize: 12, fontFamily: 'DM Sans,sans-serif', fontWeight: 400, cursor: 'pointer',
                }}>
                  {copied ? '✓ Copied' : 'Copy to clipboard'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function StripeSubscriptionPanel({ navigate }) {
  const [portalLoading, setPortalLoading] = useState(false)
  const [subscribeLoading, setSubscribeLoading] = useState(false)
  const [subStatus, setSubStatus]         = useState(null)
  const [subLoading, setSubLoading]       = useState(true)
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState(null)
  const [trialEnd, setTrialEnd] = useState(null)
  // Pre-checkout consent modal (§312j BGB pre-purchase summary + recurring acknowledgment)
  const [subConfirmOpen, setSubConfirmOpen] = useState(false)

  async function doSubscribeNow() {
    if (subscribeLoading) return
    setSubscribeLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setSubscribeLoading(false); return }
    const result = await startCheckout('subscription', session.user.id, session.user.email)
    if (!result?.redirected) setSubscribeLoading(false)
  }

  function subscribeNow() {
    if (subscribeLoading) return
    setSubConfirmOpen(true)
  }

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setSubLoading(false); return }
      const { data } = await supabase
        .from('agent_subscriptions')
        .select('subscription_status, cancel_at_period_end, current_period_end, trial_end')
        .eq('user_id', session.user.id)
        .single()
      if (data) {
        setSubStatus(data.subscription_status)
        setCancelAtPeriodEnd(data.cancel_at_period_end === true)
        setCurrentPeriodEnd(data.current_period_end || null)
        setTrialEnd(data.trial_end || null)
      }
      setSubLoading(false)
    }
    load()
  }, [])

  async function openPortal() {
    setPortalLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/stripe?action=portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (e) {
      console.error('Portal error:', e)
    }
    setPortalLoading(false)
  }

  if (subLoading) return null

  const isActive = subStatus === 'active'
  const isTrialing = subStatus === 'trialing'
  const isPastDue = subStatus === 'past_due'
  const isCancelled = subStatus === 'cancelled' || subStatus === 'canceled'
  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div style={{ padding:'18px 20px', borderBottom:`1px solid ${C.border}` }}>
      <p style={{ fontSize:13, fontWeight:500, color:C.text, marginBottom:4 }}>Subscription</p>
      <p style={{ fontSize:11, color:C.textMuted, fontWeight:300, marginBottom:14 }}>Manage your Velyr plan and billing.</p>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {isTrialing && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:C.accentSoft, border:`1px solid ${C.accentMid}`, borderRadius:9, padding:'10px 14px', flexWrap:'wrap', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:C.accent, display:'inline-block' }} />
              <span style={{ fontSize:13, color:C.accent, fontWeight:500 }}>
                Free trial{trialDaysLeft != null ? ` — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left` : ''}
                {cancelAtPeriodEnd ? ' · ends, won’t renew' : ' · then €29/mo'}
              </span>
            </div>
            <button onClick={openPortal} disabled={portalLoading} className="btn" style={{ background:'transparent', border:`1px solid ${C.accent}`, color:C.accent, borderRadius:7, padding:'6px 13px', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:400 }}>
              {portalLoading ? '…' : (cancelAtPeriodEnd ? 'Manage →' : 'Cancel trial')}
            </button>
          </div>
        )}

        {isActive && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:C.accentSoft, border:`1px solid ${C.accentMid}`, borderRadius:9, padding:'10px 14px', flexWrap:'wrap', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:C.accent, display:'inline-block' }} />
              <span style={{ fontSize:13, color:C.accent, fontWeight:500 }}>Growth Agent — Active</span>
            </div>
            <button onClick={openPortal} disabled={portalLoading} className="btn" style={{ background:'transparent', border:`1px solid ${C.accent}`, color:C.accent, borderRadius:7, padding:'6px 13px', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:400 }}>
              {portalLoading ? '…' : 'Manage subscription →'}
            </button>
          </div>
        )}

        {/* Kündigungsbutton (BGB §312k) — explicit cancellation entry point.
            Routes to the same Stripe Billing Portal as "Manage subscription",
            where the cancellation step is confirmed and a receipt is issued. */}
        {isActive && !cancelAtPeriodEnd && (
          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="btn"
            style={{
              background: 'transparent', border: `1px solid ${C.red}`, color: C.red,
              borderRadius: 7, padding: '8px 14px', fontSize: 12,
              fontFamily: 'DM Sans,sans-serif', fontWeight: 500,
              alignSelf: 'flex-start',
              opacity: portalLoading ? 0.6 : 1,
            }}
          >
            {portalLoading ? '…' : 'Cancel subscription'}
          </button>
        )}

        {isActive && cancelAtPeriodEnd && currentPeriodEnd && (
          <p style={{ fontSize: 12, color: '#f5a623', marginTop: 4 }}>
            Cancels on {new Date(currentPeriodEnd).toLocaleDateString()} — you have full access until then.
          </p>
        )}

        {isPastDue && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:C.yellowSoft, border:`1px solid ${C.yellowMid}`, borderRadius:9, padding:'10px 14px', flexWrap:'wrap', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:C.yellow, display:'inline-block' }} />
              <span style={{ fontSize:13, color:C.yellow, fontWeight:500 }}>Payment failed — update your card to resume the agent</span>
            </div>
            <button onClick={openPortal} disabled={portalLoading} className="btn" style={{ background:'transparent', border:`1px solid ${C.yellow}`, color:C.yellow, borderRadius:7, padding:'6px 13px', fontSize:12, fontFamily:'DM Sans,sans-serif', fontWeight:400 }}>
              {portalLoading ? '…' : 'Update payment →'}
            </button>
          </div>
        )}

        {isCancelled && (
          <div style={{ background:'rgba(26,25,22,0.03)', border:`1px solid ${C.border}`, borderRadius:9, padding:'14px', textAlign:'center' }}>
            <p style={{ fontSize:13, color:C.textMuted, fontWeight:500, marginBottom:4 }}>Subscription ended</p>
            <p style={{ fontSize:12, color:C.textMuted, fontWeight:300, marginBottom:12 }}>Your agent is paused. Start a new subscription to resume weekly improvements.</p>
            <button onClick={subscribeNow} disabled={subscribeLoading} className="btn" style={{ background:C.accent, color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontFamily:'DM Sans,sans-serif', fontWeight:500, opacity: subscribeLoading ? 0.7 : 1, cursor: subscribeLoading ? 'not-allowed' : 'pointer' }}>
              {subscribeLoading ? 'Opening Stripe…' : 'Restart subscription →'}
            </button>
          </div>
        )}

        {!isActive && !isTrialing && !isPastDue && !isCancelled && (
          <div style={{ background:'rgba(26,25,22,0.03)', border:`1px solid ${C.border}`, borderRadius:9, padding:'14px', textAlign:'center' }}>
            <p style={{ fontSize:13, color:C.textMuted, fontWeight:300, marginBottom:12 }}>No active subscription. Unlock the Growth Agent to start getting weekly improvements.</p>
            <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
              <button onClick={subscribeNow} disabled={subscribeLoading} className="btn" style={{ background:C.accent, color:'#fff', border:'none', borderRadius:8, padding:'9px 18px', fontSize:13, fontFamily:'DM Sans,sans-serif', fontWeight:500, opacity: subscribeLoading ? 0.7 : 1, cursor: subscribeLoading ? 'not-allowed' : 'pointer' }}>
                {subscribeLoading ? 'Opening Stripe…' : 'Start free trial — €29/mo after →'}
              </button>
            </div>
          </div>
        )}
      </div>

      <CheckoutConfirmModal
        type="subscription"
        open={subConfirmOpen}
        onCancel={() => setSubConfirmOpen(false)}
        onConfirm={() => { setSubConfirmOpen(false); doSubscribeNow() }}
        loading={subscribeLoading}
      />
    </div>
  )
}

function SettingsPage({subscription, user, onTogglePause, actionLoading, onDeleteRequest, onSaveSettings, navigate}) {
  const [isPublic, setIsPublic]   = useState(subscription?.is_public || false)
  const [slug, setSlug]           = useState(subscription?.public_slug || '')
  const [competitors, setCompetitors] = useState(() => {
    const initial = subscription?.competitors || []
    while (initial.length < 5) initial.push('')
    return initial.slice(0, 5)
  })
  const [savingPublic, setSavingPublic] = useState(false)
  const [savingComp,   setSavingComp]   = useState(false)
  const [publicError,  setPublicError]  = useState(null)
  const [compError,    setCompError]    = useState(null)
  const [publicSaved,  setPublicSaved]  = useState(false)
  const [compSaved,    setCompSaved]    = useState(false)

  const slugValid    = !slug || /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)
  const previewUrl   = slug ? `velyr.io/agent/${slug}` : 'velyr.io/agent/your-slug'
  const publicUrl    = (subscription?.is_public && subscription?.public_slug) ? `/agent/${subscription.public_slug}` : null

  async function savePublic() {
    setPublicError(null); setPublicSaved(false)
    if (slug && !slugValid) { setPublicError('Slug must be 3-30 chars: lowercase letters, numbers, hyphens only'); return }
    setSavingPublic(true)
    try {
      const result = await onSaveSettings({ is_public: isPublic, public_slug: slug || null })
      if (result?.error) setPublicError(result.error)
      else               setPublicSaved(true)
    } catch (e) { setPublicError(e.message || 'Failed to save') }
    finally       { setSavingPublic(false) }
  }

  async function saveCompetitors() {
    setCompError(null); setCompSaved(false)
    setSavingComp(true)
    try {
      const cleaned = competitors.map(u => u.trim()).filter(Boolean)
      for (const u of cleaned) { try { new URL(u) } catch { setCompError(`Invalid URL: ${u}`); setSavingComp(false); return } }
      const result = await onSaveSettings({ competitors: cleaned })
      if (result?.error) setCompError(result.error)
      else               setCompSaved(true)
    } catch (e) { setCompError(e.message || 'Failed to save') }
    finally       { setSavingComp(false) }
  }

  return (
    <Card style={{overflow:'hidden'}}>
      <StripeSubscriptionPanel navigate={navigate} />
      <div style={{padding:'18px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
        <div>
          <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:2}}>
            {subscription?.status==='paused'?'⏸ Agent is paused':'▶ Agent is active'}
          </p>
          <p style={{fontSize:11,color:C.textMuted,fontWeight:300}}>
            {subscription?.status==='paused'?'Resume to run again every Monday.':'Runs every Monday at 9am.'}
          </p>
        </div>
        <button className="btn" onClick={onTogglePause} disabled={actionLoading} style={{
          background:subscription?.status==='paused'?C.accent:'transparent',
          color:subscription?.status==='paused'?'#fff':C.textMuted,
          border:`1px solid ${subscription?.status==='paused'?C.accent:C.border}`,
          borderRadius:7,padding:'8px 15px',fontSize:12,fontFamily:'DM Sans,sans-serif',fontWeight:400,
          opacity:actionLoading?0.6:1,
        }}>
          {actionLoading?'…':subscription?.status==='paused'?'Resume Agent':'Pause Agent'}
        </button>
      </div>

      {/* Public Profile (Part 4d) */}
      <div style={{padding:'18px 20px',borderBottom:`1px solid ${C.border}`}}>
        <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:4}}>Public Profile</p>
        <p style={{fontSize:11,color:C.textMuted,fontWeight:300,marginBottom:14}}>Share a public timeline of your agent's work — runs and results.</p>

        <label style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,cursor:'pointer'}}>
          <input type="checkbox" checked={isPublic} onChange={e=>setIsPublic(e.target.checked)} style={{width:14,height:14}} />
          <span style={{fontSize:12,color:C.text}}>Make my agent timeline public</span>
        </label>

        <div style={{marginBottom:8}}>
          <label style={{fontSize:11,color:C.textMuted,fontWeight:300,marginBottom:4,display:'block'}}>Your public URL slug</label>
          <input type="text" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))} placeholder="florian"
            style={{width:'100%',maxWidth:280,padding:'8px 12px',fontSize:13,fontFamily:'DM Mono,monospace',
              border:`1px solid ${slugValid?C.border:C.red}`,borderRadius:6,background:'#fff',outline:'none'}} />
          <p style={{fontSize:11,color:C.textMuted,marginTop:6,fontFamily:'DM Mono,monospace'}}>{previewUrl}</p>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:12,marginTop:12,flexWrap:'wrap'}}>
          <button className="btn" onClick={savePublic} disabled={savingPublic} style={{
            background:C.accent,color:'#fff',border:'none',borderRadius:7,padding:'8px 16px',
            fontSize:12,fontFamily:'DM Sans,sans-serif',fontWeight:400,opacity:savingPublic?0.6:1,
          }}>{savingPublic?'Saving…':'Save'}</button>
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.accent,textDecoration:'none',fontWeight:500}}>
              View public timeline →
            </a>
          )}
          {publicSaved && <span style={{fontSize:11,color:C.green}}>✓ Saved</span>}
          {publicError && <span style={{fontSize:11,color:C.red}}>{publicError}</span>}
        </div>
      </div>

      {/* Competitors (Part 6d) */}
      <div style={{padding:'18px 20px',borderBottom:`1px solid ${C.border}`}}>
        <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:4}}>Competitors</p>
        <p style={{fontSize:11,color:C.textMuted,fontWeight:300,marginBottom:14}}>We'll scan these every Monday and alert you if anything changes.</p>
        {competitors.map((url, i) => (
          <input key={i} type="url" value={url} onChange={e=>{ const next=[...competitors]; next[i]=e.target.value; setCompetitors(next) }}
            placeholder={`https://competitor-${i+1}.com`}
            style={{width:'100%',maxWidth:420,padding:'8px 12px',fontSize:13,fontFamily:'DM Mono,monospace',
              border:`1px solid ${C.border}`,borderRadius:6,background:'#fff',outline:'none',marginBottom:8,display:'block'}} />
        ))}
        <div style={{display:'flex',alignItems:'center',gap:12,marginTop:8,flexWrap:'wrap'}}>
          <button className="btn" onClick={saveCompetitors} disabled={savingComp} style={{
            background:C.accent,color:'#fff',border:'none',borderRadius:7,padding:'8px 16px',
            fontSize:12,fontFamily:'DM Sans,sans-serif',fontWeight:400,opacity:savingComp?0.6:1,
          }}>{savingComp?'Saving…':'Save competitors'}</button>
          {compSaved && <span style={{fontSize:11,color:C.green}}>✓ Saved</span>}
          {compError && <span style={{fontSize:11,color:C.red}}>{compError}</span>}
        </div>
      </div>

      <div style={{padding:'18px 20px',borderBottom:`1px solid ${C.border}`}}>
        <p style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:8}}>Account</p>
        <p style={{fontSize:12,color:C.textMuted,marginBottom:2}}>Email: {user?.email}</p>
        <p style={{fontSize:12,color:C.textMuted}}>Plan: {subscription?.plan||'Growth'}</p>
      </div>
      <div style={{padding:'18px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
        <div>
          <p style={{fontSize:13,fontWeight:500,color:C.red,marginBottom:2}}>Delete account</p>
          <p style={{fontSize:11,color:C.textMuted}}>Permanently deletes your account and all data.</p>
        </div>
        <button className="btn" onClick={onDeleteRequest} style={{
          background:'transparent',color:C.red,
          border:`1px solid rgba(184,50,50,0.3)`,
          borderRadius:7,padding:'7px 14px',fontSize:12,fontFamily:'DM Sans,sans-serif',
        }}>
          Delete account
        </button>
      </div>
    </Card>
  )
}

// ─── RUN DETAIL MODAL ─────────────────────────────────────────────────────────
function RunDetail({run, onClose}) {
  const analysis = run.analysis_result||{}
  const funnel   = run.funnel_analysis
  const fields   = [
    {label:'💡 Data Insight',         text:analysis.data_insight},
    {label:'💥 Impact',               text:analysis.impact},
    {label:'✅ Solution',             text:analysis.solution},
    {label:'📈 Expected improvement', text:analysis.expected_improvement},
    {label:'🔍 Competitor angle',     text:analysis.competitor_insight},
  ]

  return (
    <div style={{position:'fixed',inset:0,zIndex:999,background:'rgba(26,25,22,0.4)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={onClose}>
      <div className="pop-in" onClick={e=>e.stopPropagation()} style={{
        background:'#fff',borderRadius:16,padding:'28px 26px',
        maxWidth:560,width:'100%',maxHeight:'88vh',overflowY:'auto',
        boxShadow:'0 20px 60px rgba(26,25,22,0.15)',position:'relative',
      }}>
        <button onClick={onClose} style={{position:'absolute',top:14,right:16,background:'none',border:'none',fontSize:20,cursor:'pointer',color:C.textLight}}>×</button>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
          <StatusBadge status={run.status}/>
          <span style={{fontSize:11,color:C.textLight}}>{new Date(run.created_at).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        {analysis.problem&&(
          <h3 style={{fontFamily:'Instrument Serif,serif',fontWeight:400,fontSize:24,letterSpacing:'-.01em',marginBottom:20,color:C.text,lineHeight:1.25}}>{analysis.problem}</h3>
        )}
        <div style={{background:'rgba(26,25,22,0.02)',border:`1px solid ${C.border}`,borderRadius:10,padding:'13px 15px',marginBottom:16}}>
          <SectionLabel style={{marginBottom:12}}>What the agent did</SectionLabel>
          <div style={{display:'flex',gap:0,overflowX:'auto',paddingBottom:4}}>
            {AGENT_STEPS.map((step,i)=>{
              const stepI=deriveAgentStep(run), done=i<=stepI, failed=run.status==='failed'&&i===stepI
              return (
                <div key={step.id} style={{display:'flex',alignItems:'center',gap:0,flexShrink:0}}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                    <div style={{
                      width:24,height:24,borderRadius:'50%',fontSize:11,
                      background:failed?C.red:done?C.accent:'rgba(26,25,22,0.07)',
                      border:`1px solid ${failed?C.red:done?C.accent:C.border}`,
                      display:'flex',alignItems:'center',justifyContent:'center',color:done?'#fff':C.textLight,
                    }}>
                      {failed?'✕':done?'✓':''}
                    </div>
                    <p style={{fontSize:9,color:done?C.accent:C.textLight,textAlign:'center',maxWidth:54,lineHeight:1.3}}>{step.label}</p>
                  </div>
                  {i<AGENT_STEPS.length-1&&<div style={{width:20,height:1,background:done?C.accent:C.border,opacity:0.35,flexShrink:0,marginBottom:18}}/>}
                </div>
              )
            })}
          </div>
        </div>
        {fields.map((item,i)=>item.text&&(
          <div key={i} style={{background:'rgba(26,25,22,0.025)',border:`1px solid ${C.border}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{marginBottom:5}}>{item.label}</SectionLabel>
            <p style={{fontSize:13,color:C.text,lineHeight:1.65}}>{item.text}</p>
          </div>
        ))}
        {analysis.file_to_edit&&(
          <div style={{background:C.accentSoft,border:`1px solid ${C.accentMid}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{color:C.accent,marginBottom:5}}>📄 File edited</SectionLabel>
            <p style={{fontSize:12,color:C.text,fontFamily:'DM Mono,monospace'}}>{analysis.file_to_edit}</p>
          </div>
        )}
        {analysis.analytics_snapshot&&(
          <div style={{background:'rgba(26,25,22,0.02)',border:`1px solid ${C.border}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{marginBottom:8}}>📊 Analytics snapshot</SectionLabel>
            <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
              {[
                {label:'Pageviews',value:analysis.analytics_snapshot.totalPageviews},
                {label:'Bounce Rate',value:analysis.analytics_snapshot.bounceRate!=null?`${analysis.analytics_snapshot.bounceRate}%`:null},
                {label:'Sessions',value:analysis.analytics_snapshot.uniqueVisitors},
              ].map(({label,value})=>(
                <div key={label}>
                  <p style={{fontSize:10,color:C.textLight}}>{label}</p>
                  <p style={{fontFamily:'Instrument Serif,serif',fontSize:22,color:C.text}}>{value??'—'}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {funnel&&(
          <div style={{background:'rgba(26,25,22,0.02)',border:`1px solid ${C.border}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{marginBottom:6}}>🗺️ Funnel snapshot</SectionLabel>
            <p style={{fontSize:12,color:C.text}}>{funnel.totalPages} pages · {Object.keys(funnel.pageTypes||{}).length} types</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:7}}>
              {Object.entries(funnel.pageTypes||{}).map(([type,count])=>(
                <span key={type} style={{fontSize:10,background:C.accentSoft,border:`1px solid ${C.accentMid}`,borderRadius:5,padding:'2px 6px',color:C.accent}}>
                  {PAGE_TYPE_EMOJI[type]||'📄'} {type}: {count}
                </span>
              ))}
            </div>
            {funnel.biggestDropOff&&(
              <p style={{fontSize:11,color:C.yellow,marginTop:7}}>⚠️ Drop-off: {funnel.biggestDropOff.filePath} ({funnel.biggestDropOff.dropOffScore}%)</p>
            )}
          </div>
        )}
        {run.pr_url&&(
          <a href={run.pr_url} target="_blank" rel="noreferrer" style={{
            display:'block',textAlign:'center',marginTop:20,
            background:C.text,color:C.bg,borderRadius:9,padding:'12px',
            fontSize:14,fontFamily:'DM Sans,sans-serif',fontWeight:500,textDecoration:'none',transition:'background .2s',
          }}
            onMouseEnter={e=>e.currentTarget.style.background=C.accent}
            onMouseLeave={e=>e.currentTarget.style.background=C.text}
          >View Pull Request on GitHub →</a>
        )}
      </div>
    </div>
  )
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
// FIX #11: added `error` prop to surface failure message inside the modal
function DeleteConfirmModal({onConfirm, onCancel, loading, error}) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:999,background:'rgba(26,25,22,0.4)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={onCancel}>
      <div className="pop-in" onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:16,padding:'28px 26px',maxWidth:400,width:'100%',boxShadow:'0 20px 60px rgba(26,25,22,0.15)'}}>
        <p style={{fontSize:26,marginBottom:12}}>⚠️</p>
        <h3 style={{fontFamily:'Instrument Serif,serif',fontWeight:400,fontSize:22,marginBottom:8,color:C.text}}>Delete your account?</h3>
        <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7,marginBottom:22}}>This permanently deletes your account, all agent runs, and all connected data. Cannot be undone.</p>
        {error && (
          <p style={{fontSize:12,color:C.red,background:C.redSoft,border:`1px solid ${C.redMid}`,borderRadius:7,padding:'8px 12px',marginBottom:14}}>
            {error}
          </p>
        )}
        <div style={{display:'flex',gap:8}}>
          <button className="btn" onClick={onCancel} style={{flex:1,background:'transparent',color:C.text,border:`1px solid ${C.border}`,borderRadius:8,padding:'12px',fontSize:13,fontFamily:'DM Sans,sans-serif'}}>Cancel</button>
          <button className="btn" onClick={onConfirm} disabled={loading} style={{flex:1,background:C.red,color:'#fff',border:'none',borderRadius:8,padding:'12px',fontSize:13,fontFamily:'DM Sans,sans-serif',fontWeight:500,opacity:loading?0.6:1}}>
            {loading?'Deleting…':'Yes, delete everything'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function AgentDashboard({ navigate }) {
  const [user,           setUser]           = useState(null)
  const [authLoading,    setAuthLoading]    = useState(true)
  const [runs,           setRuns]           = useState([])
  const [loading,        setLoading]        = useState(true)
  const [selected,       setSelected]       = useState(null)
  const [subscription,   setSubscription]   = useState(null)
  const [actionLoading,  setActionLoading]  = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError,    setDeleteError]    = useState(null)  // FIX #11: track deletion errors
  const [activePage,     setActivePage]     = useState('overview')
  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [funnelPages,    setFunnelPages]    = useState([])
  const [learnings,      setLearnings]      = useState([])
  const [impactMetrics,  setImpactMetrics]  = useState([])
  const [snippetDeclined, setSnippetDeclined] = useState(false)
  const [siteNetwork,     setSiteNetwork]     = useState(null)   // agent_site_network latest row
  const [websiteUrl,      setWebsiteUrl]      = useState(null)   // agent_connections.website_url

  // Demo mode: /agent?demo=true loads hardcoded data, bypasses Supabase.
  const isDemo = useMemo(
    () => typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('demo') === 'true',
    []
  )

  // auth
  useEffect(()=>{
    if (isDemo) {
      setUser({ id: 'demo-user', email: 'demo@acme-store.com' })
      setAuthLoading(false)
      return
    }
    supabase.auth.getSession().then(({data:{session}})=>{
      if(!session){navigate('/agent/login');return}
      setUser(session.user);setAuthLoading(false)
    })
    const {data:{subscription:authSub}}=supabase.auth.onAuthStateChange((_,session)=>{
      if(!session){navigate('/agent/login');return}
      setUser(session.user);setAuthLoading(false)
    })
    return()=>authSub.unsubscribe()
  },[isDemo])

  const [checkoutSuccess, setCheckoutSuccess] = useState(false)
  const [checkoutCancelled, setCheckoutCancelled] = useState(false)
  // null = pending, true = Stripe confirms paid subscription, false = no/invalid
  // session. When `true` and the DB row hasn't been created yet (webhook lag),
  // we show a "Setting up" state instead of the "Unlock your Growth Agent"
  // screen so freshly-paid users never see the subscribe page.
  const [stripeVerified, setStripeVerified] = useState(null)
  // false = verify effect still in flight (or skipped pre-mount), true = settled.
  // Gates the "Unlock" render so we never flash the subscribe screen while the
  // Stripe verify is still resolving (or before fetchData completes).
  const [verifyDone,     setVerifyDone]     = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'success') {
      setCheckoutSuccess(true)
      window.history.replaceState({}, '', '/agent/dashboard')
    } else if (params.get('checkout') === 'cancelled') {
      setCheckoutCancelled(true)
      window.history.replaceState({}, '', '/agent/dashboard')
    }
  }, [])

  // Mobile nav drawer: lock body scroll while open + close on Escape. The
  // drawer is CSS-driven (≤900); this only adds the scroll-lock + key affordance.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [drawerOpen])

  // Parallel Stripe verify on mount. Uses the session_id stashed in
  // localStorage during onboarding (mount gate of AgentOnboarding.jsx) with
  // sessionStorage as a fallback. Lets the dashboard treat a freshly-paid
  // user as subscribed while the Stripe webhook is still writing the
  // agent_subscriptions row.
  //
  // Hard 3s timeout via AbortController: if Stripe verify hangs we settle the
  // gate (stripeVerified=false, verifyDone=true) so users never stare at a
  // spinner. The dashboard's regular DB polling will still catch the row
  // when it arrives.
  useEffect(() => {
    if (!user || isDemo) return
    let cancelled = false
    let sessionId = null
    try { sessionId = localStorage.getItem('velyr_onboarding_session_id') } catch {}
    if (!sessionId) {
      try { sessionId = sessionStorage.getItem('velyr_onboarding_session_id') } catch {}
    }
    if (!sessionId) {
      setStripeVerified(false)
      setVerifyDone(true)
      return
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/stripe?action=verify_session&session_id=${encodeURIComponent(sessionId)}`,
          { signal: controller.signal }
        )
        const json = await res.json()
        if (cancelled) return
        clearTimeout(timeoutId)
        // 'no_payment_required' = trial checkout (card captured, nothing charged yet).
        const paid = (json.paymentStatus === 'paid' || json.paymentStatus === 'no_payment_required') && json.type === 'subscription'
        setStripeVerified(paid)
        setVerifyDone(true)
        if (paid) {
          try { localStorage.removeItem('velyr_onboarding_session_id') } catch {}
          try { sessionStorage.removeItem('velyr_onboarding_session_id') } catch {}
        }
      } catch {
        if (!cancelled) {
          setStripeVerified(false)
          setVerifyDone(true)
        }
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [user, isDemo])

  useEffect(() => {
    if (!checkoutSuccess || !user || isDemo) return
    fetchData()
    const t = setTimeout(() => setCheckoutSuccess(false), 5000)
    return () => clearTimeout(t)
  }, [checkoutSuccess, user, isDemo])

  useEffect(() => {
    if (!checkoutCancelled) return
    const t = setTimeout(() => setCheckoutCancelled(false), 5000)
    return () => clearTimeout(t)
  }, [checkoutCancelled])

  // data
  useEffect(()=>{
    if(!user)return
    if (isDemo) {
      setSubscription(demoData.subscription)
      setRuns(demoData.runs)
      setFunnelPages(demoData.funnelPages)
      setLearnings(demoData.learnings)
      setImpactMetrics(demoData.impactMetrics)
      setLoading(false)
      return
    }
    fetchData()
    const interval=setInterval(fetchData,30000)
    return()=>clearInterval(interval)
  },[user, isDemo])

  // Fast poll: if Stripe confirms payment but the agent_subscriptions row
  // hasn't been written by the webhook yet, re-fetch every 2s for ~16s so
  // the user sees the real dashboard the moment the row appears.
  useEffect(() => {
    if (!user || isDemo) return
    if (stripeVerified !== true) return
    if (subscription) return
    let attempts = 0
    const t = setInterval(() => {
      attempts++
      fetchData()
      if (attempts >= 8) clearInterval(t)
    }, 2000)
    return () => clearInterval(t)
  }, [user, isDemo, stripeVerified, subscription])

  async function fetchData() {
    const {data:subs}=await supabase.from('agent_subscriptions').select('*').eq('auth_user_id',user.id).single()
    setSubscription(subs)
    if(!subs){setLoading(false);return}

    const [runsRes, funnelRes, learningsRes, impactRes, connRes, snRes] = await Promise.all([
      supabase.from('agent_runs').select('*').eq('subscription_id',subs.id).order('created_at',{ascending:false}).limit(50),
      supabase.from('agent_funnel_pages').select('*').eq('subscription_id',subs.id).order('created_at',{ascending:false}).limit(30),
      supabase.from('agent_learnings').select('*').eq('subscription_id',subs.id).order('created_at',{ascending:false}).limit(50),
      // FIX #3: added .eq('subscription_id', subs.id) — previously fetched all users' metrics
      supabase.from('impact_metrics').select('*').eq('subscription_id',subs.id).order('measured_at',{ascending:false}).limit(20),
      supabase.from('agent_connections').select('posthog_snippet_declined,website_url').eq('subscription_id',subs.id).maybeSingle(),
      // agent_site_network may not exist yet (Stage 4.5 migration); error is silently ignored
      supabase.from('agent_site_network').select('*').eq('subscription_id',subs.id).order('captured_at',{ascending:false}).limit(1).maybeSingle(),
    ])

    if(runsRes.data) setRuns(runsRes.data)
    if(funnelRes.data){
      const seen=new Set()
      setFunnelPages(funnelRes.data.filter(p=>{if(seen.has(p.page_path))return false;seen.add(p.page_path);return true}))
    }
    if(learningsRes.data) setLearnings(learningsRes.data)
    if(impactRes.data) setImpactMetrics(impactRes.data)
    setSnippetDeclined(connRes.data?.posthog_snippet_declined === true)
    setWebsiteUrl(connRes.data?.website_url || null)
    // 42P01 = relation does not exist (table absent until Stage 4.5 migration) — expected, stay silent.
    // Any other error (RLS denial, permission issue) is surfaced so it doesn't silently eat real data.
    if (snRes.error && snRes.error.code !== '42P01') {
      console.warn('[fetchData] agent_site_network:', snRes.error.message)
    }
    setSiteNetwork(snRes.data || null)
    setLoading(false)
  }

  async function getToken() {
    const {data:{session}}=await supabase.auth.getSession()
    return session?.access_token
  }

  const [subscribeLoading, setSubscribeLoading] = useState(false)
  // Pre-checkout consent modal for the dashboard "Unlock your Growth Agent" CTA.
  // Existing handleSubscribe logic preserved as doHandleSubscribe and only runs
  // after the user explicitly confirms in the modal.
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false)
  async function doHandleSubscribe() {
    if (subscribeLoading || isDemo) return
    setSubscribeLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { navigate('/agent/login'); return }
    const result = await startCheckout('subscription', session.user.id, session.user.email)
    if (!result?.redirected) setSubscribeLoading(false)
  }
  function handleSubscribe() {
    if (subscribeLoading || isDemo) return
    setUnlockConfirmOpen(true)
  }

  async function handleTogglePause() {
    setActionLoading(true)
    const token=await getToken()
    const action=subscription?.status==='paused'?'resume':'pause'
    const res=await fetch(`/api/agent/run?action=${action}`,{method:'POST',headers:{'Authorization':`Bearer ${token}`}})
    const data=await res.json()
    if(data.success) setSubscription(prev=>({...prev,status:data.status}))
    setActionLoading(false)
  }

  async function handleSaveSettings(payload) {
    const token = await getToken()
    const res = await fetch('/api/agent/run?action=update-settings', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (data?.success && data.subscription) {
      setSubscription(prev => ({ ...prev, ...data.subscription }))
      return { success: true }
    }
    return { error: data?.error || 'Save failed' }
  }

  async function handleReenableSnippet() {
    const token = await getToken()
    await fetch('/api/agent/run?action=reenable_snippet', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    setSnippetDeclined(false)
  }

  async function handleDeleteAccount() {
    setActionLoading(true)
    setDeleteError(null)
    const token=await getToken()
    const res=await fetch('/api/agent/run?action=delete',{method:'POST',headers:{'Authorization':`Bearer ${token}`}})
    const data=await res.json()
    if(data.success){
      await supabase.auth.signOut()
      navigate('/')
    } else {
      // FIX #11: show error in modal instead of silently closing it
      setDeleteError(data.error || 'Something went wrong. Please try again.')
      setActionLoading(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/agent/login')
  }

  const pending = runs.filter(r=>r.status==='waiting_approval').length

  if(authLoading) return (
    <>
      <style>{CSS}</style>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><Spinner size={24}/></div>
    </>
  )

  return (
    <>
      <style>{CSS}</style>
      {selected&&<RunDetail run={selected} onClose={()=>setSelected(null)}/>}
      {showDeleteConfirm&&(
        <DeleteConfirmModal
          onConfirm={handleDeleteAccount}
          onCancel={()=>{ setShowDeleteConfirm(false); setDeleteError(null) }}
          loading={actionLoading}
          error={deleteError}
        />
      )}

      {checkoutCancelled && (
        <div style={{
          position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', zIndex:200,
          background:C.bgCard, border:`1px solid ${C.border}`,
          boxShadow:'0 4px 20px rgba(28,25,23,0.12)',
          borderRadius:10, padding:'10px 16px',
          fontSize:13, color:C.text, fontFamily:'DM Sans,sans-serif',
        }}>
          Checkout cancelled — no charge was made.
        </div>
      )}

      <CheckoutConfirmModal
        type="subscription"
        open={unlockConfirmOpen}
        onCancel={() => setUnlockConfirmOpen(false)}
        onConfirm={() => { setUnlockConfirmOpen(false); doHandleSubscribe() }}
        loading={subscribeLoading}
      />

      <div className={`dash-shell ${drawerOpen?'drawer-open':''}`} style={{minHeight:'100vh',background:C.bg,display:'flex'}}>

        {/* Mobile drawer scrim (≤900). Tap to dismiss. */}
        <div className="dash-scrim" onClick={()=>setDrawerOpen(false)} aria-hidden="true"/>

        {/* ── LEFT SIDEBAR NAV ── */}
        <div className="dash-sidebar" style={{
          width:200,flexShrink:0,background:C.bgCard,
          borderRight:`1px solid ${C.border}`,
          display:'flex',flexDirection:'column',
          position:'sticky',top:0,height:'100vh',
          overflowY:'auto',
        }}>
          <div style={{
            padding:'18px 16px 14px',
            display:'flex',alignItems:'center',gap:9,
            borderBottom:`1px solid ${C.border}`,
            justifyContent:'space-between',
          }}>
            <div onClick={()=>navigate('/')} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer',minWidth:0}}>
              <VelyrLogo size={22}/>
              <div>
                <p style={{fontFamily:'Instrument Serif,serif',fontSize:17,color:C.text,lineHeight:1}}>Velyr</p>
                <p style={{fontSize:9,color:C.textLight,letterSpacing:'.06em',textTransform:'uppercase',marginTop:2}}>Growth Agent</p>
              </div>
            </div>
            <button
              className="dash-drawer-close btn"
              aria-label="Close navigation"
              onClick={()=>setDrawerOpen(false)}
              style={{
                width:36,height:36,borderRadius:8,flexShrink:0,
                border:`1px solid ${C.border}`,background:'transparent',
                alignItems:'center',justifyContent:'center',
                fontSize:20,color:C.textMuted,lineHeight:1,
              }}
            >×</button>
          </div>

          <nav style={{padding:'10px 8px',flex:1}}>
            {NAV_ITEMS.map(item=>(
              <button key={item.id} className="nav-item" onClick={()=>{setActivePage(item.id); setDrawerOpen(false)}} style={{
                display:'flex',alignItems:'center',gap:9,
                padding:'8px 10px',borderRadius:7,marginBottom:2,
                background:activePage===item.id?C.accentSoft:'transparent',
                color:activePage===item.id?C.accent:C.textMuted,
              }}>
                <span style={{fontSize:13,flexShrink:0,opacity:activePage===item.id?1:0.6}}>{item.icon}</span>
                <span style={{fontSize:12,fontWeight:activePage===item.id?500:400}}>{item.label}</span>
                {item.id==='runs'&&pending>0&&(
                  <span style={{
                    marginLeft:'auto',fontSize:9,fontWeight:500,
                    background:C.yellow,color:'#fff',borderRadius:10,
                    padding:'1px 5px',minWidth:16,textAlign:'center',
                  }}>{pending}</span>
                )}
              </button>
            ))}
          </nav>

          <div style={{padding:'12px 16px',borderTop:`1px solid ${C.border}`}}>
            {subscription ? (
              <div style={{display:'flex',alignItems:'center',gap:7}}>
                <span className={runs.some(r=>r.status==='running')?'pulse-dot':''} style={{
                  width:6,height:6,borderRadius:'50%',display:'inline-block',
                  background:subscription.status==='paused'?C.yellow:runs.some(r=>r.status==='running')?C.blue:C.accent,
                  flexShrink:0,
                }}/>
                <div>
                  <p style={{fontSize:11,color:C.text,fontWeight:400}}>Agent {subscription.status==='paused'?'paused':runs.some(r=>r.status==='running')?'running':'active'}</p>
                  <p style={{fontSize:9,color:C.textLight}}>Autonomous mode</p>
                </div>
              </div>
            ) : null}
            {subscription&&(
              <button className="btn" onClick={handleTogglePause} disabled={actionLoading} style={{
                width:'100%',marginTop:8,padding:'6px',borderRadius:6,fontSize:10,
                background:'transparent',color:C.textMuted,border:`1px solid ${C.border}`,
                fontFamily:'DM Sans,sans-serif',
              }}>
                {subscription.status==='paused'?'▶ Resume':'⏸ Pause'}
              </button>
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="dash-main" style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}>

          <div style={{
            height:52,padding:'0 24px',
            display:'flex',alignItems:'center',justifyContent:'space-between',
            borderBottom:`1px solid ${C.border}`,
            background:'rgba(245,242,236,0.9)',backdropFilter:'blur(16px)',
            position:'sticky',top:0,zIndex:50,
          }}>
            <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
              <button
                className="dash-hamburger btn"
                aria-label="Open navigation"
                onClick={()=>setDrawerOpen(true)}
                style={{
                  width:40,height:40,borderRadius:8,flexShrink:0,
                  border:`1px solid ${C.border}`,background:C.bgCard,
                  alignItems:'center',justifyContent:'center',
                }}
              >
                <span style={{position:'relative',display:'block',width:16,height:11}}>
                  <span style={{position:'absolute',left:0,right:0,top:0,height:1.5,background:C.text,borderRadius:1}}/>
                  <span style={{position:'absolute',left:0,right:0,top:5,height:1.5,background:C.text,borderRadius:1}}/>
                  <span style={{position:'absolute',left:0,right:0,top:10,height:1.5,background:C.text,borderRadius:1}}/>
                </span>
              </button>
              <p style={{fontSize:13,fontWeight:500,color:C.text,textTransform:'capitalize'}}>
                {activePage}
              </p>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              {pending>0&&(
                <div style={{display:'flex',alignItems:'center',gap:6,background:C.yellowSoft,border:`1px solid ${C.yellowMid}`,borderRadius:7,padding:'4px 11px',cursor:'pointer'}} onClick={()=>setActivePage('runs')}>
                  <span className="pulse-dot" style={{width:5,height:5,borderRadius:'50%',background:C.yellow,display:'inline-block'}}/>
                  <span style={{fontSize:11,color:C.yellow,fontWeight:500}}>{pending} awaiting approval</span>
                </div>
              )}
              <span style={{fontSize:11,color:C.textLight}}>{user?.email}</span>
              <button className="btn" onClick={handleLogout} style={{
                background:'none',border:`1px solid ${C.border}`,borderRadius:6,
                padding:'4px 12px',fontSize:11,fontFamily:'DM Sans,sans-serif',
                color:C.textMuted,
              }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.red;e.currentTarget.style.color=C.red}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.textMuted}}
              >Log out</button>
            </div>
          </div>

          <div className="dash-content" style={{flex:1,padding:'24px',overflowY:'auto'}}>

            {!loading&&!subscription&&stripeVerified===true&&(
              <div className="fade-up" style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:16,padding:'48px 32px',textAlign:'center',maxWidth:480,margin:'0 auto'}}>
                <Spinner size={28}/>
                <h2 style={{fontFamily:'Instrument Serif,serif',fontWeight:400,fontSize:24,margin:'18px 0 10px',color:C.text}}>Setting up your Growth Agent…</h2>
                <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7}}>Payment confirmed. We're finalizing your account — this usually takes a few seconds.</p>
              </div>
            )}

            {!loading&&verifyDone&&!subscription&&stripeVerified===false&&(
              <div className="fade-up" style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:16,padding:'48px 32px',textAlign:'center',maxWidth:480,margin:'0 auto'}}>
                <p style={{fontSize:32,marginBottom:14}}>🤖</p>
                <h2 style={{fontFamily:'Instrument Serif,serif',fontWeight:400,fontSize:28,marginBottom:10,color:C.text}}>Unlock your Growth Agent</h2>
                <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7,marginBottom:24}}>Subscribe to start getting weekly improvements. You'll connect GitHub and Telegram right after checkout.</p>
                <button className="btn" onClick={handleSubscribe} disabled={subscribeLoading} style={{
                  background: subscribeLoading ? C.accent : C.text, color:C.bg, border:'none', borderRadius:9,
                  padding:'13px 26px', fontSize:14, fontFamily:'DM Sans,sans-serif', fontWeight:500,
                  opacity: subscribeLoading ? 0.85 : 1, cursor: subscribeLoading ? 'not-allowed' : 'pointer',
                }}
                  onMouseEnter={e=>{ if (!subscribeLoading) e.currentTarget.style.background=C.accent }}
                  onMouseLeave={e=>{ if (!subscribeLoading) e.currentTarget.style.background=C.text }}
                >{subscribeLoading ? 'Opening Stripe…' : 'Subscribe — €29/mo →'}</button>
                <div style={{ marginTop: 22 }}>
                  <button
                    onClick={() => { setDeleteError(null); setShowDeleteConfirm(true) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, color: C.textLight, fontFamily: 'DM Sans, sans-serif', fontWeight: 300,
                      textDecoration: 'underline', textDecorationColor: 'rgba(160,152,144,0.35)',
                    }}
                  >Delete account</button>
                </div>
              </div>
            )}

            {subscription&&!loading&&(
              <>
                {snippetDeclined&&!isDemo&&(
                  <div style={{
                    marginBottom:16,padding:'10px 16px',
                    background:C.yellowSoft,border:`1px solid ${C.yellowMid}`,borderRadius:8,
                    display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,
                  }}>
                    <span style={{fontSize:12,color:C.yellow,lineHeight:1.4}}>
                      ⚠️ Analytics tracking declined — fix recommendations will be less accurate without visitor data.
                    </span>
                    <button className="btn" onClick={handleReenableSnippet} style={{
                      fontSize:11,padding:'5px 12px',borderRadius:6,flexShrink:0,
                      background:C.yellow,color:'#fff',border:'none',fontFamily:'DM Sans,sans-serif',
                    }}>
                      Re-enable tracking →
                    </button>
                  </div>
                )}
                {activePage==='overview'&&(
                  <div className="fade-up" style={{marginBottom:20}}>
                    <SectionLabel style={{color:C.accent,marginBottom:6}}>Growth Agent Dashboard</SectionLabel>
                    <h1 style={{fontFamily:'Instrument Serif,serif',fontWeight:400,fontSize:'clamp(24px,3vw,38px)',letterSpacing:'-.02em',lineHeight:1.1,color:C.text,marginBottom:4}}>
                      Autonomous growth <em style={{fontStyle:'italic',color:C.accent}}>optimization.</em>
                    </h1>
                    <p style={{fontSize:12,color:C.textLight}}>Your agent analyzes, fixes and improves your website — continuously. · Auto-refreshes every 30s</p>
                  </div>
                )}

                {activePage==='overview'&&(
                  <OverviewPage
                    runs={runs} subscription={subscription}
                    funnelPages={funnelPages} learnings={learnings}
                    impactMetrics={impactMetrics}
                    onSelectRun={setSelected}
                    onTogglePause={handleTogglePause}
                    actionLoading={actionLoading}
                  />
                )}

                {activePage==='runs'&&(
                  <div className="fade-up">
                    <RunsPage runs={runs} loading={loading} onSelect={setSelected}/>
                  </div>
                )}

                {activePage==='insights'&&(
                  <div className="fade-up">
                    <InsightsPage runs={runs} impactMetrics={impactMetrics} learnings={learnings} funnelPages={funnelPages}/>
                  </div>
                )}

                {activePage==='network'&&(
                  <div className="fade-up">
                    <NetworkPage
                      runs={runs}
                      siteNetwork={siteNetwork}
                      websiteUrl={websiteUrl}
                    />
                  </div>
                )}

                {activePage==='funnel'&&(
                  <div className="fade-up">
                    <p style={{fontSize:12,color:C.textMuted,lineHeight:1.7,marginBottom:14}}>
                      The agent automatically detects all pages in your repo and maps the conversion funnel. Pages with high drop-off are prioritized on the next run.
                    </p>
                    {/* FIX #6: funnelPages + loading passed from parent, no second fetch */}
                    <FunnelPage funnelPages={funnelPages} loading={loading}/>
                  </div>
                )}

                {activePage==='dna'&&(
                  <div className="fade-up">
                    <DNAPage subscriptionId={subscription?.id}/>
                  </div>
                )}

                {activePage==='guardrails'&&(
                  <div className="fade-up">
                    <p style={{fontSize:12,color:C.textMuted,lineHeight:1.7,marginBottom:14}}>
                      These rules are enforced on every run — the agent will not make changes that violate them.
                    </p>
                    <GuardrailsPage subscriptionId={subscription?.id}/>
                  </div>
                )}

                {activePage==='settings'&&(
                  <div className="fade-up">
                    <SettingsPage
                      subscription={subscription} user={user}
                      onTogglePause={handleTogglePause} actionLoading={actionLoading}
                      onDeleteRequest={()=>{ setDeleteError(null); setShowDeleteConfirm(true) }}
                      onSaveSettings={handleSaveSettings}
                      navigate={navigate}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Legal footer (§5 TMG — Impressum must be reachable from every page) */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: C.bg }}>
            <span style={{ fontSize: 12, color: C.textLight, fontWeight: 300, fontFamily: 'DM Sans, sans-serif' }}>© 2026 Velyr</span>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.textLight, fontFamily: 'DM Sans, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
              <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.textLight, fontFamily: 'DM Sans, sans-serif', fontWeight: 300 }}>Legal Notice (Impressum)</button>
              <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.textLight, fontFamily: 'DM Sans, sans-serif', fontWeight: 300 }}>AGB</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}