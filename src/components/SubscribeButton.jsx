import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const LABELS = {
  subscription: 'Start free trial – €29/month after',
}

// Higher-level trial entry point used by CTAs. Handles the guest case:
// - subscription + no session → persist intent (localStorage primary, sessionStorage
//   fallback) and route to /agent/register?intent=subscription so the user can
//   sign up; the intent is later honoured by App.jsx's post-signup handler and
//   by AgentAuth after a manual login.
// - signed-in user → go straight to onboarding. There is NO card at signup
//   anymore: the subscription starts as a 14-day free trial created server-side
//   once onboarding (GitHub + Telegram) completes.
export async function beginCheckout(type, navigate) {
  const { data: { session } } = await supabase.auth.getSession()

  if (type === 'subscription' && !session?.user) {
    try { localStorage.setItem('postLoginCheckout', type) } catch {}
    try { sessionStorage.setItem('postLoginCheckout', type) } catch {}
    const target = `/agent/register?intent=${type}`
    if (navigate) navigate(target)
    else window.location.href = target
    return { redirected: true }
  }

  if (navigate) navigate('/agent/onboarding')
  else window.location.href = '/agent/onboarding'
  return { redirected: true }
}

export default function SubscribeButton({ type, style = {}, className = '', navigate }) {
  const [loading, setLoading] = useState(false)

  // Start the free trial immediately — no payment/consent modal here. Nothing is
  // charged at trial start (no card is collected); the recurring-charge consent
  // is shown at the actual payment step (the dashboard conversion flow once the
  // trial ends).
  const handleClick = async () => {
    if (loading) return
    setLoading(true)
    try {
      const result = await beginCheckout(type, navigate)
      if (!result?.redirected) setLoading(false)
    } catch (err) {
      console.error('Trial start error:', err)
      setLoading(false)
    }
  }

  const label = LABELS[type] || 'Buy Now'

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        className={className}
        style={{
          background: '#1c1917',
          color: '#f7f4ef',
          border: 'none',
          borderRadius: 10,
          padding: '14px 28px',
          fontFamily: 'Jost, sans-serif',
          fontWeight: 500,
          fontSize: 15,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          letterSpacing: '.02em',
          transition: 'background .2s, transform .15s',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          ...style,
        }}
      >
        {loading && (
          <span style={{
            width: 14,
            height: 14,
            border: '1.5px solid rgba(247,244,239,0.35)',
            borderTopColor: '#f7f4ef',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'spin 0.7s linear infinite',
          }} />
        )}
        {loading ? 'Redirecting…' : label}
      </button>
      <p style={{ fontSize: 11, color: '#a09890', fontWeight: 300, textAlign: 'center', marginTop: 6 }}>
        * 14-day free trial. Cancel anytime, no charge during trial. Endpreis gem. § 19 UStG — no VAT charged.
      </p>
    </>
  )
}
