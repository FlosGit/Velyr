// Shared Stripe Checkout starter.
//
// Pure primitive: POST to /api/stripe?action=checkout and, on success, redirect
// the browser to the Checkout session URL. Returns { redirected, error }.
//
// Callers are responsible for resolving any Supabase session and passing
// userId/userEmail. The subscription checkout always requires an authenticated
// user (userId); the server rejects the call without one.
export async function startCheckout(type, userId = null, userEmail = null) {
  try {
    const body = { type }
    if (userId)    body.userId    = userId
    if (userEmail) body.userEmail = userEmail

    const res = await fetch('/api/stripe?action=checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok && data?.url) {
      window.location.href = data.url
      return { redirected: true }
    }

    console.error('Checkout error:', data?.error || `http ${res.status}`)
    return { redirected: false, error: data?.error || 'checkout failed' }
  } catch (err) {
    console.error('Checkout error:', err)
    return { redirected: false, error: err?.message || 'network error' }
  }
}
