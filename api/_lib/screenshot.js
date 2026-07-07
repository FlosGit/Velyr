// ─── ScreenshotOne capture → Supabase Storage public URL ─────────────────────
// Extracted verbatim from api/agent/run.js (C4 needs it in the Telegram webhook
// too). Returns a durable public URL in the 'screenshots' bucket, or null on any
// failure — callers treat a screenshot as strictly best-effort.
// `_`-prefixed dir ⇒ not a Vercel route (no function-cap cost).

import crypto from 'node:crypto'

export async function captureScreenshot(supabase, url) {
  const apiKey = process.env.SCREENSHOTONE_API_KEY
  if (!apiKey || !url) return null
  try {
    const params = new URLSearchParams({
      access_key: apiKey, url, viewport_width: '1280', viewport_height: '800',
      // No block_ads/block_cookie_banners: ScreenshotOne's ad-blocker blocks
      // analytics endpoints (e.g. PostHog), which throws during a customer
      // SPA's boot and leaves the page blank — only the CSS background paints.
      // cache 'false' (not 'true' + cache_ttl): an early broken run cached a solid
      // black frame under the shared cache-key, and every later run was served that
      // stale image with NO error. Render fresh every time so it can't recur.
      device_scale_factor: '1', format: 'png', cache: 'false',
      // No wait_for_selector / error_on_selector_not_found: '#root > *' never
      // matched in ScreenshotOne's headless and caused FALSE timeouts even though
      // the page renders perfectly (proven by a manual load + delay + no-selector
      // capture). wait_until 'load' settles fast — the SPA's persistent PostHog +
      // Google Fonts sockets don't block the load event the way they stalled
      // networkidle — then a fixed delay (8s) lets React paint after mount.
      wait_until: 'load', delay: '8',
      // Budgets in seconds: navigation_timeout 20 (page load), timeout 30 (overall,
      // <=90). Comfortable now that no selector wait burns the budget.
      navigation_timeout: '20', timeout: '30',
      // NO response_type=json: that returns a cache_url REFERENCE to a CDN cache
      // object (stale/empty with cache=false → the black frame), not the render.
      // Omitting it (default by_format) makes /take stream the freshly-rendered
      // PNG bytes — the exact path the manual call proved correct — hosted below.
    })
    // Abort exceeds ScreenshotOne's `timeout` (30s) — 35s — so the fetch can't cut
    // off a capture that's still finishing. On failure captureScreenshot returns
    // null and the caller continues (non-blocking).
    const res = await fetch(`https://api.screenshotone.com/take?${params}`, { signal: AbortSignal.timeout(35000) })
    if (!res.ok) {
      // Surface the real cause (e.g. request_not_valid + error_details) instead
      // of swallowing the 400 — see ScreenshotOne error response body.
      const body = await res.text()
      console.error('ScreenshotOne failed', res.status, body)
      return null
    }
    // Live PNG bytes (not a cache reference) → upload to Supabase Storage and
    // return a durable public URL. Requires a PUBLIC bucket named 'screenshots'.
    // Service-role key bypasses storage RLS; a unique key per run rules out any
    // stale CDN/cache collision.
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = `${crypto.randomUUID()}.png`
    const { error: upErr } = await supabase.storage.from('screenshots')
      .upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (upErr) { console.error('Screenshot upload failed', upErr.message); return null }
    return supabase.storage.from('screenshots').getPublicUrl(path).data?.publicUrl || null
  } catch { return null }
}
