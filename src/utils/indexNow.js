// Bing/Yandex IndexNow submitter. POSTs a batch of URLs to the IndexNow API so
// participating search engines re-crawl them immediately instead of waiting for
// the next sitemap sweep.
//
// The key is PUBLIC by design: it is published as a flat file at
// /<key>.txt (public/), and fetching that file is how IndexNow proves we own
// velyr.io. That is why this module may live in src/ — there is no secret here.
// Contrast scripts/lib/bing-url-submission.mjs, whose Bing Webmaster Tools
// apikey IS a secret and therefore must never sit under src/.
//
// **Key rotated 2026-08-04.** The previous key (a8425d52b07f44328eb7ad62c553a65a)
// began returning HTTP 403 UserForbiddedToAccessSite on every submission, to
// both api.indexnow.org and www.bing.com/indexnow, which is why Bing Webmaster
// Tools kept reporting IndexNow as "not set up". The old key file is
// deliberately LEFT IN PLACE in public/ — IndexNow permits multiple hosted keys,
// and removing it could invalidate anything still in flight. Only the key used
// for new submissions changed.
//
// **Gotcha:** a 202 means "accepted, key validation pending", NOT "verified".
// Bing fetches keyLocation asynchronously afterwards, so the key file must
// already be live at the origin. On a brand-new key the very first submission
// of a deploy can therefore race the deploy that publishes the key file; every
// later deploy is fine because the file is already live by then.
//
// Uses the shared global fetch (works in the browser and Node 18+). Resolves
// with a structured result and NEVER rejects, so a caller can log the outcome
// without wrapping it. Resolves with null when there are no URLs to submit.

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const INDEXNOW_KEY = '921a567509fb4860b02512bdf3270a4f'
const HOST = 'velyr.io'
const TIMEOUT_MS = 10_000

// Documented IndexNow response codes, mapped to something a deploy log can be
// read at a glance. Anything unlisted falls through to the raw status.
const STATUS_MEANING = {
  200: 'ok — urls submitted',
  202: 'accepted — key validation pending',
  400: 'bad request — invalid format',
  403: 'forbidden — key not valid for this host (check the key file)',
  422: 'unprocessable — urls not under this host, or key mismatch',
  429: 'rate limited — too many requests',
}

export async function submitToIndexNow(urls) {
  const urlList = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (!urlList.length) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
    })

    // Error bodies carry the actual reason (e.g. UserForbiddedToAccessSite).
    // Read it on failure only: a success body is empty and not worth a round-trip.
    let detail = ''
    if (!res.ok) {
      detail = await res.text().catch(() => '')
    }

    return {
      ok: res.ok,
      status: res.status,
      meaning: STATUS_MEANING[res.status] || `unexpected status ${res.status}`,
      submitted: res.ok ? urlList.length : 0,
      detail: detail.slice(0, 300),
    }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      meaning: aborted ? 'timeout' : 'network error',
      submitted: 0,
      detail: String(err?.message || '').slice(0, 300),
    }
  } finally {
    clearTimeout(timer)
  }
}
