import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { startCheckout } from '../utils/startCheckout.js'
import CheckoutConfirmModal from './CheckoutConfirmModal.jsx'

const LABELS = {
  subscription: 'Subscribe – €29/month',
}

// Higher-level checkout entry point used by CTAs. Handles the guest case:
// - subscription + no session → persist intent (localStorage primary, sessionStorage
//   fallback) and route to /agent/register?intent=subscription so the user can
//   sign up; the intent is later honoured by App.jsx's post-signup handler and
//   by AgentAuth after a manual login.
// - signed-in user → call the shared startCheckout util, which POSTs to
//   /api/stripe and redirects to the Stripe Checkout URL.
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

  return startCheckout(type, session?.user?.id || null, session?.user?.email || null)
}

export default function SubscribeButton({ type, style = {}, className = '', navigate }) {
  const [loading, setLoading] = useState(false)
  // Pre-checkout consent gate (recurring-charge acknowledgment for the
  // subscription). Existing checkout logic below is unchanged — it only runs
  // after the user actively confirms.
  const [confirmOpen, setConfirmOpen] = useState(false)

  const startActualCheckout = async () => {
    if (loading) return
    setLoading(true)
    try {
      const result = await beginCheckout(type, navigate)
      if (!result?.redirected) setLoading(false)
    } catch (err) {
      console.error('Checkout error:', err)
      setLoading(false)
    }
  }

  const handleClick = () => {
    if (loading) return
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    setConfirmOpen(false)
    await startActualCheckout()
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
        * Endpreis gem. § 19 UStG — no VAT charged
      </p>

      <CheckoutConfirmModal
        type={type}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        loading={loading}
      />
    </>
  )
}
