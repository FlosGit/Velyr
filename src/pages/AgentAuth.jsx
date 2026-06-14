import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

function readPendingIntent() {
  try {
    return (
      localStorage.getItem('postLoginCheckout') ||
      sessionStorage.getItem('postLoginCheckout') ||
      null
    )
  } catch {
    return null
  }
}

function clearPendingIntent() {
  try { localStorage.removeItem('postLoginCheckout') } catch {}
  try { sessionStorage.removeItem('postLoginCheckout') } catch {}
}

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
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Jost:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow-x: hidden; max-width: 100vw; }
  body { background: #f7f4ef; font-family: 'Jost', sans-serif; font-weight: 300; -webkit-font-smoothing: antialiased; }
  img, svg, video { max-width: 100%; }
  @media (max-width: 600px) {
    .auth-card-inner { padding: 28px 22px !important; }
  }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  .auth-card { animation: fadeUp .4s ease both; }
  .auth-inp {
    width: 100%; background: #fff; border: 1px solid rgba(28,25,23,0.12); border-radius: 10px;
    padding: 13px 16px; color: #1c1917; font-family: 'Jost', sans-serif;
    font-weight: 300; font-size: 15px; outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .auth-inp:focus { border-color: rgba(42,92,69,0.4); box-shadow: 0 0 0 3px rgba(42,92,69,0.08); }
  .auth-inp::placeholder { color: #b0a89e; }
  .auth-btn {
    width: 100%; background: #1c1917; color: #f7f4ef; border: none; border-radius: 10px;
    padding: 15px; font-family: 'Jost', sans-serif; font-weight: 500; font-size: 15px;
    cursor: pointer; transition: background .2s, transform .15s;
    letter-spacing: .03em;
  }
  .auth-btn:hover:not(:disabled) { background: #2a5c45; transform: translateY(-1px); }
  .auth-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .auth-btn-google {
    width: 100%; background: #fff; color: #1c1917;
    border: 1px solid rgba(28,25,23,0.14); border-radius: 10px;
    padding: 14px; font-family: 'Jost', sans-serif; font-weight: 400; font-size: 15px;
    cursor: pointer; transition: border-color .2s, background .2s, transform .15s;
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    letter-spacing: .02em;
  }
  .auth-btn-google:hover:not(:disabled) { border-color: rgba(28,25,23,0.28); background: #faf8f4; transform: translateY(-1px); }
  .auth-btn-google:disabled { opacity: 0.6; cursor: not-allowed; }
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

function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  )
}

export default function AgentAuth({ navigate, mode = 'login' }) {
  const [tab, setTab]           = useState(mode)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  async function handleSubmit() {
    setError('')
    setSuccess('')
    if (!email.trim() || !password.trim()) { setError('Please fill in all fields.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)

    if (tab === 'register') {
      // Prefer ?intent= from the URL (set by SubscribeButton when it redirected
      // here), fall back to whatever's in localStorage/sessionStorage. We encode
      // it into emailRedirectTo so the post-confirmation entry point can resume
      // the checkout even when the email link opens in a different tab/device.
      const urlIntent = (() => {
        try { return new URLSearchParams(window.location.search).get('intent') } catch { return null }
      })()
      const intent = urlIntent || readPendingIntent()
      const redirectTo = intent
        ? `${window.location.origin}/agent/post-signup?next=${encodeURIComponent(intent)}`
        : `${window.location.origin}/agent/post-signup`

      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      })
      if (err) {
        const msg = err.message || ''
        if (err.code === 'user_already_exists' || err.status === 422 || /already (registered|exists|in use)/i.test(msg)) {
          setError('This email is already registered. Please log in instead.')
        } else {
          setError(msg)
        }
        setLoading(false)
        return
      }
      // When email confirmation is enabled, Supabase doesn't error on duplicate emails
      // (to prevent enumeration). Instead it returns a user with an empty identities array.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('This email is already registered. Please log in instead.')
        setLoading(false)
        return
      }
      setSuccess('Check your email to confirm your account, then log in.')
      setLoading(false)
      return
    }

    if (tab === 'login') {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) { setError('Incorrect email or password.'); setLoading(false); return }

      // Resume a pending subscription intent — no card at signup anymore, so a
      // pending "subscription" routes to onboarding to start the free trial (the
      // trial subscription is created server-side once onboarding completes).
      const pending = readPendingIntent()
      if (pending === 'subscription') {
        clearPendingIntent()
        navigate('/agent/onboarding')
        return
      }

      navigate('/agent/dashboard')
    }
  }

  async function handleForgot() {
    setError('')
    setSuccess('')
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/agent/reset-password`,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSuccess('If an account exists for this email, a reset link has been sent.')
  }

  async function handleGoogle() {
    setError('')
    setSuccess('')
    // Persist any pending Stripe checkout intent BEFORE redirecting, so it
    // survives the OAuth round-trip — same `postLoginCheckout` key
    // SubscribeButton/beginCheckout use, and the same one App.jsx's hash
    // handler reads on return to route a confirmed login to /agent/post-signup.
    const urlIntent = (() => {
      try { return new URLSearchParams(window.location.search).get('intent') } catch { return null }
    })()
    const intent = urlIntent || readPendingIntent()
    if (intent === 'subscription') {
      try { localStorage.setItem('postLoginCheckout', 'subscription') } catch {}
      try { sessionStorage.setItem('postLoginCheckout', 'subscription') } catch {}
    }

    setLoading(true)
    // Implicit flow: Supabase sends the user to Google and back to the site
    // origin with the session in the URL hash (#access_token=…). App.jsx's
    // existing on-mount hash handler is the return path — no callback route.
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    // On success the browser has already navigated to Google; we only get here
    // if the redirect could not be started.
    if (err) {
      setError(err.message || 'Could not start Google sign-in. Please try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div className="auth-card" style={{ width: '100%', maxWidth: 420 }}>

          {/* Logo */}
          <div onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 40, cursor: 'pointer', justifyContent: 'center' }}>
            <Logo size={22} />
            <span style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, fontSize: 20, color: C.text }}>Velyr</span>
            <span style={{ fontSize: 11, color: C.textLight, fontWeight: 300 }}>/ Growth Agent</span>
          </div>

          {/* Card */}
          <div className="auth-card-inner" style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: '36px 32px', boxShadow: '0 4px 32px rgba(28,25,23,0.07)' }}>

            {/* Tab switcher */}
            <div style={{ display: 'flex', background: 'rgba(28,25,23,0.05)', borderRadius: 10, padding: 4, marginBottom: 28 }}>
              {[{ key: 'login', label: 'Log in' }, { key: 'register', label: 'Create account' }].map(t => (
                <button key={t.key} onClick={() => { setTab(t.key); setError(''); setSuccess('') }} style={{
                  flex: 1, background: tab === t.key ? '#fff' : 'transparent',
                  border: 'none', borderRadius: 8, padding: '9px',
                  fontFamily: 'Jost, sans-serif', fontSize: 13,
                  fontWeight: tab === t.key ? 500 : 300,
                  color: tab === t.key ? C.text : C.textLight,
                  cursor: 'pointer', transition: 'all .2s',
                  boxShadow: tab === t.key ? '0 1px 6px rgba(28,25,23,0.1)' : 'none',
                }}>{t.label}</button>
              ))}
            </div>

            <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 26, letterSpacing: '-.015em', marginBottom: 6, color: C.text }}>
              {tab === 'login' ? 'Welcome back' : 'Get started'}
            </h2>
            <p style={{ fontSize: 14, color: C.textMuted, fontWeight: 300, marginBottom: 24, lineHeight: 1.6 }}>
              {tab === 'login'
                ? 'Log in to your Growth Agent dashboard.'
                : 'Create your account to start the Growth Agent.'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: C.textLight, fontWeight: 300, display: 'block', marginBottom: 6, letterSpacing: '.03em' }}>Email</label>
                <input
                  className="auth-inp"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, color: C.textLight, fontWeight: 300, letterSpacing: '.03em' }}>Password</label>
                  {tab === 'login' && (
                    <button
                      onClick={handleForgot}
                      disabled={loading}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: C.textLight, cursor: 'pointer', fontFamily: 'Jost, sans-serif', fontWeight: 300, padding: 0, transition: 'color .2s' }}
                      onMouseEnter={e => e.target.style.color = C.accent}
                      onMouseLeave={e => e.target.style.color = C.textLight}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  className="auth-inp"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              {error && (
                <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: C.red }}>
                  {error}
                </div>
              )}
              {success && (
                <div style={{ background: 'rgba(42,92,69,0.06)', border: '1px solid rgba(42,92,69,0.2)', borderRadius: 8, padding: '10px 13px', fontSize: 13, color: C.accent }}>
                  {success}
                </div>
              )}

              <div style={{ height: 4 }} />

              {tab === 'register' && (
                <p style={{ fontSize: 12, color: C.textLight, fontWeight: 300, lineHeight: 1.55, textAlign: 'center', marginBottom: 4 }}>
                  By creating an account you agree to our{' '}
                  <button
                    onClick={() => navigate('/agb')}
                    style={{ background: 'none', border: 'none', padding: 0, color: C.accent, fontSize: 12, fontFamily: 'Jost, sans-serif', fontWeight: 400, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)' }}
                  >Terms of Service</button>
                  {' '}and{' '}
                  <button
                    onClick={() => navigate('/privacy')}
                    style={{ background: 'none', border: 'none', padding: 0, color: C.accent, fontSize: 12, fontFamily: 'Jost, sans-serif', fontWeight: 400, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(42,92,69,0.35)' }}
                  >Privacy Policy</button>.
                </p>
              )}

              <button className="auth-btn" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Please wait…' : tab === 'login' ? 'Log in →' : 'Create account →'}
              </button>

              {/* OAuth — shared by both Log in and Create account tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 2px' }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ fontSize: 12, color: C.textLight, fontWeight: 300 }}>or</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <button className="auth-btn-google" onClick={handleGoogle} disabled={loading}>
                <GoogleIcon size={18} />
                Continue with Google
              </button>
            </div>
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: C.textLight, marginTop: 20, fontWeight: 300 }}>
            {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setTab(tab === 'login' ? 'register' : 'login'); setError(''); setSuccess('') }} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', fontFamily: 'Jost, sans-serif', fontWeight: 400 }}>
              {tab === 'login' ? 'Create one' : 'Log in'}
            </button>
          </p>

        </div>
      </div>

      {/* Legal footer (§5 TMG — Impressum must be reachable from every page) */}
      <div style={{ borderTop: '1px solid rgba(28,25,23,0.08)', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: C.bg }}>
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