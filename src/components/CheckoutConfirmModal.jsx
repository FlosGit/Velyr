import { useEffect, useState } from 'react'

// Pre-checkout confirmation modal. Required for EU consumer-law compliance:
//   - subscription (€49/mo):    Recurring-charge acknowledgment + §312j BGB summary
//
// The modal gates the existing Stripe-redirect flow. The hosting component
// keeps full control over the redirect — this only collects an explicit
// affirmative consent before that redirect fires.

const C = {
  bg:        '#f7f4ef',
  bgCard:    '#ffffff',
  text:      '#1c1917',
  textMuted: '#6b6460',
  textLight: '#a09890',
  border:    'rgba(28,25,23,0.12)',
  accent:    '#2a5c45',
}

export default function CheckoutConfirmModal({ type, open, onCancel, onConfirm, loading = false }) {
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!open) setChecked(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey) }
  }, [open, onCancel])

  if (!open) return null

  const title = 'Confirm your subscription'

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(28,25,23,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: 'Jost, sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bgCard, borderRadius: 16, padding: '28px 28px 24px',
          maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(28,25,23,0.18)',
          border: `1px solid ${C.border}`,
        }}
      >
        <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent, fontWeight: 500, marginBottom: 10 }}>
          Subscription summary
        </p>
        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 400, fontSize: 24, color: C.text, marginBottom: 18, letterSpacing: '-.015em' }}>
          {title}
        </h3>

        {/* Summary block */}
        <div style={{ background: 'rgba(42,92,69,0.04)', border: '1px solid rgba(42,92,69,0.15)', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
          <p style={{ fontSize: 14, color: C.text, fontWeight: 500, marginBottom: 4 }}>Growth Agent — €49 / month</p>
          <p style={{ fontSize: 13, color: C.textMuted, fontWeight: 300, lineHeight: 1.6 }}>
            Recurring monthly charge, billed in advance via Stripe. You can cancel anytime from your dashboard — cancellation takes effect at the end of the current billing period.
          </p>
          <p style={{ fontSize: 11, color: C.textLight, fontWeight: 300, marginTop: 6 }}>* Final price — as a small business under § 19 UStG, no VAT is charged</p>
        </div>

        {/* Consent checkbox */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, accentColor: C.accent }}
          />
          <span style={{ fontSize: 13, color: C.textMuted, fontWeight: 300, lineHeight: 1.55 }}>
            I understand this is a recurring monthly charge of €49 and agree to the Terms of Service.
          </span>
        </label>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              flex: '1 1 130px', background: 'transparent', color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '12px 18px', fontSize: 14, fontFamily: 'Jost, sans-serif',
              fontWeight: 400, cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '.02em', transition: 'all .15s',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { if (checked && !loading) onConfirm?.() }}
            disabled={!checked || loading}
            style={{
              flex: '2 1 200px', background: checked ? C.accent : 'rgba(28,25,23,0.12)',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '12px 18px', fontSize: 14, fontFamily: 'Jost, sans-serif',
              fontWeight: 500, cursor: (checked && !loading) ? 'pointer' : 'not-allowed',
              letterSpacing: '.02em', transition: 'all .15s',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Opening Stripe…' : 'Proceed to payment →'}
          </button>
        </div>
      </div>
    </div>
  )
}
