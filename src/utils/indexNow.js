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
// **Key rotated twice on 2026-08-04.** Root cause, in order of discovery:
//
//   1. Every submission returned 403 UserForbiddedToAccessSite, silently, on
//      both api.indexnow.org and www.bing.com/indexnow — which is why Bing
//      Webmaster Tools kept reporting IndexNow as "not set up".
//   2. Not a key-file problem: the file served 200 text/plain with the correct
//      content, readable by a bingbot user-agent. Not a host-variant problem
//      either: velyr.io and www.velyr.io both 403'd.
//   3. Real cause: the Bing property had been imported from Google Search
//      Console, so Bing never established native ownership. Fixed by removing
//      the property and re-adding it with the msvalidate.01 meta tag in
//      index.html — keep that tag permanently.
//   4. Verification alone did NOT clear it. Keys Bing had already evaluated
//      during the unverified period stayed permanently 403, while a
//      never-before-seen key still got a provisional 202. The failed verdict is
//      cached PER KEY, so recovery needs a key Bing has never evaluated.
//
// Hence this third key. Superseded keys (a8425d52…, 921a5675…) are burned and
// will always 403; their files stay in public/ because IndexNow permits
// multiple hosted keys and removing them gains nothing.
//
// **Gotcha — the ordering rule that burned key #2:** a 202 means "accepted, key
// validation pending", NOT "verified". Bing fetches keyLocation asynchronously
// afterwards, and if the file isn't live yet it serves the SPA's index.html
// (200 text/html, not the key), so the key fails validation and is burned for
// good. NEVER submit a new key before its file is deployed and returning
// text/plain. Rotating a key is therefore always: add file -> deploy -> verify
// the file -> only then submit.
//
// Uses the shared global fetch (works in the browser and Node 18+). Resolves
// with a structured result and NEVER rejects, so a caller can log the outcome
// without wrapping it. Resolves with null when there are no URLs to submit.

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const INDEXNOW_KEY = '380c9dfd5859776e64c5dd0de1c943c8'
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

// Preflight: confirm the key file is actually live and serving the key before
// we let Bing see the key at all.
//
// This exists because of the failure above: a submission whose keyLocation is
// not yet deployed gets served the SPA's index.html (200 text/html), Bing marks
// the key invalid, and that key is burned permanently. The Vercel build runs
// prerender BEFORE the deploy goes live, so the very build that publishes a new
// key file would otherwise be the thing that destroys the key. Skipping one
// deploy's submission costs nothing; burning a key costs a rotation.
async function keyFileIsLive(keyUrl, key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(keyUrl, { signal: controller.signal })
    if (!res.ok) return { live: false, reason: `key file returned HTTP ${res.status}` }

    const body = (await res.text()).trim()
    if (body !== key) {
      const ct = res.headers.get('content-type') || ''
      return {
        live: false,
        reason: ct.includes('text/html')
          ? 'key file served the SPA shell, not the key (not deployed yet)'
          : 'key file content does not match the key',
      }
    }
    return { live: true }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return { live: false, reason: aborted ? 'key file check timed out' : `key file unreachable: ${err?.message}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function submitToIndexNow(urls) {
  const urlList = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (!urlList.length) return null

  const keyLocation = `https://${HOST}/${INDEXNOW_KEY}.txt`
  const preflight = await keyFileIsLive(keyLocation, INDEXNOW_KEY)
  if (!preflight.live) {
    return {
      ok: false,
      status: 0,
      meaning: `skipped to protect the key — ${preflight.reason}`,
      submitted: 0,
      detail: 'Submitting now would let Bing fail the key permanently. It will submit on the next build once the file is live.',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation, urlList }),
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
