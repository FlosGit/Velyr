// Shared Stripe Checkout starter.
//
// Pure primitive: POST to /api/stripe?action=checkout and, on success, redirect
// the browser to the Checkout session URL. Returns { redirected, error }.
//
// Callers pass the Supabase session access token. The server derives the user
// (id + email) from the verified JWT — A14: userId/userEmail are no longer trusted
// from the request body. The subscription checkout always requires an authenticated
// user; the server rejects the call (401) without a valid token.
export async function startCheckout(type, accessToken = null) {
  try {
    const res = await fetch('/api/stripe?action=checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ type }),
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
