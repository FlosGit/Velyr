import { useState, useEffect } from 'react'

import { supabase } from '../lib/supabase.js'
import { MOTION_CSS } from '../lib/motion.jsx'
import { SiteNetwork } from '../components/SiteNetwork.jsx'
import { buildNetworkData, hubDomainFromUrl } from '../lib/siteNetworkData.js'

const C = {
  bg:        '#f7f4ef',
  bgCard:    '#ffffff',
  text:      '#1c1917',
  textMuted: '#6b6460',
  textLight: '#a09890',
  border:    'rgba(28,25,23,0.09)',
  accent:    '#2a5c45',
  red:       '#c0392b',
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&family=DM+Mono:wght@400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
  .ob-card { animation: fadeUp .4s ease both; }
  .ob-inp {
    width: 100%; background: #fff; border: 1px solid rgba(28,25,23,0.12); border-radius: 10px;
    padding: 13px 16px; color: #1c1917; font-family: 'Jost', sans-serif;
    font-weight: 300; font-size: 15px; outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .ob-inp:focus { border-color: rgba(42,92,69,0.4); box-shadow: 0 0 0 3px rgba(42,92,69,0.08); }
  .ob-inp::placeholder { color: #b0a89e; }
  .ob-inp:disabled { opacity: 0.5; cursor: not-allowed; }
  .ob-inp.valid { border-color: rgba(42,92,69,0.5); }
  .ob-inp.invalid { border-color: rgba(192,57,43,0.5); }
  .ob-btn {
    width: 100%; background: #1c1917; color: #f7f4ef; border: none; border-radius: 10px;
    padding: 15px; font-family: 'Jost', sans-serif; font-weight: 500; font-size: 15px;
    cursor: pointer; transition: background .2s, transform .15s; letter-spacing: .03em;
  }
  .ob-btn:hover:not(:disabled) { background: #2a5c45; transform: translateY(-1px); }
  .ob-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .ob-btn-ghost {
    width: 100%; background: transparent; color: #1c1917;
    border: 1px solid rgba(28,25,23,0.15); border-radius: 10px;
    padding: 14px; font-family: 'Jost', sans-serif; font-weight: 400; font-size: 15px;
    cursor: pointer; transition: all .2s; letter-spacing: .03em;
  }
  .ob-btn-ghost:hover { border-color: rgba(28,25,23,0.3); background: rgba(28,25,23,0.03); }
  .req-item { transition: all .3s ease; }
  .ob-shopify-note { margin: 0 0 24px; }
  .ob-shopify-note summary {
    list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px;
    font-family: 'Jost', sans-serif; font-weight: 400; font-size: 13px; color: #2a5c45;
    padding: 12px 14px; border: 1px solid rgba(42,92,69,0.18); border-radius: 12px;
    background: rgba(42,92,69,0.04); transition: background .2s, border-color .2s;
  }
  .ob-shopify-note summary::-webkit-details-marker { display: none; }
  .ob-shopify-note summary:hover { background: rgba(42,92,69,0.07); border-color: rgba(42,92,69,0.3); }
  .ob-shopify-note summary .ob-chev { font-size: 10px; opacity: .65; transition: transform .2s; }
  .ob-shopify-note[open] summary .ob-chev { transform: rotate(90deg); }
  .ob-shopify-note[open] summary { border-radius: 12px 12px 0 0; }
  .ob-shopify-body {
    border: 1px solid rgba(42,92,69,0.18); border-top: none; border-radius: 0 0 12px 12px;
    padding: 14px 16px; background: #fff;
    font-family: 'Jost', sans-serif; font-weight: 300; font-size: 13px; color: #6b6460; line-height: 1.7;
  }
  .ob-shopify-body ol { margin: 0 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .code-display {
    font-family: 'DM Mono', monospace;
    font-size: 22px;
    letter-spacing: .15em;
    color: #2a5c45;
    background: rgba(42,92,69,0.07);
    border: 1px solid rgba(42,92,69,0.2);
    border-radius: 10px;
    padding: 16px;
    text-align: center;
    user-select: all;
  }
  .tg-open-btn {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; background: #229ED9; color: #fff; border: none; border-radius: 10px;
    padding: 15px; font-family: 'Jost', sans-serif; font-weight: 500; font-size: 15px;
    cursor: pointer; transition: background .2s, transform .15s; letter-spacing: .03em;
    text-decoration: none;
  }
  .tg-open-btn:hover { background: #1a8cbf; transform: translateY(-1px); }
  @media (max-width: 600px) {
    .ob-card-inner { padding: 24px 18px !important; }
  }
`

function Logo({ size = 24, color = '#2a5c45' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" stroke={color} strokeWidth="1.1" opacity="0.35"/>
      <circle cx="16" cy="16" r="9"  stroke={color} strokeWidth="1.1" opacity="0.6"/>
      <circle cx="16" cy="16" r="3.2" fill={color}/>
      <line x1="16" y1="2"  x2="16" y2="7"  stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45"/>
      <line x1="16" y1="25" x2="16" y2="30" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45"/>
      <line x1="2"  y1="16" x2="7"  y2="16" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45"/>
      <line x1="25" y1="16" x2="30" y2="16" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.45"/>
    </svg>
  )
}

function TelegramIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 13.618l-2.95-.924c-.64-.203-.658-.64.135-.954l11.57-4.461c.537-.194 1.006.131.659.942z"/>
    </svg>
  )
}

function StepIndicator({ current, total }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: i < current ? C.accent : i === current ? C.text : 'transparent',
            border: `1px solid ${i <= current ? 'transparent' : C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 500,
            color: i <= current ? '#fff' : C.textLight,
            transition: 'all .3s',
          }}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div style={{
              width: 20, height: 1,
              background: i < current ? C.accent : C.border,
              transition: 'background .3s',
            }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── STEP 0: Requirements ────────────────────────────────────────────────────
function Step0({ onNext }) {
  const [checks, setChecks] = useState({ github: null, hosting: null, react: null, admin: null, telegram: null })

  const requirements = [
    {
      key: 'github', icon: '🐙', title: 'GitHub account + repo',
      desc: "Your website's code must be in a GitHub repository.",
      fixText: 'Create a free GitHub account', fixUrl: 'https://github.com/signup',
    },
    {
      key: 'hosting', icon: '🚀', title: 'Auto-deploy from GitHub',
      desc: 'Your repo must auto-deploy on merge — works with Vercel, Netlify, Render, Railway, or Cloudflare Pages.',
      fixText: 'Set up auto-deploy (free tiers available)', fixUrl: 'https://vercel.com/new',
    },
    {
      key: 'react', icon: '🧩', title: 'A supported project type',
      desc: 'React, Next.js, or Vite — or a Shopify theme connected to GitHub. The agent proposes fixes as pull requests against that repo.',
      fixText: null, notSupportedText: 'No-code stores without GitHub sync (plain Shopify, Wix, Squarespace, Webflow) aren’t supported — on Shopify? See the note below.',
    },
    {
      key: 'admin', icon: '🔑', title: 'Admin access to the repo',
      desc: 'You need to be able to install GitHub Apps and merge Pull Requests.',
      fixText: null,
    },
    {
      key: 'telegram', icon: '✈️', title: 'Telegram account',
      desc: 'The agent sends weekly PR approvals via Telegram. You reply YES or NO to deploy each fix.',
      fixText: 'Get Telegram (free)', fixUrl: 'https://telegram.org/',
    },
  ]

  const allChecked = Object.values(checks).every(v => v === true)
  const hasBlocker = Object.values(checks).some(v => v === false)

  const toggle = (key, value) => setChecks(prev => ({ ...prev, [key]: prev[key] === value ? null : value }))

  return (
    <div>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 12, fontWeight: 400 }}>Step 1 of 6</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 28, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
        Requirements check
      </h2>
      <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 28 }}>
        The Growth Agent needs a few things to work. Check off what you have — we'll help with the rest.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {requirements.map((req) => {
          const status = checks[req.key]
          const isYes = status === true
          const isNo = status === false
          return (
            <div key={req.key} className="req-item" style={{
              border: `1px solid ${isYes ? 'rgba(42,92,69,0.3)' : isNo ? 'rgba(192,57,43,0.3)' : C.border}`,
              borderRadius: 12, background: isYes ? 'rgba(42,92,69,0.04)' : isNo ? 'rgba(192,57,43,0.04)' : '#fff',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{req.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 3 }}>{req.title}</p>
                  <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300, lineHeight: 1.6 }}>{req.desc}</p>
                  {isNo && req.fixUrl && (
                    <a href={req.fixUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: C.accent, fontWeight: 400, textDecoration: 'none', borderBottom: '1px solid rgba(42,92,69,0.3)' }}>
                      {req.fixText} →
                    </a>
                  )}
                  {isNo && req.notSupportedText && (
                    <p style={{ fontSize: 12, color: C.red, marginTop: 8, fontWeight: 300 }}>✕ {req.notSupportedText}</p>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {status !== null && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: isYes ? '#22c55e' : C.red, boxShadow: isYes ? '0 0 6px #22c55e' : `0 0 6px ${C.red}`, animation: 'pulse 2s ease infinite' }} />
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: `1px solid ${C.border}` }}>
                <button onClick={() => toggle(req.key, true)} style={{ flex: 1, padding: '10px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: isYes ? 500 : 300, background: isYes ? 'rgba(42,92,69,0.08)' : 'transparent', color: isYes ? C.accent : C.textMuted, border: 'none', borderRight: `1px solid ${C.border}`, cursor: 'pointer', transition: 'all .2s' }}>
                  ✓ Yes, I have this
                </button>
                <button onClick={() => toggle(req.key, false)} style={{ flex: 1, padding: '10px', fontSize: 13, fontFamily: 'Jost, sans-serif', fontWeight: isNo ? 500 : 300, background: isNo ? 'rgba(192,57,43,0.06)' : 'transparent', color: isNo ? C.red : C.textMuted, border: 'none', cursor: 'pointer', transition: 'all .2s' }}>
                  ✕ I don't have this
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <details className="ob-shopify-note">
        <summary>
          <span style={{ fontSize: 15 }}>🛍️</span>
          <span style={{ flex: 1 }}>On Shopify? You can still use Velyr if your theme is connected to GitHub.</span>
          <span className="ob-chev">▶</span>
        </summary>
        <div className="ob-shopify-body">
          Velyr ships its conversion fixes as GitHub pull requests. If your Shopify theme is synced to a GitHub repo, those fixes flow straight back into your live theme once you approve them — no plugins, no editing theme code by hand.
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <p style={{ fontWeight: 400, color: C.text, marginBottom: 8 }}>Connect your theme to GitHub (one time):</p>
            <ol>
              <li>Shopify admin → <strong style={{ color: C.text, fontWeight: 400 }}>Online Store → Themes</strong></li>
              <li><strong style={{ color: C.text, fontWeight: 400 }}>Add theme → Connect from GitHub</strong></li>
              <li>Authorize GitHub and choose the repo &amp; branch Shopify should sync</li>
            </ol>
            <p style={{ marginTop: 10 }}>
              Once it’s synced, check “Yes” above and continue — you’ll pick that repo in the GitHub step.
            </p>
          </div>
        </div>
      </details>

      {allChecked && (
        <div style={{ background: 'rgba(42,92,69,0.07)', border: '1px solid rgba(42,92,69,0.25)', borderRadius: 10, padding: '13px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: C.accent, fontWeight: 400 }}>You're all set! Let's get started.</p>
        </div>
      )}
      {hasBlocker && !allChecked && (
        <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 10, padding: '13px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: C.red, fontWeight: 400, marginBottom: 4 }}>Some requirements are missing.</p>
          <p style={{ fontSize: 12, color: C.textMuted, fontWeight: 300, lineHeight: 1.6 }}>
            Set up the missing items first, then come back to continue. The agent won't work without them.
          </p>
        </div>
      )}

      <button className="ob-btn" onClick={onNext} disabled={!allChecked}>
        {allChecked ? 'Continue — set up the agent' : 'Check all requirements to continue'}
      </button>
    </div>
  )
}

// ─── STEP 1: Website ─────────────────────────────────────────────────────────
function Step1({ onNext, onBack, navigate }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  const handleNext = () => {
    if (!url.trim()) { setError('Please enter your website URL.'); return }
    const clean = url.startsWith('http') ? url : `https://${url}`
    onNext({ websiteUrl: clean })
  }

  return (
    <div>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 12, fontWeight: 400 }}>Step 2 of 6</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 28, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
        Your website
      </h2>
      <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 16 }}>
        The agent will analyze your website every week and find conversion improvements.
      </p>

      {/* Data-processing notice (GDPR Art. 13/14 informed consent) */}
      <div style={{ background: 'rgba(42,92,69,0.05)', border: '1px solid rgba(42,92,69,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 22 }}>
        <p style={{ fontSize: 12.5, color: C.textMuted, fontWeight: 300, lineHeight: 1.6 }}>
          By connecting your GitHub repository, website, and analytics, you authorize Velyr to access and process this data to run the Growth Agent. See our{' '}
          {navigate ? (
            <button onClick={() => navigate('/privacy')} style={{ background: 'none', border: 'none', padding: 0, color: C.accent, fontSize: 12.5, fontFamily: 'Jost, sans-serif', fontWeight: 400, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)' }}>
              Privacy Policy
            </button>
          ) : (
            <a href="/privacy" style={{ color: C.accent, fontWeight: 400, textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)' }}>Privacy Policy</a>
          )}
          {' '}for details.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, color: C.textLight, display: 'block', marginBottom: 6, letterSpacing: '.03em' }}>Website URL</label>
          <input className="ob-inp" placeholder="yourwebsite.com" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleNext()} />
        </div>
        {error && <p style={{ fontSize: 13, color: C.red }}>{error}</p>}
        <div style={{ height: 8 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ob-btn-ghost" onClick={onBack} style={{ flex: '0 0 auto', width: 'auto', padding: '14px 20px' }}>← Back</button>
          <button className="ob-btn" onClick={handleNext}>Continue →</button>
        </div>
      </div>
    </div>
  )
}

function GitHubIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/>
    </svg>
  )
}

function Spinner({ size = 16, color = C.accent }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid rgba(28,25,23,0.15)`, borderTopColor: color, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
  )
}

// ─── STEP 2: GitHub (OAuth + ownership-verified repo picker) ──────────────────
// Replaces the old manual "Installation ID + owner + repo" form. The user
// authorizes via GitHub OAuth (OA2 → OA3); on return we read the signed handoff
// cookie's snapshot (OA4 /api/onboarding?action=snapshot) and present only the
// repos GitHub actually exposed. Picking one calls ?action=complete, which is
// the only path that writes the verified installation via complete_onboarding.
function Step2({ onNext, onBack, user, subscriptionId, formData }) {
  // 'idle' | 'redirecting' | 'returning' | 'picking' | 'submitting' | 'error'
  const [state, setState]       = useState('idle')
  const [error, setError]       = useState('')
  const [snapshot, setSnapshot] = useState(null) // { githubLogin, installations }

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${session?.access_token}` }
  }

  const fetchSnapshot = async () => {
    try {
      const res = await fetch('/api/onboarding?action=snapshot', { headers: await authHeader() })
      const json = await res.json()
      if (res.ok) {
        setSnapshot(json)
        setState('picking')
      } else {
        setError(json.error || 'Your GitHub session expired. Please reconnect.')
        setState('error')
      }
    } catch {
      setError('Could not load your GitHub repositories. Please reconnect.')
      setState('error')
    }
  }

  // On return from GitHub the page has fully reloaded — pick up ?oauth=… here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('oauth')
    if (oauth === 'success') {
      setState('returning')
      fetchSnapshot()
      window.history.replaceState({}, '', '/agent/onboarding')
    } else if (oauth === 'error') {
      setError(params.get('reason') || 'GitHub connection failed. Please try again.')
      setState('error')
      window.history.replaceState({}, '', '/agent/onboarding')
    }
  }, [])

  const connectGitHub = async () => {
    setState('redirecting')
    setError('')
    try {
      // The OAuth ownership checks (oauth-initiate + complete_onboarding) key on
      // agent_subscriptions.auth_user_id, which is otherwise only set at the
      // final step. Set it now (RLS grants authenticated UPDATE on this column
      // for the row it owns) so initiate's 403 check passes.
      await supabase
        .from('agent_subscriptions')
        .update({ auth_user_id: user.id, email: user.email, plan: 'growth' })
        .eq('id', subscriptionId)

      // The redirect to GitHub is a full page navigation — persist collected
      // form data (website URL from step 1) so we can restore it on return.
      try { localStorage.setItem('velyr_onboarding_data', JSON.stringify(formData || {})) } catch {}

      const res = await fetch('/api/github/oauth-initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ subscriptionId }),
      })
      const json = await res.json()
      if (res.ok && json.redirectUrl) {
        window.location.href = json.redirectUrl
      } else {
        setError(json.error || 'Could not start GitHub authorization. Please try again.')
        setState('error')
      }
    } catch {
      setError('Could not start GitHub authorization. Please try again.')
      setState('error')
    }
  }

  const pickRepo = async (installationId, repoFullName) => {
    setState('submitting')
    setError('')
    try {
      const res = await fetch('/api/onboarding?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ subscriptionId, installationId, repoFullName }),
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        const [repoOwner, repoName] = repoFullName.split('/')
        // GitHub connection is now verified + persisted server-side. Carry the
        // selection forward for display; the remaining steps write Telegram etc.
        onNext({ installationId, repoFullName, repoOwner, repoName })
      } else {
        setError(json.error || 'Could not connect this repository. Please try again.')
        setState('picking') // keep the picker open so they can retry
      }
    } catch {
      setError('Could not connect this repository. Please try again.')
      setState('picking')
    }
  }

  const heading = (
    <>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 12, fontWeight: 400 }}>Step 3 of 6</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 28, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
        Connect GitHub
      </h2>
    </>
  )

  // ── returning / submitting: loading states ─────────────────────────────────
  if (state === 'returning' || state === 'submitting') {
    return (
      <div>
        {heading}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '40px 0' }}>
          <Spinner size={28} />
          <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300 }}>
            {state === 'returning' ? 'Loading your repositories…' : 'Connecting your repository…'}
          </p>
        </div>
      </div>
    )
  }

  // ── picking: ownership-verified repo list ──────────────────────────────────
  if (state === 'picking') {
    const installations = snapshot?.installations || []
    const hasRepos = installations.some(i => (i.repos || []).length > 0)
    return (
      <div>
        {heading}
        <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 20 }}>
          Connected as <strong style={{ fontWeight: 500, color: C.text }}>@{snapshot?.githubLogin}</strong>. Choose the repository the agent should work on.
        </p>

        {!hasRepos && (
          <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 10, padding: '13px 16px', marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: C.red, fontWeight: 400 }}>No installations found for your GitHub account or organizations. Install Velyr first.</p>
          </div>
        )}

        {installations.map((inst) => (
          <div key={inst.installationId} style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 12, color: C.textLight, marginBottom: 8, letterSpacing: '.03em' }}>
              Account: <strong style={{ fontWeight: 500, color: C.textMuted }}>@{inst.account?.login}</strong>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(inst.repos || []).map((repo) => (
                <button
                  key={repo.fullName}
                  onClick={() => pickRepo(inst.installationId, repo.fullName)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '13px 16px', cursor: 'pointer', fontFamily: 'Jost, sans-serif',
                    fontWeight: 400, fontSize: 14, color: C.text, transition: 'all .2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(42,92,69,0.4)'; e.currentTarget.style.background = 'rgba(42,92,69,0.03)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = '#fff' }}
                >
                  <GitHubIcon size={16} />
                  <span style={{ flex: 1 }}>{repo.fullName}</span>
                  <span style={{ fontSize: 13, color: C.accent }}>→</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <p style={{ fontSize: 12, color: C.textLight, fontWeight: 300, lineHeight: 1.6, marginTop: 8, marginBottom: 12 }}>
          Don't see the repo you want? Make sure the Velyr Growth Agent is installed on the right repository.{' '}
          <a href="https://github.com/apps/velyr-growth-agent/installations/new" target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: 'underline' }}>Manage installation →</a>
        </p>

        {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 12 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ob-btn-ghost" onClick={onBack} style={{ flex: '0 0 auto', width: 'auto', padding: '14px 20px' }}>← Back</button>
        </div>
      </div>
    )
  }

  // ── idle / redirecting / error: the connect CTA ────────────────────────────
  return (
    <div>
      {heading}
      <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 24 }}>
        The agent reads your code and creates Pull Requests with fixes — directly in your repo. Authorize with GitHub to choose a repository.
      </p>

      <div style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 12, padding: '18px', marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300, lineHeight: 1.6, marginBottom: 14 }}>
          You'll be sent to GitHub to authorize Velyr and pick which repositories it can access. We never see your password, and you can revoke access any time from GitHub.
        </p>
        <button
          onClick={connectGitHub}
          disabled={state === 'redirecting' || !subscriptionId}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', background: C.text, color: '#fff', border: 'none', borderRadius: 10,
            padding: '15px', fontFamily: 'Jost, sans-serif', fontWeight: 500, fontSize: 15,
            cursor: state === 'redirecting' ? 'not-allowed' : 'pointer', opacity: state === 'redirecting' ? 0.6 : 1,
            transition: 'background .2s, transform .15s', letterSpacing: '.03em',
          }}
          onMouseEnter={e => { if (state !== 'redirecting') e.currentTarget.style.background = C.accent }}
          onMouseLeave={e => { e.currentTarget.style.background = C.text }}
        >
          {state === 'redirecting' ? <Spinner size={16} color="#fff" /> : <GitHubIcon size={18} />}
          {state === 'redirecting' ? 'Redirecting to GitHub…' : 'Connect GitHub'}
        </button>
      </div>

      {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ob-btn-ghost" onClick={onBack} style={{ flex: '0 0 auto', width: 'auto', padding: '14px 20px' }}>← Back</button>
      </div>
    </div>
  )
}

// ─── STEP 4: Hosting platform ─────────────────────────────────────────────────
// Records which platform deploys the customer's repo. The agent works identically
// on all of them (it only opens a PR; the host auto-deploys on merge), so this is
// stored for clarity/future-proofing and never branches the run path.
const HOSTING_OPTIONS = [
  { value: 'vercel',           icon: '▲',  label: 'Vercel' },
  { value: 'netlify',          icon: '◆',  label: 'Netlify' },
  { value: 'render',           icon: '●',  label: 'Render' },
  { value: 'railway',          icon: '🚆', label: 'Railway' },
  { value: 'cloudflare_pages', icon: '☁',  label: 'Cloudflare Pages' },
]

function StepPlatform({ onNext, onBack }) {
  const [selected, setSelected] = useState('vercel')

  return (
    <div>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 12, fontWeight: 400 }}>Step 4 of 6</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 28, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
        Where is it deployed?
      </h2>
      <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 24 }}>
        Pick the platform that hosts your repo. The agent works the same on all of them — it opens a pull request and your host deploys it automatically once you approve.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {HOSTING_OPTIONS.map((opt) => {
          const isSel = selected === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              className="req-item"
              onClick={() => setSelected(opt.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                border: `1px solid ${isSel ? 'rgba(42,92,69,0.45)' : C.border}`,
                borderRadius: 12, background: isSel ? 'rgba(42,92,69,0.05)' : '#fff',
                padding: '14px 16px', cursor: 'pointer', fontFamily: 'Jost, sans-serif',
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0, width: 22, textAlign: 'center' }}>{opt.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: isSel ? 500 : 300, color: C.text }}>{opt.label}</span>
              <span style={{
                width: 18, height: 18, flexShrink: 0, borderRadius: '50%',
                border: `1px solid ${isSel ? C.accent : 'rgba(28,25,23,0.2)'}`,
                background: isSel ? C.accent : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isSel && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
              </span>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ob-btn-ghost" onClick={onBack} style={{ flex: '0 0 auto', width: 'auto', padding: '14px 20px' }}>← Back</button>
        <button className="ob-btn" onClick={() => onNext({ hostingProvider: selected })}>Continue →</button>
      </div>
    </div>
  )
}

// ─── STEP 5: Analytics (zero-setup) ───────────────────────────────────────────
function Step3({ onNext, onBack }) {
  return (
    <div>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 12, fontWeight: 400 }}>Step 5 of 6</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 28, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
        Analytics — zero setup
      </h2>
      <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 24 }}>
        Velyr handles analytics tracking for your site — you don't need your own PostHog account.
        Your visitor data is processed by Velyr's analytics infrastructure.
      </p>

      <div style={{ background: 'rgba(42,92,69,0.06)', border: '1px solid rgba(42,92,69,0.2)', borderRadius: 12, padding: '16px 18px', marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 6 }}>✅ What Velyr sets up for you:</p>
        <ul style={{ fontSize: 13, color: C.textMuted, fontWeight: 300, lineHeight: 1.9, paddingLeft: 16 }}>
          <li>Built-in analytics — pageviews, bounce rate, traffic sources</li>
          <li>Weekly data fed directly into the Growth Agent</li>
        </ul>
      </div>

      <div style={{ background: 'rgba(28,25,23,0.03)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 24 }}>
        <p style={{ fontSize: 12, color: C.textLight, fontWeight: 300, lineHeight: 1.7 }}>
          After your first run, you'll receive a snippet via Telegram to paste into your app's entry file (<code style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, background: 'rgba(28,25,23,0.06)', padding: '1px 5px', borderRadius: 4 }}>main.jsx</code>, <code style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, background: 'rgba(28,25,23,0.06)', padding: '1px 5px', borderRadius: 4 }}>_app.jsx</code>, or <code style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, background: 'rgba(28,25,23,0.06)', padding: '1px 5px', borderRadius: 4 }}>app/layout.tsx</code>).
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ob-btn-ghost" onClick={onBack} style={{ flex: '0 0 auto', width: 'auto', padding: '14px 20px' }}>← Back</button>
        <button className="ob-btn" onClick={() => onNext({})}>Continue →</button>
      </div>
    </div>
  )
}

// ─── STEP 4: Telegram ────────────────────────────────────────────────────────
function Step4({ onNext, onBack, loading }) {
  const [code, setCode]           = useState('')
  const [error, setError]         = useState('')
  const [verifying, setVerifying] = useState(false)
  const [botOpened, setBotOpened] = useState(false)
  // B3: the bot deep link must carry a per-user start token so /start can bind
  // the verification code to this account. Without it the bot refuses /start.
  const [startToken, setStartToken]       = useState(null)
  const [tokenError, setTokenError]       = useState('')
  const [tokenLoading, setTokenLoading]   = useState(false)

  const fetchStartToken = async () => {
    setTokenLoading(true)
    setTokenError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/onboarding?action=telegram_start_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.token) {
        setTokenError(json.error || 'Could not prepare your Telegram setup link. Please retry.')
        setStartToken(null)
      } else {
        setStartToken(json.token)
      }
    } catch {
      setTokenError('Could not prepare your Telegram setup link. Please retry.')
      setStartToken(null)
    } finally {
      setTokenLoading(false)
    }
  }

  // Mint a fresh start token when the step mounts.
  useEffect(() => { fetchStartToken() }, [])

  const botLink = startToken ? `https://t.me/VelyrBot?start=${startToken}` : null

  const handleNext = async () => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) { setError('Please enter your verification code.'); return }

    if (!/^VELYR-[A-Z0-9]{6}$/.test(trimmed)) {
      setError('Invalid code format. It should look like VELYR-XXXXXX.')
      return
    }

    setVerifying(true)
    setError('')

    // OA6: validation moved server-side. The browser can no longer read
    // telegram_verification_codes (tvc RLS policies retired). This is a
    // read-only "is this code live?" check for fast feedback; the actual
    // ownership-bound consume happens atomically in finalize at submit.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/onboarding?action=verify_telegram_code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ code: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      setVerifying(false)
      if (!res.ok) {
        setError(json.error || 'Code not found or expired. Please go back to Telegram and type /start again.')
        return
      }
      // Thread codeId forward — finalize binds + consumes it at final submit.
      onNext({ telegramCode: trimmed, telegramChatId: json.chatId, codeId: json.codeId })
    } catch {
      setVerifying(false)
      setError('Could not verify your code. Please check your connection and try again.')
    }
  }

  return (
    <div>
      <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, marginBottom: 12, fontWeight: 400 }}>Step 6 of 6</p>
      <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 28, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
        Connect Telegram
      </h2>
      <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 24 }}>
        The agent sends you weekly reports and PR approvals via Telegram. Connect it in 2 steps.
      </p>

      <div style={{ border: `1px solid ${botOpened ? 'rgba(42,92,69,0.3)' : C.border}`, background: botOpened ? 'rgba(42,92,69,0.04)' : '#fff', borderRadius: 12, padding: '16px 18px', marginBottom: 12, transition: 'all .3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: botOpened ? C.accent : 'transparent', border: `1px solid ${botOpened ? C.accent : C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: botOpened ? '#fff' : C.textLight, fontWeight: 500, flexShrink: 0 }}>
            {botOpened ? '✓' : '1'}
          </div>
          <p style={{ fontSize: 14, fontWeight: 500, color: C.text }}>Open @VelyrBot and send /start</p>
        </div>
        <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300, lineHeight: 1.6, paddingLeft: 32, marginBottom: 14 }}>
          The bot will send you a 6-character verification code. You'll need it in step 2.
        </p>
        <div style={{ paddingLeft: 32 }}>
          {botLink ? (
            <a href={botLink} target="_blank" rel="noreferrer" className="tg-open-btn" style={{ display: 'inline-flex', width: 'auto', padding: '9px 18px' }} onClick={() => setTimeout(() => setBotOpened(true), 2000)}>
              <TelegramIcon size={16} />
              Open @VelyrBot
            </a>
          ) : tokenLoading ? (
            <p style={{ fontSize: 13, color: C.textLight, fontWeight: 300 }}>Preparing your setup link…</p>
          ) : (
            <div>
              {tokenError && <p style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>{tokenError}</p>}
              <button onClick={fetchStartToken} className="tg-open-btn" style={{ display: 'inline-flex', width: 'auto', padding: '9px 18px', cursor: 'pointer', border: 'none' }}>
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 12, padding: '16px 18px', marginBottom: 16, opacity: botOpened ? 1 : 0.5, transition: 'opacity .3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'transparent', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.textLight, fontWeight: 500, flexShrink: 0 }}>2</div>
          <p style={{ fontSize: 14, fontWeight: 500, color: C.text }}>Enter your verification code</p>
        </div>
        <div style={{ paddingLeft: 32 }}>
          <input className="ob-inp" placeholder="VELYR-XXXXXX" value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={!botOpened} style={{ fontFamily: 'DM Mono, monospace', letterSpacing: '.08em', fontSize: 16 }} onKeyDown={e => e.key === 'Enter' && handleNext()} />
        </div>
      </div>

      {!botOpened && (
        <button onClick={() => setBotOpened(true)} style={{ background: 'none', border: 'none', fontSize: 12, color: C.textLight, cursor: 'pointer', fontFamily: 'Jost, sans-serif', fontWeight: 300, padding: '0 0 16px', textDecoration: 'underline' }}>
          Already have a code
        </button>
      )}

      {error && <p style={{ fontSize: 13, color: C.red, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ob-btn-ghost" onClick={onBack} style={{ flex: '0 0 auto', width: 'auto', padding: '14px 20px' }}>← Back</button>
        <button className="ob-btn" onClick={handleNext} disabled={loading || verifying || !botOpened}>
          {verifying ? 'Verifying…' : loading ? 'Setting up…' : 'Launch Growth Agent 🚀'}
        </button>
      </div>
    </div>
  )
}

// ─── FIRST-CONNECT BUILD FINALE ───────────────────────────────────────────────
// Stage 3 (C1 + C2). Polls site_structure_preview (RA1 result, fired after the
// GitHub step) and animates the real folder structure wave-by-wave, then closes
// with the C2 "your network sharpens on Monday" beat and routes to the dashboard
// Overview. Honest: structure-only, neutral nodes, NO verdicts. Failure-safe: on
// status:'error' / timeout / empty it skips the build beat and still closes clean.
function OnboardingBuild({ subscriptionId, websiteUrl, navigate }) {
  const [phase, setPhase] = useState('polling')   // polling | building | skip
  const [data, setData]   = useState(null)
  const [showOutro, setShowOutro] = useState(false)
  const domain = hubDomainFromUrl(websiteUrl) || 'your site'

  // Poll the preview row until terminal. ready/partial with nodes → build;
  // error / timeout / empty → skip (never hang, never show a broken graph).
  useEffect(() => {
    if (!subscriptionId) { setPhase('skip'); return }
    let cancelled = false
    let polls = 0
    const MAX_POLLS = 14   // ~21s at 1.5s
    const tick = async () => {
      if (cancelled) return
      polls++
      const { data: row } = await supabase
        .from('site_structure_preview').select('*')
        .eq('subscription_id', subscriptionId).maybeSingle()
      if (cancelled) return
      const st = row?.status
      if (st === 'ready' || st === 'partial') {
        const nd = buildNetworkData(row, { domain })
        if (nd && nd.nodes.length > 1) { setData(nd); setPhase('building'); return }
        setPhase('skip'); return                 // ready but nothing to show
      }
      if (st === 'error')        { setPhase('skip'); return }
      if (polls >= MAX_POLLS)    { setPhase('skip'); return }
      setTimeout(tick, 1500)
    }
    tick()
    return () => { cancelled = true }
  }, [subscriptionId, domain])

  // building → let the reveal play, then fade in the outro. skip → outro now.
  useEffect(() => {
    if (phase === 'building') {
      const t = setTimeout(() => setShowOutro(true), 2600)
      return () => clearTimeout(t)
    }
    if (phase === 'skip') setShowOutro(true)
  }, [phase])

  // Auto-route once the outro is shown (generous read pause); button skips it.
  useEffect(() => {
    if (!showOutro) return
    const t = setTimeout(() => navigate('/agent/dashboard'), 5200)
    return () => clearTimeout(t)
  }, [showOutro, navigate])

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '20px 28px' }}>
        <Logo size={20} />
        <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 18, color: C.text }}>Velyr</span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 24px' }}>
        <p style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.accent, marginBottom: 6, fontWeight: 500 }}>
          {phase === 'building' ? 'Mapping your site' : phase === 'polling' ? 'Mapping your site' : 'All set'}
        </p>
        <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 30, letterSpacing: '-.015em', color: C.text, marginBottom: 18 }}>
          {domain}
        </h2>

        {phase === 'polling' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 0' }}>
            <div style={{ width: 26, height: 26, border: '2px solid rgba(42,92,69,0.15)', borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300 }}>Reading your repository structure…</p>
          </div>
        )}

        {phase === 'building' && data && (
          <div style={{ width: '100%', maxWidth: 960, borderRadius: 16, overflow: 'hidden', background: '#f7f4ef', border: `1px solid ${C.border}` }}>
            <SiteNetwork data={data} reveal style={{ height: 'min(56vh, 520px)', minHeight: 360 }} />
          </div>
        )}

        {/* Outro — C2: the network itself sharpens on Monday */}
        <div style={{
          marginTop: 22, textAlign: 'center', maxWidth: 460,
          opacity: showOutro ? 1 : 0, transition: 'opacity .6s ease',
        }}>
          <p style={{ fontSize: 14, color: C.text, fontWeight: 400, lineHeight: 1.6, marginBottom: 6 }}>
            This is your site’s structure. On your first run Monday, the agent maps how your
            pages actually connect — and ships its first conversion fix.
          </p>
          <button className="ob-btn" onClick={() => navigate('/agent/dashboard')} style={{ width: 'auto', padding: '12px 24px', marginTop: 12 }}>
            Enter your dashboard →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ROOT ────────────────────────────────────────────────────────────────────
// FIX 3: useNavigate hook instead of navigate prop
export default function AgentOnboarding({ navigate }) {
  
  const [step, setStep]         = useState(0)
  const [user, setUser]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [formData, setFormData] = useState({})
  const [gateChecked, setGateChecked] = useState(false)
  const [subscriptionId, setSubscriptionId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { navigate('/agent/login'); return }
      setUser(session.user)
    })
  }, [])

  // Returning from the GitHub OAuth redirect (OA3 → /agent/onboarding?oauth=…):
  // the full page reload wiped React state, so restore the form data we stashed
  // before redirecting and jump straight to the GitHub step. Step2 reads the
  // ?oauth= param itself to drive its snapshot fetch / error display.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('oauth')) {
      try {
        const saved = localStorage.getItem('velyr_onboarding_data')
        if (saved) setFormData(prev => ({ ...JSON.parse(saved), ...prev }))
      } catch {}
      setStep(2)
    }
  }, [])

  // Subscription gate — onboarding no longer requires a card. Ensure the bare
  // agent_subscriptions row exists (idempotent server-side init) so the GitHub
  // step (complete_onboarding) and finalize have a row to attach to, then let
  // the user in. The 14-day Stripe trial is created AFTER onboarding completes
  // (handleStep4 → /api/stripe?action=start_trial), so nothing is collected or
  // verified with Stripe here.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled || !session) return
        const res = await fetch('/api/onboarding?action=init_subscription', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && json.subscriptionId) {
          setSubscriptionId(json.subscriptionId)
        } else {
          console.error('[onboarding] init_subscription failed:', json.error || res.status)
        }
      } catch (err) {
        if (!cancelled) console.error('[onboarding] init_subscription error:', err)
      } finally {
        // Always clear the gate so the user can proceed; the GitHub step
        // re-checks subscriptionId and shows a clear error if init truly failed.
        if (!cancelled) setGateChecked(true)
      }
    })()

    return () => { cancelled = true }
  }, [user])

  const handleStep0 = ()     => setStep(1)
  const handleStep1 = (data) => { setFormData(prev => ({ ...prev, ...data })); setStep(2) }
  const handleStep2 = (data) => {
    setFormData(prev => ({ ...prev, ...data }))
    setStep(3)
    // Stage 3: kick off the first-connect structure preview now (RA1, ~2s) so it's
    // ready by the time the user reaches the build finale. Fire-and-forget; any
    // failure is non-fatal (the finale times out → skips gracefully to Overview).
    ;(async () => {
      try {
        if (!subscriptionId) return
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        await fetch('/api/onboarding?action=discover_structure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ subscriptionId }),
        })
      } catch { /* non-fatal */ }
    })()
  }
  // Platform-selection step (records hosting_provider only; no run-path effect).
  const handlePlatform = (data) => { setFormData(prev => ({ ...prev, ...data })); setStep(4) }
  const handleStep3 = (data) => { setFormData(prev => ({ ...prev, ...data })); setStep(5) }

  const handleStep4 = async (data) => {
    setLoading(true)
    setError('')
    const allData = { ...formData, ...data }

    try {
      // No payment gate here: onboarding collects no card. The bare
      // agent_subscriptions row was created at mount (init_subscription) and its
      // id is in `subscriptionId`. The 14-day Stripe trial is started AFTER
      // finalize succeeds (start_trial below), so the clock begins at completion.
      if (!subscriptionId) {
        setError('Your session expired. Refresh the page and try again.')
        setLoading(false)
        return
      }

      // Persist the onboarding-supplied details onto the row.
      const subUpdate = await supabase
        .from('agent_subscriptions')
        .update({
          auth_user_id: user.id,
          email: user.email,
          plan: 'growth',
          telegram_chat_id: allData.telegramChatId,
        })
        .eq('id', subscriptionId)
      console.log('[onboarding/step4] agent_subscriptions update result:', { error: subUpdate.error, status: subUpdate.status })
      if (subUpdate.error) throw subUpdate.error

      // OA6: the verification code is re-validated AND atomically consumed
      // server-side inside finalize (no browser SELECT/UPDATE on
      // telegram_verification_codes anymore). We just thread the codeId
      // captured at Step 4 entry.
      // OA5: the agent_connections write is SERVER-SIDE. The browser can no
      // longer write that table (interim RLS write policies retired in
      // 20260522_retire_interim_oauth_rls.sql), so we POST the remaining,
      // non-GitHub fields to /api/onboarding?action=finalize, which writes them
      // with the service role after re-checking ownership + that the GitHub
      // step (complete_onboarding) already ran.
      const { data: { session } } = await supabase.auth.getSession()
      const finalizeRes = await fetch('/api/onboarding?action=finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          subscriptionId,
          websiteUrl: allData.websiteUrl,
          hostingProvider: allData.hostingProvider,  // platform-selection step (Step 4)
          posthogApiKey: null,        // zero-setup onboarding collects no key
          posthogProjectId: null,
          posthogHost: 'https://us.i.posthog.com',
          telegramChatId: allData.telegramChatId,
          // Stage 4.13 binding: finalize validates this code matches the chat,
          // marks it used, and writes the FK — all atomically (OA6).
          verificationCodeId: allData.codeId,
        }),
      })
      const finalizeJson = await finalizeRes.json().catch(() => ({}))
      console.log('[onboarding/step4] finalize result:', { status: finalizeRes.status, body: finalizeJson })
      if (!finalizeRes.ok || !finalizeJson.ok) {
        throw new Error(finalizeJson.error || 'Could not finish onboarding.')
      }

      // Onboarding is complete → START THE 14-DAY TRIAL now (Stripe-native, NO
      // card). Best-effort: if it fails, the dashboard has an idempotent fallback
      // that starts the trial on next load, so we never block the finale on it.
      try {
        await fetch('/api/stripe?action=start_trial', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
      } catch (e) {
        console.warn('[onboarding/step4] start_trial failed (dashboard fallback will retry):', e?.message)
      }

      // OA4: the OAuth redirect stashed form data under this key; clear it now.
      try { localStorage.removeItem('velyr_onboarding_data') } catch {}

      // Stage 3: show the first-connect build finale (step 5) instead of jumping
      // to the dashboard; it animates the structure preview, then routes to
      // Overview (or skips there on any failure).
      setLoading(false)
      setStep(6)
    } catch (err) {
      console.error('[onboarding/step4] failed:', {
        message: err?.message,
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
        raw: err,
      })
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  // Until the subscription gate clears (or sends the user to Stripe), show a
  // simple spinner instead of the form so users never see steps they aren't
  // entitled to.
  if (!user || !gateChecked) {
    return (
      <>
        <style>{CSS + MOTION_CSS}</style>
        <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div style={{ width: 32, height: 32, border: '2px solid rgba(28,25,23,0.15)', borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontSize: 13, color: C.textLight, fontWeight: 300 }}>Checking your subscription…</p>
        </div>
      </>
    )
  }

  // Stage 3: first-connect build finale takes over full-screen (the graph needs
  // more width than the 520px step card).
  if (step === 6) {
    return (
      <>
        <style>{CSS + MOTION_CSS}</style>
        <OnboardingBuild subscriptionId={subscriptionId} websiteUrl={formData.websiteUrl} navigate={navigate} />
      </>
    )
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ width: '100%', maxWidth: 520 }}>
          <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 40, cursor: 'pointer', justifyContent: 'center' }}>
            <Logo size={22} />
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: C.text }}>Velyr</span>
            <span style={{ fontSize: 11, color: C.textLight, fontWeight: 300 }}>/ Growth Agent Setup</span>
          </div>

          <div className="ob-card ob-card-inner" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: '36px 32px', boxShadow: '0 4px 32px rgba(28,25,23,0.07)' }}>
            <StepIndicator current={step} total={6} />
            {step === 0 && <Step0 onNext={handleStep0} />}
            {step === 1 && <Step1 onNext={handleStep1} onBack={() => setStep(0)} navigate={navigate} />}
            {step === 2 && <Step2 onNext={handleStep2} onBack={() => setStep(1)} user={user} subscriptionId={subscriptionId} formData={formData} />}
            {step === 3 && <StepPlatform onNext={handlePlatform} onBack={() => setStep(2)} />}
            {step === 4 && <Step3 onNext={handleStep3} onBack={() => setStep(3)} />}
            {step === 5 && <Step4 onNext={handleStep4} onBack={() => setStep(4)} loading={loading} />}
            {error && (
              <div style={{ marginTop: 16, background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: C.red }}>
                {error}
              </div>
            )}
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: C.textLight, marginTop: 20, fontWeight: 300 }}>
            Takes about 5 minutes · You can change everything later
          </p>
        </div>
      </div>

      {/* Legal footer (§5 TMG — Impressum must be reachable from every page) */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: C.bg }}>
        <span style={{ fontSize: 13, color: C.textLight, fontWeight: 300, fontFamily: 'Jost, sans-serif' }}>© 2026 Velyr</span>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
          <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Legal Notice (Impressum)</button>
          <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>AGB</button>
        </div>
      </div>
    </>
  )
}