// ─── Landing-page replica of the real Agent Dashboard ────────────────────────
// A faithful miniature of src/pages/AgentDashboard.jsx (2026-07 redesign: deep-
// green sidebar + warm cream per-tab card UI), filled with demoData and fully
// clickable: all seven tabs render, run rows open a detail panel, and every
// toggle / chip / filter / button responds locally. Buttons that would hit the
// backend show a small in-shell toast instead.
//
// Design tokens, status maps, nav icons and step lists are COPIED from
// AgentDashboard.jsx (`C`, `STATUS`, `NAV_ITEMS`, `AGENT_STEPS`) — keep them in
// sync when the dashboard is restyled so this preview never drifts from the
// product. Marketing-only mock data (the pending PR, DNA entries, guardrails)
// lives here, NOT in demoData, so the live /agent?demo=true dashboard is
// unaffected.
//
// Boot choreography: Home.jsx's `.dash-boot` CSS targets the class names
// .dash-preview-shell / .dp-leftnav / .dp-main / .dash-mc placed below.
import { useEffect, useRef, useState } from 'react'
import { demoData } from '../data/demoData'
import SiteNetwork from './SiteNetwork.jsx'
import { mockSiteNetworkData } from '../data/mockSiteNetwork.js'
import { CountUp } from '../lib/motion.jsx'

// ─── Design tokens (copied from AgentDashboard.jsx `C` / `FONT`) ──────────────
const T = {
  bg:           '#EFEDE4',
  bgCard:       '#FFFFFF',
  bgSoft:       '#FBFAF4',
  bgChip:       '#F4F2E9',
  sidebar:      '#1E362B',
  text:         '#1C2420',
  textMuted:    '#6B7266',
  textLight:    '#9A9E93',
  textFaint:    '#A8AB9E',
  label:        '#8B8F80',
  border:       '#E3E0D4',
  borderSoft:   '#F0EEE3',
  borderMed:    '#D8D5C8',
  ink:          '#1E362B',
  accent:       '#3E6B54',
  accentBar:    '#7FA98F',
  chipBg:       '#EFF3EC',
  chipText:     '#4A6B58',
  green:        '#3E7A56', greenBg: '#E4EEE4', greenText: '#2C5B3F',
  yellow:       '#C9A227', yellowBg: '#F5EEDC', yellowText: '#8A6D1F',
  red:          '#C0553F', redBg: '#F6E7E4',  redText: '#9C3B2E',
  gray:         '#9A9E93', grayBg: '#ECEBE6',  grayText: '#6B7266',
  banner:       '#E9EFE7', bannerBorder: '#D3DECF', bannerText: '#33463B',
  dangerBorder: '#EBD9D4',
  sideText:     '#F4F2E9',
  sideMuted:    '#9DB3A6',
  sideFaint:    '#8FA697',
  sideDim:      '#5F7A6B',
}
const F = {
  sans:  "'Poppins', system-ui, sans-serif",
  serif: "'Newsreader', Georgia, serif",
  mono:  "ui-monospace, Menlo, Consolas, monospace",
}

const STATUS = {
  running:          { label: 'Running',           bg: T.chipBg,   color: T.accent,     dot: T.yellow },
  waiting_approval: { label: 'Awaiting approval', bg: T.yellowBg, color: T.yellowText, dot: T.yellow },
  deployed:         { label: 'Deployed',          bg: T.greenBg,  color: T.greenText,  dot: T.green },
  rejected:         { label: 'Rejected',          bg: T.redBg,    color: T.redText,    dot: T.red },
  failed:           { label: 'Failed',            bg: T.redBg,    color: T.redText,    dot: T.red },
  rolled_back:      { label: 'Rolled back',       bg: T.grayBg,   color: T.grayText,   dot: T.gray },
  pending:          { label: 'Pending',           bg: T.grayBg,   color: T.grayText,   dot: T.gray },
}

// Sidebar nav — same SVG stroke icons as the real dashboard.
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

const AGENT_STEPS = [
  { id:'fetch_repo',  label:'Fetching source',          desc:'Reading your repo or theme structure' },
  { id:'fetch_ph',    label:'Pulling analytics',        desc:'Loading PostHog pageview & session data' },
  { id:'scan_comp',   label:'Scanning competitors',     desc:'Checking tracked competitor sites for changes' },
  { id:'seasonal',    label:'Checking seasonal',        desc:'Picking the right priority for this month' },
  { id:'read_dna',    label:'Reading Business DNA',     desc:'Loading what works and what to avoid' },
  { id:'map_funnel',  label:'Mapping funnel',           desc:'Detecting pages and conversion flow' },
  { id:'analyze',     label:'Finding biggest issue',    desc:'Claude analyzing where visitors drop off' },
  { id:'screenshot',  label:'Taking before screenshot', desc:'Capturing the page before any changes' },
  { id:'write_fix',   label:'Writing fix',              desc:'Editing file and generating patch' },
  { id:'open_pr',     label:'Preparing fix',            desc:'Opening a PR or staging the theme change' },
  { id:'notify',      label:'Sending notification',     desc:'Telegram message — reply YES or NO' },
]

// The Network graph keeps its own pre-redesign look (matches NetworkPage).
const NODE_STATUS_COPY = {
  neutral: 'Watching', tracked: 'Tracked', 'fix-in-flight': 'Fix in progress',
  optimized: 'Optimized', problem: 'Regression',
}
const NODE_STATUS_DOT = {
  neutral: '#a8a39a', tracked: '#ccc8c3', 'fix-in-flight': '#c2a45f',
  optimized: '#2f6b4f', problem: '#c2573d',
}

// ─── Marketing-only mock data (NOT in demoData — see header comment) ─────────
const HOUR = 3600000
const daysAgo = (n) => new Date(Date.now() - n * 24 * HOUR).toISOString()

const PENDING_RUN = {
  id: 'preview-pending', status: 'waiting_approval', pr_number: 251,
  pr_url: 'https://github.com/taskloop/web/pull/251',
  created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  analysis_result: {
    problem_title: 'Hero CTA is buried under secondary links',
    problem: 'Hero buries the primary CTA under two secondary links',
    data_insight: 'Scroll-depth data shows 62% of mobile visitors never reach the current CTA position; heatmaps show the top link cluster splits attention three ways.',
    solution: 'Move the "Start free trial" button directly under the headline and demote the two secondary links to one text link below it.',
    expected_improvement: '+0.4pp CVR',
    file_to_edit: 'src/components/Hero/Hero.tsx',
    confidence_score: 84,
    backlog: [
      { page_path: '/pricing', problem: 'No plan comparison table — visitors skim the page in under 25s.', expected_impact: '+0.2pp CVR' },
      { page_path: '/onboarding', problem: 'Step 3 has no confirmation state, so unsure users re-submit.', expected_impact: '+0.15pp activation' },
      { page_path: '/docs', problem: "Search results have no result count or empty state.", expected_impact: 'Fewer support tickets' },
    ],
  },
}

const DNA_ENTRIES = [
  { id:'dna-1', outcome:'measured_win', fix_type:'form_length',       notes:'Short signup forms win on this site — cutting to two fields lifted signup completion measurably.', created_at: daysAgo(4) },
  { id:'dna-2', outcome:'measured_win', fix_type:'image_performance', notes:'Compressing hero media pays off — mobile bounce fell 4pp after the AVIF swap.', created_at: daysAgo(25) },
  { id:'dna-3', outcome:'survived',     fix_type:'social_proof',      notes:'Trust signals near the feature grid reduce first-visit bounce for cold traffic.', created_at: daysAgo(32) },
  { id:'dna-4', outcome:'survived',     fix_type:'cta_placement',     notes:'Above-the-fold pricing CTA works for mobile visitors — keep primary actions high.', created_at: daysAgo(67) },
  { id:'dna-5', outcome:'rollback',     fix_type:'cta_copy',          notes:'Over-specific hero CTA copy ("Start automating in 2 minutes") raised bounce 4pp — avoid time promises in CTAs.', created_at: daysAgo(39) },
  { id:'dna-6', outcome:'pending',      fix_type:'onboarding_progress', notes:'Progress indicator on onboarding step 2 — deployed, awaiting the 7-day verdict.', created_at: daysAgo(3) },
]

// ─── Helpers (copied from AgentDashboard.jsx) ─────────────────────────────────
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff/60000), h = Math.floor(m/60), d = Math.floor(h/24)
  if (d>0) return `${d}d ago`; if (h>0) return `${h}h ago`; if (m>0) return `${m}m ago`; return 'just now'
}
function fmt(iso) {
  return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
}
function nextMonday9am() {
  const now=new Date(), day=now.getDay()
  const daysUntil = day===1?(now.getHours()<9?0:7):(8-day)%7||7
  const next=new Date(now); next.setDate(now.getDate()+daysUntil); next.setHours(9,0,0,0); return next
}
const isLive = r => r.status==='deployed'

// Mirrors runTitle() in AgentDashboard.jsx: a short AI headline first, else a
// word-capped fallback — never mid-sentence (file names/analytics text have dots).
function runTitle(a) {
  if (!a) return 'Analysis pending…'
  if (a.problem_title) return a.problem_title
  const text = a.problem || 'Analysis pending…'
  if (text.length <= 72) return text
  const cut = text.slice(0, 72)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…'
}

// ─── Scoped CSS ───────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap');

  @keyframes dpTabIn   { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  @keyframes dpPulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes dpToastIn { from { opacity:0; transform:translate(-50%,8px); } to { opacity:1; transform:translate(-50%,0); } }
  @keyframes dpPopIn   { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
  @keyframes dpPanelIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:none; } }
  @keyframes dpSpin    { to { transform:rotate(360deg); } }
  .dp-tabpane { animation: dpTabIn .3s cubic-bezier(.4,0,.2,1); }
  .dp-pulse   { animation: dpPulse 2.4s ease-in-out infinite; }
  .dp-pop-in  { animation: dpPopIn .28s cubic-bezier(.22,.61,.36,1) both; }
  .dp-spinner { display:inline-block; width:12px; height:12px; border-radius:50%; border:1.5px solid currentColor; border-top-color:transparent; animation: dpSpin .7s linear infinite; flex-shrink:0; }

  .dp-navitem { cursor:pointer; transition:background .18s ease, color .18s ease; border:none; background:none; width:100%; text-align:left; font-family:${F.sans}; }
  .dp-navitem:hover { background:rgba(255,255,255,.07); }
  .dp-run-row { cursor:pointer; transition:background .15s ease; }
  .dp-run-row:hover { background:${T.bgSoft}; }
  .dp-btn { cursor:pointer; transition:background .18s ease, color .18s ease, border-color .18s ease, opacity .18s ease, transform .15s ease; border:none; font-family:${F.sans}; }
  .dp-btn:active:not(:disabled) { transform:scale(.985); }
  .dp-btn-primary { background:${T.ink}; color:${T.sideText}; }
  .dp-btn-primary:hover:not(:disabled) { background:#2C4A3B; }
  .dp-btn-ghost { background:none; border:1px solid ${T.borderMed}; color:#4A5248; }
  .dp-btn-ghost:hover:not(:disabled) { background:#F7F5EC; }
  .dp-btn-danger { background:none; border:1px solid ${T.dangerBorder}; color:${T.redText}; }
  .dp-btn-danger:hover:not(:disabled) { background:#F6EBE8; }
  .dp-link { color:${T.accent}; font-weight:500; cursor:pointer; background:none; border:none; padding:0; font-family:${F.sans}; }
  .dp-link:hover { text-decoration:underline; }
  .dp-card-hover { transition:box-shadow .22s ease, transform .18s ease; }
  .dp-card-hover:hover { box-shadow:0 6px 24px rgba(30,54,43,.08); transform:translateY(-1px); }
  .dp-input { background:${T.bgSoft}; border:1px solid ${T.border}; border-radius:8px; padding:8px 12px; font-size:11.5px; font-family:${F.sans}; color:${T.text}; outline:none; }
  .dp-input:focus { border-color:${T.accent}; background:#FFFFFF; }
  .dp-input::placeholder { color:${T.textFaint}; }
  .dp-chip-x { cursor:pointer; border:none; width:15px; height:15px; border-radius:50%; font-size:10px; line-height:1; display:grid; place-items:center; font-family:${F.sans}; transition:background .15s ease; }
  .dp-toggle { width:38px; height:22px; border-radius:11px; position:relative; cursor:pointer; flex:none; transition:background .22s ease; border:none; }
  .dp-toggle .dp-knob { width:16px; height:16px; border-radius:50%; background:#FFFFFF; position:absolute; top:3px; transition:left .22s cubic-bezier(.22,.61,.36,1); box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .dp-scroll { overflow-y:auto; scrollbar-width:thin; scrollbar-color:rgba(30,54,43,.18) transparent; }
  .dp-scroll::-webkit-scrollbar { width:5px; height:5px; }
  .dp-scroll::-webkit-scrollbar-thumb { background:rgba(30,54,43,.18); border-radius:3px; }
  .dp-scroll::-webkit-scrollbar-track { background:transparent; }

  .dp-hero { display:grid; grid-template-columns:1.3fr 1fr auto; }
  .dp-hero-cell { padding:16px 20px; border-right:1px solid ${T.borderSoft}; }
  .dp-hero-cell:last-child { border-right:none; }
  .dp-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .dp-cols { display:grid; grid-template-columns:2fr 1fr; gap:10px; align-items:start; }
  .dp-funnel-top { display:grid; grid-template-columns:1.6fr 1fr; gap:10px; align-items:start; }
  .dp-approval-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  .dp-strip { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .dp-tabbar { display:none; }

  @media (max-width: 860px) {
    .dash-preview-shell .dp-leftnav { display:none !important; }
    .dp-tabbar { display:flex !important; }
    .dp-hero { grid-template-columns:1fr; }
    .dp-hero-cell { border-right:none; border-bottom:1px solid ${T.borderSoft}; }
    .dp-hero-cell:last-child { border-bottom:none; }
    .dp-cols, .dp-funnel-top, .dp-approval-grid { grid-template-columns:1fr; }
    .dash-preview-shell .dp-main { padding:14px 14px 20px !important; }
  }
  @media (max-width: 600px) {
    .dp-kpis { grid-template-columns:1fr 1fr; }
    .dp-strip { grid-template-columns:1fr 1fr; }
    .dp-chrome-note { display:none !important; }
  }
`

// ─── Shared bits ──────────────────────────────────────────────────────────────
function VelyrMark({ size=24, color='#C9E3D2' }) {
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

function NavIcon({ path, size=14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.85, flexShrink:0}}>
      <path d={path}/>
    </svg>
  )
}

function Label({children, style}) {
  return <p style={{fontSize:9.5,letterSpacing:'.14em',textTransform:'uppercase',fontWeight:500,color:T.label,...style}}>{children}</p>
}

function Card({children, style, className, onClick}) {
  return (
    <div className={className} onClick={onClick} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:12,...style}}>
      {children}
    </div>
  )
}

function Badge({status}) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{
      fontSize:9.5,fontWeight:500,padding:'3px 9px',borderRadius:20,
      background:s.bg,color:s.color,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:5,fontFamily:F.sans,
    }}>{s.label}</span>
  )
}

function DotIcon({status}) {
  const s = STATUS[status] || STATUS.pending
  return (
    <div style={{width:22,height:22,borderRadius:7,background:s.bg,display:'grid',placeItems:'center',flexShrink:0}}>
      <span style={{width:6,height:6,borderRadius:'50%',background:s.dot,display:'inline-block'}}/>
    </div>
  )
}

function FileChip({children, style}) {
  return (
    <span style={{
      fontFamily:F.mono,fontSize:9.5,color:T.chipText,background:T.chipBg,
      borderRadius:5,padding:'2px 7px',maxWidth:200,overflow:'hidden',
      textOverflow:'ellipsis',whiteSpace:'nowrap',display:'inline-block',...style,
    }}>{children}</span>
  )
}

function Banner({iconPath, children}) {
  return (
    <div style={{
      display:'flex',alignItems:'center',gap:10,
      background:T.banner,border:`1px solid ${T.bannerBorder}`,borderRadius:9,
      padding:'9px 14px',marginBottom:12,
    }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d={iconPath}/></svg>
      <span style={{fontSize:10.5,color:T.bannerText,lineHeight:1.5}}>{children}</span>
    </div>
  )
}

function Toggle({on, onClick, label}) {
  return (
    <button className="dp-toggle" onClick={onClick} aria-label={label} aria-pressed={on}
      style={{background:on?T.accent:'#C9C6B8'}}>
      <span className="dp-knob" style={{left:on?19:3}}/>
    </button>
  )
}

// ─── Overview: pending approval card ─────────────────────────────────────────
function PendingCard({ run, onOpen, onToast }) {
  const a = run.analysis_result
  return (
    <Card className="dash-mc" onClick={onOpen} style={{
      overflow:'hidden',borderColor:'#EADFC2',cursor:'pointer',
      boxShadow:'0 10px 34px rgba(201,162,39,.12)',
    }}>
      <div style={{
        background:T.yellowBg,borderBottom:'1px solid #EADFC2',padding:'9px 18px',
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="dp-pulse" style={{width:7,height:7,borderRadius:'50%',background:T.yellow,display:'inline-block',flexShrink:0}}/>
          <Label style={{color:T.yellowText,marginBottom:0}}>Awaiting your approval · PR #{run.pr_number}</Label>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <button className="dp-btn" onClick={(e)=>{e.stopPropagation(); onToast('Just a preview — real fixes arrive as GitHub PRs you can open.')}} style={{
            fontSize:10,color:T.chipText,background:T.chipBg,borderRadius:6,padding:'4px 9px',fontWeight:500,
          }}>View on GitHub ↗</button>
          <span style={{fontSize:10,color:T.yellowText}}>
            Reply <code style={{fontFamily:F.mono,fontSize:9,fontWeight:600}}>YES</code> or <code style={{fontFamily:F.mono,fontSize:9,fontWeight:600}}>NO</code> on Telegram
          </span>
        </div>
      </div>

      <div className="dp-approval-grid" style={{padding:'14px 18px'}}>
        <div style={{minWidth:0}}>
          <Label style={{marginBottom:6}}>Problem identified</Label>
          <p style={{fontSize:11.5,fontWeight:500,color:T.text,lineHeight:1.5,marginBottom:5}}>{a.problem}</p>
          <p style={{fontSize:10,color:T.textMuted,lineHeight:1.55}}>{a.data_insight}</p>
        </div>
        <div style={{minWidth:0}}>
          <Label style={{marginBottom:6}}>Fix prepared</Label>
          <p style={{fontSize:10.5,color:T.text,lineHeight:1.5,marginBottom:7}}>{a.solution}</p>
          <FileChip style={{maxWidth:'100%',display:'block'}}>{a.file_to_edit}</FileChip>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8,minWidth:0}}>
          <Label style={{marginBottom:0}}>Expected impact</Label>
          <div style={{display:'flex',alignItems:'baseline',gap:6}}>
            <span style={{fontFamily:F.serif,fontSize:25,fontWeight:500,color:T.green,lineHeight:1}}>{a.expected_improvement}</span>
            <span style={{fontSize:10,color:T.textMuted}}>conversion</span>
          </div>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:9,color:T.textLight}}>Confidence</span>
              <span style={{fontSize:9,fontWeight:500,color:T.text}}>{a.confidence_score}%</span>
            </div>
            <div style={{height:4,background:T.borderSoft,borderRadius:2,overflow:'hidden'}}>
              <div className="v-bar-fill" style={{height:'100%',width:`${a.confidence_score}%`,'--v-w':`${a.confidence_score}%`,background:T.green,borderRadius:2}}/>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:9}}>
            <span style={{color:T.textLight}}>Auto-rollback</span>
            <span style={{color:T.textMuted}}>48h if no uplift</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Overview: status hero ────────────────────────────────────────────────────
function StatusHero({ paused, simStep, simStarting, simMsg, onRunNow, onTogglePause, lastRun, onSelectRun }) {
  const running = simStep >= 0 || simStarting

  // Live countdown to Monday 09:00 (30s tick keeps it honest without churn).
  const [, setTick] = useState(0)
  useEffect(() => { const id = setInterval(()=>setTick(t=>t+1), 30000); return ()=>clearInterval(id) }, [])
  const target = nextMonday9am()
  const diff = target - Date.now()
  const d = Math.floor(diff/86400000), h = Math.floor((diff%86400000)/3600000), m = Math.floor((diff%3600000)/60000)
  const countdown = d>0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`
  const weekMs = 7*24*3600000
  const weekProgress = Math.min(100, Math.max(0, ((Date.now()-(target.getTime()-weekMs))/weekMs)*100))

  let heroLabel, heroDot, heroBig, heroNote, heroProgress
  if (paused) {
    heroLabel='AGENT PAUSED'; heroDot=T.gray
    heroBig='On hold'; heroNote='No runs scheduled — resume any time.'; heroProgress=0
  } else if (simStarting) {
    heroLabel='AGENT RUNNING'; heroDot=T.yellow
    heroBig='Starting run…'; heroNote='Dispatching your agent — the first step begins in a moment.'; heroProgress=0
  } else if (running) {
    heroLabel='AGENT RUNNING'; heroDot=T.yellow
    heroBig=`Step ${simStep+1} of ${AGENT_STEPS.length}`
    heroNote=`${AGENT_STEPS[simStep].label} — ${AGENT_STEPS[simStep].desc}`
    heroProgress=Math.round(((simStep+1)/AGENT_STEPS.length)*100)
  } else {
    heroLabel='AGENT IDLE · NEXT RUN IN'; heroDot=T.green
    heroBig=countdown; heroNote='Every Monday morning'; heroProgress=Math.round(weekProgress)
  }

  return (
    <Card className="dp-hero" style={{overflow:'hidden'}}>
      <div className="dp-hero-cell">
        <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:11}}>
          <span className="dp-pulse" style={{width:7,height:7,borderRadius:'50%',background:heroDot,display:'inline-block',flexShrink:0}}/>
          <Label style={{marginBottom:0}}>{heroLabel}</Label>
        </div>
        <p style={{fontFamily:F.serif,fontSize:'clamp(24px,3vw,32px)',lineHeight:1,fontWeight:500,color:T.ink,minHeight:32,display:'flex',alignItems:'center',gap:10}}>
          {heroBig}
          {running && <span className="dp-spinner" style={{color:T.accent}}/>}
        </p>
        <p style={{fontSize:10.5,color:T.textMuted,marginTop:8,minHeight:16}}>{heroNote}</p>
        <div style={{height:4,background:'#EDEBE0',borderRadius:2,marginTop:12,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${heroProgress}%`,background:T.accent,borderRadius:2,transition:'width .9s ease'}}/>
        </div>
      </div>

      <div className="dp-hero-cell">
        <Label style={{marginBottom:11}}>Last run · {timeAgo(lastRun.created_at)}</Label>
        <p style={{fontSize:11.5,fontWeight:500,lineHeight:1.45,color:T.text}}>
          {AGENT_STEPS.length} steps completed<br/>1 fix shipped to production
        </p>
        <button className="dp-link dp-btn" onClick={()=>onSelectRun(lastRun)} style={{fontSize:10.5,marginTop:10}}>
          View run details →
        </button>
      </div>

      <div className="dp-hero-cell" style={{display:'flex',flexDirection:'column',gap:8,justifyContent:'center',minWidth:180}}>
        {!paused && (
          <button className="dp-btn dp-btn-primary" onClick={onRunNow} disabled={running} style={{
            fontSize:11,fontWeight:500,borderRadius:8,padding:'9px 16px',
            opacity:running?.55:1,cursor:running?'not-allowed':'pointer',
          }}>{running?'Run in progress':'Run now'}</button>
        )}
        <button className="dp-btn dp-btn-ghost" onClick={onTogglePause} style={{fontSize:11,borderRadius:8,padding:'9px 16px'}}>
          {paused?'Resume agent':'Pause agent'}
        </button>
        {simMsg ? (
          <p style={{fontSize:9.5,lineHeight:1.5,color:T.accent}}>{simMsg}</p>
        ) : !paused && !running && (
          <p style={{fontSize:9,color:T.textLight,lineHeight:1.4,textAlign:'center'}}>One manual run/day · scheduled runs continue automatically</p>
        )}
      </div>
    </Card>
  )
}

// ─── Overview: KPI row ────────────────────────────────────────────────────────
function KpiRow({ allRuns, booted, onGoRuns }) {
  const runs     = allRuns.filter(r=>r.status!=='waiting_approval')
  const total    = allRuns.length
  const deployed = runs.filter(isLive).length
  const rate     = Math.round((deployed/total)*100)
  const pending  = allRuns.filter(r=>r.status==='waiting_approval')
  const oneWeekAgo = new Date(Date.now() - 7*86400000)
  const thisWeek = runs.filter(r=>new Date(r.created_at)>oneWeekAgo&&isLive(r)).length
  const firstRun = runs[runs.length-1]
  const sinceStr = new Date(firstRun.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})
  const pendingHint = pending[0] ? runTitle(pending[0].analysis_result) : null

  const kpis = [
    { label:'Fixes live',      num:deployed, format:n=>Math.round(n).toLocaleString(),
      sub: thisWeek>0?`+${thisWeek} this week`:'Shipped to production', subColor:thisWeek>0?T.accent:T.label },
    { label:'Deploy rate',     num:rate, format:n=>`${Math.round(n)}%`,
      sub:`${deployed} of ${total} held in production`, subColor:T.label },
    { label:'Runs completed',  num:total, format:n=>Math.round(n).toLocaleString(),
      sub:`since ${sinceStr}`, subColor:T.label },
    { label:'Awaiting review', num:pending.length, format:n=>Math.round(n).toLocaleString(),
      sub: pendingHint || 'Nothing waiting on you', subColor:T.yellowText },
  ]

  return (
    <div className="dp-kpis">
      {kpis.map((k,i)=>(
        <Card key={i} className="dp-card-hover" onClick={onGoRuns} style={{padding:'13px 16px',cursor:'pointer'}}>
          <Label>{k.label}</Label>
          <p style={{fontFamily:F.serif,fontSize:28,fontWeight:500,lineHeight:1.15,color:T.ink,marginTop:6}}>
            <CountUp value={booted ? k.num : 0} format={k.format}/>
          </p>
          <p style={{fontSize:10,color:k.subColor,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.sub}</p>
        </Card>
      ))}
    </div>
  )
}

// ─── Overview: activity + performance + teasers ──────────────────────────────
function ActivityCard({ runs, onSelectRun, onGoRuns }) {
  const items = runs.filter(r=>r.status!=='waiting_approval').slice(0,5)
  return (
    <Card style={{padding:'15px 18px'}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:4}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text}}>Activity</p>
        <button className="dp-link dp-btn" onClick={onGoRuns} style={{fontSize:10.5}}>All runs →</button>
      </div>
      {items.map((run,i)=>{
        const a = run.analysis_result||{}
        return (
          <div key={run.id} className="dp-run-row" onClick={()=>onSelectRun(run)} style={{
            display:'grid',gridTemplateColumns:'22px 1fr auto',gap:10,alignItems:'center',
            padding:'10px 0',borderBottom:i<items.length-1?`1px solid ${T.borderSoft}`:'none',
          }}>
            <DotIcon status={run.status}/>
            <div style={{minWidth:0}}>
              <p style={{fontSize:11,fontWeight:500,lineHeight:1.35,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {runTitle(a)}
              </p>
              <div style={{display:'flex',alignItems:'center',gap:7,marginTop:3}}>
                {a.file_to_edit && <FileChip>{a.file_to_edit.split('/').pop()}</FileChip>}
                <span style={{fontSize:9.5,color:T.textLight}}>{timeAgo(run.created_at)}</span>
              </div>
            </div>
            <Badge status={run.status}/>
          </div>
        )
      })}
    </Card>
  )
}

function PerformanceCard({ allRuns }) {
  const runs     = allRuns.filter(r=>r.status!=='waiting_approval')
  const deployed = runs.filter(isLive).length
  const rate     = Math.round((deployed/runs.length)*100)
  const failed   = runs.filter(r=>['failed','rejected'].includes(r.status)).length
  const history  = [...allRuns].reverse()
  const oldest   = history[0]

  return (
    <Card style={{padding:'15px 18px'}}>
      <p style={{fontSize:12,fontWeight:600,color:T.text,marginBottom:11}}>Performance</p>
      <div style={{display:'flex',gap:22}}>
        <div>
          <p style={{fontFamily:F.serif,fontSize:23,fontWeight:500,color:T.accent,lineHeight:1}}>{rate}%</p>
          <p style={{fontSize:9.5,color:T.label,marginTop:2}}>Deploy rate</p>
        </div>
        <div>
          <p style={{fontFamily:F.serif,fontSize:23,fontWeight:500,color:T.ink,lineHeight:1}}>{failed}</p>
          <p style={{fontSize:9.5,color:T.label,marginTop:2}}>Failed / rejected</p>
        </div>
      </div>
      <Label style={{margin:'13px 0 7px'}}>Run history</Label>
      <div style={{display:'flex',alignItems:'flex-end',gap:3,height:30}}>
        {history.map((run,i)=>{
          const s = STATUS[run.status]||STATUS.pending
          const hgt = isLive(run)?'100%':run.status==='waiting_approval'?'66%':run.status==='rejected'?'34%':'56%'
          return (
            <div key={run.id} title={`${s.label} · ${timeAgo(run.created_at)}`} className="v-bar-fill" style={{
              flex:1,borderRadius:2,height:hgt,background:isLive(run)?T.accentBar:s.dot,animationDelay:`${i*0.02}s`,
            }}/>
          )
        })}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:8.5,color:T.textFaint,marginTop:4}}>
        <span>{new Date(oldest.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
        <span>today</span>
      </div>
    </Card>
  )
}

function GuardrailsTeaser({ ruleCount, onGo }) {
  return (
    <Card className="dp-card-hover" onClick={onGo} style={{padding:'13px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,cursor:'pointer'}}>
      <div>
        <p style={{fontSize:11,fontWeight:600,color:T.text}}>Guardrails</p>
        <p style={{fontSize:9.5,color:T.label,marginTop:2}}>{ruleCount} rule{ruleCount===1?'':'s'} enforced on every run</p>
      </div>
      <span className="dp-link" style={{fontSize:10.5,whiteSpace:'nowrap'}}>Edit →</span>
    </Card>
  )
}

function DnaStrip({ learnings, onGoDna }) {
  const wins   = learnings.filter(l=>l.outcome==='positive').length
  const losses = learnings.filter(l=>l.outcome==='negative').length
  const rate   = Math.round((wins/learnings.length)*100)
  const pos    = learnings.filter(l=>l.outcome==='positive'&&l.delta)
  const avg    = Math.round(pos.reduce((s,l)=>s+l.delta,0)/pos.length)

  return (
    <Card style={{padding:'15px 18px'}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:11}}>
        <div>
          <p style={{fontSize:12,fontWeight:600,color:T.text}}>Business DNA</p>
          <p style={{fontSize:9.5,color:T.label,marginTop:2}}>What worked on your site, and what didn’t — read on every run</p>
        </div>
        <button className="dp-link dp-btn" onClick={onGoDna} style={{fontSize:10.5}}>View DNA →</button>
      </div>
      <div className="dp-strip">
        {[
          {num:learnings.length, color:T.ink,       sub:'total learnings'},
          {num:`${rate}%`,       color:T.accent,    sub:'win rate'},
          {num:`+${avg}%`,       color:T.accent,    sub:'avg improvement on wins'},
          {num:losses,           color:T.textMuted, sub:'rolled back / avoided'},
        ].map((s,i)=>(
          <div key={i}>
            <p style={{fontFamily:F.serif,fontSize:20,fontWeight:500,color:s.color,lineHeight:1}}>{s.num}</p>
            <p style={{fontSize:9,color:T.label,marginTop:3}}>{s.sub}</p>
          </div>
        ))}
      </div>
      <div style={{marginTop:10}}>
        {learnings.slice(0,3).map((l,i)=>(
          <div key={l.id||i} style={{display:'flex',alignItems:'center',gap:9,fontSize:10.5,padding:'6px 0',borderTop:`1px solid ${T.borderSoft}`}}>
            <span style={{color:l.outcome==='positive'?T.green:T.red,flexShrink:0,fontWeight:600}}>{l.outcome==='positive'?'✓':'✕'}</span>
            <span style={{color:T.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.summary}</span>
            {l.delta&&<span style={{color:l.outcome==='positive'?T.greenText:T.redText,flexShrink:0,fontWeight:500}}>{l.outcome==='positive'?'+':''}{l.delta}%</span>}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Runs tab: "Next up" backlog ─────────────────────────────────────────────
function NextUpCard({ backlog, pinnedPath, onTogglePin }) {
  if (!backlog || !backlog.length) return null
  return (
    <Card style={{padding:'14px 18px',marginBottom:14}}>
      <p style={{fontSize:12,fontWeight:600,color:T.text}}>Next up</p>
      <p style={{fontSize:9.5,color:T.label,margin:'2px 0 4px'}}>What the agent would tackle next — one tap schedules it for the next run.</p>
      {backlog.map((item,i)=>{
        const isPinned = pinnedPath === item.page_path
        return (
          <div key={item.page_path} style={{
            display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',
            padding:'10px 0',borderTop:i>0?`1px solid ${T.borderSoft}`:'none',
          }}>
            <div style={{minWidth:0}}>
              <FileChip style={{marginBottom:5,display:'inline-block'}}>{item.page_path}</FileChip>
              <p style={{fontSize:10.5,color:T.text,lineHeight:1.5}}>{item.problem}</p>
              {item.expected_impact && <p style={{fontSize:9.5,color:T.accent,fontWeight:500,marginTop:2}}>{item.expected_impact}</p>}
            </div>
            <button className="dp-btn" onClick={()=>onTogglePin(item.page_path)} style={{
              fontSize:10,fontWeight:500,borderRadius:7,padding:'6px 12px',whiteSpace:'nowrap',
              background:isPinned?'#C9E3D2':T.bgChip,color:T.ink,transition:'background .25s ease',
            }}>{isPinned?'Scheduled ✓':'Fix this next'}</button>
          </div>
        )
      })}
    </Card>
  )
}

// ─── Runs tab ─────────────────────────────────────────────────────────────────
function RunsTab({ allRuns, onSelectRun, onToast, backlog, pinnedPath, onTogglePin }) {
  const [filter, setFilter] = useState('all')
  const GROUPS = {
    deployed: ['deployed'], waiting_approval: ['waiting_approval'],
    rejected: ['rejected'], rolled_back: ['rolled_back'],
  }
  const filters = [
    { key:'all', label:'All' }, { key:'deployed', label:'Deployed' },
    { key:'waiting_approval', label:'Awaiting approval' }, { key:'rejected', label:'Rejected' },
    { key:'rolled_back', label:'Rolled back' },
  ]
  const countFor = key => key==='all' ? allRuns.length : allRuns.filter(r=>GROUPS[key].includes(r.status)).length
  const filtered = filter==='all' ? allRuns : allRuns.filter(r=>GROUPS[filter].includes(r.status))

  function weekLabel(iso) {
    const d=new Date(iso), now=new Date(), diff=Math.floor((now-d)/86400000)
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
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      <NextUpCard backlog={backlog} pinnedPath={pinnedPath} onTogglePin={onTogglePin}/>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:12,flexWrap:'wrap'}}>
        <p style={{fontSize:10.5,color:T.textMuted}}>Every change the agent made or proposed — click a run for full details.</p>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
          {filters.map(f=>{
            const active = filter===f.key
            return (
              <button key={f.key} className="dp-btn" onClick={()=>setFilter(f.key)} style={{
                fontSize:9.5,fontWeight:500,padding:'5px 11px',borderRadius:20,
                background:active?T.ink:T.bgCard,color:active?T.sideText:'#4A5248',
                border:`1px solid ${active?T.ink:T.border}`,
              }}>{f.label} · {countFor(f.key)}</button>
            )
          })}
        </div>
      </div>

      {grouped.map((group,gi)=>(
        <section key={gi} style={{marginBottom:10}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',padding:'0 4px 6px'}}>
            <Label style={{marginBottom:0}}>{group.label}</Label>
            <span style={{fontSize:9.5,color:T.textLight}}>{group.runs.length} run{group.runs.length!==1?'s':''}</span>
          </div>
          <Card style={{overflow:'hidden'}}>
            {group.runs.map((run,i)=>{
              const a = run.analysis_result||{}
              const bounceDelta = (run.bounce_rate_before!=null&&run.bounce_rate_after!=null)
                ? run.bounce_rate_after - run.bounce_rate_before : null
              return (
                <div key={run.id} className="dp-run-row" onClick={()=>onSelectRun(run)} style={{
                  display:'grid',gridTemplateColumns:'22px 1fr auto auto',gap:11,alignItems:'center',
                  padding:'11px 16px',borderBottom:i<group.runs.length-1?`1px solid ${T.borderSoft}`:'none',
                }}>
                  <DotIcon status={run.status}/>
                  <div style={{minWidth:0}}>
                    <p style={{fontSize:11,fontWeight:500,lineHeight:1.4,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {runTitle(a)}
                    </p>
                    <div style={{display:'flex',alignItems:'center',gap:7,marginTop:3,flexWrap:'wrap'}}>
                      {a.file_to_edit && <FileChip>{a.file_to_edit.split('/').pop()}</FileChip>}
                      {a.expected_improvement && (
                        <span style={{fontSize:9.5,color:T.accent,fontWeight:500}}>{a.expected_improvement}</span>
                      )}
                      {bounceDelta!=null && (
                        <span style={{fontSize:9.5,color:bounceDelta<0?T.greenText:bounceDelta>0?T.redText:T.textLight,fontWeight:500}}>
                          Bounce {run.bounce_rate_before}% → {run.bounce_rate_after}%
                        </span>
                      )}
                      {run.pr_url && (
                        <button className="dp-link dp-btn" onClick={e=>{e.stopPropagation(); onToast('Just a preview — PRs open on GitHub in the real dashboard.')}} style={{fontSize:9.5}}>
                          PR #{run.pr_number} ↗
                        </button>
                      )}
                    </div>
                  </div>
                  <Badge status={run.status}/>
                  <span style={{fontSize:9.5,color:T.textLight,whiteSpace:'nowrap',minWidth:62,textAlign:'right'}}>{fmt(run.created_at)}</span>
                </div>
              )
            })}
          </Card>
        </section>
      ))}
    </div>
  )
}

// ─── Network tab ──────────────────────────────────────────────────────────────
function NetworkTab() {
  const [selectedNode, setSelectedNode] = useState(null)
  const lastRun = demoData.runs[0]
  const next = nextMonday9am()
  return (
    <div>
      <p style={{fontSize:10,color:T.textLight,marginBottom:10}}>
        Last run {fmt(lastRun.created_at)} · next Mon {next.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} · click a node to inspect it
      </p>
      <Card style={{position:'relative',overflow:'hidden'}}>
        <SiteNetwork
          data={mockSiteNetworkData}
          onNodeClick={(n)=>{ if(!n.isHub) setSelectedNode(n) }}
          fonts={{ sans:'Jost, sans-serif', serif:'Instrument Serif, serif', mono:'DM Mono, monospace' }}
          style={{height:400}}
        />
        {selectedNode && (
          <div style={{
            position:'absolute',top:0,right:0,bottom:0,width:250,maxWidth:'85%',
            background:T.bgCard,borderLeft:`1px solid ${T.border}`,
            boxShadow:'-8px 0 28px rgba(30,54,43,.08)',zIndex:20,
            padding:'16px 18px',overflowY:'auto',animation:'dpPanelIn .22s ease both',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
              <p style={{fontFamily:F.serif,fontWeight:500,fontSize:17,color:T.text,lineHeight:1.15}}>{selectedNode.label}</p>
              <button className="dp-btn" onClick={()=>setSelectedNode(null)} style={{
                background:'none',border:`1px solid ${T.border}`,borderRadius:6,
                width:22,height:22,fontSize:12,color:T.textMuted,flexShrink:0,lineHeight:1,
              }}>×</button>
            </div>
            <p style={{fontFamily:F.mono,fontSize:9.5,color:T.textMuted,wordBreak:'break-all',marginTop:5,marginBottom:12}}>{selectedNode.id}</p>
            <div style={{display:'flex',alignItems:'center',gap:7}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:NODE_STATUS_DOT[selectedNode.status],flexShrink:0}}/>
              <span style={{fontSize:11,color:T.text}}>{NODE_STATUS_COPY[selectedNode.status]||'Watching'}</span>
            </div>
            {selectedNode.rankReason && (
              <p style={{fontSize:10,color:T.textMuted,lineHeight:1.55,marginTop:12,paddingTop:12,borderTop:`1px solid ${T.borderSoft}`}}>
                {selectedNode.rankReason}
              </p>
            )}
          </div>
        )}
      </Card>
      <p style={{fontSize:9.5,color:T.textLight,marginTop:8,lineHeight:1.5}}>
        Every page, section and component of your site and how they connect. <span style={{color:T.yellow}}>Gold</span> = fix awaiting your approval · <span style={{color:T.green}}>green</span> = optimized and holding.
      </p>
    </div>
  )
}

// ─── Funnel tab ───────────────────────────────────────────────────────────────
function FunnelTab({ pinnedPath, onTogglePin }) {
  const funnelPages = demoData.funnelPages
  const withTraffic = funnelPages.filter(p=>p.views_7d>0)
  const biggestOpp  = [...withTraffic].sort((a,b)=>b.drop_off_score-a.drop_off_score)[0]
  const pinned = pinnedPath === biggestOpp.page_path
  const pinnedElsewhere = pinnedPath && pinnedPath !== biggestOpp.page_path
  const maxViews    = Math.max(...funnelPages.map(p=>p.views_7d||0),1)
  const totalViews  = withTraffic.reduce((s,p)=>s+(p.views_7d||0),0)
  const barPages    = [...withTraffic].sort((a,b)=>b.views_7d-a.views_7d).slice(0,6)
  const BAR_SHADES  = ['#3E6B54','#4F7B63','#5C8A6F','#6D9A7F','#7FA98F','#93B8A1']

  const leverageOf = (p) => {
    if (p.page_path===biggestOpp.page_path) return { badge:'Next focus', bg:T.ink,     color:T.sideText }
    if (p.drop_off_score>=60)               return { badge:'High',       bg:T.yellowBg, color:T.yellowText }
    if (p.drop_off_score>=30)               return { badge:'Medium',     bg:T.grayBg,   color:T.grayText }
    return                                         { badge:'Low',        bg:T.grayBg,   color:T.textLight }
  }
  const sorted = [...withTraffic].sort((a,b)=>(b.drop_off_score||0)-(a.drop_off_score||0)||b.views_7d-a.views_7d)

  return (
    <div>
      <Banner iconPath="M3 4h18l-7 8v6l-4 2v-8L3 4z">
        Every page mapped and cross-referenced with your analytics — the agent fixes the highest-leverage page first.
      </Banner>

      <div className="dp-funnel-top" style={{marginBottom:10}}>
        <Card style={{padding:'16px 20px'}}>
          <p style={{fontSize:12,fontWeight:600,color:T.text,marginBottom:3}}>Traffic by page</p>
          <p style={{fontSize:9.5,color:T.label,marginBottom:14}}>
            Last 7 days · {totalViews.toLocaleString()} views across {withTraffic.length} pages
          </p>
          {barPages.map((p,i)=>{
            const w = Math.max(4,Math.round(((p.views_7d||0)/maxViews)*100))
            return (
              <div key={p.page_path} style={{marginBottom:i<barPages.length-1?11:0}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:5,gap:10}}>
                  <span style={{fontSize:10.5,fontWeight:500,fontFamily:F.mono,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.page_path}</span>
                  <span style={{fontSize:10,color:T.textMuted,flexShrink:0}}>
                    <span style={{fontFamily:F.serif,fontSize:12.5,color:T.ink}}>{p.views_7d.toLocaleString()}</span>
                    {p.drop_off_score>0?` · ${p.drop_off_score}% drop-off`:''}
                  </span>
                </div>
                <div style={{height:18,background:T.borderSoft,borderRadius:5,overflow:'hidden'}}>
                  <div className="v-bar-fill" style={{height:'100%',width:`${w}%`,'--v-w':`${w}%`,background:BAR_SHADES[i]||BAR_SHADES[5],borderRadius:5,animationDelay:`${i*0.08}s`}}/>
                </div>
              </div>
            )
          })}
        </Card>

        <div style={{background:T.sidebar,borderRadius:12,padding:'16px 20px',color:T.sideText}}>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:11}}>
            <span className="dp-pulse" style={{width:7,height:7,borderRadius:'50%',background:T.yellow,display:'inline-block'}}/>
            <span style={{fontSize:9,letterSpacing:'.14em',color:T.sideMuted,fontWeight:500}}>HIGHEST LEVERAGE</span>
          </div>
          <p style={{fontFamily:F.mono,fontSize:14,color:'#C9E3D2'}}>{biggestOpp.page_path}</p>
          <p style={{fontSize:10.5,lineHeight:1.6,color:'#C7CFC4',marginTop:8}}>
            {biggestOpp.drop_off_score}% of visitors drop off here · {biggestOpp.views_7d.toLocaleString()} views/week. {biggestOpp.ai_insight}
          </p>
          <p style={{fontSize:9.5,color:T.sideFaint,marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,.12)'}}>
            {pinned
              ? 'Pinned — the agent focuses here on its next run, then the pin clears.'
              : pinnedElsewhere
                ? `Currently pinned: ${pinnedPath} — scheduling this page replaces it.`
                : 'The agent prioritizes high-leverage pages first.'}
          </p>
          <button className="dp-btn" onClick={()=>onTogglePin(biggestOpp.page_path)} style={{
            fontSize:10.5,fontWeight:500,borderRadius:8,padding:'8px 15px',marginTop:12,width:'100%',
            background:pinned?'#C9E3D2':T.bgChip,color:T.ink,transition:'background .25s ease',
          }}>
            {pinned?'Scheduled for next run ✓':'Fix in next run'}
          </button>
        </div>
      </div>

      <Card style={{overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <div style={{minWidth:480}}>
            <div style={{display:'grid',gridTemplateColumns:'1.4fr .6fr 1fr auto',gap:11,alignItems:'center',padding:'10px 16px',borderBottom:`1px solid ${T.border}`,fontSize:8.5,letterSpacing:'.13em',color:T.label,fontWeight:500}}>
              <span>PAGE</span><span>VIEWS / WK</span><span>DROP-OFF</span><span style={{minWidth:80,textAlign:'right'}}>LEVERAGE</span>
            </div>
            {sorted.map((p,i)=>{
              const lev = leverageOf(p)
              const isNext = p.page_path===biggestOpp.page_path
              const dropW = Math.min(100,p.drop_off_score||0)
              return (
                <div key={p.id} style={{
                  display:'grid',gridTemplateColumns:'1.4fr .6fr 1fr auto',gap:11,alignItems:'center',
                  padding:'10px 16px',borderBottom:i<sorted.length-1?`1px solid ${T.borderSoft}`:'none',
                  background:isNext?T.bgSoft:'transparent',
                }}>
                  <span style={{fontFamily:F.mono,fontSize:10.5,color:T.ink,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.page_path}</span>
                  <span style={{fontSize:10.5,color:'#4A5248'}}>{(p.views_7d||0).toLocaleString()}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{flex:1,height:4,background:T.borderSoft,borderRadius:3,overflow:'hidden',maxWidth:90}}>
                      <div className="v-bar-fill" style={{height:'100%',width:`${dropW}%`,'--v-w':`${dropW}%`,background:dropW>=60?T.red:dropW>=30?T.yellow:T.accentBar,borderRadius:3,animationDelay:`${i*0.04}s`}}/>
                    </div>
                    <span style={{fontSize:9.5,color:dropW>=60?T.redText:T.label,minWidth:28,fontWeight:dropW>=60?500:400}}>{p.drop_off_score}%</span>
                  </div>
                  <span style={{fontSize:9,fontWeight:500,color:lev.color,background:lev.bg,borderRadius:20,padding:'3px 9px',whiteSpace:'nowrap',minWidth:64,textAlign:'center'}}>{lev.badge}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── DNA tab ──────────────────────────────────────────────────────────────────
function DnaTab({ verdicts, onVerdict }) {
  const grouped = { measured_win:[], survived:[], rollback:[], pending:[] }
  for (const d of DNA_ENTRIES) grouped[d.outcome].push(d)

  const GROUPS = [
    { key:'measured_win', title:'Measured wins',   sub:'Bounce measurably improved after deploy — doubled down on', mark:{sym:'✓', color:T.green,     label:'Measured win'} },
    { key:'survived',     title:'Survived 7 days',  sub:'Still live, but no measured improvement — weak signal',     mark:{sym:'✓', color:T.textMuted, label:'Survived'} },
    { key:'rollback',     title:'Never do again',   sub:'Rolled back — the agent avoids these',                     mark:{sym:'✕', color:T.red,       label:'Rolled back'} },
    { key:'pending',      title:'Pending',          sub:'Deployed, awaiting the 7-day verdict',                     mark:{sym:'·', color:T.yellow,    label:'Pending'} },
  ]

  return (
    <div style={{maxWidth:640}}>
      <Banner iconPath="M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12M6 15c0 3 2 6 6 6M18 15c0 3-2 6-6 6">
        What the agent has learned — confirm a learning to reinforce it, or mark it wrong and the agent ignores it from the next run on.
      </Banner>

      {GROUPS.map(g=>{
        const entries = grouped[g.key]
        if (!entries.length) return null
        return (
          <Card key={g.key} style={{padding:'14px 18px',marginBottom:10}}>
            <p style={{fontSize:12,fontWeight:600,color:T.text}}>{g.title}</p>
            <p style={{fontSize:9.5,color:T.label,margin:'2px 0 2px'}}>{g.sub}</p>
            {entries.map((e,i)=>{
              const verdict = verdicts[e.id]
              const rejected = verdict==='rejected'
              return (
                <div key={e.id} style={{
                  display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',
                  padding:'10px 0',borderBottom:i<entries.length-1?`1px solid ${T.borderSoft}`:'none',
                }}>
                  <div style={{minWidth:0,opacity:rejected?.55:1,transition:'opacity .2s ease'}}>
                    <p style={{fontSize:10.5,lineHeight:1.5,color:T.text}}>{e.notes}</p>
                    <div style={{fontSize:9,color:T.textLight,marginTop:3}}>
                      learned from <FileChip style={{fontSize:9,padding:'1px 5px'}}>{e.fix_type.replace(/_/g,' ')}</FileChip>
                      <span style={{marginLeft:7}}>{new Date(e.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                    </div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:9.5,color:g.mark.color,fontWeight:500,whiteSpace:'nowrap',opacity:rejected?.55:1}}>
                      <span style={{fontWeight:600}}>{g.mark.sym}</span>{g.mark.label}
                    </span>
                    {verdict==='confirmed' ? (
                      <span style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:9.5,color:T.greenText,fontWeight:500,whiteSpace:'nowrap'}}>
                        ✓ Confirmed by you
                        <button className="dp-btn" onClick={()=>onVerdict(e.id,null)} style={{background:'none',padding:0,fontSize:9,color:T.textLight,textDecoration:'underline'}}>Undo</button>
                      </span>
                    ) : rejected ? (
                      <span style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:9.5,color:T.textMuted,whiteSpace:'nowrap'}}>
                        Ignored by agent
                        <button className="dp-btn" onClick={()=>onVerdict(e.id,null)} style={{background:'none',padding:0,fontSize:9,color:T.textLight,textDecoration:'underline'}}>Undo</button>
                      </span>
                    ) : (
                      <div style={{display:'flex',gap:5}}>
                        <button className="dp-btn dp-btn-primary" onClick={()=>onVerdict(e.id,'confirmed')} style={{fontSize:9.5,fontWeight:500,borderRadius:6,padding:'5px 11px'}}>Confirm</button>
                        <button className="dp-btn dp-btn-danger" onClick={()=>onVerdict(e.id,'rejected')} style={{fontSize:9.5,borderRadius:6,padding:'5px 11px'}}>Wrong</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>
        )
      })}

      <Card style={{padding:'14px 18px'}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text,marginBottom:6}}>Timeline</p>
        {[...DNA_ENTRIES].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map((d,i,arr)=>{
          const s = d.outcome==='measured_win' ? {color:T.greenText, bg:T.greenBg,  label:'measured win'}
                  : d.outcome==='survived'     ? {color:T.grayText,  bg:T.grayBg,   label:'survived'}
                  : d.outcome==='rollback'     ? {color:T.redText,   bg:T.redBg,    label:'rollback'}
                  :                              {color:T.yellowText,bg:T.yellowBg, label:'pending'}
          return (
            <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:i<arr.length-1?`1px solid ${T.borderSoft}`:'none'}}>
              <span style={{fontSize:9,color:T.textLight,fontFamily:F.mono,minWidth:56}}>
                {new Date(d.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
              </span>
              <span style={{fontSize:10.5,color:T.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.fix_type.replace(/_/g,' ')}</span>
              <span style={{fontSize:9,color:s.color,background:s.bg,borderRadius:20,padding:'2px 9px',fontWeight:500}}>{s.label}</span>
            </div>
          )
        })}
      </Card>
      <p style={{fontSize:9.5,color:T.label,padding:'10px 4px 0'}}>The agent reads this log on every run — measured wins are doubled down on, rollbacks avoided; "survived" alone is treated as weak evidence.</p>
    </div>
  )
}

// ─── Guardrails tab ───────────────────────────────────────────────────────────
function GuardrailsTab({ guard, setGuard }) {
  const [forbInput, setForbInput] = useState('')
  const [protInput, setProtInput] = useState('')
  const [saved, setSaved] = useState(false)
  const savedT = useRef(null)
  useEffect(()=>()=>clearTimeout(savedT.current),[])

  const ruleCount = (guard.tone.trim()?1:0)+guard.forbidden.length+guard.protected.length+(guard.custom.trim()?1:0)

  function addTag(field, input, setInput) {
    const v = input.trim()
    if (v && !guard[field].includes(v)) setGuard(g=>({...g,[field]:[...g[field],v]}))
    setInput('')
  }
  function removeTag(field, val) { setGuard(g=>({...g,[field]:g[field].filter(v=>v!==val)})) }
  function save() { setSaved(true); clearTimeout(savedT.current); savedT.current=setTimeout(()=>setSaved(false),2500) }

  const chipSection = ({title, sub, field, input, setInput, placeholder, danger}) => (
    <Card style={{padding:'14px 18px',marginBottom:10}}>
      <p style={{fontSize:12,fontWeight:600,color:T.text}}>{title}</p>
      <p style={{fontSize:9.5,color:T.label,margin:'2px 0 10px'}}>{sub}</p>
      {guard[field].length>0 && (
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:9}}>
          {guard[field].map(tag=>(
            <span key={tag} className="dp-pop-in" style={{
              display:'inline-flex',alignItems:'center',gap:6,fontSize:10.5,
              background:danger?T.redBg:T.bgChip,
              border:`1px solid ${danger?T.dangerBorder:T.border}`,
              color:danger?'#7A4438':T.text,
              borderRadius:20,padding:'5px 7px 5px 11px',
            }}>
              {tag}
              <button className="dp-chip-x" onClick={()=>removeTag(field,tag)} aria-label={`Remove ${tag}`} style={{
                background:danger?T.dangerBorder:'#E7E4D6',color:danger?'#9C6455':T.textMuted,
              }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input className="dp-input" value={input} onChange={e=>setInput(e.target.value)}
        onKeyDown={e=>e.key==='Enter'&&addTag(field,input,setInput)}
        placeholder={placeholder} style={{width:'100%'}}/>
    </Card>
  )

  return (
    <div style={{maxWidth:600}}>
      <Banner iconPath="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z">
        Enforced on every run — the agent will never make a change that violates these rules.
      </Banner>

      <Card style={{padding:'14px 18px',marginBottom:10}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text}}>Tone of voice</p>
        <p style={{fontSize:9.5,color:T.label,margin:'2px 0 10px'}}>How the agent writes copy on your behalf.</p>
        <input className="dp-input" value={guard.tone} onChange={e=>setGuard(g=>({...g,tone:e.target.value}))} style={{width:'100%'}}/>
      </Card>

      {chipSection({
        title:'Never do these', sub:'Tactics the agent must never use.',
        field:'forbidden', input:forbInput, setInput:setForbInput,
        placeholder:'e.g. "clickbait headlines" — press Enter', danger:true,
      })}
      {chipSection({
        title:'Never change these', sub:'Parts of your site that are off-limits.',
        field:'protected', input:protInput, setInput:setProtInput,
        placeholder:'e.g. "brand colors" — press Enter', danger:false,
      })}

      <Card style={{padding:'14px 18px',marginBottom:12}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text}}>Additional rules</p>
        <p style={{fontSize:9.5,color:T.label,margin:'2px 0 10px'}}>Anything else the agent should keep in mind.</p>
        <textarea className="dp-input" value={guard.custom} onChange={e=>setGuard(g=>({...g,custom:e.target.value}))} rows={2}
          style={{width:'100%',resize:'vertical',lineHeight:1.55}}/>
      </Card>

      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button className="dp-btn" onClick={save} style={{
          background:saved?T.green:T.ink,color:T.sideText,borderRadius:8,
          padding:'9px 18px',fontSize:11,fontWeight:500,transition:'background .25s ease',minWidth:130,
        }}>{saved?'Saved ✓':'Save guardrails'}</button>
        <span style={{fontSize:9.5,color:T.label}}>{ruleCount} rule{ruleCount===1?'':'s'} active</span>
      </div>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────
function SettingsTab({ paused, onTogglePause, onToast }) {
  const [isPublic, setIsPublic] = useState(true)
  const [slug, setSlug] = useState('taskloop')
  const [competitors, setCompetitors] = useState(['https://competitor-a.com','https://competitor-b.com'])
  const [compSaved, setCompSaved] = useState(false)
  const savedT = useRef(null)
  useEffect(()=>()=>clearTimeout(savedT.current),[])
  function saveComp() { setCompSaved(true); clearTimeout(savedT.current); savedT.current=setTimeout(()=>setCompSaved(false),2500) }

  const [goal, setGoal] = useState('Clicks on the "Start free trial" button')
  const [goalType, setGoalType] = useState('click_text')
  const [goalValue, setGoalValue] = useState('Start free trial')
  const [goalSaved, setGoalSaved] = useState(false)
  const goalT = useRef(null)
  useEffect(()=>()=>clearTimeout(goalT.current),[])
  function saveGoal() { setGoalSaved(true); clearTimeout(goalT.current); goalT.current=setTimeout(()=>setGoalSaved(false),2500) }

  // Simulated agent badge install: idle → confirm → busy → done (mirrors the real
  // dashboard's one-click install; here it just plays the states).
  const [badgePhase, setBadgePhase] = useState('idle')
  const badgeT = useRef(null)
  useEffect(()=>()=>clearTimeout(badgeT.current),[])
  function simInstallBadge() {
    setBadgePhase('busy')
    badgeT.current = setTimeout(()=>setBadgePhase('done'), 1400)
  }

  const monoInput = { fontFamily:F.mono, fontSize:10.5 }

  return (
    <div style={{maxWidth:600}}>
      <Card style={{padding:'14px 18px',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
          <div>
            <p style={{fontSize:12,fontWeight:600,color:T.text}}>Subscription</p>
            <div style={{display:'flex',alignItems:'center',gap:7,marginTop:5}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:T.green}}/>
              <span style={{fontSize:10.5,color:'#4A5248'}}>Growth Agent — active</span>
            </div>
          </div>
          <button className="dp-btn dp-btn-ghost" onClick={()=>onToast('Just a preview — billing lives in your real dashboard.')} style={{fontSize:10.5,fontWeight:500,borderRadius:8,padding:'8px 14px',whiteSpace:'nowrap'}}>
            Manage subscription →
          </button>
        </div>
      </Card>

      <Card style={{padding:'14px 18px',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14}}>
          <div>
            <p style={{fontSize:12,fontWeight:600,color:T.text}}>{paused?'Agent is paused':'Agent is active'}</p>
            <p style={{fontSize:9.5,color:T.label,marginTop:3}}>
              {paused?'Resume to run again every Monday morning.':'Runs every Monday morning.'}
            </p>
          </div>
          <Toggle on={!paused} onClick={onTogglePause} label={paused?'Resume agent':'Pause agent'}/>
        </div>
      </Card>

      <Card style={{padding:'14px 18px',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14}}>
          <div>
            <p style={{fontSize:12,fontWeight:600,color:T.text}}>Public profile</p>
            <p style={{fontSize:9.5,color:T.label,marginTop:3}}>Share a public timeline of your agent's runs and results.</p>
          </div>
          <Toggle on={isPublic} onClick={()=>setIsPublic(v=>!v)} label="Make my agent timeline public"/>
        </div>
        {isPublic && (
          <>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:12,paddingTop:12,borderTop:`1px solid ${T.borderSoft}`,flexWrap:'wrap'}}>
              <span style={{fontSize:10,color:T.label,fontFamily:F.mono}}>velyr.io/agent/</span>
              <input className="dp-input" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))} style={{...monoInput,width:130}}/>
              <button className="dp-link dp-btn" onClick={()=>onToast('Just a preview — your real timeline gets its own public page.')} style={{fontSize:10.5}}>View public timeline →</button>
            </div>
            <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.borderSoft}`}}>
              <p style={{fontSize:10.5,fontWeight:500,color:T.text,marginBottom:6}}>Win badge for your site</p>
              <svg width="320" height="64" viewBox="0 0 320 64" role="img" aria-label="Optimized weekly by Velyr. Last measured win: −2pp bounce" style={{display:'block',marginBottom:8}}>
                <rect x="0.5" y="0.5" width="319" height="63" rx="14" fill="#2a5c45" stroke="#234d3a"/>
                <circle cx="30" cy="32" r="12" fill="#f7f4ef" fillOpacity="0.14"/>
                <path d="M24 32 l4.5 4.5 L38 27" stroke="#f7f4ef" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <text x="54" y="27" fontFamily={F.sans} fontSize="12" fill="#f7f4ef" fillOpacity="0.78">Optimized weekly by <tspan fontWeight="700" fillOpacity="1">Velyr</tspan></text>
                <text x="54" y="46" fontFamily={F.sans} fontSize="13.5" fontWeight="600" fill="#f7f4ef">Last measured win: −2pp bounce</text>
              </svg>
              <input readOnly onFocus={e=>e.target.select()}
                value={`<a href="https://velyr.io/agent/${slug}"><img src="https://velyr.io/api/agent/run?action=win_badge&slug=${slug}" alt="Optimized weekly by Velyr" width="320" height="64"></a>`}
                className="dp-input" style={{...monoInput,width:'100%',fontSize:9.5,color:T.textMuted}}/>
              <p style={{fontSize:9,color:T.textLight,marginTop:6,lineHeight:1.5}}>Paste this into your site's footer — it updates automatically with your latest measured win.</p>
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,flexWrap:'wrap'}}>
                {badgePhase==='done' ? (
                  <span style={{fontSize:10.5,color:T.greenText,fontWeight:500}}>✓ Installed by the agent</span>
                ) : badgePhase==='busy' ? (
                  <span style={{fontSize:10.5,color:T.textMuted,display:'inline-flex',alignItems:'center',gap:7}}>
                    <span className="dp-spinner" style={{color:T.accent,width:10,height:10}}/> Installing — the agent is shipping the badge…
                  </span>
                ) : badgePhase==='confirm' ? (
                  <>
                    <span style={{fontSize:10,color:T.text}}>This ships straight to your live site.</span>
                    <button className="dp-btn dp-btn-primary" onClick={simInstallBadge} style={{fontSize:10,fontWeight:500,borderRadius:7,padding:'6px 12px'}}>Yes, install it</button>
                    <button className="dp-btn dp-btn-ghost" onClick={()=>setBadgePhase('idle')} style={{fontSize:10,borderRadius:7,padding:'6px 12px'}}>Cancel</button>
                  </>
                ) : (
                  <button className="dp-btn dp-btn-ghost" onClick={()=>setBadgePhase('confirm')} style={{fontSize:10,fontWeight:500,borderRadius:7,padding:'6px 12px'}}>
                    Let the agent install it →
                  </button>
                )}
              </div>
            </div>
            <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.borderSoft}`}}>
              <p style={{fontSize:10.5,fontWeight:500,color:T.text,marginBottom:6}}>Share card</p>
              <svg width="300" height="158" viewBox="0 0 600 315" role="img" aria-label="taskloop.app: bounce rate 43% before, 41% after, −2pp" style={{display:'block',marginBottom:8,maxWidth:'100%'}}>
                <rect x="0.5" y="0.5" width="599" height="314" rx="16" fill="#f7f4ef" stroke="#e5e0d5"/>
                <text x="36" y="44" fontFamily={F.sans} fontSize="14" fontWeight="600" fill="#6b6460">taskloop.app</text>
                <text x="564" y="44" textAnchor="end" fontFamily={F.sans} fontSize="14" fontWeight="700" fill="#2a5c45">Velyr</text>
                <text x="36" y="78" fontFamily={F.sans} fontSize="14" fill="#1c1917" fillOpacity="0.85">Signup form asks for 8 fields including optional ones</text>
                <text x="36" y="128" fontFamily={F.sans} fontSize="12" fontWeight="600" letterSpacing="1.2" fill="#6b6460">BOUNCE BEFORE</text>
                <text x="36" y="182" fontFamily={F.sans} fontSize="46" fontWeight="800" fill="#1c1917">43%</text>
                <path d="M232 164 h56 m0 0 l-9 -8 m9 8 l-9 8" stroke="#6b6460" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                <text x="330" y="128" fontFamily={F.sans} fontSize="12" fontWeight="600" letterSpacing="1.2" fill="#6b6460">BOUNCE AFTER</text>
                <text x="330" y="182" fontFamily={F.sans} fontSize="46" fontWeight="800" fill="#1c1917">41%</text>
                <rect x="36" y="212" width="150" height="36" rx="18" fill="#2a5c45"/>
                <text x="111" y="236" textAnchor="middle" fontFamily={F.sans} fontSize="16" fontWeight="700" fill="#f7f4ef">−2pp bounce</text>
                <text x="36" y="286" fontFamily={F.sans} fontSize="12" fill="#6b6460">Measured deploy±2d, site-wide · correlation, not attribution</text>
                <text x="564" y="286" textAnchor="end" fontFamily={F.sans} fontSize="12" fill="#6b6460">velyr.io</text>
              </svg>
              <p style={{fontSize:9,color:T.textLight,lineHeight:1.5}}>The bigger before/after card (600×315) — link it in posts or share the image directly.</p>
            </div>
          </>
        )}
      </Card>

      <Card style={{padding:'14px 18px',marginBottom:10}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text}}>Conversion goal</p>
        <p style={{fontSize:9.5,color:T.label,margin:'3px 0 10px'}}>What "success" means for your site — the agent optimizes toward this.</p>
        <textarea className="dp-input" value={goal} onChange={e=>setGoal(e.target.value)}
          placeholder='e.g. clicks on the "Start free trial" button'
          style={{width:'100%',minHeight:50,resize:'vertical',fontSize:10.5,lineHeight:1.5}}/>
        <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
          <select className="dp-input" value={goalType} onChange={e=>setGoalType(e.target.value)} style={{fontSize:10.5}}>
            <option value="click_text">Click on a button/link with text…</option>
            <option value="pageview_path">Visit to the page…</option>
          </select>
          <input className="dp-input" value={goalValue} onChange={e=>setGoalValue(e.target.value)} style={{...monoInput,flex:1,minWidth:140}}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}>
          <button className="dp-btn dp-btn-primary" onClick={saveGoal} style={{fontSize:10.5,fontWeight:500,borderRadius:7,padding:'7px 14px'}}>Save goal</button>
          {goalSaved && <span style={{fontSize:9.5,color:T.green}}>✓ Saved</span>}
        </div>
      </Card>

      <Card style={{padding:'14px 18px',marginBottom:10}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text}}>Competitors</p>
        <p style={{fontSize:9.5,color:T.label,margin:'3px 0 10px'}}>Scanned every Monday — you'll be alerted if anything changes. Up to two sites.</p>
        <div style={{display:'flex',flexDirection:'column',gap:6,maxWidth:340}}>
          {competitors.map((url,i)=>(
            <input key={i} className="dp-input" value={url}
              onChange={e=>{ const next=[...competitors]; next[i]=e.target.value; setCompetitors(next) }}
              style={{...monoInput,width:'100%'}}/>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}>
          <button className="dp-btn dp-btn-primary" onClick={saveComp} style={{fontSize:10.5,fontWeight:500,borderRadius:7,padding:'7px 14px'}}>
            Save competitors
          </button>
          {compSaved && <span style={{fontSize:9.5,color:T.green}}>✓ Saved</span>}
        </div>
      </Card>

      <Card style={{padding:'14px 18px',marginBottom:14}}>
        <p style={{fontSize:12,fontWeight:600,color:T.text}}>Account</p>
        <p style={{fontSize:10.5,color:'#4A5248',marginTop:5}}>demo@taskloop.app</p>
      </Card>

      <div style={{
        border:`1px solid ${T.dangerBorder}`,borderRadius:12,padding:'14px 18px',
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap',
      }}>
        <div>
          <p style={{fontSize:11,fontWeight:600,color:T.redText}}>Danger zone</p>
          <p style={{fontSize:9.5,color:'#A8887F',marginTop:2}}>Cancel your subscription or permanently delete your account and all data.</p>
        </div>
        <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
          <button className="dp-btn dp-btn-danger" onClick={()=>onToast('Just a preview — there is nothing to cancel here.')} style={{fontSize:10,borderRadius:7,padding:'7px 12px',whiteSpace:'nowrap'}}>Cancel subscription</button>
          <button className="dp-btn dp-btn-danger" onClick={()=>onToast('Just a preview — no account, no data, nothing to delete.')} style={{fontSize:10,borderRadius:7,padding:'7px 12px',whiteSpace:'nowrap'}}>Delete account</button>
        </div>
      </div>
    </div>
  )
}

// ─── Run detail overlay (scoped to the shell, mirrors RunDetail) ──────────────
function RunDetail({ run, onClose, onToast }) {
  const a = run.analysis_result||{}
  const fields = [
    {label:'Data insight',         text:a.data_insight},
    {label:'Impact',               text:a.impact},
    {label:'Solution',             text:a.solution},
    {label:'Expected improvement', text:a.expected_improvement},
  ]
  return (
    <div onClick={onClose} style={{
      position:'absolute',inset:0,zIndex:50,background:'rgba(20,32,26,.45)',
      backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',padding:18,
    }}>
      <div className="dp-pop-in dp-scroll" onClick={e=>e.stopPropagation()} style={{
        background:T.bgCard,borderRadius:14,padding:'20px 20px',
        maxWidth:480,width:'100%',maxHeight:'92%',overflowY:'auto',
        boxShadow:'0 20px 60px rgba(20,32,26,.2)',position:'relative',fontFamily:F.sans,
      }}>
        <button className="dp-btn" onClick={onClose} style={{position:'absolute',top:10,right:12,background:'none',fontSize:17,color:T.textLight}}>×</button>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <Badge status={run.status}/>
          <span style={{fontSize:9.5,color:T.textLight}}>{new Date(run.created_at).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        {(a.problem || a.problem_title) && (() => {
          const hasSplitTitle = a.problem_title && a.problem && a.problem_title !== a.problem
          return (
            <>
              <h3 style={{fontFamily:F.serif,fontWeight:500,fontSize:19,letterSpacing:'-.01em',marginBottom:hasSplitTitle?4:14,color:T.ink,lineHeight:1.25}}>{runTitle(a)}</h3>
              {hasSplitTitle && (
                <p style={{fontSize:10.5,color:T.textMuted,lineHeight:1.6,marginBottom:14}}>{a.problem}</p>
              )}
            </>
          )
        })()}
        <div style={{background:T.bgSoft,border:`1px solid ${T.border}`,borderRadius:9,padding:'11px 13px',marginBottom:11}}>
          <Label style={{marginBottom:9}}>What the agent did</Label>
          <div style={{display:'flex',flexWrap:'wrap',gap:'9px 9px'}}>
            {AGENT_STEPS.map(step=>(
              <div key={step.id} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,width:48}}>
                <div style={{
                  width:19,height:19,borderRadius:'50%',fontSize:9,flexShrink:0,background:T.accent,
                  display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',
                }}>✓</div>
                <p style={{fontSize:7.5,color:T.accent,textAlign:'center',lineHeight:1.3}}>{step.label}</p>
              </div>
            ))}
          </div>
        </div>
        {fields.map((item,i)=>item.text&&(
          <div key={i} style={{background:T.bgSoft,border:`1px solid ${T.border}`,borderRadius:8,padding:'9px 12px',marginBottom:6}}>
            <Label style={{marginBottom:4}}>{item.label}</Label>
            <p style={{fontSize:10.5,color:T.text,lineHeight:1.6}}>{item.text}</p>
          </div>
        ))}
        {a.file_to_edit && (
          <div style={{background:T.chipBg,border:'1px solid #DDE7DA',borderRadius:8,padding:'9px 12px',marginBottom:6}}>
            <Label style={{color:T.chipText,marginBottom:4}}>File edited</Label>
            <p style={{fontSize:10,color:T.text,fontFamily:F.mono,wordBreak:'break-all'}}>{a.file_to_edit}</p>
          </div>
        )}
        {a.backlog && a.backlog.length > 0 && (
          <div style={{background:T.bgSoft,border:`1px solid ${T.border}`,borderRadius:8,padding:'9px 12px',marginBottom:6}}>
            <Label style={{marginBottom:6}}>Next up — what the agent would tackle next</Label>
            {a.backlog.map((item,i)=>(
              <div key={item.page_path} style={{padding:'6px 0',borderTop:i>0?`1px solid ${T.borderSoft}`:'none'}}>
                <span style={{fontFamily:F.mono,fontSize:9.5,color:T.chipText}}>{item.page_path}</span>
                <p style={{fontSize:10,color:T.text,lineHeight:1.5,marginTop:2}}>{item.problem}</p>
              </div>
            ))}
          </div>
        )}
        {run.pr_url && (
          <button className="dp-btn dp-btn-primary" onClick={()=>onToast('Just a preview — PRs open on GitHub in the real dashboard.')} style={{
            display:'block',width:'100%',textAlign:'center',marginTop:14,borderRadius:8,padding:'10px',fontSize:11.5,fontWeight:500,
          }}>View Pull Request on GitHub →</button>
        )}
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function DashboardPreview({ booted = true }) {
  const allRuns = [PENDING_RUN, ...demoData.runs]
  const learnings = demoData.learnings
  const lastCompleted = demoData.runs[0]

  const [tab, setTab] = useState('overview')
  const [paused, setPaused] = useState(false)
  const [selectedRun, setSelectedRun] = useState(null)

  // In-shell toast for buttons that would hit the backend in the real app.
  const [note, setNote] = useState(null)
  const [noteKey, setNoteKey] = useState(0)
  const noteT = useRef(null)
  const showNote = (text) => {
    clearTimeout(noteT.current)
    setNote(text); setNoteKey(k=>k+1)
    noteT.current = setTimeout(()=>setNote(null), 2600)
  }
  useEffect(()=>()=>clearTimeout(noteT.current),[])

  // Simulated "Run now": a brief "Starting…" beat, then walks the real 11-step
  // pipeline once, then settles — mirrors the real dashboard's runStarting +
  // spinner loading state (useAnimatedRunStep) rather than jumping straight in.
  const [simStep, setSimStep] = useState(-1)
  const [simStarting, setSimStarting] = useState(false)
  const [simMsg, setSimMsg] = useState(null)
  const simT = useRef(null)
  const simStartT = useRef(null)
  function startSim() {
    if (simStep >= 0 || simStarting || paused) return
    setSimMsg(null); setSimStarting(true)
    simStartT.current = setTimeout(() => {
      setSimStarting(false); setSimStep(0)
      let i = 0
      simT.current = setInterval(() => {
        i += 1
        if (i >= AGENT_STEPS.length) {
          clearInterval(simT.current)
          setSimStep(-1)
          setSimMsg('Preview run complete — in the real dashboard a fix would now be waiting for your YES on Telegram.')
        } else setSimStep(i)
      }, 950)
    }, 1100)
  }
  useEffect(()=>()=>{ clearInterval(simT.current); clearTimeout(simStartT.current) },[])

  // Interactive state shared across tabs (persists while switching).
  // A single pinned page path — shared between the Funnel tab's "Fix in next
  // run" and the Runs tab's "Next up" backlog, mirroring the real dashboard's
  // one-shot focus_page_path (pinning one replaces whatever was pinned before).
  const [pinnedPath, setPinnedPath] = useState(null)
  const togglePin = (path) => setPinnedPath(p => p===path ? null : path)
  const [dnaVerdicts, setDnaVerdicts] = useState({})
  const [guard, setGuard] = useState({
    tone: 'Friendly and direct — no hype, no pressure tactics',
    forbidden: ['Fake urgency or countdown timers', 'Clickbait headlines'],
    protected: ['Brand colors', 'Logo and navigation'],
    custom: 'Keep all copy in English. Never promise features that don’t exist.',
  })
  const ruleCount = (guard.tone.trim()?1:0)+guard.forbidden.length+guard.protected.length+(guard.custom.trim()?1:0)

  const pendingCount = allRuns.filter(r=>r.status==='waiting_approval').length
  const running = simStep >= 0 || simStarting

  const goTab = (id) => { setTab(id); setSelectedRun(null) }

  return (
    <div className="dash-preview-shell" style={{
      position:'relative',display:'flex',flexDirection:'column',
      width:'100%',maxWidth:'100%',background:T.bg,
      border:`1px solid ${T.border}`,borderRadius:16,overflow:'hidden',
      boxShadow:'0 24px 70px -24px rgba(30,54,43,.35)',
      fontFamily:F.sans,color:T.text,
    }}>
      <style>{CSS}</style>

      {/* ── Browser chrome — frames the shell as the product, not page content ── */}
      <div style={{
        display:'flex',alignItems:'center',gap:10,padding:'9px 14px',
        background:'#E9E6DA',borderBottom:'1px solid #DCD8C9',flexShrink:0,
      }}>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          {['#DE6A5A','#E4BC4E','#61A870'].map(c=>(
            <span key={c} style={{width:9,height:9,borderRadius:'50%',background:c,opacity:.85}}/>
          ))}
        </div>
        <div style={{flex:1,display:'flex',justifyContent:'center',minWidth:0}}>
          <div style={{
            display:'inline-flex',alignItems:'center',gap:6,background:'#FFFFFF',
            border:`1px solid ${T.border}`,borderRadius:7,padding:'4px 14px',
            fontSize:10,fontFamily:F.mono,color:T.textMuted,maxWidth:'100%',
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={T.textLight} strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}>
              <rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
            </svg>
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>velyr.io/agent/dashboard</span>
          </div>
        </div>
        <span className="dp-chrome-note" style={{fontSize:9.5,color:T.textLight,display:'inline-flex',alignItems:'center',gap:5,flexShrink:0}}>
          <span style={{width:5,height:5,borderRadius:'50%',background:T.accentBar}}/> example data
        </span>
      </div>

      {/* ── Mobile tab bar (sidebar collapses ≤860px) ── */}
      <div className="dp-tabbar dp-scroll" style={{
        gap:5,padding:'9px 12px',background:T.sidebar,overflowX:'auto',flexShrink:0,
      }}>
        {NAV_ITEMS.map(item=>{
          const active = tab===item.id
          return (
            <button key={item.id} className="dp-btn" onClick={()=>goTab(item.id)} style={{
              display:'inline-flex',alignItems:'center',gap:6,flexShrink:0,
              padding:'6px 11px',borderRadius:7,fontSize:10.5,
              background:active?'rgba(255,255,255,.14)':'transparent',
              color:active?T.sideText:T.sideMuted,fontWeight:active?500:400,
            }}>
              <NavIcon path={item.icon} size={12}/>
              {item.label}
              {item.id==='runs'&&pendingCount>0&&(
                <span style={{fontSize:8,fontWeight:600,background:T.yellow,color:T.ink,borderRadius:8,padding:'0 5px'}}>{pendingCount}</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{display:'flex',alignItems:'stretch',height:640,minHeight:0}}>

        {/* ── Left sidebar (deep green, mirrors the real shell) ── */}
        <nav className="dp-leftnav" style={{
          width:190,flexShrink:0,background:T.sidebar,
          display:'flex',flexDirection:'column',padding:'16px 10px 12px',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:9,padding:'0 8px 18px'}}>
            <VelyrMark size={24}/>
            <div>
              <p style={{fontFamily:F.serif,fontSize:16,lineHeight:1,color:T.sideText}}>Velyr</p>
              <p style={{fontSize:7,letterSpacing:'.18em',color:T.sideFaint,marginTop:3,textTransform:'uppercase'}}>Growth Agent</p>
            </div>
          </div>

          <div style={{flex:1}}>
            {NAV_ITEMS.map(item=>{
              const active = tab===item.id
              return (
                <button key={item.id} className="dp-navitem" onClick={()=>goTab(item.id)} style={{
                  display:'flex',alignItems:'center',gap:9,
                  padding:'7px 10px',borderRadius:7,marginBottom:2,fontSize:11,
                  background:active?'rgba(255,255,255,.12)':'transparent',
                  color:active?T.sideText:T.sideMuted,
                  fontWeight:active?500:400,
                }}>
                  <NavIcon path={item.icon}/>
                  <span>{item.label}</span>
                  {item.id==='runs'&&pendingCount>0&&(
                    <span style={{
                      marginLeft:'auto',fontSize:8,fontWeight:600,
                      background:T.yellow,color:T.ink,borderRadius:9,
                      padding:'1px 5px',minWidth:14,textAlign:'center',
                    }}>{pendingCount}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div style={{marginTop:'auto',padding:'10px 10px 0',borderTop:'1px solid rgba(255,255,255,.09)'}}>
            <div style={{display:'flex',alignItems:'center',gap:7,fontSize:9.5,color:T.sideFaint}}>
              <span className={paused?'':'dp-pulse'} style={{
                width:6,height:6,borderRadius:'50%',flexShrink:0,
                background:paused?'#9A9E93':running?T.yellow:'#7FC79A',
              }}/>
              <span>{paused?'Agent paused':running?'Agent running':'Agent active'}</span>
            </div>
            <p style={{fontSize:8.5,color:T.sideDim,marginTop:5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>demo@taskloop.app</p>
          </div>
        </nav>

        {/* ── Main content (scrolls internally, like the real app) ── */}
        <main className="dp-main dp-scroll" style={{flex:1,minWidth:0,overflowY:'auto',padding:'18px 22px 28px'}}>

          <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,gap:10}}>
            <h3 style={{margin:0,fontSize:16,fontWeight:600,letterSpacing:'-.01em',color:T.text,fontFamily:F.sans}}>
              {PAGE_TITLES[tab]}
            </h3>
            {pendingCount>0&&(
              <button className="dp-btn" onClick={()=>goTab('runs')} style={{
                display:'flex',alignItems:'center',gap:6,background:T.yellowBg,borderRadius:20,padding:'4px 11px',
              }}>
                <span className="dp-pulse" style={{width:5,height:5,borderRadius:'50%',background:T.yellow,display:'inline-block'}}/>
                <span style={{fontSize:9.5,color:T.yellowText,fontWeight:500,whiteSpace:'nowrap'}}>{pendingCount} awaiting approval</span>
              </button>
            )}
          </header>

          <div key={tab} className="dp-tabpane">
            {tab==='overview'&&(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <PendingCard run={PENDING_RUN} onOpen={()=>setSelectedRun(PENDING_RUN)} onToast={showNote}/>
                <StatusHero
                  paused={paused} simStep={simStep} simStarting={simStarting} simMsg={simMsg}
                  onRunNow={startSim} onTogglePause={()=>setPaused(p=>!p)}
                  lastRun={lastCompleted} onSelectRun={setSelectedRun}
                />
                <KpiRow allRuns={allRuns} booted={booted} onGoRuns={()=>goTab('runs')}/>
                <div className="dp-cols">
                  <ActivityCard runs={allRuns} onSelectRun={setSelectedRun} onGoRuns={()=>goTab('runs')}/>
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    <PerformanceCard allRuns={allRuns}/>
                    <GuardrailsTeaser ruleCount={ruleCount} onGo={()=>goTab('guardrails')}/>
                  </div>
                </div>
                <DnaStrip learnings={learnings} onGoDna={()=>goTab('dna')}/>
              </div>
            )}

            {tab==='runs'&&<RunsTab allRuns={allRuns} onSelectRun={setSelectedRun} onToast={showNote} backlog={PENDING_RUN.analysis_result.backlog} pinnedPath={pinnedPath} onTogglePin={togglePin}/>}
            {tab==='network'&&<NetworkTab/>}
            {tab==='funnel'&&<FunnelTab pinnedPath={pinnedPath} onTogglePin={togglePin}/>}
            {tab==='dna'&&<DnaTab verdicts={dnaVerdicts} onVerdict={(id,v)=>setDnaVerdicts(d=>({...d,[id]:v}))}/>}
            {tab==='guardrails'&&<GuardrailsTab guard={guard} setGuard={setGuard}/>}
            {tab==='settings'&&<SettingsTab paused={paused} onTogglePause={()=>setPaused(p=>!p)} onToast={showNote}/>}
          </div>
        </main>
      </div>

      {/* ── Run detail overlay + preview toast (scoped to the shell) ── */}
      {selectedRun&&<RunDetail run={selectedRun} onClose={()=>setSelectedRun(null)} onToast={showNote}/>}
      {note&&(
        <div key={noteKey} style={{
          position:'absolute',bottom:16,left:'50%',zIndex:60,
          background:T.ink,color:T.sideText,borderRadius:9,padding:'9px 16px',
          fontSize:10.5,fontFamily:F.sans,lineHeight:1.45,maxWidth:'86%',
          boxShadow:'0 8px 24px rgba(20,32,26,.3)',pointerEvents:'none',
          animation:'dpToastIn .25s ease both',textAlign:'center',
        }}>{note}</div>
      )}
    </div>
  )
}
