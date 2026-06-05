// Bing/Yandex IndexNow submitter. POSTs a batch of URLs to the IndexNow API so
// participating search engines re-crawl them immediately instead of waiting for
// the next sitemap sweep. The key is published as a flat file at
// /db20abff66ce473f8ff4aa472a842fbf.txt (public/), which is how IndexNow proves
// ownership of velyr.io.
//
// Uses the shared global fetch (works in the browser and Node 18+). Resolves
// with the Response so callers can inspect res.status; resolves with null when
// there are no URLs to submit. Rejects only on a network-level failure.

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const INDEXNOW_KEY = 'db20abff66ce473f8ff4aa472a842fbf'
const HOST = 'velyr.io'

export async function submitToIndexNow(urls) {
  const urlList = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (!urlList.length) return null

  return fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
  })
}
