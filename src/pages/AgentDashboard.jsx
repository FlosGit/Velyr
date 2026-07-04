import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { demoData } from '../data/demoData'
import { startCheckout } from '../utils/startCheckout.js'
import CheckoutConfirmModal from '../components/CheckoutConfirmModal.jsx'
import { SiteNetwork } from '../components/SiteNetwork.jsx'
import { buildNetworkData, hubDomainFromUrl } from '../lib/siteNetworkData.js'
import { MOTION_CSS, CountUp } from '../lib/motion.jsx'

// ─── DESIGN TOKENS (redesign 2026-07: warm cream canvas + deep-green sidebar) ──
const C = {
  bg:           '#EFEDE4',
  bgCard:       '#FFFFFF',
  bgSoft:       '#FBFAF4',   // inputs at rest, row hover
  bgChip:       '#F4F2E9',   // neutral chips
  sidebar:      '#1E362B',
  text:         '#1C2420',
  textMuted:    '#6B7266',
  textLight:    '#9A9E93',
  textFaint:    '#A8AB9E',
  label:        '#8B8F80',   // uppercase section labels
  border:       '#E3E0D4',
  borderSoft:   '#F0EEE3',   // inner row dividers
  borderMed:    '#D8D5C8',
  ink:          '#1E362B',   // primary buttons, big serif numbers
  inkHover:     '#2C4A3B',
  accent:       '#3E6B54',   // links, progress fills
  accentBar:    '#7FA98F',   // soft green bars
  chipBg:       '#EFF3EC',   // file-path chips
  chipText:     '#4A6B58',
  green:        '#3E7A56', greenBg: '#E4EEE4', greenText: '#2C5B3F',
  yellow:       '#C9A227', yellowBg: '#F5EEDC', yellowText: '#8A6D1F',
  red:          '#C0553F', redBg: '#F6E7E4',  redText: '#9C3B2E',
  gray:         '#9A9E93', grayBg: '#ECEBE6',  grayText: '#6B7266',
  banner:       '#E9EFE7', bannerBorder: '#D3DECF', bannerText: '#33463B',
  dangerBorder: '#EBD9D4',
  // dark sidebar foregrounds
  sideText:     '#F4F2E9',
  sideMuted:    '#9DB3A6',
  sideFaint:    '#8FA697',
  sideDim:      '#5F7A6B',
}

const FONT = {
  sans:  "'Poppins', system-ui, sans-serif",
  serif: "'Newsreader', Georgia, serif",
  mono:  "ui-monospace, Menlo, Consolas, monospace",
}
// The Network graph keeps its pre-redesign look — these fonts are passed only
// to <SiteNetwork/> and are imported solely for it (see CSS @import below).
const NETWORK_FONTS = {
  sans:  "'DM Sans', sans-serif",
  serif: "'Instrument Serif', serif",
  mono:  "'DM Mono', monospace",
}

const STATUS = {
  running:          { label: 'Running',           bg: C.chipBg,  color: C.accent,    dot: C.yellow },
  waiting_approval: { label: 'Awaiting approval', bg: C.yellowBg, color: C.yellowText, dot: C.yellow },
  deployed:         { label: 'Deployed',          bg: C.greenBg,  color: C.greenText,  dot: C.green },
  approved:         { label: 'Deployed',          bg: C.greenBg,  color: C.greenText,  dot: C.green },
  rejected:         { label: 'Rejected',          bg: C.redBg,    color: C.redText,    dot: C.red },
  failed:           { label: 'Failed',            bg: C.redBg,    color: C.redText,    dot: C.red },
  pending:          { label: 'Pending',           bg: C.grayBg,   color: C.grayText,   dot: C.gray },
  rolled_back:      { label: 'Rolled back',       bg: C.grayBg,   color: C.grayText,   dot: C.gray },
  // Shopify-direct lifecycle — same concepts as the GitHub statuses above
  // (the fix is a staged live-theme write instead of a PR), so they share the
  // same labels and visual language rather than falling through to "Pending".
  shopify_awaiting_approval: { label: 'Awaiting approval',      bg: C.yellowBg, color: C.yellowText, dot: C.yellow },
  shopify_deployed:          { label: 'Deployed',               bg: C.greenBg,  color: C.greenText,  dot: C.green },
  shopify_rejected:          { label: 'Rejected',               bg: C.redBg,    color: C.redText,    dot: C.red },
  shopify_rolled_back:       { label: 'Rolled back',            bg: C.grayBg,   color: C.grayText,   dot: C.gray },
  shopify_rollback_pending:  { label: 'Rollback proposed',      bg: C.yellowBg, color: C.yellowText, dot: C.yellow },
  shopify_concurrency_abort: { label: 'Aborted — theme edited', bg: C.grayBg,   color: C.grayText,   dot: C.gray },
  shopify_needs_reconsent:   { label: 'Reconnect Shopify',      bg: C.redBg,    color: C.redText,    dot: C.red },
  shopify_token_failed:      { label: 'Failed',                 bg: C.redBg,    color: C.redText,    dot: C.red },
  shopify_theme_read_failed: { label: 'Failed',                 bg: C.redBg,    color: C.redText,    dot: C.red },
}

// Cross-path status groups. The Shopify-direct lifecycle mirrors the GitHub one
// (shopify_awaiting_approval ≙ waiting_approval, shopify_deployed ≙ deployed, …);
// every "is it pending / is it live" check goes through these helpers so the two
// paths can't drift apart again.
const isAwaitingApproval = r => r.status === 'waiting_approval' || r.status === 'shopify_awaiting_approval'
const isLive             = r => r.status === 'deployed' || r.status === 'approved' || r.status === 'shopify_deployed'
// Runs-page filter chips → the statuses each one matches.
const STATUS_GROUP = {
  deployed:         ['deployed', 'approved', 'shopify_deployed'],
  waiting_approval: ['waiting_approval', 'shopify_awaiting_approval', 'shopify_rollback_pending'],
  rejected:         ['rejected', 'shopify_rejected'],
  rolled_back:      ['rolled_back', 'shopify_rolled_back'],
  failed:           ['failed', 'shopify_token_failed', 'shopify_theme_read_failed', 'shopify_needs_reconsent'],
}

const AGENT_STEPS = [
  { id:'fetch_repo',  label:'Fetching source',         desc:'Reading your repo or theme structure' },
  { id:'fetch_ph',    label:'Pulling analytics',       desc:'Loading PostHog pageview & session data' },
  { id:'scan_comp',   label:'Scanning competitors',    desc:'Checking tracked competitor sites for changes' },
  { id:'seasonal',    label:'Checking seasonal',       desc:'Picking the right priority for this month' },
  { id:'read_dna',    label:'Reading Business DNA',    desc:'Loading what works and what to avoid' },
  { id:'map_funnel',  label:'Mapping funnel',          desc:'Detecting pages and conversion flow' },
  { id:'analyze',     label:'Finding biggest issue',   desc:'Claude analyzing where visitors drop off' },
  { id:'screenshot',  label:'Taking before screenshot',desc:'Capturing the page before any changes' },
  { id:'write_fix',   label:'Writing fix',             desc:'Editing file and generating patch' },
  { id:'open_pr',     label:'Preparing fix',           desc:'Opening a PR (GitHub) or staging the theme change (Shopify)' },
  { id:'notify',      label:'Sending notification',    desc:'Telegram message — reply YES or NO' },
]

// Sidebar nav — SVG stroke icons (24×24 paths, rendered at 15px).
const NAV_ITEMS = [
  { id:'overview',   label:'Overview',   icon:'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
  { id:'runs',       label:'Runs',       icon:'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6' },
  { id:'network',    label:'Network',    icon:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2c3 3 3 17 0 20c-3-3-3-17 0-20' },
  { id:'funnel',     label:'Funnel',     icon:'M3 4h18l-7 8v6l-4 2v-8L3 4z' },
  { id:'dna',        label:'DNA',        icon:'M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12M6 15c0 3 2 6 6 6M18 15c0 3-2 6-6 6' },
  { id:'guardrails', label:'Guardrails', icon:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { id:'settings',   label:'Settings',   icon:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.07-.4.1-.8.1-1.2z' },
]
const PAGE_TITLES = { overview:'Overview', runs:'Runs', network:'Network', funnel:'Funnel', dna:'DNA', guardrails:'Guardrails', settings:'Settings' }

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap');
  /* Kept ONLY for the Network graph, which stays on its pre-redesign look. */
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { background: ${C.bg}; color: ${C.text}; font-family: ${FONT.sans}; font-weight: 400; -webkit-font-smoothing: antialiased; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  img, svg, video { max-width: 100%; }
  @keyframes spin    { to { transform: rotate(360deg); } }
  @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
  @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
  @keyframes popIn   { from{opacity:0;transform:scale(.97)} to{opacity:1;transform:scale(1)} }
  @keyframes streamIn{ from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
  @keyframes reveal  { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
  .fade-up   { animation: fadeUp .35s cubic-bezier(.22,.61,.36,1) both; }
  .fade-in   { animation: fadeIn .3s ease both; }
  .pop-in    { animation: popIn .28s cubic-bezier(.22,.61,.36,1) both; }
  .stream-in { animation: streamIn .25s ease both; }
  .reveal-in { animation: reveal .25s ease both; }
  .pulse-dot { animation: pulse 2.4s ease-in-out infinite; }
  .spin      { animation: spin .7s linear infinite; }
  /* Page transition: re-triggered by keying the wrapper on the active tab. */
  .page-in   { animation: fadeUp .35s cubic-bezier(.22,.61,.36,1) both; }

  .nav-item  { cursor:pointer; transition: background .18s ease, color .18s ease; border:none; background:none; width:100%; text-align:left; }
  .nav-item:hover { background: rgba(255,255,255,.07); }
  .run-row   { cursor:pointer; transition: background .15s ease; }
  .run-row:hover { background: ${C.bgSoft}; }
  .btn       { cursor:pointer; transition: background .18s ease, color .18s ease, border-color .18s ease, opacity .18s ease; border:none; font-family:${FONT.sans}; }
  .btn:active{ transform: scale(.985); }
  .btn-primary { background:${C.ink}; color:${C.sideText}; }
  .btn-primary:hover:not(:disabled) { background:${C.inkHover}; }
  .btn-ghost { background:none; border:1px solid ${C.borderMed}; color:#4A5248; }
  .btn-ghost:hover:not(:disabled) { background:#F7F5EC; }
  .btn-danger-ghost { background:none; border:1px solid ${C.dangerBorder}; color:${C.redText}; }
  .btn-danger-ghost:hover:not(:disabled) { background:#F6EBE8; }
  .link-green { color:${C.accent}; font-weight:500; cursor:pointer; text-decoration:none; }
  .link-green:hover { text-decoration: underline; }
  .card-hover { transition: box-shadow .22s ease, transform .18s ease, border-color .22s ease; }
  .card-hover:hover { box-shadow: 0 6px 24px rgba(30,54,43,.08); transform: translateY(-1px); }
  .chip-x { cursor:pointer; border:none; width:17px; height:17px; border-radius:50%; font-size:11px; line-height:1; display:grid; place-items:center; font-family:${FONT.sans}; transition: background .15s ease; }
  .table-scroll { overflow-x:auto; }
  ::-webkit-scrollbar { width:4px; height:4px; }
  ::-webkit-scrollbar-thumb { background:rgba(30,54,43,.18); border-radius:3px; }
  ::-webkit-scrollbar-track { background:transparent; }
  input, textarea { font-family:${FONT.sans}; outline:none; }
  input:focus, textarea:focus { border-color:${C.accent} !important; background:#FFFFFF !important; }
  ::placeholder { color:${C.textFaint}; }
  a { color:${C.accent}; }

  /* Toggle switch (settings) */
  .toggle { width:42px; height:24px; border-radius:12px; position:relative; cursor:pointer; flex:none; transition: background .22s ease; border:none; }
  .toggle .knob { width:18px; height:18px; border-radius:50%; background:#FFFFFF; position:absolute; top:3px; transition: left .22s cubic-bezier(.22,.61,.36,1); box-shadow:0 1px 3px rgba(0,0,0,.25); }

  /* Responsive grids (classes, not inline, so media queries can restyle) */
  .dash-hero   { display:grid; grid-template-columns:1.3fr 1fr auto; }
  .dash-kpis   { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
  .dash-cols   { display:grid; grid-template-columns:2fr 1fr; gap:14px; align-items:start; }
  .funnel-top  { display:grid; grid-template-columns:1.6fr 1fr; gap:14px; align-items:start; }
  .approval-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; }
  .strip-grid  { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .hero-cell   { padding:22px 26px; border-right:1px solid ${C.borderSoft}; }
  .hero-cell:last-child { border-right:none; }

  /* Drawer affordances are hidden on desktop; the ≤900 block reveals them. */
  .dash-hamburger { display: none; }
  .dash-scrim { display: none; }
  .dash-drawer-close { display: none; }
  .dash-header-badge-m { display: none; } /* mobile-only stacked pending badge */

  @media (max-width: 1100px) {
    .dash-kpis { grid-template-columns:1fr 1fr; }
    .dash-cols { grid-template-columns:1fr; }
    .funnel-top { grid-template-columns:1fr; }
  }
  @media (max-width: 1000px) {
    .dash-hero { grid-template-columns:1fr; }
    .hero-cell { border-right:none; border-bottom:1px solid ${C.borderSoft}; }
    .hero-cell:last-child { border-bottom:none; }
    .approval-grid { grid-template-columns:1fr; }
  }
  @media (max-width: 700px) {
    .strip-grid { grid-template-columns:1fr 1fr; }
  }
  /* ── Mobile responsiveness ── */
  @media (max-width: 900px) {
    /* Sidebar → off-canvas slide-in drawer with the full vertical nav. */
    .dash-sidebar {
      position: fixed !important; top: 0 !important; left: 0 !important;
      height: 100vh !important; width: 270px !important; max-width: 84vw;
      transform: translateX(-100%);
      transition: transform .28s cubic-bezier(.4,0,.2,1);
      z-index: 80;
    }
    .dash-shell.drawer-open .dash-sidebar {
      transform: translateX(0);
      box-shadow: 0 12px 40px rgba(20,32,26,.4);
    }
    .dash-sidebar .nav-item { min-height: 44px !important; }
    .dash-scrim {
      display: block; position: fixed; inset: 0; z-index: 70;
      background: rgba(20,32,26,.45);
      opacity: 0; pointer-events: none;
      transition: opacity .28s ease;
    }
    .dash-shell.drawer-open .dash-scrim { opacity: 1; pointer-events: auto; }
    .dash-hamburger { display: inline-flex !important; }
    .dash-drawer-close { display: flex !important; }
    .dash-header-badge-d { display: none !important; }
    .dash-header-badge-m { display: inline-flex !important; }
    .dash-main { width: 100% !important; }
    .dash-content-pad { padding: 18px 16px 40px !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dash-sidebar, .dash-scrim { transition: none !important; }
  }
  @media (max-width: 600px) {
    .dash-kpis { grid-template-columns:1fr 1fr; }
    .hero-cell { padding:18px 18px; }
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
    case 'shopify_awaiting_approval':
    case 'shopify_deployed':
    case 'shopify_rejected':
    case 'shopify_rolled_back':
      return lastIdx
    case 'failed':
      return midIdx
    default:
      return -1
  }
}

// Shared Stripe Billing Portal opener (subscription card + danger-zone cancel).
async function openBillingPortal() {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/stripe?action=portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}` },
  })
  const data = await res.json()
  if (data.url) window.location.href = data.url
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
// The real Velyr mark (the mockup's simplified logo was explicitly not accurate).
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

function NavIcon({ path, size=15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.85, flexShrink:0}}>
      <path d={path}/>
    </svg>
  )
}

function StatusBadge({ status, small }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{
      fontSize:small?10:10.5, fontWeight:500,
      padding:small?'3px 9px':'4px 11px', borderRadius:20,
      background:s.bg, color:s.color,
      whiteSpace:'nowrap', display:'inline-flex', alignItems:'center', gap:5,
    }}>
      {status==='running'&&(
        <span className="pulse-dot" style={{width:5,height:5,borderRadius:'50%',background:s.dot,display:'inline-block'}}/>
      )}
      {s.label}
    </span>
  )
}

function Spinner({size=18}) {
  return <div style={{width:size,height:size,border:`1.5px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin .7s linear infinite',flexShrink:0}}/>
}

function SectionLabel({children, style}) {
  return <p style={{fontSize:10.5,letterSpacing:'.14em',textTransform:'uppercase',fontWeight:500,color:C.label,...style}}>{children}</p>
}

function Card({children,style,className,onClick}) {
  return (
    <div className={className} onClick={onClick} style={{
      background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,
      ...style
    }}>
      {children}
    </div>
  )
}

// Status-tinted 26px icon square used by activity + run rows.
function StatusDotIcon({status}) {
  const s = STATUS[status] || STATUS.pending
  return (
    <div style={{width:26,height:26,borderRadius:8,background:s.bg,display:'grid',placeItems:'center',flexShrink:0}}>
      <span className={status==='running'?'pulse-dot':''} style={{width:7,height:7,borderRadius:'50%',background:s.dot,display:'inline-block'}}/>
    </div>
  )
}

function FileChip({children, style}) {
  return (
    <span style={{
      fontFamily:FONT.mono,fontSize:10.5,color:C.chipText,background:C.chipBg,
      borderRadius:5,padding:'2px 7px',maxWidth:220,overflow:'hidden',
      textOverflow:'ellipsis',whiteSpace:'nowrap',display:'inline-block',...style,
    }}>{children}</span>
  )
}

// Green info banner used by Funnel / DNA / Guardrails headers.
function InfoBanner({iconPath, children, right}) {
  return (
    <div className="fade-up" style={{
      display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,
      background:C.banner,border:`1px solid ${C.bannerBorder}`,borderRadius:10,
      padding:'11px 16px',marginBottom:20,
    }}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d={iconPath}/></svg>
        <span style={{fontSize:12,color:C.bannerText,lineHeight:1.5}}>{children}</span>
      </div>
      {right}
    </div>
  )
}

function Toggle({on, onClick, disabled, label}) {
  return (
    <button className="toggle" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on}
      style={{background:on?C.accent:'#C9C6B8',opacity:disabled?.55:1,cursor:disabled?'not-allowed':'pointer'}}>
      <span className="knob" style={{left:on?21:3}}/>
    </button>
  )
}

// ─── PENDING APPROVAL CARD ────────────────────────────────────────────────────
// One card for both delivery mechanisms: a GitHub run carries pr_number/pr_url
// (fix = pull request), a Shopify-direct run carries neither (fix = staged
// live-theme write, applied on the Telegram YES). Same layout, honest labels.
function PendingApprovalCard({run}) {
  const analysis = run.analysis_result || {}
  const isThemeWrite = run.status === 'shopify_awaiting_approval'
  // Analytics Setup-PR / setup-write runs carry no analysis_result — label them
  // honestly instead of defaulting to "Conversion issue detected" (both paths).
  const isSetup = run.run_type === 'setup_posthog' || run.run_type === 'setup_posthog_foreign_choice'
  // Only show a confidence figure when the agent actually returned one.
  const rawConf = analysis.confidence_score ?? analysis.confidence
  const confNum = typeof rawConf === 'number' ? rawConf : null

  return (
    <Card className="fade-up" style={{overflow:'hidden',borderColor:'#EADFC2',boxShadow:'0 10px 34px rgba(201,162,39,.12)'}}>
      <div style={{
        background:C.yellowBg,borderBottom:'1px solid #EADFC2',padding:'11px 22px',
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="pulse-dot" style={{width:8,height:8,borderRadius:'50%',background:C.yellow,display:'inline-block',flexShrink:0}}/>
          <SectionLabel style={{color:C.yellowText,marginBottom:0}}>
            {isThemeWrite ? 'Awaiting your approval · Theme fix' : `Awaiting your approval · PR #${run.pr_number||'—'}`}
          </SectionLabel>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {isThemeWrite ? (
            <span style={{fontSize:11,color:C.chipText,background:C.chipBg,borderRadius:6,padding:'4px 10px',fontWeight:500}}>
              Applied to your live theme on approval
            </span>
          ) : (
            <a href={run.pr_url} target="_blank" rel="noreferrer" className="v-press" style={{
              fontSize:11,color:C.chipText,background:C.chipBg,borderRadius:6,padding:'4px 10px',
              textDecoration:'none',fontWeight:500,
            }}>View on GitHub ↗</a>
          )}
          <span style={{fontSize:11,color:C.yellowText}}>
            Reply <code style={{fontFamily:FONT.mono,fontSize:10,fontWeight:600}}>YES</code> or <code style={{fontFamily:FONT.mono,fontSize:10,fontWeight:600}}>NO</code> on Telegram
          </span>
        </div>
      </div>

      <div className="approval-grid" style={{padding:'18px 22px'}}>
        <div style={{minWidth:0}}>
          <SectionLabel style={{marginBottom:8}}>Problem identified</SectionLabel>
          <p style={{fontSize:13,fontWeight:500,color:C.text,lineHeight:1.5,marginBottom:6}}>
            {analysis.problem || (isSetup ? 'Analytics not installed yet' : 'Conversion issue detected')}
          </p>
          {analysis.data_insight && (
            <p style={{fontSize:11,color:C.textMuted,lineHeight:1.55}}>{analysis.data_insight}</p>
          )}
        </div>

        <div style={{minWidth:0}}>
          <SectionLabel style={{marginBottom:8}}>Fix prepared</SectionLabel>
          <p style={{fontSize:12,color:C.text,lineHeight:1.5,marginBottom:8}}>
            {analysis.solution || (isSetup ? 'One-time install of the Velyr analytics snippet' : 'Code changes applied')}
          </p>
          {analysis.file_to_edit && <FileChip style={{maxWidth:'100%',display:'block'}}>{analysis.file_to_edit}</FileChip>}
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:10,minWidth:0}}>
          <SectionLabel style={{marginBottom:0}}>Expected impact</SectionLabel>
          {analysis.expected_improvement ? (
            <div style={{display:'flex',alignItems:'baseline',gap:6}}>
              <span style={{fontFamily:FONT.serif,fontSize:30,fontWeight:500,color:C.green,lineHeight:1}}>
                {analysis.expected_improvement}
              </span>
              <span style={{fontSize:11,color:C.textMuted}}>conversion</span>
            </div>
          ) : (
            <p style={{fontSize:12,color:C.textMuted,lineHeight:1.5}}>Measured after deploy.</p>
          )}
          {confNum!=null && (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:10,color:C.textLight}}>Confidence</span>
                <span style={{fontSize:10,fontWeight:500,color:C.text}}>{confNum}%</span>
              </div>
              <div style={{height:4,background:C.borderSoft,borderRadius:2,overflow:'hidden'}}>
                <div className="v-bar-fill" style={{height:'100%',width:`${confNum}%`,'--v-w':`${confNum}%`,background:confNum>75?C.green:confNum>50?C.yellow:C.red,borderRadius:2}}/>
              </div>
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}>
            <span style={{color:C.textLight}}>Auto-rollback</span>
            <span style={{color:C.textMuted}}>48h if no uplift</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── STATUS HERO (Overview) ───────────────────────────────────────────────────
function StatusHero({subscription, runs, onTogglePause, actionLoading, onTriggerRun, triggerLoading, triggerMessage, onSelectRun}) {
  const isPaused  = subscription?.status==='paused'
  const activeRun = runs.find(r=>r.status==='running')
  const isRunning = !!activeRun
  const lastRun   = runs[0]||null
  const pending   = runs.filter(isAwaitingApproval)

  // "Run now" gating: blocked while a run is running/awaiting approval (this is
  // also what stops a double-run right after the post-onboarding auto-run), or
  // within the 24h manual-run cooldown (last_manual_run_at). Scheduled cron runs
  // and the auto-run never set last_manual_run_at, so they don't consume it.
  const inFlight             = isRunning || pending.length > 0
  const lastManualMs         = subscription?.last_manual_run_at ? new Date(subscription.last_manual_run_at).getTime() : 0
  const manualCooldownLeftMs = lastManualMs ? Math.max(0, 24*3600000 - (Date.now() - lastManualMs)) : 0
  const runNowDisabled       = isPaused || inFlight || manualCooldownLeftMs > 0 || triggerLoading
  const runNowLabel = triggerLoading ? '…'
    : inFlight ? 'Run in progress'
    : manualCooldownLeftMs > 0 ? `Next run in ${manualCooldownLeftMs >= 3600000 ? Math.ceil(manualCooldownLeftMs/3600000)+'h' : '<1h'}`
    : 'Run now'

  const target = useMemo(() => nextMonday9am(), [])
  const countdown = useCountdown(target)
  const stepIdx = isRunning ? deriveAgentStep(activeRun) : -1

  const now = new Date()
  const weekMs = 7*24*3600000
  const weekProgress = Math.min(100,Math.max(0,((now-(new Date(target.getTime()-weekMs)))/weekMs)*100))

  let heroLabel, heroDot, heroBig, heroNote, heroProgress
  if (isPaused) {
    heroLabel='AGENT PAUSED'; heroDot=C.gray
    heroBig='On hold'; heroNote='No runs scheduled — resume any time.'; heroProgress=0
  } else if (isRunning) {
    heroLabel='AGENT RUNNING'; heroDot=C.yellow
    heroBig=`Step ${Math.max(stepIdx,0)+1} of ${AGENT_STEPS.length}`
    heroNote=AGENT_STEPS[stepIdx]?.label ? `${AGENT_STEPS[stepIdx].label} — ${AGENT_STEPS[stepIdx].desc}` : 'Analyzing your site…'
    heroProgress=Math.round(((Math.max(stepIdx,0)+1)/AGENT_STEPS.length)*100)
  } else {
    heroLabel='AGENT IDLE · NEXT RUN IN'; heroDot=C.green
    heroBig=countdown.str||'—'; heroNote='Every Monday · 9:00 am'; heroProgress=Math.round(weekProgress)
  }

  // Last-run summary column
  const lastSteps = lastRun ? deriveAgentStep(lastRun)+1 : 0
  const lastOutcome = !lastRun ? null
    : lastRun.status==='running' ? 'Run in progress right now'
    : isLive(lastRun) ? '1 fix shipped to production'
    : isAwaitingApproval(lastRun) ? '1 fix awaiting your approval'
    : lastRun.status==='rejected'||lastRun.status==='shopify_rejected' ? 'Fix rejected — nothing shipped'
    : lastRun.status==='rolled_back'||lastRun.status==='shopify_rolled_back' ? 'Change rolled back'
    : lastRun.status==='failed' ? 'Run failed — no changes made'
    : (STATUS[lastRun.status]?.label || 'Completed')

  return (
    <Card className="fade-up dash-hero" style={{overflow:'hidden',marginBottom:14}}>
      <div className="hero-cell">
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
          <span className="pulse-dot" style={{width:8,height:8,borderRadius:'50%',background:heroDot,display:'inline-block',flexShrink:0}}/>
          <SectionLabel style={{marginBottom:0}}>{heroLabel}</SectionLabel>
        </div>
        <p style={{fontFamily:FONT.serif,fontSize:'clamp(32px, 4vw, 44px)',lineHeight:1,fontWeight:500,color:C.ink,minHeight:44}}>{heroBig}</p>
        <p style={{fontSize:12,color:C.textMuted,marginTop:10}}>{heroNote}</p>
        <div style={{height:4,background:'#EDEBE0',borderRadius:2,marginTop:16,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${heroProgress}%`,background:C.accent,borderRadius:2,transition:'width 1s ease'}}/>
        </div>
      </div>

      <div className="hero-cell">
        <SectionLabel style={{marginBottom:14}}>{lastRun?`Last run · ${timeAgo(lastRun.created_at)}`:'Last run'}</SectionLabel>
        {lastRun ? (
          <>
            <p style={{fontSize:13.5,fontWeight:500,lineHeight:1.45,color:C.text}}>
              {lastSteps>0?`${lastSteps} step${lastSteps===1?'':'s'} completed`:'Run recorded'}<br/>{lastOutcome}
            </p>
            <button className="link-green btn" onClick={()=>onSelectRun(lastRun)} style={{
              background:'none',border:'none',padding:0,fontSize:12,marginTop:12,fontFamily:FONT.sans,
            }}>View run details →</button>
          </>
        ) : (
          <p style={{fontSize:13,color:C.textMuted,lineHeight:1.55}}>No runs yet.<br/>Your first run kicks off Monday at 9:00 — or start one now.</p>
        )}
      </div>

      <div className="hero-cell" style={{display:'flex',flexDirection:'column',gap:9,justifyContent:'center',minWidth:200}}>
        {!isPaused && (
          <button className="btn btn-primary v-press" onClick={onTriggerRun} disabled={runNowDisabled} style={{
            fontSize:12.5,fontWeight:500,borderRadius:9,padding:'10px 18px',
            opacity:runNowDisabled?.55:1,cursor:runNowDisabled?'not-allowed':'pointer',
          }}>{runNowLabel}</button>
        )}
        <button className="btn btn-ghost" onClick={onTogglePause} disabled={actionLoading} style={{
          fontSize:12.5,borderRadius:9,padding:'10px 18px',
          opacity:actionLoading?.55:1,cursor:actionLoading?'not-allowed':'pointer',
        }}>
          {actionLoading?'…':isPaused?'Resume agent':'Pause agent'}
        </button>
        {triggerMessage && (
          <p className="reveal-in" style={{fontSize:11,lineHeight:1.5,color:triggerMessage.error?C.redText:C.accent}}>{triggerMessage.text}</p>
        )}
        {!isPaused && !inFlight && manualCooldownLeftMs===0 && !triggerMessage && (
          <p style={{fontSize:10,color:C.textLight,lineHeight:1.4,textAlign:'center'}}>One manual run/day · scheduled runs continue automatically</p>
        )}
      </div>
    </Card>
  )
}

// ─── KPI ROW (Overview) ───────────────────────────────────────────────────────
function KpiRow({runs}) {
  const total    = runs.length
  const deployed = runs.filter(isLive).length
  const rate     = total>0 ? Math.round((deployed/total)*100) : null
  const pending  = runs.filter(isAwaitingApproval)

  const oneWeekAgo = new Date(Date.now() - 7 * 86400000)
  const thisWeek = runs.filter(r=>new Date(r.created_at)>oneWeekAgo&&isLive(r)).length
  const firstRun = runs.length ? runs[runs.length-1] : null
  const sinceStr = firstRun ? new Date(firstRun.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : null
  const pendingHint = pending[0]?.analysis_result?.problem

  const kpis = [
    {
      label:'Fixes live', num:deployed, format:n=>Math.round(n).toLocaleString(),
      sub: thisWeek>0?`+${thisWeek} this week`:'Shipped to production',
      subColor: thisWeek>0?C.accent:C.label,
    },
    {
      label:'Deploy rate', num:rate??0, format:n=>rate==null?'—':`${Math.round(n)}%`,
      sub: total>0?`${deployed} of ${total} held in production`:'No runs yet',
      subColor: C.label,
    },
    {
      label:'Runs completed', num:total, format:n=>Math.round(n).toLocaleString(),
      sub: sinceStr?`since ${sinceStr}`:'Analyzed since launch',
      subColor: C.label,
    },
    {
      label:'Awaiting review', num:pending.length, format:n=>Math.round(n).toLocaleString(),
      sub: pending.length>0?(pendingHint?pendingHint.slice(0,42)+(pendingHint.length>42?'…':''):'Reply YES or NO on Telegram'):'Nothing waiting on you',
      subColor: pending.length>0?C.yellowText:C.label,
    },
  ]

  return (
    <div className="dash-kpis v-stagger" style={{marginBottom:14}}>
      {kpis.map((k,i)=>(
        <Card key={i} className="card-hover" style={{padding:'18px 22px'}}>
          <SectionLabel>{k.label}</SectionLabel>
          <p style={{fontFamily:FONT.serif,fontSize:38,fontWeight:500,lineHeight:1.15,color:C.ink,marginTop:8}}>
            <CountUp value={k.num} format={k.format}/>
          </p>
          <p style={{fontSize:11.5,color:k.subColor,marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.sub}</p>
        </Card>
      ))}
    </div>
  )
}

// ─── ACTIVITY CARD (Overview) ─────────────────────────────────────────────────
// Real run-outcome timeline rows only. Pending fixes live in PendingApprovalCard
// + the header badge; this stream is "actions taken", so running + awaiting-
// approval rows are skipped to avoid duplication.
function ActivityCard({runs, onSelectRun, onGoRuns}) {
  const items = runs
    .filter(r => r.status!=='running' && !isAwaitingApproval(r))
    .slice(0,5)

  return (
    <Card className="fade-up" style={{padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:6}}>
        <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Activity</p>
        <button className="link-green btn" onClick={onGoRuns} style={{background:'none',border:'none',padding:0,fontSize:11.5,fontFamily:FONT.sans}}>All runs →</button>
      </div>
      {items.length===0 && (
        <p style={{fontSize:12,color:C.textLight,padding:'18px 0',textAlign:'center'}}>
          No completed runs yet. Kick one off with Run now, or wait for Monday morning.
        </p>
      )}
      {items.map((run,i)=>{
        const analysis = run.analysis_result||{}
        return (
          <div key={run.id} className="stream-in run-row" onClick={()=>onSelectRun(run)} style={{
            animationDelay:`${i*0.05}s`,
            display:'grid',gridTemplateColumns:'26px 1fr auto',gap:12,alignItems:'center',
            padding:'13px 0',borderBottom:i<items.length-1?`1px solid ${C.borderSoft}`:'none',
          }}>
            <StatusDotIcon status={run.status}/>
            <div style={{minWidth:0}}>
              <p style={{fontSize:13,fontWeight:500,lineHeight:1.35,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {analysis.problem || (STATUS[run.status]?.label || 'Run')}
              </p>
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4}}>
                {analysis.file_to_edit && <FileChip>{analysis.file_to_edit.split('/').pop()}</FileChip>}
                <span style={{fontSize:11,color:C.textLight}}>{timeAgo(run.created_at)}</span>
              </div>
            </div>
            <StatusBadge status={run.status}/>
          </div>
        )
      })}
    </Card>
  )
}

// ─── PERFORMANCE CARD (Overview sidebar column) ───────────────────────────────
function PerformanceCard({runs}) {
  const deployed = runs.filter(isLive).length
  const total    = runs.length
  const rate     = total>0?Math.round((deployed/total)*100):0
  const failed   = runs.filter(r=>['failed','rejected','shopify_rejected','shopify_token_failed','shopify_theme_read_failed'].includes(r.status)).length

  // Run history — oldest → latest, colored by outcome (deployed = soft green).
  const history = [...runs].slice(0,26).reverse()
  const oldest  = history[0]

  return (
    <Card className="fade-up" style={{padding:'20px 24px',animationDelay:'.08s'}}>
      <p style={{fontSize:13.5,fontWeight:600,color:C.text,marginBottom:14}}>Performance</p>
      <div style={{display:'flex',gap:26}}>
        <div>
          <p style={{fontFamily:FONT.serif,fontSize:30,fontWeight:500,color:C.accent,lineHeight:1}}>
            <CountUp value={rate} format={n=>`${Math.round(n)}%`}/>
          </p>
          <p style={{fontSize:11,color:C.label,marginTop:2}}>Deploy rate</p>
        </div>
        <div>
          <p style={{fontFamily:FONT.serif,fontSize:30,fontWeight:500,color:C.ink,lineHeight:1}}>
            <CountUp value={failed}/>
          </p>
          <p style={{fontSize:11,color:C.label,marginTop:2}}>Failed / rejected</p>
        </div>
      </div>
      {history.length>0 && (
        <>
          <SectionLabel style={{margin:'18px 0 8px'}}>Run history</SectionLabel>
          <div style={{display:'flex',alignItems:'flex-end',gap:3,height:38}}>
            {history.map((run,i)=>{
              const s = STATUS[run.status]||STATUS.pending
              const h = isLive(run)?'100%':isAwaitingApproval(run)?'66%':run.status==='failed'||run.status==='rejected'||run.status==='shopify_rejected'?'34%':'56%'
              const bg = isLive(run)?C.accentBar:s.dot
              return (
                <div key={run.id} title={`${s.label} · ${timeAgo(run.created_at)}`} className="v-bar-fill" style={{
                  flex:1,borderRadius:2,height:h,background:bg,animationDelay:`${i*0.02}s`,
                }}/>
              )
            })}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:9.5,color:C.textFaint,marginTop:5}}>
            <span>{oldest?new Date(oldest.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'oldest'}</span>
            <span>today</span>
          </div>
        </>
      )}
      {history.length===0 && (
        <p style={{fontSize:11,color:C.textLight,marginTop:14}}>Run history appears after your first run.</p>
      )}
    </Card>
  )
}

// ─── GUARDRAILS TEASER (Overview sidebar column) ─────────────────────────────
function GuardrailsTeaser({subscriptionId, onGoGuardrails}) {
  const [ruleCount, setRuleCount] = useState(null)

  useEffect(()=>{
    if(!subscriptionId) return
    supabase.from('agent_brand_guardrails').select('tone,forbidden_patterns,protected_elements,custom_rules')
      .eq('subscription_id',subscriptionId).maybeSingle()
      .then(({data})=>{
        if(!data){ setRuleCount(0); return }
        setRuleCount(
          (data.tone?1:0) +
          (data.forbidden_patterns?.length||0) +
          (data.protected_elements?.length||0) +
          (data.custom_rules?1:0)
        )
      })
  },[subscriptionId])

  return (
    <Card className="fade-up card-hover" style={{padding:'18px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,animationDelay:'.12s'}}>
      <div>
        <p style={{fontSize:12.5,fontWeight:600,color:C.text}}>Guardrails</p>
        <p style={{fontSize:11,color:C.label,marginTop:2}}>
          {ruleCount==null ? 'Rules enforced on every run'
            : ruleCount>0 ? `${ruleCount} rule${ruleCount===1?'':'s'} enforced on every run`
            : 'Set brand rules the agent must follow'}
        </p>
      </div>
      <button className="link-green btn" onClick={onGoGuardrails} style={{background:'none',border:'none',padding:0,fontSize:11.5,whiteSpace:'nowrap',fontFamily:FONT.sans}}>Edit →</button>
    </Card>
  )
}

// ─── BUSINESS DNA STRIP (Overview) ───────────────────────────────────────────
function AgentLearningStrip({learnings, onGoDna}) {
  if (learnings.length===0) return null

  const wins    = learnings.filter(l=>l.outcome==='positive').length
  const losses  = learnings.filter(l=>l.outcome==='negative').length
  const rate    = Math.round((wins/learnings.length)*100)
  const posAvgDelta = learnings.filter(l=>l.outcome==='positive'&&l.delta)
  const avgLift = posAvgDelta.length>0?Math.round(posAvgDelta.reduce((s,l)=>s+(l.delta||0),0)/posAvgDelta.length):null

  return (
    <Card className="fade-up" style={{padding:'20px 24px',animationDelay:'.15s'}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:14}}>
        <div>
          <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Business DNA</p>
          <p style={{fontSize:11,color:C.label,marginTop:2}}>What worked on your site, and what didn’t — read on every run</p>
        </div>
        <button className="link-green btn" onClick={onGoDna} style={{background:'none',border:'none',padding:0,fontSize:11.5,fontFamily:FONT.sans}}>View DNA →</button>
      </div>
      <div className="strip-grid">
        {[
          {num:learnings.length, format:undefined, color:C.ink,   sub:'total learnings'},
          {num:rate,             format:n=>`${Math.round(n)}%`, color:C.accent, sub:'win rate'},
          {num:avgLift,          format:n=>`+${Math.round(n)}%`, color:C.accent, sub:'avg improvement on wins'},
          {num:losses,           format:undefined, color:C.textMuted, sub:'rolled back / avoided'},
        ].map((s,i)=>(
          <div key={i}>
            <p style={{fontFamily:FONT.serif,fontSize:26,fontWeight:500,color:s.color,lineHeight:1}}>
              {s.num!=null?<CountUp value={s.num} format={s.format}/>:'—'}
            </p>
            <p style={{fontSize:10.5,color:C.label,marginTop:3}}>{s.sub}</p>
          </div>
        ))}
      </div>
      <div style={{marginTop:14,display:'flex',flexDirection:'column'}}>
        {learnings.slice(0,3).map((l,i)=>(
          <div key={l.id||i} style={{display:'flex',alignItems:'center',gap:10,fontSize:11.5,padding:'7px 0',borderTop:`1px solid ${C.borderSoft}`}}>
            <span style={{color:l.outcome==='positive'?C.green:C.red,flexShrink:0,fontWeight:600}}>{l.outcome==='positive'?'✓':'✕'}</span>
            <span style={{color:C.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.summary}</span>
            {l.delta&&<span style={{color:l.outcome==='positive'?C.greenText:C.redText,flexShrink:0,fontWeight:500}}>{l.outcome==='positive'?'+':''}{l.delta}%</span>}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── OVERVIEW PAGE ────────────────────────────────────────────────────────────
function OverviewPage({runs, subscription, learnings, onSelectRun, onTogglePause, actionLoading, onTriggerRun, triggerLoading, triggerMessage, onGoRuns, onGoGuardrails, onGoDna}) {
  const pendingRun = runs.find(isAwaitingApproval)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {pendingRun && <PendingApprovalCard run={pendingRun}/>}

      <StatusHero
        subscription={subscription} runs={runs}
        onTogglePause={onTogglePause} actionLoading={actionLoading}
        onTriggerRun={onTriggerRun} triggerLoading={triggerLoading}
        triggerMessage={triggerMessage} onSelectRun={onSelectRun}
      />

      <KpiRow runs={runs}/>

      <div className="dash-cols">
        <ActivityCard runs={runs} onSelectRun={onSelectRun} onGoRuns={onGoRuns}/>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <PerformanceCard runs={runs}/>
          <GuardrailsTeaser subscriptionId={subscription?.id} onGoGuardrails={onGoGuardrails}/>
        </div>
      </div>

      <AgentLearningStrip learnings={learnings} onGoDna={onGoDna}/>
    </div>
  )
}

// ─── RUNS PAGE ────────────────────────────────────────────────────────────────
function RunsPage({runs, loading, onSelect, learnings=[]}) {
  const [filter, setFilter] = useState('all')
  // Outcomes lead; error/rejection states trail (don't headline failure).
  const filters = [
    { key:'all',              label:'All' },
    { key:'deployed',         label:'Deployed' },
    { key:'waiting_approval', label:'Awaiting approval' },
    { key:'rejected',         label:'Rejected' },
    { key:'rolled_back',      label:'Rolled back' },
    { key:'failed',           label:'Failed' },
  ]
  const countFor = key => key==='all' ? runs.length : runs.filter(r=>(STATUS_GROUP[key]||[key]).includes(r.status)).length

  // Group-aware: each chip matches its GitHub status AND its Shopify-direct twin(s).
  const filtered = filter==='all'?runs:runs.filter(r=>(STATUS_GROUP[filter]||[filter]).includes(r.status))

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

  if (loading) return <div style={{padding:48,display:'flex',justifyContent:'center'}}><Spinner/></div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div className="fade-up" style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:16,flexWrap:'wrap'}}>
        <p style={{fontSize:12.5,color:C.textMuted}}>Every change the agent made or proposed — click a run for full details.</p>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {filters.map(f=>{
            const active = filter===f.key
            return (
              <button key={f.key} className="btn" onClick={()=>setFilter(f.key)} style={{
                fontSize:11.5,fontWeight:500,padding:'6px 13px',borderRadius:20,
                background:active?C.ink:C.bgCard,
                color:active?C.sideText:'#4A5248',
                border:`1px solid ${active?C.ink:C.border}`,
              }}>
                {f.label} · {countFor(f.key)}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length===0 && (
        <Card className="fade-up" style={{padding:48,textAlign:'center'}}>
          <p style={{fontSize:13,color:C.label}}>{filter==='all'?'No runs yet.':'No runs with this status yet.'}</p>
        </Card>
      )}

      {grouped.map((group,gi)=>(
        <section key={gi} className="fade-up" style={{marginBottom:14,animationDelay:`${gi*0.06}s`}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',padding:'0 4px 8px'}}>
            <SectionLabel style={{marginBottom:0}}>{group.label}</SectionLabel>
            <span style={{fontSize:11,color:C.textLight}}>{group.runs.length} run{group.runs.length!==1?'s':''}</span>
          </div>
          <Card style={{overflow:'hidden'}}>
            {group.runs.map((run,i)=>{
              const analysis=run.analysis_result||{}
              const bounceDelta = (run.bounce_rate_before != null && run.bounce_rate_after != null)
                ? run.bounce_rate_after - run.bounce_rate_before : null
              const hasCompetitor = Array.isArray(run.competitor_changes) && run.competitor_changes.length > 0
              return (
                <div key={run.id} className="run-row" onClick={()=>onSelect(run)} style={{
                  display:'grid',gridTemplateColumns:'26px 1fr auto auto',gap:14,alignItems:'center',
                  padding:'15px 22px',
                  borderBottom:i<group.runs.length-1?`1px solid ${C.borderSoft}`:'none',
                }}>
                  <StatusDotIcon status={run.status}/>
                  <div style={{minWidth:0}}>
                    <p style={{fontSize:13,fontWeight:500,lineHeight:1.4,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {analysis.problem||'Analysis pending…'}
                    </p>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,flexWrap:'wrap'}}>
                      {analysis.file_to_edit && <FileChip>{analysis.file_to_edit.split('/').pop()}</FileChip>}
                      {analysis.expected_improvement && (
                        <span style={{fontSize:11,color:C.accent,fontWeight:500}}>{analysis.expected_improvement}</span>
                      )}
                      {bounceDelta != null && (
                        <span style={{fontSize:11,color:bounceDelta<0?C.greenText:bounceDelta>0?C.redText:C.textLight,fontWeight:500}}>
                          Bounce {run.bounce_rate_before}% → {run.bounce_rate_after}%
                        </span>
                      )}
                      {hasCompetitor && (
                        <span style={{fontSize:10.5,color:C.yellowText,background:C.yellowBg,padding:'2px 8px',borderRadius:20,fontWeight:500}}>
                          Competitor change
                        </span>
                      )}
                      {run.pr_url && (
                        <a href={run.pr_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="link-green" style={{fontSize:11}}>
                          PR #{run.pr_number} ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={run.status}/>
                  <span style={{fontSize:11,color:C.textLight,whiteSpace:'nowrap',minWidth:74,textAlign:'right'}}>{fmt(run.created_at)}</span>
                </div>
              )
            })}
          </Card>
        </section>
      ))}

      {/* Agent Learnings — full per-outcome history (the condensed strip stays on Overview). */}
      {learnings.length>0&&(
        <section className="fade-up" style={{animationDelay:'.1s'}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',padding:'0 4px 8px'}}>
            <SectionLabel style={{marginBottom:0}}>Agent learnings</SectionLabel>
            <span style={{fontSize:11,color:C.textLight}}>every outcome improves future decisions</span>
          </div>
          <Card style={{overflow:'hidden'}}>
            {learnings.map((l,i)=>(
              <div key={l.id||i} style={{
                display:'flex',alignItems:'flex-start',gap:12,padding:'13px 22px',
                borderBottom:i<learnings.length-1?`1px solid ${C.borderSoft}`:'none',
              }}>
                <span style={{fontSize:13,color:l.outcome==='positive'?C.green:C.red,flexShrink:0,paddingTop:1,fontWeight:600}}>
                  {l.outcome==='positive'?'✓':'✕'}
                </span>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:12.5,color:C.text,marginBottom:3,lineHeight:1.5}}>{l.summary}</p>
                  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                    <span style={{fontSize:10.5,color:C.textMuted}}>{l.change_type}</span>
                    {l.delta&&<span style={{fontSize:10.5,color:l.outcome==='positive'?C.greenText:C.redText,fontWeight:500}}>{l.outcome==='positive'?'+':''}{l.delta}% {l.metric_type}</span>}
                    <span style={{fontSize:10.5,color:C.textLight}}>{l.confidence} confidence</span>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  )
}

// ─── NETWORK PAGE ─────────────────────────────────────────────────────────────
// The graph itself (SiteNetwork) is deliberately untouched by the redesign —
// same component, same fonts, same visual language. Only the framing card
// adopts the new palette.
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

function NetworkPage({ runs, siteNetwork, structurePreview, websiteUrl }) {
  const [selectedNode, setSelectedNode] = useState(null)
  const activeRun = runs.find(r => r.status === 'running') || null
  const isRunning = !!activeRun
  const lastRun   = runs[0] || null

  // Most-recent active run drives fix-in-flight + the panel's PR link.
  const inflightRun = runs.find(r => r.status === 'running')
                   || runs.find(isAwaitingApproval)
                   || null

  // Fall back to the onboarding structure preview before the first run writes
  // agent_site_network. isPreview drives the honest "preview" status copy below.
  const networkRow = siteNetwork || structurePreview
  const isPreview  = !siteNetwork && !!structurePreview

  let statusText, statusColor
  if (isRunning) {
    const stepId    = activeRun.current_step && CURRENT_STEP_TO_ID[activeRun.current_step]
    const stepLabel = stepId
      ? (AGENT_STEPS.find(s => s.id === stepId)?.label || activeRun.current_step)
      : 'Running'
    statusText  = `Running now · ${stepLabel.toLowerCase()}`
    statusColor = C.accent
  } else if (lastRun) {
    const next = nextMonday9am()
    const nextLabel = next.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    statusText  = `Last run ${fmt(lastRun.created_at)} · next Mon ${nextLabel}`
    statusColor = C.textLight
  } else if (isPreview) {
    statusText  = 'Structure preview · live conversion map after your first run'
    statusColor = C.textLight
  } else {
    statusText  = 'No runs yet'
    statusColor = C.textLight
  }

  const domain = hubDomainFromUrl(websiteUrl)
  const networkData = buildNetworkData(networkRow, { domain, inflightRun })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18 }}>
        {isRunning && (
          <span className="pulse-dot" style={{ width:6, height:6, borderRadius:'50%', background:C.yellow, display:'inline-block', flexShrink:0 }}/>
        )}
        <span style={{ fontSize:11.5, color:statusColor, fontWeight:isRunning?500:400 }}>{statusText}</span>
      </div>

      <Card style={{ position:'relative', overflow:'hidden' }}>
        {networkData ? (
          <SiteNetwork
            data={networkData}
            onNodeClick={(n) => { if (!n.isHub) setSelectedNode(n) }}
            fonts={NETWORK_FONTS}
            style={{ height:'calc(100vh - 190px)', minHeight:360 }}
          />
        ) : (
          <div style={{
            display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', padding:'64px 24px', textAlign:'center',
          }}>
            <div style={{
              width:40, height:40, borderRadius:'50%',
              background:C.chipBg, display:'flex',
              alignItems:'center', justifyContent:'center',
              marginBottom:16, fontSize:20, color:C.accent,
            }}>◎</div>
            <p style={{ fontFamily:FONT.serif, fontWeight:500, fontSize:20, color:C.text, marginBottom:8 }}>
              {isRunning ? 'Mapping your site…' : 'Your network graph appears here'}
            </p>
            <p style={{ fontSize:12, color:C.textMuted, lineHeight:1.7, maxWidth:340 }}>
              {isRunning
                ? "The agent is mapping your site's structure. Check back in a few minutes."
                : "Your first network graph will appear after Monday's run. The agent maps every page, section, and component of your site and how they connect."
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
              position:'absolute', top:0, right:0, bottom:0, width:320, maxWidth:'85%',
              background:C.bgCard, borderLeft:`1px solid ${C.border}`,
              boxShadow:'-8px 0 28px rgba(30,54,43,.08)', zIndex:20,
              padding:'20px 22px', overflowY:'auto',
              animation:'slideInRight .22s ease both',
            }}>
              <style>{`@keyframes slideInRight { from { opacity:0; transform:translateX(16px) } to { opacity:1; transform:none } }`}</style>

              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                <p style={{ fontFamily:FONT.serif, fontWeight:500, fontSize:22, color:C.text, lineHeight:1.15 }}>
                  {selectedNode.label}
                </p>
                <button className="btn" onClick={() => setSelectedNode(null)} style={{
                  background:'none', border:`1px solid ${C.border}`, borderRadius:6,
                  width:26, height:26, fontSize:14, color:C.textMuted, flexShrink:0, lineHeight:1,
                }}>×</button>
              </div>

              <p style={{ fontFamily:FONT.mono, fontSize:11, color:C.textMuted, wordBreak:'break-all', marginTop:6, marginBottom:16 }}>
                {selectedNode.id}
              </p>

              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:prUrl?18:0 }}>
                <span style={{ width:9, height:9, borderRadius:'50%', background:NODE_STATUS_DOT[selectedNode.status], flexShrink:0 }}/>
                <span style={{ fontSize:13, color:C.text }}>{NODE_STATUS_COPY[selectedNode.status] || 'Watching'}</span>
              </div>

              {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" className="v-press" style={{
                  display:'inline-flex', alignItems:'center', gap:7,
                  background:C.yellowBg, border:'1px solid #EADFC2', borderRadius:8,
                  padding:'9px 13px', fontSize:12, color:C.yellowText, fontWeight:500, textDecoration:'none',
                }}>
                  View open PR{prNum ? ` #${prNum}` : ''} →
                </a>
              )}
            </div>
          )
        })()}
      </Card>
    </div>
  )
}

// ─── FUNNEL PAGE ──────────────────────────────────────────────────────────────
// Real data only: agent_funnel_pages rows (page_path, views_7d, drop_off_score,
// page_type, ai_insight). Leverage badges are derived from drop-off severity;
// the dark "highest leverage" card is the top drop-off page with traffic.
function FunnelPage({funnelPages, loading, subscription, onSaveSettings}) {
  // Hooks before the early returns below (hook order must never vary).
  const [schedSaving, setSchedSaving] = useState(false)
  const [schedError, setSchedError]   = useState(null)

  if(loading) return <div style={{padding:48,display:'flex',justifyContent:'center'}}><Spinner/></div>

  const banner = (
    <InfoBanner iconPath="M3 4h18l-7 8v6l-4 2v-8L3 4z">
      Every page mapped and cross-referenced with your analytics — the agent fixes the highest-leverage page first.
    </InfoBanner>
  )

  if(!funnelPages.length) return (
    <div>
      {banner}
      <Card className="fade-up" style={{padding:48,textAlign:'center'}}>
        <p style={{fontSize:13,color:C.text,marginBottom:4,fontWeight:500}}>No funnel data yet</p>
        <p style={{fontSize:11.5,color:C.textLight}}>Funnel analysis runs automatically every Monday.</p>
      </Card>
    </div>
  )

  const withTraffic = funnelPages.filter(p=>p.views_7d>0)
  const noTraffic   = funnelPages.filter(p=>!(p.views_7d>0))
  const biggestOpp  = [...withTraffic].filter(p=>p.drop_off_score>0).sort((a,b)=>b.drop_off_score-a.drop_off_score)[0]
    || [...funnelPages].filter(p=>p.drop_off_score>0).sort((a,b)=>b.drop_off_score-a.drop_off_score)[0]
  const maxViews = Math.max(...funnelPages.map(p=>p.views_7d||0),1)
  const totalViews = withTraffic.reduce((s,p)=>s+(p.views_7d||0),0)

  // Traffic bars: top pages by views, shaded dark→light green (mockup funnel look).
  const barPages = [...withTraffic].sort((a,b)=>b.views_7d-a.views_7d).slice(0,6)
  const BAR_SHADES = ['#3E6B54','#4F7B63','#5C8A6F','#6D9A7F','#7FA98F','#93B8A1']

  const leverageOf = (p) => {
    if (biggestOpp && p.page_path===biggestOpp.page_path) return { badge:'Next focus', bg:C.ink,    color:C.sideText }
    if (!(p.views_7d>0))       return { badge:'No traffic', bg:C.grayBg,  color:C.textLight }
    if (p.drop_off_score>=60)  return { badge:'High',       bg:C.yellowBg,color:C.yellowText }
    if (p.drop_off_score>=30)  return { badge:'Medium',     bg:C.grayBg,  color:C.grayText }
    return                            { badge:'Low',        bg:C.grayBg,  color:C.textLight }
  }

  const sorted = [
    ...[...withTraffic].sort((a,b)=>(b.drop_off_score||0)-(a.drop_off_score||0)||b.views_7d-a.views_7d),
    ...[...noTraffic].sort((a,b)=>a.page_path.localeCompare(b.page_path)),
  ]

  // "Fix in next run" — pins biggestOpp.page_path on agent_subscriptions.
  // focus_page_path (via update-settings); the next weekly run biases toward
  // it, then consumes the pin. Toggling off un-schedules.
  const pinnedPath = subscription?.focus_page_path || null
  const scheduled  = !!biggestOpp && pinnedPath === biggestOpp.page_path

  async function toggleSchedule() {
    if (!biggestOpp || schedSaving) return
    setSchedSaving(true); setSchedError(null)
    try {
      const result = await onSaveSettings({ focus_page_path: scheduled ? null : biggestOpp.page_path })
      if (result?.error) setSchedError(result.error)
    } catch (e) { setSchedError(e.message || 'Could not save') }
    finally { setSchedSaving(false) }
  }

  return (
    <div>
      {banner}

      <div className="funnel-top" style={{marginBottom:14}}>
        <Card className="fade-up" style={{padding:'22px 26px'}}>
          <p style={{fontSize:13.5,fontWeight:600,color:C.text,marginBottom:4}}>Traffic by page</p>
          <p style={{fontSize:11.5,color:C.label,marginBottom:18}}>
            Last 7 days{totalViews>0?` · ${totalViews.toLocaleString()} views across ${withTraffic.length} page${withTraffic.length===1?'':'s'}`:''}
          </p>
          {barPages.length===0 && (
            <p style={{fontSize:12,color:C.textLight,padding:'8px 0'}}>No traffic recorded yet — bars appear once visitors arrive.</p>
          )}
          {barPages.map((p,i)=>{
            const w = Math.max(4,Math.round(((p.views_7d||0)/maxViews)*100))
            return (
              <div key={p.page_path} style={{marginBottom:i<barPages.length-1?14:0}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6,gap:12}}>
                  <span style={{fontSize:12.5,fontWeight:500,fontFamily:FONT.mono,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.page_path}</span>
                  <span style={{fontSize:12,color:C.textMuted,flexShrink:0}}>
                    <span style={{fontFamily:FONT.serif,fontSize:15,color:C.ink}}><CountUp value={p.views_7d} format={n=>Math.round(n).toLocaleString()}/></span>
                    {p.drop_off_score>0?` · ${p.drop_off_score}% drop-off`:''}
                  </span>
                </div>
                <div style={{height:22,background:C.borderSoft,borderRadius:6,overflow:'hidden'}}>
                  <div className="v-bar-fill" style={{height:'100%',width:`${w}%`,'--v-w':`${w}%`,background:BAR_SHADES[i]||BAR_SHADES[5],borderRadius:6,animationDelay:`${i*0.08}s`}}/>
                </div>
              </div>
            )
          })}
        </Card>

        <div className="fade-up" style={{background:C.sidebar,borderRadius:14,padding:'22px 26px',color:C.sideText,animationDelay:'.08s'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
            <span className="pulse-dot" style={{width:8,height:8,borderRadius:'50%',background:C.yellow,display:'inline-block'}}/>
            <span style={{fontSize:10.5,letterSpacing:'.14em',color:C.sideMuted,fontWeight:500}}>HIGHEST LEVERAGE</span>
          </div>
          {biggestOpp ? (
            <>
              <p style={{fontFamily:FONT.mono,fontSize:17,color:'#C9E3D2'}}>{biggestOpp.page_path}</p>
              <p style={{fontSize:12.5,lineHeight:1.6,color:'#C7CFC4',marginTop:10}}>
                {biggestOpp.drop_off_score}% of visitors drop off here · {biggestOpp.views_7d||0} views/week.
                {biggestOpp.ai_insight?` ${biggestOpp.ai_insight}`:''}
              </p>
              <p style={{fontSize:11.5,color:C.sideFaint,marginTop:12,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.12)'}}>
                {scheduled
                  ? 'Pinned — the agent focuses here on its next run, then the pin clears.'
                  : 'The agent prioritizes high-leverage pages first.'}
              </p>
              <button className="btn v-press" onClick={toggleSchedule} disabled={schedSaving} style={{
                fontSize:12.5,fontWeight:500,border:'none',borderRadius:9,padding:'10px 18px',
                marginTop:16,width:'100%',
                background:scheduled?'#C9E3D2':C.bgChip,color:C.ink,
                opacity:schedSaving?.7:1,cursor:schedSaving?'wait':'pointer',
                transition:'background .25s ease',
              }}>
                {schedSaving?'…':scheduled?'Scheduled for next run ✓':'Fix in next run'}
              </button>
              {pinnedPath && !scheduled && (
                <p className="reveal-in" style={{fontSize:11,color:C.sideFaint,marginTop:8,lineHeight:1.5}}>
                  Currently pinned: <span style={{fontFamily:FONT.mono}}>{pinnedPath}</span> — scheduling this page replaces it.
                </p>
              )}
              {schedError && <p className="reveal-in" style={{fontSize:11,color:'#E8B4A6',marginTop:8,lineHeight:1.5}}>{schedError}</p>}
            </>
          ) : (
            <>
              <p style={{fontSize:12.5,lineHeight:1.6,color:'#C7CFC4'}}>
                No drop-off hotspot detected yet. Once your pages collect traffic, the biggest leak shows up here.
              </p>
              {pinnedPath && (
                <p style={{fontSize:11.5,color:C.sideFaint,marginTop:12,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.12)'}}>
                  Pinned for the next run: <span style={{fontFamily:FONT.mono}}>{pinnedPath}</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <Card className="fade-up table-scroll" style={{overflow:'hidden',animationDelay:'.12s'}}>
        <div style={{minWidth:560}}>
          <div style={{display:'grid',gridTemplateColumns:'1.4fr .6fr 1fr auto',gap:14,alignItems:'center',padding:'13px 22px',borderBottom:`1px solid ${C.border}`,fontSize:10,letterSpacing:'.13em',color:C.label,fontWeight:500}}>
            <span>PAGE</span><span>VIEWS / WK</span><span>DROP-OFF</span><span style={{minWidth:96,textAlign:'right'}}>LEVERAGE</span>
          </div>
          {sorted.map((p,i)=>{
            const lev = leverageOf(p)
            const isNext = biggestOpp && p.page_path===biggestOpp.page_path
            const muted = !(p.views_7d>0)
            const dropW = Math.min(100,p.drop_off_score||0)
            return (
              <div key={p.id||p.page_path} style={{
                display:'grid',gridTemplateColumns:'1.4fr .6fr 1fr auto',gap:14,alignItems:'center',
                padding:'14px 22px',borderBottom:i<sorted.length-1?`1px solid ${C.borderSoft}`:'none',
                background:isNext?C.bgSoft:'transparent',opacity:muted?.6:1,
              }}>
                <span style={{fontFamily:FONT.mono,fontSize:12,color:C.ink,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.page_path}</span>
                <span style={{fontSize:12,color:'#4A5248'}}>{muted?'—':(p.views_7d||0).toLocaleString()}</span>
                <div style={{display:'flex',alignItems:'center',gap:9}}>
                  <div style={{flex:1,height:5,background:C.borderSoft,borderRadius:3,overflow:'hidden',maxWidth:110}}>
                    <div className="v-bar-fill" style={{height:'100%',width:`${dropW}%`,'--v-w':`${dropW}%`,background:dropW>=60?C.red:dropW>=30?C.yellow:C.accentBar,borderRadius:3,animationDelay:`${i*0.04}s`}}/>
                  </div>
                  <span style={{fontSize:11,color:dropW>=60?C.redText:C.label,minWidth:32,fontWeight:dropW>=60?500:400}}>{p.drop_off_score?`${p.drop_off_score}%`:'—'}</span>
                </div>
                <span style={{fontSize:10.5,fontWeight:500,color:lev.color,background:lev.bg,borderRadius:20,padding:'4px 11px',whiteSpace:'nowrap',minWidth:74,textAlign:'center'}}>{lev.badge}</span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ─── BUSINESS DNA PAGE ────────────────────────────────────────────────────────
function DNAPage({ subscriptionId }) {
  const [dna, setDna]         = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!subscriptionId) return
    setLoading(true)
    // select('*') (not an explicit column list) so a deployment that predates
    // the user_verdict migration still loads — the property is just undefined.
    supabase.from('agent_business_dna')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setDna(data || []); setLoading(false) })
  }, [subscriptionId])

  // Confirm / Wrong verdicts: optimistic local update, reverted on API failure.
  // 'rejected' entries are excluded from the agent's prompt on future runs.
  const [verdictBusy, setVerdictBusy]   = useState(null)  // dna id in flight
  const [verdictError, setVerdictError] = useState(null)

  async function setVerdict(entry, verdict) {
    if (verdictBusy) return
    setVerdictBusy(entry.id); setVerdictError(null)
    const prev = dna
    setDna(d => d.map(x => x.id === entry.id ? { ...x, user_verdict: verdict } : x))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/agent/run?action=dna_verdict', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dna_id: entry.id, verdict }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not save')
    } catch (e) {
      setDna(prev)
      setVerdictError(e.message || 'Could not save — try again.')
    } finally {
      setVerdictBusy(null)
    }
  }

  const grouped = useMemo(() => {
    const out = { success: [], rollback: [], pending: [] }
    for (const d of dna) if (out[d.outcome]) out[d.outcome].push(d)
    return out
  }, [dna])

  const banner = (
    <InfoBanner iconPath="M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12M6 15c0 3 2 6 6 6M18 15c0 3-2 6-6 6">
      What the agent has learned — confirm a learning to reinforce it, or mark it wrong and the agent ignores it from the next run on.
    </InfoBanner>
  )

  if (loading) return (
    <div style={{maxWidth:800}}>
      {banner}
      <div style={{padding:32,display:'flex',justifyContent:'center'}}><Spinner/></div>
    </div>
  )

  const GROUPS = [
    { key:'success',  title:'What works for this site', sub:'Doubled down on in future runs',       mark:{sym:'✓', color:C.green,  label:'Success'} },
    { key:'rollback', title:'Never do again',           sub:'Rolled back — the agent avoids these', mark:{sym:'✕', color:C.red,    label:'Rolled back'} },
    { key:'pending',  title:'Pending',                  sub:'Deployed, awaiting the 7-day verdict', mark:{sym:'·', color:C.yellow, label:'Pending'} },
  ]

  return (
    <div style={{maxWidth:800}}>
      {banner}

      {verdictError && (
        <p className="reveal-in" style={{fontSize:12,color:C.redText,background:C.redBg,border:`1px solid ${C.dangerBorder}`,borderRadius:8,padding:'8px 14px',marginBottom:14}}>
          {verdictError}
        </p>
      )}

      {dna.length === 0 && (
        <Card className="fade-up" style={{padding:'40px 24px',textAlign:'center'}}>
          <p style={{fontSize:13,color:C.textMuted}}>
            No DNA recorded yet. Entries appear after the agent's fixes are deployed, evaluated, or rolled back.
          </p>
        </Card>
      )}

      {GROUPS.map((g,gi)=>{
        const entries = grouped[g.key]
        if (!entries.length) return null
        return (
          <Card key={g.key} className="fade-up" style={{padding:'20px 26px',marginBottom:14,animationDelay:`${gi*0.06}s`}}>
            <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>{g.title}</p>
            <p style={{fontSize:11.5,color:C.label,margin:'3px 0 4px'}}>{g.sub}</p>
            {entries.map((e,i)=>{
              const busy = verdictBusy === e.id
              const rejected = e.user_verdict === 'rejected'
              return (
              <div key={e.id} style={{
                display:'grid',gridTemplateColumns:'1fr auto',gap:16,alignItems:'center',
                padding:'13px 0',borderBottom:i<entries.length-1?`1px solid ${C.borderSoft}`:'none',
              }}>
                <div style={{minWidth:0,opacity:rejected?.55:1,transition:'opacity .2s ease'}}>
                  <p style={{fontSize:13,lineHeight:1.5,color:C.text}}>
                    {e.notes || e.fix_type.replace(/_/g,' ')}
                  </p>
                  <div style={{fontSize:10.5,color:C.textLight,marginTop:4}}>
                    learned from <FileChip style={{fontSize:10.5,padding:'1.5px 6px'}}>{e.fix_type.replace(/_/g,' ')}</FileChip>
                    <span style={{marginLeft:8}}>{new Date(e.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
                  <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,color:g.mark.color,fontWeight:500,whiteSpace:'nowrap',opacity:rejected?.55:1}}>
                    <span style={{fontWeight:600}}>{g.mark.sym}</span>{g.mark.label}
                  </span>
                  {e.user_verdict === 'confirmed' ? (
                    <span className="reveal-in" style={{display:'inline-flex',alignItems:'center',gap:8,fontSize:11,color:C.greenText,fontWeight:500,whiteSpace:'nowrap'}}>
                      ✓ Confirmed by you
                      <button className="btn" onClick={()=>setVerdict(e,null)} disabled={busy} style={{
                        background:'none',border:'none',padding:0,fontSize:10.5,color:C.textLight,
                        textDecoration:'underline',opacity:busy?.5:1,fontFamily:FONT.sans,
                      }}>Undo</button>
                    </span>
                  ) : rejected ? (
                    <span className="reveal-in" style={{display:'inline-flex',alignItems:'center',gap:8,fontSize:11,color:C.textMuted,whiteSpace:'nowrap'}}>
                      Ignored by agent
                      <button className="btn" onClick={()=>setVerdict(e,null)} disabled={busy} style={{
                        background:'none',border:'none',padding:0,fontSize:10.5,color:C.textLight,
                        textDecoration:'underline',opacity:busy?.5:1,fontFamily:FONT.sans,
                      }}>Undo</button>
                    </span>
                  ) : (
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-primary v-press" onClick={()=>setVerdict(e,'confirmed')} disabled={busy} style={{
                        fontSize:11,fontWeight:500,borderRadius:7,padding:'6px 13px',opacity:busy?.6:1,
                      }}>{busy?'…':'Confirm'}</button>
                      <button className="btn btn-danger-ghost" onClick={()=>setVerdict(e,'rejected')} disabled={busy} style={{
                        fontSize:11,borderRadius:7,padding:'6px 13px',opacity:busy?.6:1,
                      }}>Wrong</button>
                    </div>
                  )}
                </div>
              </div>
              )
            })}
          </Card>
        )
      })}

      {dna.length > 0 && (
        <Card className="fade-up" style={{padding:'20px 26px',animationDelay:'.18s'}}>
          <p style={{fontSize:13.5,fontWeight:600,color:C.text,marginBottom:8}}>Timeline</p>
          {dna.slice(0, 30).map((d,i) => {
            const s = d.outcome==='success' ? {color:C.greenText,bg:C.greenBg}
                    : d.outcome==='rollback' ? {color:C.redText,bg:C.redBg}
                    : {color:C.yellowText,bg:C.yellowBg}
            return (
              <div key={d.id} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:i<Math.min(dna.length,30)-1?`1px solid ${C.borderSoft}`:'none'}}>
                <span style={{fontSize:10.5,color:C.textLight,fontFamily:FONT.mono,minWidth:70}}>
                  {new Date(d.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
                </span>
                <span style={{fontSize:12.5,color:C.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.fix_type.replace(/_/g,' ')}</span>
                <span style={{fontSize:10.5,color:s.color,background:s.bg,borderRadius:20,padding:'3px 10px',fontWeight:500,textTransform:'capitalize'}}>
                  {d.outcome}
                </span>
              </div>
            )
          })}
        </Card>
      )}

      <p style={{fontSize:11.5,color:C.label,padding:'14px 4px 0'}}>The agent reads this log on every run — successes are doubled down on, rollbacks avoided.</p>
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

  const inp = {width:'100%',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:9,padding:'10px 14px',fontSize:12.5,fontFamily:FONT.sans,color:C.text}
  const ruleCount = (tone.trim()?1:0)+forbidden.length+protected_.length+(customRules.trim()?1:0)

  const chipSection = ({title, sub, list, setList, input, setInput, placeholder, danger}) => (
    <Card className="fade-up" style={{padding:'22px 26px',marginBottom:14}}>
      <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>{title}</p>
      <p style={{fontSize:11.5,color:C.label,margin:'3px 0 14px'}}>{sub}</p>
      {list.length>0 && (
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
          {list.map(tag=>(
            <span key={tag} className="pop-in" style={{
              display:'inline-flex',alignItems:'center',gap:7,fontSize:12,
              background:danger?C.redBg:C.bgChip,
              border:`1px solid ${danger?C.dangerBorder:C.border}`,
              color:danger?'#7A4438':C.text,
              borderRadius:20,padding:'6px 8px 6px 13px',
            }}>
              {tag}
              <button className="chip-x" onClick={()=>removeTag(list,setList,tag)} aria-label={`Remove ${tag}`} style={{
                background:danger?C.dangerBorder:'#E7E4D6',color:danger?'#9C6455':C.textMuted,
              }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input value={input} onChange={e=>setInput(e.target.value)}
        onKeyDown={e=>e.key==='Enter'&&addTag(list,setList,input,setInput)}
        placeholder={placeholder} style={inp}/>
    </Card>
  )

  return (
    <div style={{maxWidth:760}}>
      <InfoBanner iconPath="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z">
        Enforced on every run — the agent will never make a change that violates these rules.
      </InfoBanner>

      <Card className="fade-up" style={{padding:'22px 26px',marginBottom:14}}>
        <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Tone of voice</p>
        <p style={{fontSize:11.5,color:C.label,margin:'3px 0 14px'}}>How the agent writes copy on your behalf.</p>
        <input value={tone} onChange={e=>setTone(e.target.value)} placeholder='"friendly but direct", "professional, no fluff"' style={inp}/>
      </Card>

      {chipSection({
        title:'Never do these', sub:'Tactics the agent must never use.',
        list:forbidden, setList:setForbidden, input:forbInput, setInput:setForbInput,
        placeholder:'e.g. "clickbait headlines" — press Enter', danger:true,
      })}
      {chipSection({
        title:'Never change these', sub:'Parts of your site that are off-limits.',
        list:protected_, setList:setProtected, input:protInput, setInput:setProtInput,
        placeholder:'e.g. "brand colors" — press Enter', danger:false,
      })}

      <Card className="fade-up" style={{padding:'22px 26px',marginBottom:18}}>
        <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Additional rules</p>
        <p style={{fontSize:11.5,color:C.label,margin:'3px 0 14px'}}>Anything else the agent should keep in mind.</p>
        <textarea value={customRules} onChange={e=>setCustomRules(e.target.value)} placeholder="Any other instructions for the agent…" rows={3}
          style={{...inp,resize:'vertical',lineHeight:1.55}}/>
      </Card>

      <div className="fade-up" style={{display:'flex',alignItems:'center',gap:14}}>
        <button className="btn v-press" onClick={handleSave} disabled={saving} style={{
          background:saved?C.green:C.ink,color:C.sideText,borderRadius:9,
          padding:'11px 22px',fontSize:12.5,fontWeight:500,
          opacity:saving?.7:1,transition:'background .25s ease',minWidth:150,
        }}>
          {saving?'Saving…':saved?'Saved ✓':'Save guardrails'}
        </button>
        <span style={{fontSize:11.5,color:C.label}}>{ruleCount} rule{ruleCount===1?'':'s'} active</span>
      </div>
    </div>
  )
}

// ─── SETTINGS — SUBSCRIPTION CARD ─────────────────────────────────────────────
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
    try { await openBillingPortal() } catch (e) { console.error('Portal error:', e) }
    setPortalLoading(false)
  }

  if (subLoading) return null

  const isActive = subStatus === 'active'
  const isTrialing = subStatus === 'trialing'
  const isPastDue = subStatus === 'past_due'
  const isCancelled = subStatus === 'cancelled' || subStatus === 'canceled'
  // Anti-abuse denial: this site's identity already consumed a free trial
  // (trial_fingerprints ledger) — no trial, but the paid path is open.
  const isDenied = subStatus === 'trial_denied'
  const trialDaysLeft = trialEnd
    ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86400000))
    : null

  const ghostBtn = {fontSize:12,fontWeight:500,color:C.ink,background:'none',border:'1px solid #C9C6B8',borderRadius:9,padding:'9px 16px',whiteSpace:'nowrap'}

  return (
    <Card className="fade-up" style={{padding:'22px 26px',marginBottom:14}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
        <div>
          <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Subscription</p>
          {isActive && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:C.green}}/>
              <span style={{fontSize:12.5,color:'#4A5248'}}>
                Growth Agent — active{cancelAtPeriodEnd&&currentPeriodEnd?` · cancels ${new Date(currentPeriodEnd).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}`:''}
              </span>
            </div>
          )}
          {isTrialing && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:C.green}}/>
              <span style={{fontSize:12.5,color:'#4A5248'}}>
                Free trial{trialDaysLeft != null ? ` — ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left` : ''}
                {cancelAtPeriodEnd ? ' · ends, won’t renew' : ' · then €29/mo'}
              </span>
            </div>
          )}
          {isPastDue && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:C.yellow}}/>
              <span style={{fontSize:12.5,color:C.yellowText,fontWeight:500}}>Payment failed — update your card to resume the agent</span>
            </div>
          )}
          {isCancelled && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:C.gray}}/>
              <span style={{fontSize:12.5,color:C.textMuted}}>Subscription ended — your agent is paused.</span>
            </div>
          )}
          {isDenied && (
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:C.yellow}}/>
              <span style={{fontSize:12.5,color:C.yellowText,fontWeight:500}}>Free trial not available — this site already used one. Subscribe to activate your agent.</span>
            </div>
          )}
          {!isActive && !isTrialing && !isPastDue && !isCancelled && !isDenied && (
            <p style={{fontSize:12.5,color:C.textMuted,marginTop:6}}>No active subscription yet — finish setup to start your 14-day free trial, no card required.</p>
          )}
        </div>

        {(isActive || isTrialing) && (
          <button className="btn v-press" onClick={openPortal} disabled={portalLoading} style={ghostBtn}>
            {portalLoading ? '…' : isTrialing && !cancelAtPeriodEnd ? 'Manage trial →' : 'Manage subscription →'}
          </button>
        )}
        {isPastDue && (
          <button className="btn v-press" onClick={openPortal} disabled={portalLoading} style={{...ghostBtn,color:C.yellowText,borderColor:'#EADFC2'}}>
            {portalLoading ? '…' : 'Update payment →'}
          </button>
        )}
        {isCancelled && (
          <button className="btn btn-primary v-press" onClick={subscribeNow} disabled={subscribeLoading} style={{
            fontSize:12.5,fontWeight:500,borderRadius:9,padding:'10px 18px',
            opacity:subscribeLoading?.7:1,cursor:subscribeLoading?'not-allowed':'pointer',whiteSpace:'nowrap',
          }}>
            {subscribeLoading ? 'Opening Stripe…' : 'Restart subscription →'}
          </button>
        )}
        {isDenied && (
          <button className="btn btn-primary v-press" onClick={subscribeNow} disabled={subscribeLoading} style={{
            fontSize:12.5,fontWeight:500,borderRadius:9,padding:'10px 18px',
            opacity:subscribeLoading?.7:1,cursor:subscribeLoading?'not-allowed':'pointer',whiteSpace:'nowrap',
          }}>
            {subscribeLoading ? 'Opening Stripe…' : 'Activate — €29/mo →'}
          </button>
        )}
        {!isActive && !isTrialing && !isPastDue && !isCancelled && !isDenied && (
          <button className="btn btn-primary v-press" onClick={() => navigate('/agent/onboarding')} style={{
            fontSize:12.5,fontWeight:500,borderRadius:9,padding:'10px 18px',whiteSpace:'nowrap',
          }}>
            Start free trial →
          </button>
        )}
      </div>

      <CheckoutConfirmModal
        type="subscription"
        open={subConfirmOpen}
        onCancel={() => setSubConfirmOpen(false)}
        onConfirm={() => { setSubConfirmOpen(false); doSubscribeNow() }}
        loading={subscribeLoading}
      />
    </Card>
  )
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function SettingsPage({subscription, user, onTogglePause, actionLoading, onDeleteRequest, onSaveSettings, navigate}) {
  const [isPublic, setIsPublic]   = useState(subscription?.is_public || false)
  const [slug, setSlug]           = useState(subscription?.public_slug || '')
  const [competitors, setCompetitors] = useState(() => {
    // Exactly TWO competitor slots — a deliberate product cap, do not add a third.
    const initial = subscription?.competitors || []
    while (initial.length < 2) initial.push('')
    return initial.slice(0, 2)
  })
  const [savingPublic, setSavingPublic] = useState(false)
  const [savingComp,   setSavingComp]   = useState(false)
  const [publicError,  setPublicError]  = useState(null)
  const [compError,    setCompError]    = useState(null)
  const [publicSaved,  setPublicSaved]  = useState(false)
  const [compSaved,    setCompSaved]    = useState(false)
  // Danger-zone cancel (Kündigungsbutton, BGB §312k) — routes to the Stripe
  // Billing Portal where cancellation is confirmed and a receipt issued.
  const [cancelLoading, setCancelLoading] = useState(false)

  const isPaused    = subscription?.status==='paused'
  const slugValid   = !slug || /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)
  const publicUrl   = (subscription?.is_public && subscription?.public_slug) ? `/agent/${subscription.public_slug}` : null
  // 'trial_denied' has no Stripe customer — offering the billing portal would 400.
  const hasBilling  = !!subscription?.subscription_status && !['cancelled','canceled','trial_denied'].includes(subscription.subscription_status)

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

  async function cancelViaPortal() {
    setCancelLoading(true)
    try { await openBillingPortal() } catch (e) { console.error('Portal error:', e) }
    setCancelLoading(false)
  }

  const monoInput = {
    fontFamily:FONT.mono,fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,
    padding:'9px 12px',background:C.bgSoft,color:C.text,
  }

  return (
    <div style={{maxWidth:760}}>
      <StripeSubscriptionPanel navigate={navigate}/>

      {/* Agent pause / resume */}
      <Card className="fade-up" style={{padding:'22px 26px',marginBottom:14,animationDelay:'.04s'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
          <div>
            <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>{isPaused?'Agent is paused':'Agent is active'}</p>
            <p style={{fontSize:11.5,color:C.label,marginTop:4}}>
              {isPaused?'Resume to run again every Monday at 9:00 am.':'Runs every Monday at 9:00 am.'}
            </p>
          </div>
          <Toggle on={!isPaused} onClick={onTogglePause} disabled={actionLoading} label={isPaused?'Resume agent':'Pause agent'}/>
        </div>
      </Card>

      {/* Public profile */}
      <Card className="fade-up" style={{padding:'22px 26px',marginBottom:14,animationDelay:'.08s'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
          <div>
            <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Public profile</p>
            <p style={{fontSize:11.5,color:C.label,marginTop:4}}>Share a public timeline of your agent's runs and results.</p>
          </div>
          <Toggle on={isPublic} onClick={()=>setIsPublic(v=>!v)} label="Make my agent timeline public"/>
        </div>
        {isPublic && (
          <div className="reveal-in" style={{display:'flex',alignItems:'center',gap:10,marginTop:16,paddingTop:16,borderTop:`1px solid ${C.borderSoft}`,flexWrap:'wrap'}}>
            <span style={{fontSize:12,color:C.label,fontFamily:FONT.mono}}>velyr.io/agent/</span>
            <input value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))} placeholder="your-slug"
              style={{...monoInput,width:180,borderColor:slugValid?C.border:C.red}}/>
            <button className="btn btn-primary v-press" onClick={savePublic} disabled={savingPublic} style={{
              fontSize:12,fontWeight:500,borderRadius:8,padding:'9px 16px',opacity:savingPublic?.6:1,
            }}>{savingPublic?'Saving…':'Save'}</button>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noreferrer" className="link-green" style={{fontSize:12}}>View public timeline →</a>
            )}
          </div>
        )}
        {!isPublic && subscription?.is_public && (
          <div className="reveal-in" style={{display:'flex',alignItems:'center',gap:10,marginTop:16,paddingTop:16,borderTop:`1px solid ${C.borderSoft}`}}>
            <button className="btn btn-primary v-press" onClick={savePublic} disabled={savingPublic} style={{
              fontSize:12,fontWeight:500,borderRadius:8,padding:'9px 16px',opacity:savingPublic?.6:1,
            }}>{savingPublic?'Saving…':'Save'}</button>
            <span style={{fontSize:11.5,color:C.label}}>Saves the timeline as private.</span>
          </div>
        )}
        {(publicSaved||publicError) && (
          <p className="reveal-in" style={{fontSize:11.5,marginTop:10,color:publicError?C.redText:C.green}}>
            {publicError||'✓ Saved'}
          </p>
        )}
      </Card>

      {/* Competitors — capped at two, by design. */}
      <Card className="fade-up" style={{padding:'22px 26px',marginBottom:14,animationDelay:'.12s'}}>
        <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Competitors</p>
        <p style={{fontSize:11.5,color:C.label,margin:'4px 0 14px'}}>Scanned every Monday — you'll be alerted if anything changes. Up to two sites.</p>
        <div style={{display:'flex',flexDirection:'column',gap:8,maxWidth:420}}>
          {competitors.map((url, i) => (
            <input key={i} type="url" value={url}
              onChange={e=>{ const next=[...competitors]; next[i]=e.target.value; setCompetitors(next) }}
              placeholder={`https://competitor-${i+1}.com`}
              style={{...monoInput,width:'100%'}}/>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginTop:14,flexWrap:'wrap'}}>
          <button className="btn btn-primary v-press" onClick={saveCompetitors} disabled={savingComp} style={{
            fontSize:12,fontWeight:500,borderRadius:8,padding:'9px 16px',opacity:savingComp?.6:1,
          }}>{savingComp?'Saving…':'Save competitors'}</button>
          {compSaved && <span className="reveal-in" style={{fontSize:11.5,color:C.green}}>✓ Saved</span>}
          {compError && <span className="reveal-in" style={{fontSize:11.5,color:C.redText}}>{compError}</span>}
        </div>
      </Card>

      {/* Account */}
      <Card className="fade-up" style={{padding:'22px 26px',marginBottom:26,animationDelay:'.16s'}}>
        <p style={{fontSize:13.5,fontWeight:600,color:C.text}}>Account</p>
        <p style={{fontSize:12.5,color:'#4A5248',marginTop:6}}>{user?.email}</p>
      </Card>

      {/* Danger zone */}
      <div className="fade-up" style={{
        border:`1px solid ${C.dangerBorder}`,borderRadius:14,padding:'20px 26px',
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap',
        animationDelay:'.2s',
      }}>
        <div>
          <p style={{fontSize:13,fontWeight:600,color:C.redText}}>Danger zone</p>
          <p style={{fontSize:11.5,color:'#A8887F',marginTop:3}}>
            {hasBilling
              ? 'Cancel your subscription or permanently delete your account and all data.'
              : 'Permanently delete your account and all data.'}
          </p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {hasBilling && (
            <button className="btn" onClick={cancelViaPortal} disabled={cancelLoading} style={{
              fontSize:12,color:C.redText,background:'none',border:`1px solid ${C.dangerBorder}`,
              borderRadius:8,padding:'8px 14px',whiteSpace:'nowrap',opacity:cancelLoading?.6:1,
            }}>{cancelLoading?'…':'Cancel subscription'}</button>
          )}
          <button className="btn" onClick={onDeleteRequest} style={{
            fontSize:12,color:C.redText,background:'none',border:`1px solid ${C.dangerBorder}`,
            borderRadius:8,padding:'8px 14px',whiteSpace:'nowrap',
          }}>Delete account</button>
        </div>
      </div>
    </div>
  )
}

// ─── RUN DETAIL MODAL ─────────────────────────────────────────────────────────
function RunDetail({run, onClose}) {
  const analysis = run.analysis_result||{}
  const funnel   = run.funnel_analysis
  const fields   = [
    {label:'Data insight',         text:analysis.data_insight},
    {label:'Impact',               text:analysis.impact},
    {label:'Solution',             text:analysis.solution},
    {label:'Expected improvement', text:analysis.expected_improvement},
    {label:'Competitor angle',     text:analysis.competitor_insight},
  ]

  return (
    <div className="fade-in" style={{position:'fixed',inset:0,zIndex:999,background:'rgba(20,32,26,.45)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={onClose}>
      <div className="pop-in" onClick={e=>e.stopPropagation()} style={{
        background:C.bgCard,borderRadius:16,padding:'28px 26px',
        maxWidth:560,width:'100%',maxHeight:'88vh',overflowY:'auto',
        boxShadow:'0 20px 60px rgba(20,32,26,.2)',position:'relative',
      }}>
        <button onClick={onClose} style={{position:'absolute',top:14,right:16,background:'none',border:'none',fontSize:20,cursor:'pointer',color:C.textLight}}>×</button>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
          <StatusBadge status={run.status}/>
          <span style={{fontSize:11,color:C.textLight}}>{new Date(run.created_at).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        {analysis.problem&&(
          <h3 style={{fontFamily:FONT.serif,fontWeight:500,fontSize:24,letterSpacing:'-.01em',marginBottom:20,color:C.ink,lineHeight:1.25}}>{analysis.problem}</h3>
        )}
        <div style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',marginBottom:16}}>
          <SectionLabel style={{marginBottom:12}}>What the agent did</SectionLabel>
          {/* Wrapping grid (never scrolls horizontally) — stages flow
              left-to-right then wrap; checkmarks show how far the run got. */}
          <div style={{display:'flex',flexWrap:'wrap',gap:'12px 12px'}}>
            {AGENT_STEPS.map((step,i)=>{
              const stepI=deriveAgentStep(run), done=i<=stepI, failed=run.status==='failed'&&i===stepI
              return (
                <div key={step.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,width:58}}>
                  <div style={{
                    width:24,height:24,borderRadius:'50%',fontSize:11,flexShrink:0,
                    background:failed?C.red:done?C.accent:C.borderSoft,
                    display:'flex',alignItems:'center',justifyContent:'center',color:done||failed?'#fff':C.textLight,
                  }}>
                    {failed?'✕':done?'✓':''}
                  </div>
                  <p style={{fontSize:9,color:done?C.accent:C.textLight,textAlign:'center',lineHeight:1.3}}>{step.label}</p>
                </div>
              )
            })}
          </div>
        </div>
        {fields.map((item,i)=>item.text&&(
          <div key={i} style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{marginBottom:5}}>{item.label}</SectionLabel>
            <p style={{fontSize:13,color:C.text,lineHeight:1.65}}>{item.text}</p>
          </div>
        ))}
        {analysis.file_to_edit&&(
          <div style={{background:C.chipBg,border:'1px solid #DDE7DA',borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{color:C.chipText,marginBottom:5}}>File edited</SectionLabel>
            <p style={{fontSize:12,color:C.text,fontFamily:FONT.mono,wordBreak:'break-all'}}>{analysis.file_to_edit}</p>
          </div>
        )}
        {analysis.analytics_snapshot&&(
          <div style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{marginBottom:8}}>Analytics snapshot</SectionLabel>
            <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
              {[
                {label:'Pageviews',value:analysis.analytics_snapshot.totalPageviews},
                {label:'Bounce rate',value:analysis.analytics_snapshot.bounceRate!=null?`${analysis.analytics_snapshot.bounceRate}%`:null},
                {label:'Sessions',value:analysis.analytics_snapshot.uniqueVisitors},
              ].map(({label,value})=>(
                <div key={label}>
                  <p style={{fontSize:10,color:C.textLight}}>{label}</p>
                  <p style={{fontFamily:FONT.serif,fontSize:22,fontWeight:500,color:C.ink}}>{value??'—'}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {funnel&&(
          <div style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:9,padding:'12px 14px',marginBottom:8}}>
            <SectionLabel style={{marginBottom:6}}>Funnel snapshot</SectionLabel>
            <p style={{fontSize:12,color:C.text}}>{funnel.totalPages} pages · {Object.keys(funnel.pageTypes||{}).length} types</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:7}}>
              {Object.entries(funnel.pageTypes||{}).map(([type,count])=>(
                <span key={type} style={{fontSize:10.5,background:C.chipBg,borderRadius:20,padding:'2px 9px',color:C.chipText,fontWeight:500}}>
                  {type}: {count}
                </span>
              ))}
            </div>
            {funnel.biggestDropOff&&(
              <p style={{fontSize:11,color:C.yellowText,marginTop:7}}>Drop-off: {funnel.biggestDropOff.filePath} ({funnel.biggestDropOff.dropOffScore}%)</p>
            )}
          </div>
        )}
        {run.screenshot_before&&(
          <div style={{marginBottom:8}}>
            <SectionLabel style={{marginBottom:6}}>Before screenshot</SectionLabel>
            <img src={run.screenshot_before} alt="Page before the change"
              style={{width:'100%',borderRadius:9,border:`1px solid ${C.border}`,display:'block'}}/>
          </div>
        )}
        {run.pr_url&&(
          <a href={run.pr_url} target="_blank" rel="noreferrer" className="btn-primary v-press" style={{
            display:'block',textAlign:'center',marginTop:20,
            borderRadius:9,padding:'12px',
            fontSize:14,fontFamily:FONT.sans,fontWeight:500,textDecoration:'none',
          }}>View Pull Request on GitHub →</a>
        )}
      </div>
    </div>
  )
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function DeleteConfirmModal({onConfirm, onCancel, loading, error}) {
  return (
    <div className="fade-in" style={{position:'fixed',inset:0,zIndex:999,background:'rgba(20,32,26,.45)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={onCancel}>
      <div className="pop-in" onClick={e=>e.stopPropagation()} style={{background:C.bgCard,borderRadius:16,padding:'28px 26px',maxWidth:400,width:'100%',boxShadow:'0 20px 60px rgba(20,32,26,.2)'}}>
        <h3 style={{fontFamily:FONT.serif,fontWeight:500,fontSize:22,marginBottom:8,color:C.text}}>Delete your account?</h3>
        <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7,marginBottom:22}}>This permanently deletes your account, all agent runs, and all connected data. Cannot be undone.</p>
        {error && (
          <p style={{fontSize:12,color:C.redText,background:C.redBg,border:`1px solid ${C.dangerBorder}`,borderRadius:7,padding:'8px 12px',marginBottom:14}}>
            {error}
          </p>
        )}
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost" onClick={onCancel} style={{flex:1,borderRadius:8,padding:'12px',fontSize:13}}>Cancel</button>
          <button className="btn" onClick={onConfirm} disabled={loading} style={{flex:1,background:C.red,color:'#fff',borderRadius:8,padding:'12px',fontSize:13,fontWeight:500,opacity:loading?.6:1}}>
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
  const [triggerLoading, setTriggerLoading] = useState(false)
  const [triggerMessage, setTriggerMessage] = useState(null) // { text, error }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError,    setDeleteError]    = useState(null)
  const [activePage,     setActivePage]     = useState('overview')
  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [funnelPages,    setFunnelPages]    = useState([])
  const [learnings,      setLearnings]      = useState([])
  const [snippetDeclined, setSnippetDeclined] = useState(false)
  const [siteNetwork,     setSiteNetwork]     = useState(null)   // agent_site_network latest row
  const [structurePreview,setStructurePreview]= useState(null)   // site_structure_preview row (pre-first-run fallback)
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

  // Onboarding collects no card anymore, so there is no Stripe checkout session
  // to verify here, and the agent_subscriptions row always exists before the
  // dashboard loads (it's created at onboarding start). Settle the gate
  // immediately: the "Unlock" screen below only shows when there is genuinely no
  // row (a user who never onboarded).
  useEffect(() => {
    if (!user || isDemo) return
    setStripeVerified(false)
    setVerifyDone(true)
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

  // Trial-start fallback: if onboarding completed but the post-finalize
  // start_trial didn't land (subscription_status still null + no Stripe
  // customer), kick it off here. start_trial is idempotent server-side, so a
  // re-fire is safe; once it succeeds the row gets a customer id and this stops.
  useEffect(() => {
    if (!user || isDemo || !subscription) return
    if (!subscription.onboarding_completed_at) return
    if (subscription.subscription_status || subscription.stripe_customer_id) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled || !session) return
        await fetch('/api/stripe?action=start_trial', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!cancelled) fetchData()
      } catch (e) {
        console.warn('[dashboard] start_trial fallback failed:', e?.message)
      }
    })()
    return () => { cancelled = true }
  }, [user, isDemo, subscription])

  async function fetchData() {
   try {
    // limit(1)+maybeSingle: .single() ERRORS on 0 OR 2 rows — a stray duplicate
    // subscription row would null out `subs` and wrongly show a paying user the
    // "Unlock" subscribe screen. Newest row wins; 0 rows → null (no throw).
    const {data:subs}=await supabase.from('agent_subscriptions').select('*').eq('auth_user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle()
    setSubscription(subs)
    if(!subs) return

    const [runsRes, funnelRes, learningsRes, connRes, snRes, previewRes] = await Promise.all([
      supabase.from('agent_runs').select('*').eq('subscription_id',subs.id).order('created_at',{ascending:false}).limit(50),
      supabase.from('agent_funnel_pages').select('*').eq('subscription_id',subs.id).order('created_at',{ascending:false}).limit(30),
      supabase.from('agent_learnings').select('*').eq('subscription_id',subs.id).order('created_at',{ascending:false}).limit(50),
      supabase.from('agent_connections').select('posthog_snippet_declined,website_url').eq('subscription_id',subs.id).maybeSingle(),
      // agent_site_network may not exist yet (Stage 4.5 migration); error is silently ignored
      supabase.from('agent_site_network').select('*').eq('subscription_id',subs.id).order('captured_at',{ascending:false}).limit(1).maybeSingle(),
      // site_structure_preview: onboarding's discover_structure writes one row per
      // subscription. Network surfaces fall back to it before the first run populates
      // agent_site_network. Table may be absent on older deploys (42P01) — same silent handling.
      supabase.from('site_structure_preview').select('*').eq('subscription_id',subs.id).maybeSingle(),
    ])

    if(runsRes.data) setRuns(runsRes.data)
    if(funnelRes.data){
      const seen=new Set()
      setFunnelPages(funnelRes.data.filter(p=>{if(seen.has(p.page_path))return false;seen.add(p.page_path);return true}))
    }
    if(learningsRes.data) setLearnings(learningsRes.data)
    setSnippetDeclined(connRes.data?.posthog_snippet_declined === true)
    setWebsiteUrl(connRes.data?.website_url || null)
    // 42P01 = relation does not exist (table absent until Stage 4.5 migration) — expected, stay silent.
    // Any other error (RLS denial, permission issue) is surfaced so it doesn't silently eat real data.
    if (snRes.error && snRes.error.code !== '42P01') {
      console.warn('[fetchData] agent_site_network:', snRes.error.message)
    }
    setSiteNetwork(snRes.data || null)
    // 42P01 (table absent on older deploys) stays silent, mirroring agent_site_network above.
    if (previewRes.error && previewRes.error.code !== '42P01') {
      console.warn('[fetchData] site_structure_preview:', previewRes.error.message)
    }
    setStructurePreview(previewRes.data || null)
   } catch (err) {
    // A network/transient failure must not strand the user on the spinner — the
    // 30s poll (and the fast post-checkout poll) will retry. Log for debugging.
    console.error('[fetchData] load failed:', err?.message || err)
   } finally {
    setLoading(false)
   }
  }

  async function getToken() {
    const {data:{session}}=await supabase.auth.getSession()
    return session?.access_token
  }

  const [subscribeLoading, setSubscribeLoading] = useState(false)
  // Pre-checkout consent modal for the dashboard "Unlock your Growth Agent" CTA.
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false)
  async function doHandleSubscribe() {
    if (subscribeLoading || isDemo) return
    setSubscribeLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { navigate('/agent/login'); return }
    const result = await startCheckout('subscription', session.user.id, session.user.email)
    if (!result?.redirected) setSubscribeLoading(false)
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

  // "Run now" — fires a single manual run (api/agent/run.js?action=trigger_run).
  // Server enforces: active + not paused, no run in-flight, max 1/day. We
  // optimistically stamp last_manual_run_at so the button locks immediately, and
  // surface 409/429/402 errors inline. fetchData polling (every 30s) picks up the
  // new 'running' run.
  async function handleTriggerRun() {
    if (triggerLoading || isDemo) return
    setTriggerLoading(true)
    setTriggerMessage(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/agent/run?action=trigger_run', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.triggered) {
        if (data.nextManualRunAt) {
          setSubscription(prev => prev ? { ...prev, last_manual_run_at: new Date().toISOString() } : prev)
        }
        setTriggerMessage({ text: 'Run started — your agent is analyzing now.', error: false })
        fetchData()
      } else {
        setTriggerMessage({ text: data.error || 'Could not start the run. Please try again.', error: true })
      }
    } catch {
      setTriggerMessage({ text: 'Could not start the run. Please try again.', error: true })
    } finally {
      setTriggerLoading(false)
    }
  }

  async function handleSaveSettings(payload) {
    const token = await getToken()
    const res = await fetch('/api/agent/run?action=update-settings', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    })
    // Non-JSON response (proxy/HTML error page, dev server without /api) must
    // surface as a clean "Save failed", not an unhandled parse throw.
    const data = await res.json().catch(() => ({}))
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
      setDeleteError(data.error || 'Something went wrong. Please try again.')
      setActionLoading(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/agent/login')
  }

  const pending   = runs.filter(isAwaitingApproval).length
  const isRunning = runs.some(r=>r.status==='running')
  const isPaused  = subscription?.status==='paused'

  if(authLoading) return (
    <>
      <style>{CSS + MOTION_CSS}</style>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><Spinner size={24}/></div>
    </>
  )

  return (
    <>
      <style>{CSS + MOTION_CSS}</style>
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
        <div className="reveal-in" style={{
          position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', zIndex:200,
          background:C.bgCard, border:`1px solid ${C.border}`,
          boxShadow:'0 4px 20px rgba(20,32,26,.12)',
          borderRadius:10, padding:'10px 16px',
          fontSize:13, color:C.text, fontFamily:FONT.sans,
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

        {/* ── LEFT SIDEBAR NAV (deep green) ── */}
        <nav className="dash-sidebar" style={{
          width:228,flexShrink:0,background:C.sidebar,
          display:'flex',flexDirection:'column',
          padding:'22px 14px 16px',
          position:'sticky',top:0,height:'100vh',
          overflowY:'auto',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 8px 24px'}}>
            <div onClick={()=>navigate('/')} style={{display:'flex',alignItems:'center',gap:11,cursor:'pointer',minWidth:0}}>
              <VelyrLogo size={30} color="#C9E3D2"/>
              <div>
                <p style={{fontFamily:FONT.serif,fontSize:20,lineHeight:1,color:C.sideText}}>Velyr</p>
                <p style={{fontSize:8.5,letterSpacing:'.18em',color:C.sideFaint,marginTop:3,textTransform:'uppercase'}}>Growth Agent</p>
              </div>
            </div>
            <button
              className="dash-drawer-close btn"
              aria-label="Close navigation"
              onClick={()=>setDrawerOpen(false)}
              style={{
                width:36,height:36,borderRadius:8,flexShrink:0,
                border:'1px solid rgba(255,255,255,.15)',background:'transparent',
                alignItems:'center',justifyContent:'center',
                fontSize:20,color:C.sideMuted,lineHeight:1,
              }}
            >×</button>
          </div>

          <div style={{flex:1}}>
            {NAV_ITEMS.map(item=>{
              const active = activePage===item.id
              return (
                <button key={item.id} className="nav-item" onClick={()=>{setActivePage(item.id); setDrawerOpen(false)}} style={{
                  display:'flex',alignItems:'center',gap:11,
                  padding:'9px 12px',borderRadius:8,marginBottom:2,fontSize:13,
                  background:active?'rgba(255,255,255,.12)':'transparent',
                  color:active?C.sideText:C.sideMuted,
                  fontWeight:active?500:400,
                  fontFamily:FONT.sans,
                }}>
                  <NavIcon path={item.icon}/>
                  <span>{item.label}</span>
                  {item.id==='runs'&&pending>0&&(
                    <span className="pop-in" style={{
                      marginLeft:'auto',fontSize:9.5,fontWeight:600,
                      background:C.yellow,color:'#1E362B',borderRadius:10,
                      padding:'1px 6px',minWidth:16,textAlign:'center',
                    }}>{pending}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div style={{marginTop:'auto',padding:'12px 12px 0',borderTop:'1px solid rgba(255,255,255,.09)'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:C.sideFaint}}>
              <span className={isPaused?'':'pulse-dot'} style={{
                width:7,height:7,borderRadius:'50%',flexShrink:0,
                background:isPaused?'#9A9E93':isRunning?C.yellow:'#7FC79A',
              }}/>
              <span>{isPaused?'Agent paused':isRunning?'Agent running':'Agent active'}</span>
            </div>
            <p style={{fontSize:10.5,color:C.sideDim,marginTop:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user?.email}</p>
          </div>
        </nav>

        {/* ── MAIN ── */}
        <main className="dash-main" style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflowY:'auto',height:'100vh'}}>
          <div className="dash-content-pad" style={{maxWidth:1160,margin:'0 auto',padding:'30px 40px 40px',width:'100%',flex:1}}>

            {/* Header */}
            <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:26,gap:12}}>
              <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
                <button
                  className="dash-hamburger btn"
                  aria-label="Open navigation"
                  onClick={()=>setDrawerOpen(true)}
                  style={{
                    width:40,height:40,borderRadius:8,flexShrink:0,
                    border:`1px solid ${C.borderMed}`,background:C.bgCard,
                    alignItems:'center',justifyContent:'center',
                  }}
                >
                  <span style={{position:'relative',display:'block',width:16,height:11}}>
                    <span style={{position:'absolute',left:0,right:0,top:0,height:1.5,background:C.text,borderRadius:1}}/>
                    <span style={{position:'absolute',left:0,right:0,top:5,height:1.5,background:C.text,borderRadius:1}}/>
                    <span style={{position:'absolute',left:0,right:0,top:10,height:1.5,background:C.text,borderRadius:1}}/>
                  </span>
                </button>
                <div style={{display:'flex',flexDirection:'column',gap:4,minWidth:0}}>
                  <h1 style={{margin:0,fontSize:21,fontWeight:600,letterSpacing:'-.01em',color:C.text}}>
                    {PAGE_TITLES[activePage]||'Overview'}
                  </h1>
                  {pending>0&&(
                    <button className="dash-header-badge-m btn" onClick={()=>setActivePage('runs')} style={{
                      alignItems:'center',gap:6,background:C.yellowBg,borderRadius:20,padding:'3px 10px',
                      border:'none',alignSelf:'flex-start',
                    }}>
                      <span className="pulse-dot" style={{width:5,height:5,borderRadius:'50%',background:C.yellow,display:'inline-block',flexShrink:0}}/>
                      <span style={{fontSize:11,color:C.yellowText,fontWeight:500,whiteSpace:'nowrap'}}>{pending} awaiting approval</span>
                    </button>
                  )}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                {pending>0&&(
                  <button className="dash-header-badge-d btn" onClick={()=>setActivePage('runs')} style={{
                    display:'flex',alignItems:'center',gap:6,background:C.yellowBg,borderRadius:20,padding:'5px 12px',border:'none',
                  }}>
                    <span className="pulse-dot" style={{width:5,height:5,borderRadius:'50%',background:C.yellow,display:'inline-block'}}/>
                    <span style={{fontSize:11,color:C.yellowText,fontWeight:500}}>{pending} awaiting approval</span>
                  </button>
                )}
                <button className="btn" onClick={handleLogout} style={{
                  fontSize:12,color:C.textMuted,background:'none',
                  border:`1px solid ${C.borderMed}`,borderRadius:8,padding:'7px 14px',
                }}
                  onMouseEnter={e=>{e.currentTarget.style.background=C.bgCard}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent'}}
                >Log out</button>
              </div>
            </header>

            {loading&&!subscription&&(
              <div style={{padding:64,display:'flex',justifyContent:'center'}}><Spinner size={24}/></div>
            )}

            {!loading&&!subscription&&stripeVerified===true&&(
              <Card className="fade-up" style={{padding:'48px 32px',textAlign:'center',maxWidth:480,margin:'0 auto'}}>
                <div style={{display:'flex',justifyContent:'center'}}><Spinner size={28}/></div>
                <h2 style={{fontFamily:FONT.serif,fontWeight:500,fontSize:24,margin:'18px 0 10px',color:C.text}}>Setting up your Growth Agent…</h2>
                <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7}}>Payment confirmed. We're finalizing your account — this usually takes a few seconds.</p>
              </Card>
            )}

            {!loading&&verifyDone&&!subscription&&stripeVerified===false&&(
              <Card className="fade-up" style={{padding:'48px 32px',textAlign:'center',maxWidth:480,margin:'0 auto'}}>
                <div style={{display:'flex',justifyContent:'center',marginBottom:16}}><VelyrLogo size={40}/></div>
                <h2 style={{fontFamily:FONT.serif,fontWeight:500,fontSize:28,marginBottom:10,color:C.text}}>Unlock your Growth Agent</h2>
                <p style={{fontSize:13,color:C.textMuted,lineHeight:1.7,marginBottom:24}}>Start your 14-day free trial — no card required. You'll connect GitHub and Telegram in onboarding.</p>
                <button className="btn btn-primary v-press" onClick={() => navigate('/agent/onboarding')} style={{
                  borderRadius:9,padding:'13px 26px',fontSize:14,fontWeight:500,
                }}>Start free trial →</button>
                <div style={{ marginTop: 22 }}>
                  <button
                    onClick={() => { setDeleteError(null); setShowDeleteConfirm(true) }}
                    style={{
                      background:'none', border:'none', cursor:'pointer',
                      fontSize:12, color:C.textLight, fontFamily:FONT.sans,
                      textDecoration:'underline', textDecorationColor:'rgba(154,158,147,.4)',
                    }}
                  >Delete account</button>
                </div>
              </Card>
            )}

            {subscription&&!loading&&(
              <>
                {snippetDeclined&&!isDemo&&(
                  <div className="fade-up" style={{
                    marginBottom:16,padding:'11px 16px',
                    background:C.yellowBg,border:'1px solid #EADFC2',borderRadius:10,
                    display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',
                  }}>
                    <span style={{fontSize:12,color:C.yellowText,lineHeight:1.4}}>
                      Analytics tracking declined — fix recommendations will be less accurate without visitor data.
                    </span>
                    <button className="btn v-press" onClick={handleReenableSnippet} style={{
                      fontSize:11,fontWeight:500,padding:'6px 13px',borderRadius:7,flexShrink:0,
                      background:C.ink,color:C.sideText,
                    }}>
                      Re-enable tracking →
                    </button>
                  </div>
                )}

                {subscription.subscription_status==='trial_denied'&&!isDemo&&(
                  <div className="fade-up" style={{
                    marginBottom:16,padding:'11px 16px',
                    background:C.yellowBg,border:'1px solid #EADFC2',borderRadius:10,
                    display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',
                  }}>
                    <span style={{fontSize:12,color:C.yellowText,lineHeight:1.4}}>
                      This website already used a Velyr free trial, so a second trial isn't available. Subscribe to activate your Growth Agent — €29/mo, cancel anytime.
                    </span>
                    <button className="btn v-press" onClick={()=>setUnlockConfirmOpen(true)} style={{
                      fontSize:11,fontWeight:500,padding:'6px 13px',borderRadius:7,flexShrink:0,
                      background:C.ink,color:C.sideText,
                    }}>
                      Activate — €29/mo →
                    </button>
                  </div>
                )}

                <div key={activePage} className="page-in">
                  {activePage==='overview'&&(
                    <OverviewPage
                      runs={runs} subscription={subscription} learnings={learnings}
                      onSelectRun={setSelected}
                      onTogglePause={handleTogglePause}
                      actionLoading={actionLoading}
                      onTriggerRun={handleTriggerRun}
                      triggerLoading={triggerLoading}
                      triggerMessage={triggerMessage}
                      onGoRuns={()=>setActivePage('runs')}
                      onGoGuardrails={()=>setActivePage('guardrails')}
                      onGoDna={()=>setActivePage('dna')}
                    />
                  )}

                  {activePage==='runs'&&(
                    <RunsPage runs={runs} loading={loading} onSelect={setSelected} learnings={learnings}/>
                  )}

                  {activePage==='network'&&(
                    <NetworkPage
                      runs={runs}
                      siteNetwork={siteNetwork}
                      structurePreview={structurePreview}
                      websiteUrl={websiteUrl}
                    />
                  )}

                  {activePage==='funnel'&&(
                    <FunnelPage funnelPages={funnelPages} loading={loading}
                      subscription={subscription} onSaveSettings={handleSaveSettings}/>
                  )}

                  {activePage==='dna'&&(
                    <DNAPage subscriptionId={subscription?.id}/>
                  )}

                  {activePage==='guardrails'&&(
                    <GuardrailsPage subscriptionId={subscription?.id}/>
                  )}

                  {activePage==='settings'&&(
                    <SettingsPage
                      subscription={subscription} user={user}
                      onTogglePause={handleTogglePause} actionLoading={actionLoading}
                      onDeleteRequest={()=>{ setDeleteError(null); setShowDeleteConfirm(true) }}
                      onSaveSettings={handleSaveSettings}
                      navigate={navigate}
                    />
                  )}
                </div>
              </>
            )}
          </div>

          {/* Legal footer (§5 TMG — Impressum must be reachable from every page) */}
          <div style={{ borderTop:`1px solid ${C.border}`, padding:'20px 40px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
            <span style={{ fontSize:12, color:C.textLight }}>© 2026 Velyr</span>
            <div style={{ display:'flex', gap:18, flexWrap:'wrap' }}>
              <button onClick={() => navigate('/privacy')}   style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:C.textLight, fontFamily:FONT.sans }}>Privacy Policy</button>
              <button onClick={() => navigate('/impressum')} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:C.textLight, fontFamily:FONT.sans }}>Imprint</button>
              <button onClick={() => navigate('/agb')}       style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:C.textLight, fontFamily:FONT.sans }}>AGB</button>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
