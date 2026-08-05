// Bing Webmaster Tools "Adaptive URL submission" API.
//
// This is NOT IndexNow. Two separate channels that both happen to notify Bing:
//
//   src/utils/indexNow.js — the open IndexNow protocol. Its key is PUBLIC by
//     design (served at /a8425d52….txt, which is how it proves ownership of
//     velyr.io) and needs no account. Notifies Bing AND Yandex.
//
//   this module — authenticated against the velyr.io property in Bing Webmaster
//     Tools. Its apikey is a REAL SECRET: it can read and write that property's
//     Webmaster data. It therefore lives ONLY in BING_WEBMASTER_API_KEY, is
//     never committed, and is redacted from every log line and error message.
//
// **Gotcha:** this file deliberately sits in scripts/lib/ and not src/. Anything
// under src/ is reachable by Vite's client bundler, and a module that reads a
// secret must not be. indexNow.js can live in src/ precisely because its key is
// public; this one cannot.
//
// **Quota:** Bing meters this per site per day, and a freshly verified property
// can start near 10/day (it scales with verified age and other site signals).
// So every run reads GetUrlSubmissionQuota FIRST and submits at most that many
// URLs. Callers pass URLs newest-first, so a small quota spends itself on new
// content instead of re-submitting two-month-old articles every deploy.
//
// Bing's own guidance is that IndexNow is the preferred channel. Treat this as
// a supplement: it is wired to fail silently and can never break a deploy.
//
// API shapes verified 2026-08-04 against Bing's official cURL walkthrough:
//   https://blogs.bing.com/webmaster/november-2019/Accessing-Bing-webmaster-tools-api-using-cURL
//   POST /json/SubmitUrlBatch?apikey=…   body {siteUrl, urlList}  -> {"d":null}
//   GET  /json/GetUrlSubmissionQuota?siteUrl=…&apikey=…
//        -> {"d":{"DailyQuota":973,"MonthlyQuota":10973}}

import { pathToFileURL } from 'node:url'

const API_BASE = 'https://ssl.bing.com/webmaster/api.svc/json'
const DEFAULT_SITE_URL = 'https://velyr.io'
const MAX_BATCH = 500 // Bing's documented per-call maximum
const TIMEOUT_MS = 10_000

const envKey = () => process.env.BING_WEBMASTER_API_KEY || ''
const envSite = () => process.env.BING_SITE_URL || DEFAULT_SITE_URL

// Strip the apikey out of anything we are about to print. Every error path runs
// through this, because Bing echoes the request URL in some fault bodies.
function redact(text, key) {
  const s = String(text ?? '')
  return key ? s.split(key).join('***') : s
}

function endpoint(op, key, params = {}) {
  const url = new URL(`${API_BASE}/${op}`)
  url.searchParams.set('apikey', key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url
}

// One HTTP round-trip. Never throws: returns a tagged result so the build can
// keep going no matter what Bing does. Never includes the key in its output.
async function callBing(op, key, { method = 'GET', params = {}, body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(endpoint(op, key, params), {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        reason: 'http_error',
        status: res.status,
        message: redact(text, key).slice(0, 300),
      }
    }
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // A 200 with a non-JSON body: treat as success, let the caller decide.
    }
    return { ok: true, status: res.status, json }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return {
      ok: false,
      reason: aborted ? 'timeout' : 'network_error',
      message: redact(err?.message, key),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Remaining URL-submission allowance for the site.
 * -> { ok:true, dailyQuota, monthlyQuota } | { ok:false, reason, status?, message? }
 */
export async function getUrlSubmissionQuota({ key = envKey(), siteUrl = envSite() } = {}) {
  if (!key) return { ok: false, reason: 'no_api_key' }

  const res = await callBing('GetUrlSubmissionQuota', key, { params: { siteUrl } })
  if (!res.ok) return res

  const d = res.json?.d
  if (!d || typeof d.DailyQuota !== 'number') {
    return { ok: false, reason: 'unexpected_response' }
  }
  return {
    ok: true,
    dailyQuota: d.DailyQuota,
    monthlyQuota: typeof d.MonthlyQuota === 'number' ? d.MonthlyQuota : null,
  }
}

/**
 * Raw batch submit. Does NOT check quota — use submitToBing() for that.
 * Caller must keep the batch at or under MAX_BATCH.
 */
export async function submitUrlBatch(urls, { key = envKey(), siteUrl = envSite() } = {}) {
  if (!key) return { ok: false, reason: 'no_api_key', submitted: 0 }

  const urlList = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))]
  if (!urlList.length) return { ok: true, submitted: 0 }
  if (urlList.length > MAX_BATCH) {
    return { ok: false, reason: 'batch_too_large', submitted: 0, max: MAX_BATCH }
  }

  const res = await callBing('SubmitUrlBatch', key, { method: 'POST', body: { siteUrl, urlList } })
  if (!res.ok) return { ...res, submitted: 0 }
  return { ok: true, submitted: urlList.length }
}

/**
 * Quota-aware submit. This is what the build calls.
 *
 * Pass URLs newest-first: when the daily quota is smaller than the list, the
 * head of the list is what gets through.
 *
 * Fails CLOSED on a quota-read failure. A failed quota read is nearly always a
 * bad key or an unverified site, in which case the submit would fail too — and
 * IndexNow has already notified Bing about these exact URLs, so skipping costs
 * nothing while spraying failed submits costs log noise and possibly quota.
 */
export async function submitToBing(urls, { key = envKey(), siteUrl = envSite() } = {}) {
  const urlList = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))]

  if (!key) return { ok: false, reason: 'no_api_key', submitted: 0, skipped: urlList.length }
  if (!urlList.length) return { ok: true, submitted: 0, skipped: 0 }

  const quota = await getUrlSubmissionQuota({ key, siteUrl })
  if (!quota.ok) {
    return {
      ok: false,
      reason: `quota_${quota.reason}`,
      status: quota.status,
      message: quota.message,
      submitted: 0,
      skipped: urlList.length,
    }
  }

  const budget = Math.min(quota.dailyQuota, MAX_BATCH, urlList.length)
  if (budget <= 0) {
    return {
      ok: true,
      reason: 'quota_exhausted',
      submitted: 0,
      skipped: urlList.length,
      dailyQuota: quota.dailyQuota,
    }
  }

  const batch = urlList.slice(0, budget)
  const sent = await submitUrlBatch(batch, { key, siteUrl })
  if (!sent.ok) return { ...sent, submitted: 0, skipped: urlList.length }

  return {
    ok: true,
    submitted: batch.length,
    skipped: urlList.length - batch.length,
    dailyQuotaBefore: quota.dailyQuota,
  }
}

// ── CLI harness ─────────────────────────────────────────────────────────────
// Verify the key without running a full build (which would ping production):
//   node scripts/lib/bing-url-submission.mjs --quota
//   node scripts/lib/bing-url-submission.mjs --submit https://velyr.io/blog
// Reads BING_WEBMASTER_API_KEY from the environment; never prints it.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const args = process.argv.slice(2)
  const siteUrl = envSite()

  if (!envKey()) {
    console.error('BING_WEBMASTER_API_KEY is not set. Try:')
    console.error('  BING_WEBMASTER_API_KEY=… node scripts/lib/bing-url-submission.mjs --quota')
    process.exit(1)
  }

  const submitAt = args.indexOf('--submit')
  if (submitAt !== -1) {
    const urls = args.slice(submitAt + 1).filter((a) => !a.startsWith('--'))
    if (!urls.length) {
      console.error('--submit needs at least one URL')
      process.exit(1)
    }
    const res = await submitToBing(urls, { siteUrl })
    console.log(`site: ${siteUrl}`)
    console.log(res.ok ? `submitted ${res.submitted}, skipped ${res.skipped}` : `FAILED: ${JSON.stringify(res)}`)
    process.exit(res.ok ? 0 : 1)
  }

  const q = await getUrlSubmissionQuota({ siteUrl })
  console.log(`site: ${siteUrl}`)
  if (q.ok) {
    console.log(`daily quota remaining:   ${q.dailyQuota}`)
    console.log(`monthly quota remaining: ${q.monthlyQuota ?? 'n/a'}`)
  } else {
    console.error(`quota read FAILED: ${JSON.stringify(q)}`)
    process.exit(1)
  }
}
