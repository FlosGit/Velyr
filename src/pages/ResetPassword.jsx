import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg: '#f7f4ef', bgCard: '#ffffff', text: '#1c1917',
  textMuted: '#6b6460', textLight: '#a09890',
  border: 'rgba(28,25,23,0.09)', accent: '#2a5c45', red: '#c0392b',
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  @media (max-width: 600px) {
    .rp-card-inner { padding: 28px 22px !important; }
  }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  .rp-card { animation: fadeUp .4s ease both; }
  .rp-inp {
    width: 100%; background: #fff; border: 1px solid rgba(28,25,23,0.12); border-radius: 10px;
    padding: 13px 16px; color: #1c1917; font-family: 'Jost', sans-serif;
    font-weight: 300; font-size: 15px; outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .rp-inp:focus { border-color: rgba(42,92,69,0.4); box-shadow: 0 0 0 3px rgba(42,92,69,0.08); }
  .rp-inp::placeholder { color: #b0a89e; }
  .rp-inp:disabled { opacity: 0.5; cursor: not-allowed; }
  .rp-btn {
    width: 100%; background: #1c1917; color: #f7f4ef; border: none; border-radius: 10px;
    padding: 15px; font-family: 'Jost', sans-serif; font-weight: 500; font-size: 15px;
    cursor: pointer; transition: background .2s, transform .15s; letter-spacing: .03em;
  }
  .rp-btn:hover:not(:disabled) { background: #2a5c45; transform: translateY(-1px); }
  .rp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
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

export default function ResetPassword({ navigate }) {
  const [password, setPassword]       = useState('')
  const [confirm, setConfirm]         = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState(false)
  const [tokenValid, setTokenValid]   = useState(null) // null = checking

  // Supabase schickt den Token als URL-Fragment (#access_token=...)
  // onAuthStateChange fängt das automatisch ab wenn die Page lädt
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setTokenValid(true)
      } else if (!session && tokenValid === null) {
        // Kurz warten, dann als ungültig markieren
        setTimeout(() => setTokenValid(prev => prev === null ? false : prev), 2000)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleReset() {
    setError('')
    if (!password.trim()) { setError('Please enter a new password.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (err) {
      setError(err.message)
      return
    }

    setSuccess(true)
    // Nach 2s zum Login weiterleiten
    setTimeout(() => navigate('/agent/login'), 2000)
  }

  // Legal footer (§5 TMG — Impressum must be reachable from every page).
  // Reused across all three render branches below.
  const LegalFooter = (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: C.bg }}>
      <span style={{ fontSize: 13, color: C.textLight, fontWeight: 300, fontFamily: 'Jost, sans-serif' }}>© 2026 Velyr</span>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/privacy')}   style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Privacy Policy</button>
        <button onClick={() => navigate('/impressum')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Imprint</button>
        <button onClick={() => navigate('/agb')}       style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>AGB</button>
      </div>
    </div>
  )

  // ── Loading state (Token wird geprüft) ──────────────────────
  if (tokenValid === null) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 14, color: C.textLight, fontFamily: 'Jost, sans-serif', fontWeight: 300 }}>Checking reset link…</p>
        </div>
        {LegalFooter}
      </>
    )
  }

  // ── Ungültiger / abgelaufener Link ───────────────────────────
  if (tokenValid === false) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="rp-card" style={{ width: '100%', maxWidth: 420 }}>
            <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 40, cursor: 'pointer', justifyContent: 'center' }}>
              <Logo size={22} />
              <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: C.text }}>Velyr</span>
              <span style={{ fontSize: 11, color: C.textLight, fontWeight: 300 }}>/ Growth Agent</span>
            </div>
            <div className="rp-card-inner" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: '36px 32px', boxShadow: '0 4px 32px rgba(28,25,23,0.07)', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
              <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 26, color: C.text, marginBottom: 10 }}>Link expired</h2>
              <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7, marginBottom: 24 }}>
                This reset link is invalid or has expired. Please request a new one.
              </p>
              <button className="rp-btn" onClick={() => navigate('/agent/login')}>Back to login →</button>
            </div>
          </div>
        </div>
        {LegalFooter}
      </>
    )
  }

  // ── Erfolgreich gesetzt ──────────────────────────────────────
  if (success) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div className="rp-card" style={{ width: '100%', maxWidth: 420 }}>
            <div className="rp-card-inner" style={{ background: C.bgCard, border: `1px solid rgba(42,92,69,0.25)`, borderRadius: 18, padding: '36px 32px', boxShadow: '0 4px 32px rgba(28,25,23,0.07)', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 26, color: C.text, marginBottom: 10 }}>Password updated</h2>
              <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, lineHeight: 1.7 }}>
                Your password has been changed. Redirecting to login…
              </p>
            </div>
          </div>
        </div>
        {LegalFooter}
      </>
    )
  }

  // ── Haupt-Form ───────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div className="rp-card" style={{ width: '100%', maxWidth: 420 }}>

          <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 40, cursor: 'pointer', justifyContent: 'center' }}>
            <Logo size={22} />
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: C.text }}>Velyr</span>
            <span style={{ fontSize: 11, color: C.textLight, fontWeight: 300 }}>/ Growth Agent</span>
          </div>

          <div className="rp-card-inner" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: '36px 32px', boxShadow: '0 4px 32px rgba(28,25,23,0.07)' }}>
            <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 26, letterSpacing: '-.015em', marginBottom: 8, color: C.text }}>
              Set new password
            </h2>
            <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, marginBottom: 24, lineHeight: 1.6 }}>
              Choose a strong password for your Velyr account.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: C.textLight, fontWeight: 300, display: 'block', marginBottom: 6, letterSpacing: '.03em' }}>New password</label>
                <input
                  className="rp-inp"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleReset()}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.textLight, fontWeight: 300, display: 'block', marginBottom: 6, letterSpacing: '.03em' }}>Confirm password</label>
                <input
                  className="rp-inp"
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleReset()}
                />
              </div>

              {error && (
                <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: C.red }}>
                  {error}
                </div>
              )}

              <div style={{ height: 4 }} />
              <button className="rp-btn" onClick={handleReset} disabled={loading}>
                {loading ? 'Updating…' : 'Set new password →'}
              </button>
            </div>
          </div>

        </div>
      </div>
      {LegalFooter}
    </>
  )
}