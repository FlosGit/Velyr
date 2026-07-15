import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import { throttling } from '@octokit/plugin-throttling'
import crypto from 'node:crypto'
import { decryptSecret } from '../_lib/secret-crypto.js'
import { resolveAffectedScope, sessionize, bounceFromSessions } from '../_lib/route-scope.js'
import { reconcileDeployed, reconcileRejected, closeRejectedPr } from '../_lib/run-reconcile.js'
import { startFollowupRun } from '../_lib/edge-dispatch.js'
import { applyShopifyDirectWrite, executeShopifyDirectRollback, rejectShopifyDirect } from '../_lib/shopify-approval.js'
import { buildWinBadgeSvg, buildWinCardSvg } from '../_lib/win-card.js'
import { buildBadgeBlock, decideBadgeInjection, BADGE_TARGETS } from '../_lib/badge-install.js'
import { readThemeFile, upsertThemeFiles } from '../_lib/shopify-theme-io.js'
import { refreshShopifyToken } from '../_lib/shopify-token-refresh.js'
import { captureScreenshot as captureScreenshotShared } from '../_lib/screenshot.js'
import { logAndSend, setupReminderEmail, tipsEmail, digestEmail, emailConfigured, verifyUnsubscribeToken, isoWeekKey } from '../_lib/email.js'

// Local wrapper keeps the historical one-arg call shape in this file.
const captureScreenshot = (url) => captureScreenshotShared(supabase, url)

// Strip Telegram-HTML tags/entities from a shared-executor message so the dashboard
// (which renders the result as plain text, not HTML) shows it cleanly. Decode &amp; last.
function stripHtml(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

// Stage 5.D: Octokit with automatic GitHub rate-limit / secondary-rate-limit
// backoff (honors Retry-After). Mirrors the Edge Function.
const ThrottledOctokit = Octokit.plugin(throttling)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Stage 5.5: this file had no maxDuration, so the quick cron modes
// (evaluate_ab / midweek / rollback_check / weekly_summary) ran under
// Vercel's default 10s limit and could be killed mid-loop over subscribers —
// leaving A/B tests half-evaluated or rollbacks half-applied. Pin to the
// Hobby-plan ceiling (60s). This is correct for the current low subscriber
// count; the modes loop over ALL active subscriptions doing PostHog queries
// (+ occasional GitHub PRs in rollback_check), so once subscriber count grows
// past what fits in 60s these should be delegated to the Supabase Edge
// Function (same fire-and-forget pattern as the full Monday run) or paginated
// with self-invocation. Flagged in the Stage 5 summary.
export const config = { maxDuration: 60 }

// ─── TELEGRAM HTML ESCAPING ──────────────────────────────────────────────────
// Cross-runtime twin of escapeHtml() in supabase/functions/agent-run/index.ts
// and api/webhooks/telegram.js. Node (api/) and Deno (supabase/functions/)
// can't share a module — same boundary as the ROLLBACK_BOUNCE_PP_THRESHOLD /
// fileToRoutePath twins. Keep in sync. Telegram messages that interpolate
// uncontrolled values (LLM `problem` text, page paths, error strings) are sent
// as parse_mode: 'HTML' with every interpolated value run through this; legacy
// Markdown has no reliable escape for a stray * _ [ or ` and breaks the send.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')   // A18: align with the telegram.js + edge escapeHtml twins
}

// Status groups spanning BOTH the GitHub and Shopify-direct run lifecycles. A
// Shopify-direct run never reaches plain 'deployed'/'rolled_back'/'rejected'/
// 'waiting_approval' (it lives in shopify_*), so any status filter that must cover both
// connection types uses these instead of a bare string compare. (Bugs A9, A12.)
const DEPLOYED_STATUSES    = ['deployed', 'shopify_deployed']
const ROLLED_BACK_STATUSES = ['rolled_back', 'shopify_rolled_back']
const REJECTED_STATUSES    = ['rejected', 'shopify_rejected']
const AWAITING_STATUSES    = ['waiting_approval', 'shopify_awaiting_approval', 'shopify_rollback_pending']

// B5: bounded-concurrency map. The report modes (midweek / weekly_summary) loop over
// every subscriber doing ~6 PostHog queries each; serial iteration hits Vercel's 60s
// wall well before the customer count justifies delegating to the edge function. A pool
// of `concurrency` cuts wall time ~Nx. Each worker owns its own try/catch, so one
// failure never aborts the batch.
async function runPool(items, concurrency, worker) {
  const queue = [...(items || [])]
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift())
  })
  await Promise.all(runners)
}

// C1: inline approval keyboard. callback_data carries the exact run id so a button tap
// resolves the precise run (the webhook's callback_query handler routes it to handleApprove
// /handleReject, which authorize it against the chat's subs). `variant` picks labels: 'fix'
// (apply/skip a proposed change) or 'rollback' (undo/keep). Plain text YES/NO still works.
function approvalKeyboard(runId, variant = 'fix') {
  const [yes, no] = variant === 'rollback'
    ? ['↩️ Roll back', '✅ Keep it']
    : ['✅ Apply', '❌ Skip']
  return { inline_keyboard: [[
    { text: yes, callback_data: `approve:${runId}` },
    { text: no,  callback_data: `reject:${runId}` },
  ]] }
}

// Constant-time string equality for shared-secret comparisons.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// posthog_host_filter is the customer's domain (window.location.host: hostname
// with an optional :port). It's interpolated into HogQL `where` clauses as a
// single-quoted literal. A tight hostname allowlist makes injection structurally
// impossible (rejects quotes, spaces, HogQL syntax) on top of the single-quote
// escaping at each call site. Anything that isn't a plain host is treated like a
// missing host — the query is skipped, never run against the whole shared project.
function isValidHostFilter(host) {
  return typeof host === 'string' && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)
}

// ─── SECRET ENCRYPTION (Stage 4.1; Stage 1D: extracted) ──────────────────────
// decryptSecret is imported from ../_lib/secret-crypto.js (shared with
// onboarding.js's encryptSecret writer). The local encryptSecret was dead here
// — only decryptSecret is read in this file. See the lib for the enc:v1:
// wire-format contract and the Deno-copy sync note.

// Stage 4.4: fetch the repo's actual default branch instead of hard-coding
// 'main'. Falls back to 'main' only if the API call fails.
async function getDefaultBranch(octokit, owner, repo) {
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo })
    return data?.default_branch || 'main'
  } catch (err) {
    console.warn(`[default-branch] repos.get failed for ${owner}/${repo}, falling back to 'main':`, err?.message)
    return 'main'
  }
}

// Cron authorization. Accepts EITHER:
//   • `x-cron-secret: $AGENT_CRON_SECRET`  — for external schedulers (Upstash
//     QStash, GitHub Actions, Trigger.dev, manual curl). Header is arbitrary
//     so cannot be set by a public caller against Vercel's edge.
//   • `Authorization: Bearer $CRON_SECRET` — Vercel's native cron pattern: when
//     the `CRON_SECRET` env var is set on the project, Vercel automatically
//     attaches this header to cron-platform invocations and never to public
//     traffic. See https://vercel.com/docs/cron-jobs/manage-cron-jobs.
//
// Both compares are constant-time. At least one of the two env vars must be
// configured or the endpoint refuses all callers (500). Returns
// { ok: true } on success or { ok: false, status, error } otherwise.
function authorizeCron(req) {
  const agentSecret  = process.env.AGENT_CRON_SECRET
  const vercelSecret = process.env.CRON_SECRET
  if (!agentSecret && !vercelSecret) {
    console.error('[agent/run] Neither AGENT_CRON_SECRET nor CRON_SECRET configured — refusing request')
    return { ok: false, status: 500, error: 'Server misconfigured' }
  }
  const xCron = req.headers['x-cron-secret']
  if (xCron && agentSecret && safeEqual(String(xCron), agentSecret)) {
    return { ok: true }
  }
  const authHeader = req.headers['authorization']
  if (authHeader && vercelSecret) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader)
    if (m && safeEqual(m[1], vercelSecret)) {
      return { ok: true }
    }
  }
  return { ok: false, status: 401, error: 'Unauthorized' }
}

// ─── SHARED HELPERS (used by rollback flow) ───────────────────────────────────
// captureScreenshot moved to api/_lib/screenshot.js (C4: the Telegram webhook's
// preview button needs the identical capture → storage pipeline).

// B6: fetch an EventsQuery window's rows, paginated past the per-request row cap.
// Returns { rows, complete } — complete=false means maxPages full pages came back
// and a residual tail was left behind (callers log it; the sample is still 5×
// the old single-page cap). Any HTTP/parse failure ends pagination with what we
// have so far — same failure surface as the old single fetch.
async function fetchWindowRows(host, projectId, headers, baseQuery, maxPages = 5) {
  const PAGE = 2000
  const rows = []
  for (let page = 0; page < maxPages; page++) {
    let batch = []
    try {
      const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
        method: 'POST', headers,
        body: JSON.stringify({ query: { ...baseQuery, limit: PAGE, offset: page * PAGE } }),
      })
      const json = await res.json()
      batch = json?.results || []
    } catch (err) {
      console.warn(`[fetchWindowRows] page ${page} failed: ${err?.message} — continuing with ${rows.length} rows`)
      return { rows, complete: false }
    }
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, complete: true }
  }
  return { rows, complete: false }
}

// (recordDNA removed — DNA is now written only at approval time: reconcileDeployed
// for GitHub, applyShopifyDirectWrite for Shopify-direct. The 48h rollback check
// only measures; it never inserts DNA. See handleRollbackCheck.)

// A pending DNA entry earns 'measured_win' only when the run's matched-window
// bounce measurement (impact_metrics, deploy±2d, ≥100 sessions/side) improved
// by at least this many percentage points. Matches the positive-notification
// band in handleRollbackCheck (bounceDelta <= -5).
const MEASURED_WIN_MIN_PP = 5

// Promote 7-day-old 'pending' DNA entries to their honest terminal outcome:
// 'measured_win' when a matched-window measurement shows a real improvement,
// else 'survived' (still deployed, nothing measurably better). The old single
// 'success' label conflated the two — "didn't break anything" was fed back
// into the agent's prompt as "what works", rewarding innocuous edits.
async function promotePendingDNA() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: pending } = await supabase
    .from('agent_business_dna').select('id, run_id, fix_type, notes')
    .eq('outcome', 'pending').lte('created_at', sevenDaysAgo)
  if (!pending?.length) return
  const runIds = [...new Set(pending.map(p => p.run_id).filter(Boolean))]
  if (!runIds.length) return
  const [{ data: runsData }, { data: metrics }] = await Promise.all([
    supabase.from('agent_runs').select('id, status').in('id', runIds),
    supabase.from('impact_metrics')
      .select('run_id, metric_type, value_before, value_after, measured_at')
      .in('run_id', runIds)
      .in('metric_type', ['site_wide_bounce_rate', 'route_scoped_bounce_rate', 'bounce_rate'])
      .order('measured_at', { ascending: false }),
  ])
  const statusById  = new Map((runsData || []).map(r => [r.id, r.status]))
  const metricByRun = new Map()
  for (const m of (metrics || [])) if (!metricByRun.has(m.run_id)) metricByRun.set(m.run_id, m)

  for (const p of pending) {
    if (!p.run_id) continue
    const status = statusById.get(p.run_id)
    // shopify_deployed included: the old 'deployed'-only check silently left
    // every Shopify-direct entry pending forever.
    if (status !== 'deployed' && status !== 'shopify_deployed') continue
    const m = metricByRun.get(p.run_id)
    const improvementPp = (m && m.value_before != null && m.value_after != null)
      ? m.value_before - m.value_after : null
    const isWin   = improvementPp != null && improvementPp >= MEASURED_WIN_MIN_PP
    const outcome = isWin ? 'measured_win' : 'survived'
    const verdict = isWin
      ? ` | 7d verdict: measured win — bounce −${Math.round(improvementPp)}pp (${m.metric_type === 'route_scoped_bounce_rate' ? 'affected pages' : 'site-wide'}, deploy±2d)`
      : improvementPp != null
        ? ` | 7d verdict: survived — bounce ${improvementPp >= 0 ? '−' : '+'}${Math.abs(Math.round(improvementPp))}pp, under the ${MEASURED_WIN_MIN_PP}pp win bar`
        : ' | 7d verdict: survived — impact unmeasured'
    await supabase.from('agent_business_dna')
      .update({ outcome, notes: `${p.notes || ''}${verdict}`.slice(0, 500) })
      .eq('id', p.id)
  }
}

// Folded from api/agent/enforce-subscriptions.js (FOLD stage): the daily sweep
// that cancels subscriptions past their period end and GCs the Telegram dedupe
// table. Logic unchanged; it reuses this file's `supabase` client (same project
// + service-role key as the original) and runs under this file's cron auth, so
// the standalone authorizeCron from the old file is no longer needed.
// A19: delete rows older than `days` EXCEPT each group's newest row — that row is the
// group's live baseline (competitor diff base / dashboard site-network render) and must
// survive a subscription being paused longer than the window; a flat cutoff delete
// would silently drop it. Conservative by construction: any select error → no delete;
// a truncated freshness page only means we KEEP more newest-old rows than needed.
// Bounded pages per daily run — successive crons drain any backlog.
async function gcKeepNewestPerGroup(supabase, { table, timeCol, groupCols, label, days = 90, pageSize = 500 }) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const { data: oldRows, error: oldErr } = await supabase
      .from(table).select(['id', timeCol, ...groupCols].join(', '))
      .lt(timeCol, cutoff)
      .order(timeCol, { ascending: false })
      .limit(pageSize)
    if (oldErr) {
      if (oldErr.code !== '42P01') console.warn(`[enforce-subscriptions] ${label} GC select failed:`, oldErr.message)
      return
    }
    if (!oldRows?.length) return

    // Groups that have at least one row INSIDE the window keep their baseline there —
    // all their old rows are deletable, including the newest old one.
    const groupKey = r => groupCols.map(c => r[c]).join('|')
    const { data: freshRows, error: freshErr } = await supabase
      .from(table).select(groupCols.join(', ')).gte(timeCol, cutoff).limit(2000)
    if (freshErr) {
      if (freshErr.code !== '42P01') console.warn(`[enforce-subscriptions] ${label} GC freshness check failed:`, freshErr.message)
      return
    }
    const freshGroups = new Set((freshRows || []).map(groupKey))

    const seenNewestOld = new Set()
    const deletable = []
    for (const r of oldRows) {           // newest-first: a group's first old row is its newest old row
      const k = groupKey(r)
      if (!seenNewestOld.has(k)) {
        seenNewestOld.add(k)
        if (freshGroups.has(k)) deletable.push(r.id)   // fresh baseline exists → old baseline deletable
        continue
      }
      deletable.push(r.id)
    }
    if (deletable.length) {
      const { error: delErr } = await supabase.from(table).delete().in('id', deletable.slice(0, pageSize))
      if (delErr) console.warn(`[enforce-subscriptions] ${label} GC delete failed:`, delErr.message)
    }
  } catch (e) {
    console.warn(`[enforce-subscriptions] ${label} GC failed:`, e?.message || String(e))
  }
}

// Cross-runtime twin of cleanupStaleRuns in supabase/functions/agent-run/index.ts —
// keep the criteria, error message, and 60-min default threshold in sync with that
// declaration. A run whose Edge isolate was hard-killed (wall clock / CPU / OOM)
// stays status='running' forever; the edge-side sweep only runs when the NEXT edge
// run starts, so without a Vercel-side sweep the zombie row keeps the dashboard
// spinning and 409s handleTriggerRun's in-flight guard until the Monday cron.
// Swept here daily (enforce_subscriptions) and on demand (trigger_run). Only
// 'running' is swept — waiting_approval and the shopify_* pending states are
// legitimately long-lived. Best-effort: never throws, returns the swept count.
async function cleanupStaleRuns() {
  const threshold = new Date(Date.now() - Number(process.env.STALE_RUN_THRESHOLD_MS || String(60 * 60 * 1000))).toISOString()
  const { data, error } = await supabase
    .from('agent_runs')
    .update({
      status:        'failed',
      error_message: 'Stuck in status=running past stale threshold — likely killed mid-flight',
      completed_at:  new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('created_at', threshold)
    .select('id')
  if (error) {
    console.warn('[stale-cleanup] failed:', error.message)
    return 0
  }
  if (data?.length) console.warn(`[stale-cleanup] marked ${data.length} stale runs as failed`)
  return data?.length || 0
}

// ─── LIFECYCLE DRIP EMAILS (daily) ───────────────────────────────────────────
// Day-2 setup reminder (only while onboarding is unfinished) and day-7 feature
// tips. Fixed templates from api/_lib/email.js — never LLM output. The age
// window is bounded on BOTH ends: the lower bound is the drip day, the upper
// bound (14d) guards the rollout — accounts already older than the window when
// this shipped are never suddenly mailed — and caps how stale a retried send
// can get. email_log's unique claim makes each mail once-ever per subscription;
// email_opt_out is the §7(3) UWG objection flag and excludes the sub entirely.
async function sendDripEmails() {
  if (!emailConfigured()) return 0
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.now()
  const { data: subs, error } = await supabase
    .from('agent_subscriptions')
    .select('id, email, created_at, onboarding_completed_at, email_opt_out, subscription_status')
    .eq('email_opt_out', false)
    .not('email', 'is', null)
    .gte('created_at', new Date(now - 14 * DAY).toISOString())
    .lte('created_at', new Date(now - 2 * DAY).toISOString())
    .limit(200)
  if (error) {
    console.warn('[enforce-subscriptions] drip email query failed:', error.message)
    return 0
  }
  let sent = 0
  for (const sub of subs || []) {
    if (sub.subscription_status === 'cancelled') continue
    const age = now - new Date(sub.created_at).getTime()
    // Day 2 (window 2–7d): nudge an unfinished onboarding.
    if (age >= 2 * DAY && age < 7 * DAY && !sub.onboarding_completed_at) {
      const r = await logAndSend(supabase, { subscriptionId: sub.id, to: sub.email, emailType: 'setup_reminder', buildMail: setupReminderEmail })
      if (r.sent) sent++
    }
    // Day 7 (window 7–14d): feature tips for the product they subscribed to.
    if (age >= 7 * DAY && age < 14 * DAY) {
      const r = await logAndSend(supabase, { subscriptionId: sub.id, to: sub.email, emailType: 'tips', buildMail: tipsEmail })
      if (r.sent) sent++
    }
  }
  return sent
}

async function handleEnforceSubscriptions(res) {
  // One shared clock for every time-boxed pass below (backfill + visual check):
  // their deadlines are only honest against the WHOLE invocation's budget.
  const handlerStart = Date.now()
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('agent_subscriptions')
    .update({ subscription_status: 'cancelled' })
    .eq('cancel_at_period_end', true)
    .lt('current_period_end', now)
    .eq('subscription_status', 'active')

  if (error) {
    console.error('enforce-subscriptions error:', error)
    return res.status(500).json({ error: error.message })
  }

  // Stale-run sweep — Vercel-side twin of the edge fn's cleanupStaleRuns, which
  // only fires at the start of the next edge run. Daily here means a hard-killed
  // isolate's zombie 'running' row heals within a day instead of next Monday.
  // Best-effort (never throws) like every GC below.
  await cleanupStaleRuns()

  // Stage 5.D: GC the Telegram webhook dedupe table. Telegram never replays an
  // update older than ~24h, so 7 days is a safe retention floor. Piggybacked
  // on this daily cron so it needs no pg_cron / extra scheduler. Best-effort —
  // a failure here must not fail the subscription sweep.
  const dedupeCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { error: gcError } = await supabase
    .from('telegram_webhook_dedupe')
    .delete()
    .lt('received_at', dedupeCutoff)
  if (gcError) console.warn('[enforce-subscriptions] dedupe GC failed:', gcError.message)

  // Stage 3C: GC the verify_telegram_code rate-limit buckets. Windows are 60s,
  // so anything older than a day is long dead; 1-day retention is ample. Same
  // best-effort, daily-cron piggyback as the dedupe GC above.
  const rateCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { error: rlGcError } = await supabase
    .from('rate_limit_hits')
    .delete()
    .lt('window_start', rateCutoff)
  if (rlGcError) console.warn('[enforce-subscriptions] rate-limit GC failed:', rlGcError.message)

  // B3: GC consumed/expired Telegram start tokens. They carry a 15-min TTL and
  // are single-use, so a 1-day retention floor is ample. Same best-effort,
  // daily-cron piggyback as the GCs above.
  const startTokenCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { error: stGcError } = await supabase
    .from('telegram_start_tokens')
    .delete()
    .lt('created_at', startTokenCutoff)
  if (stGcError) console.warn('[enforce-subscriptions] start-token GC failed:', stGcError.message)

  // Trial-abuse ledger retention: hashed identity fingerprints are kept ≤365
  // days (GDPR legitimate-interest fraud prevention, data minimization) — a
  // domain dormant for a year may trial again, accepted trade-off. Same
  // best-effort, daily-cron piggyback as the GCs above; tolerate 42P01
  // (table not yet migrated).
  const fpCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const { error: fpGcError } = await supabase
    .from('trial_fingerprints')
    .delete()
    .lt('created_at', fpCutoff)
  if (fpGcError && fpGcError.code !== '42P01') console.warn('[enforce-subscriptions] trial-fingerprint GC failed:', fpGcError.message)

  // A19: bound three tables/buckets that previously grew forever. All best-effort,
  // daily-cron piggyback like the GCs above; tolerate 42P01 (table not yet migrated).
  //
  // 1. agent_competitor_snapshots — one row per tracked URL per weekly run. The diff
  //    logic reads the newest snapshot per URL, so old rows are dead weight — EXCEPT a
  //    group's newest row, which is its diff baseline: a subscription paused >90d must
  //    not lose it (a flat cutoff delete would, silently costing one re-baseline).
  // 2. agent_site_network — one nodes/edges JSON blob per run; the dashboard renders the
  //    newest per subscription, which likewise must survive a >90d pause.
  await gcKeepNewestPerGroup(supabase, {
    table: 'agent_competitor_snapshots', timeCol: 'captured_at',
    groupCols: ['subscription_id', 'competitor_url'], label: 'competitor-snapshot',
  })
  await gcKeepNewestPerGroup(supabase, {
    table: 'agent_site_network', timeCol: 'captured_at',
    groupCols: ['subscription_id'], label: 'site-network',
  })

  // 3. screenshots storage bucket — every capture uploads a UUID-keyed PNG and nothing
  //    ever deleted them. List a bounded page (oldest first), and delete only objects
  //    >180d old that are NOT referenced by any run's screenshot_before/after (the
  //    columns store the full public URL, whose last path segment is the object name).
  //    Batch-capped; successive daily runs drain any backlog. Cross-referencing means a
  //    still-shown old screenshot is never deleted.
  try {
    const { data: objects } = await supabase.storage.from('screenshots')
      .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } })
    const shotCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000
    const oldNames = (objects || [])
      .filter(o => o?.name?.endsWith('.png') && o?.created_at && new Date(o.created_at).getTime() < shotCutoff)
      .map(o => o.name)
    if (oldNames.length) {
      // The reference sweep must PROVABLY complete before anything is deleted: an
      // un-paginated select silently caps at 1000 rows (an incomplete `referenced`
      // set would delete still-shown screenshots), and an ignored error would empty
      // the set entirely. Paginate to exhaustion; abort the GC on any error or on a
      // suspiciously unterminated pagination — deleting late is free, deleting a
      // referenced object is permanent.
      const referenced = new Set()
      const PAGE = 1000
      let from = 0
      let sweepComplete = false
      for (let page = 0; page < 50; page++) {   // 50k runs — far beyond current scale
        const { data: refRows, error: refErr } = await supabase
          .from('agent_runs').select('screenshot_before, screenshot_after')
          .or('screenshot_before.not.is.null,screenshot_after.not.is.null')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (refErr) { console.warn('[enforce-subscriptions] screenshot GC reference sweep failed:', refErr.message); break }
        for (const r of (refRows || [])) {
          for (const u of [r.screenshot_before, r.screenshot_after]) {
            if (typeof u === 'string') { const seg = u.split('/').pop(); if (seg) referenced.add(seg) }
          }
        }
        if (!refRows || refRows.length < PAGE) { sweepComplete = true; break }
        from += PAGE
      }
      // Incomplete reference set → skip deletion entirely today (never `return`
      // here — the daily cron's remaining work below must still run).
      const toDelete = sweepComplete ? oldNames.filter(n => !referenced.has(n)).slice(0, 100) : []
      if (toDelete.length) {
        const { error: rmErr } = await supabase.storage.from('screenshots').remove(toDelete)
        if (rmErr) console.warn('[enforce-subscriptions] screenshot GC remove failed:', rmErr.message)
      }
    }
  } catch (e) {
    console.warn('[enforce-subscriptions] screenshot GC failed:', e?.message || String(e))
  }

  // Capture any missing public-timeline "after" screenshots. Piggybacked on this
  // daily cron (in addition to the weekly rollback_check) so a deployed run's
  // after-shot lands within ~24h instead of waiting up to a week for Wednesday.
  // Internally capped + time-boxed; best-effort, must not fail the sweep above.
  const afterShotsCaptured = await backfillAfterScreenshots(handlerStart)
    .catch(e => { console.error('[enforce-subscriptions] after-screenshot backfill failed:', e); return 0 })

  // Item 3: visual verification of deployed runs that now have both shots.
  // Bounded + best-effort like everything above; shares the handler clock.
  const visualChecks = await runVisualChecks(handlerStart)
    .catch(e => { console.error('[enforce-subscriptions] visual check failed:', e); return 0 })

  // Lifecycle drip emails (day-2 / day-7) — template-only, idempotent via
  // email_log; best-effort like every pass above.
  const dripEmailsSent = await sendDripEmails()
    .catch(e => { console.error('[enforce-subscriptions] drip emails failed:', e); return 0 })

  return res.json({ ok: true, ran_at: now, afterShotsCaptured, visualChecks, dripEmailsSent })
}

// ─── EMAIL OPT-OUT (public, HMAC-verified) ───────────────────────────────────
// One-click unsubscribe target of every lifecycle email (footer link + RFC 8058
// List-Unsubscribe headers — mail clients POST, humans GET; both honored). The
// token is the HMAC minted by api/_lib/email.js buildUnsubscribeUrl. No login,
// no Bearer token — a formless objection (§7 Abs. 3 Nr. 3 UWG) must not require
// an account session. Responds with a minimal standalone HTML page (this
// endpoint is outside the SPA). Idempotent: opting out twice is fine, and a
// 0-row update (account since deleted) still reads as success.
async function handleEmailOptOut(req, res) {
  const sub   = typeof req.query?.sub === 'string' ? req.query.sub : ''
  const token = typeof req.query?.token === 'string' ? req.query.token : ''
  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} — Velyr</title></head><body style="background:#f7f4ef;color:#1c1917;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:24px;"><div style="max-width:440px;text-align:center;"><h1 style="font-weight:normal;font-size:26px;">${title}</h1><p style="color:#6b6460;font-size:15px;line-height:1.7;">${body}</p></div></body></html>`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  if (!sub || !verifyUnsubscribeToken(sub, token)) {
    return res.status(403).send(page('Link invalid',
      'This unsubscribe link is invalid. To opt out of product emails, just write to <a href="mailto:info@velyr.io" style="color:#2a5c45;">info@velyr.io</a> — we\'ll take care of it.'))
  }
  const { error } = await supabase
    .from('agent_subscriptions')
    .update({ email_opt_out: true })
    .eq('id', sub)
  if (error) {
    console.error('[email-opt-out] update failed:', error.message)
    return res.status(500).send(page('Something went wrong',
      'We could not process your request. Please email <a href="mailto:info@velyr.io" style="color:#2a5c45;">info@velyr.io</a> and we\'ll unsubscribe you manually.'))
  }
  return res.status(200).send(page('You\'re unsubscribed',
    'You will no longer receive product emails from Velyr. Messages required to operate your account (like password resets) are unaffected.'))
}

export default async function handler(req, res) {
  const action = req.query?.action

  // ── PUBLIC TIMELINE (no auth) ─────────────────────────────────────────────
  // GET /api/agent/run?action=public-timeline&slug=florian
  if (action === 'public-timeline') {
    return handlePublicTimeline(req, res)
  }
  // ── C12: PUBLIC WIN BADGE / SHARE CARD (no auth, SVG) ────────────────────
  // GET /api/agent/run?action=win_badge&slug=florian · ?action=win_card&slug=…
  if (action === 'win_badge' || action === 'win_card') {
    return handleWinBadge(req, res, action)
  }
  // ── EMAIL OPT-OUT (no auth — HMAC-signed one-click unsubscribe) ───────────
  // GET/POST /api/agent/run?action=email_opt_out&sub=<id>&token=<hmac>
  if (action === 'email_opt_out') {
    return handleEmailOptOut(req, res)
  }

  // ── Authenticated user actions (Supabase JWT) ─────────────────────────────
  if (action === 'update-settings' || action === 'reenable_snippet' || action === 'trigger_run' || action === 'dna_verdict' || action === 'approve_run' || action === 'reject_run' || action === 'install_badge') {
    const authHeader = req.headers.authorization
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

    if (action === 'update-settings')  return handleUpdateSettings(req, res, user)
    if (action === 'reenable_snippet') return handleReenableSnippet(req, res, user)
    if (action === 'trigger_run')      return handleTriggerRun(req, res, user)
    if (action === 'dna_verdict')      return handleDnaVerdict(req, res, user)
    if (action === 'install_badge')    return handleInstallBadge(req, res, user)
    if (action === 'approve_run' || action === 'reject_run') return handleRunAction(req, res, user, action)
  }

  // ── Account actions (quick — stay in Vercel) ──────────────────────────────
  if (action === 'pause' || action === 'resume' || action === 'delete') {
    const authHeader = req.headers.authorization
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

    if (action === 'pause') {
      await supabase.from('agent_subscriptions').update({ status: 'paused' }).eq('auth_user_id', user.id)
      return res.json({ success: true, status: 'paused' })
    }

    if (action === 'resume') {
      await supabase
        .from('agent_subscriptions')
        .update({ status: 'active' })
        .eq('auth_user_id', user.id)
        .in('subscription_status', ['active', 'trialing'])
      return res.json({ success: true, status: 'active' })
    }

    if (action === 'delete') {
      const { data: subs } = await supabase
        .from('agent_subscriptions')
        .select('id, subscription_id, subscription_status')
        .eq('auth_user_id', user.id)

      for (const s of subs || []) {
        if (!s.subscription_id || s.subscription_status === 'cancelled') continue
        try {
          await stripe.subscriptions.cancel(s.subscription_id)
        } catch (err) {
          if (err?.code === 'resource_missing') continue
          console.error('[account-delete] stripe cancel failed — aborting deletion:', { subscription_id: s.subscription_id, code: err?.code, message: err?.message })
          return res.status(500).json({ error: 'Failed to cancel Stripe subscription. Account not deleted.' })
        }
      }

      // Local teardown. Billing is now cancelled (above), so the user can never
      // be charged for a half-deleted account. The previous version deleted only
      // agent_runs + agent_connections + agent_subscriptions and was unwrapped:
      // any child table without ON DELETE CASCADE (the older ones predate the
      // migrations dir, so their FK behavior isn't guaranteed) would block the
      // parent delete and 500 AFTER Stripe was cancelled — stranding the user in
      // a billing-cancelled-but-data-intact state. We now delete EVERY child
      // table keyed on subscription_id first (idempotent for the ones that do
      // cascade), best-effort per table, before the parent + auth user.
      const subIds = subs?.map(s => s.id) || []
      if (subIds.length > 0) {
        // Children first (parent delete would otherwise hit a RESTRICT FK).
        // trial_fingerprints is deliberately NOT in this list — it's the
        // deletion-surviving anti-abuse ledger (one free trial per site
        // identity); wiping it here would re-open the delete-and-retrial loop.
        const childTables = [
          'agent_runs', 'agent_connections', 'agent_learnings', 'agent_business_dna',
          'agent_competitor_urls', 'agent_competitor_snapshots', 'agent_funnel_pages',
          'agent_brand_guardrails', 'agent_llm_usage', 'impact_metrics',
          'agent_ab_tests', 'agent_site_network', 'site_structure_preview',
          'agent_run_locks', 'email_log',
        ]
        for (const table of childTables) {
          const { error } = await supabase.from(table).delete().in('subscription_id', subIds)
          // 42P01 = table absent in this deployment — expected, ignore. Other
          // errors are logged but non-fatal; a child that genuinely couldn't be
          // cleared will surface as an FK block on the parent delete below.
          if (error && error.code !== '42P01') {
            console.error(`[account-delete] child delete failed for ${table}:`, error.message)
          }
        }
        const { error: subDelErr } = await supabase.from('agent_subscriptions').delete().in('id', subIds)
        if (subDelErr) {
          console.error('[account-delete] subscription delete failed (billing already cancelled):', subDelErr.message)
          return res.status(500).json({ error: 'Your subscription was cancelled, but the account data could not be fully removed. Please contact support to finish deletion.' })
        }
      }

      // Auth user last — cascades the auth-keyed rows (Telegram codes/tokens).
      const { error: userDelErr } = await supabase.auth.admin.deleteUser(user.id)
      if (userDelErr) {
        console.error('[account-delete] auth user delete failed:', userDelErr.message)
        return res.status(500).json({ error: 'Your account data was removed, but the login could not be deleted. Please contact support.' })
      }
      return res.json({ success: true })
    }
  }

  // ── Cron auth ─────────────────────────────────────────────────────────────
  // The previously-trusted `x-vercel-cron` header is gone: Vercel claims to
  // strip it from inbound public traffic, but the audit treats that as un-
  // provable defense-in-depth. We now require a shared secret on every cron
  // invocation; see `authorizeCron` above for the two accepted headers.
  const cronAuth = authorizeCron(req)
  if (!cronAuth.ok) {
    return res.status(cronAuth.status).json({ error: cronAuth.error })
  }

  const mode = req.query?.mode

  // ── Quick modes — stay in Vercel ──────────────────────────────────────────
  if (mode === 'midweek')              return handleMidweek(res)
  if (mode === 'rollback_check')       return handleRollbackCheck(res)
  if (mode === 'weekly_summary')       return handleWeeklySummary(res)
  if (mode === 'enforce_subscriptions') return handleEnforceSubscriptions(res)

  // ── Full run — fire Edge Function without awaiting ─────────────────────────
  // The full Monday run is too heavy for Vercel's 60s budget, so we kick the
  // Supabase Edge Function and intentionally do NOT await its completion. But
  // we MUST distinguish "aborted because the Edge run is still going" (the
  // expected case) from "the trigger never reached Supabase" (a real failure
  // we previously swallowed silently and still reported success for).
  const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-run`
  const triggerId = crypto.randomUUID()

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 2000)
  let dispatched = true
  let dispatchError = null
  try {
    await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ triggeredBy: 'cron', triggerId }),
      signal: controller.signal,
    })
  } catch (err) {
    // AbortError = our own 2s timeout fired → the request WAS sent and the
    // Edge function is (almost certainly) running. Anything else (DNS, TLS,
    // connection refused, bad URL) means the trigger never landed.
    if (err?.name === 'AbortError') {
      console.log(`[agent/run] full-run trigger dispatched (triggerId=${triggerId}) — Edge function running, not awaited`)
    } else {
      dispatched = false
      dispatchError = err?.message || String(err)
      console.error(`[agent/run] FAILED to dispatch Edge function (triggerId=${triggerId}):`, dispatchError)
    }
  } finally {
    clearTimeout(timeoutId)
  }

  if (!dispatched) {
    return res.status(502).json({ success: false, error: 'Failed to reach agent Edge function', detail: dispatchError, triggerId })
  }
  return res.status(200).json({ success: true, message: 'Agent run started via Edge Function', triggerId })
}

// ─── HELPER: Octokit ─────────────────────────────────────────────────────────
async function getOctokit(installationId) {
  const app = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8'),
  })
  const { data: { token } } = await app.octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    { installation_id: installationId }
  )
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.warn(`[github] rate limit on ${options.method} ${options.url}, retryAfter=${retryAfter}s, retryCount=${retryCount}`)
        return retryCount < 2
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.warn(`[github] secondary rate limit on ${options.method} ${options.url}, retryAfter=${retryAfter}s, retryCount=${retryCount}`)
        return retryCount < 2
      },
    },
  })
}

// ─── FILE → URL ROUTE MAPPING (Stage 2) ──────────────────────────────────────
// Byte-compatible twin of fileToRoutePath in
// supabase/functions/agent-run/route-map.ts (used there by the funnel +
// before-screenshot). Keep in sync — same Node/Deno bundle boundary as
// decryptSecret / ROLLBACK_BOUNCE_PP_THRESHOLD; update both together if the
// mapping rules change. See route-map.ts for the full rule documentation.
function toRouteSegment(seg) {
  if (/^\[\[?\.\.\..+\]\]?$/.test(seg)) return seg          // [...slug] / [[...slug]] kept
  const dyn = seg.match(/^\[(.+)\]$/)
  return dyn ? `:${dyn[1]}` : seg                            // [param] → :param
}
function normalizeRoute(route) {
  let r = route.replace(/\/{2,}/g, '/')
  if (r.length > 1) r = r.replace(/\/$/, '')
  return r.toLowerCase()
}
function fileToRoutePath(filePath) {
  const p = (filePath || '').replace(/\\/g, '/')
  const appMatch = p.match(/^(?:src\/)?app\/(.+)$/)
  if (appMatch) {
    const parts = appMatch[1].split('/')
    const file = parts.pop() || ''
    if (!/^(page|layout)\.(tsx|jsx|ts|js)$/.test(file)) return null
    const segs = []
    for (const s of parts) {
      if (s.startsWith('_') || s.startsWith('@')) return null   // private / parallel slot
      if (/^\(.*\)$/.test(s)) continue                          // route group — dropped
      segs.push(toRouteSegment(s))
    }
    return normalizeRoute('/' + segs.join('/'))
  }
  // A11 (twin of route-map.ts): normalizeRoute the pages-branch result so a nested
  // index (pages/blog/index.jsx → /blog/index → /blog/) drops its trailing slash to
  // /blog, matching PostHog's $pathname. Root '/' is preserved. Keep byte-identical
  // to the Deno twin.
  const pagesRoute = p
    .replace(/^(src\/pages|pages|src\/views|src\/screens)\//, '/')
    .replace(/\.(jsx|tsx|js|ts)$/, '')
    .replace(/\/index$/, '/')
  return normalizeRoute(pagesRoute)
}

// ─── ROLLBACK CHECK ───────────────────────────────────────────────────────────

// Capture the "after" screenshot for any deployed run that still lacks one.
// Deliberately decoupled from the bounce-rate measurement in handleRollbackCheck:
// the screenshot is a pure visual artifact for the public timeline / dashboard,
// so it must not inherit the bounce gates (PostHog host filter + >=100 sessions
// per side) or the tight [48h,96h] comparison window. Selection is idempotent
// (screenshot_after IS NULL) and the pass is both batch-capped and time-boxed,
// so a one-time backlog drains across successive weekly crons without ever
// risking the function's wall-clock budget. Returns the number captured.
async function backfillAfterScreenshots(handlerStart) {
  const BACKFILL_MAX         = 5      // hard ceiling of captures per invocation
  // Never START a capture past this elapsed (measured from handlerStart, which
  // also covers the bounce loop that ran first). captureScreenshot can block up
  // to ~35s, so 22s here keeps the whole invocation under ~57s of a 60s budget.
  const BACKFILL_DEADLINE_MS = 22000
  // Small propagation delay so the customer's own redeploy (their CI rebuilding
  // from the merged PR) has landed before we shoot — otherwise the "after" shot
  // would still show the pre-merge page. This is NOT a measurement window: a
  // screenshot only needs the change to be live, nothing more. (The 48h bounce
  // window in handleRollbackCheck is unrelated and must not gate this.)
  const minDeployAge = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  // Deployed (live) and still missing an after-shot. Newest-first so the runs a
  // visitor is most likely viewing on the public timeline get captured first.
  const { data: pending } = await supabase
    .from('agent_runs')
    .select('id, subscription_id')
    // A12: include shopify_deployed — a Shopify-direct deploy gets a "before" shot
    // (attachBeforeScreenshot) but never an "after" one without this, so its dashboard /
    // public-timeline card stays half-populated forever.
    .in('status', DEPLOYED_STATUSES)
    .is('screenshot_after', null)
    .lte('completed_at', minDeployAge)
    .order('completed_at', { ascending: false })
    .limit(BACKFILL_MAX)

  if (!pending || pending.length === 0) return 0

  let captured = 0
  for (const run of pending) {
    if (Date.now() - handlerStart > BACKFILL_DEADLINE_MS) break
    try {
      const { data: conn } = await supabase
        .from('agent_connections').select('website_url')
        .eq('subscription_id', run.subscription_id).single()
      if (!conn?.website_url) continue

      // Always shoot the site ROOT, never a fileToRoutePath-derived route: that
      // maps e.g. src/pages/Home.jsx → "/home", a non-route on a client-rendered
      // SPA (loads the empty shell → solid black). Root always renders and keeps
      // before/after comparable — same target the before-shot used.
      const shot = await captureScreenshot(conn.website_url)
      if (!shot) continue

      // Re-assert IS NULL on write so a concurrent cron can't double-write.
      await supabase.from('agent_runs')
        .update({ screenshot_after: shot })
        .eq('id', run.id)
        .is('screenshot_after', null)
      captured++
    } catch (e) {
      console.error(`[after_screenshot_backfill] run=${run.id}:`, e?.message)
    }
  }
  return captured
}

// ─── VISUAL VERIFICATION (item 3, 2026-07-08) ─────────────────────────────────
// A deployed run can be merged yet visually inert — the customer's CI never
// redeployed, the CSS got overridden, the change sits below the fold. Once a
// run has BOTH root-page screenshots (before at analysis time, after via the
// backfill above), one bounded vision-LLM call asks: is the intended change
// actually visible? The verdict lands in agent_runs.visual_check (migration
// 20260708_visual_check.sql); a "not_visible" pings the owner on Telegram and
// stamps the run's DNA note so future prompts know the fix never rendered.
// Both shots show the site ROOT only, so a change on another page maps to
// 'not_assessable' (terminal: never re-checked, never alarmed on) — the prompt
// encodes that rule explicitly.
// Runs inside the daily enforce_subscriptions cron: full budget headroom there,
// and the verdict lands ≤24h after the after-shot exists.

// Same model the edge fn uses (OpenRouter slug — dot, not the native dash).
// AGENT_LLM_MODEL is the env-var twin of LLM_MODEL in
// supabase/functions/agent-run/index.ts — set it on BOTH surfaces (Vercel env +
// Supabase secret) when switching models, and keep the fallback slugs in sync.
const VISUAL_CHECK_MODEL = process.env.AGENT_LLM_MODEL || 'anthropic/claude-sonnet-4.6'
// Cost-accounting twin of LLM_PRICING_EUR_PER_M in supabase/functions/agent-run/
// index.ts (same env overrides, same defaults) — keep in sync.
const VISUAL_LLM_EUR_PER_M = {
  INPUT:  Number(process.env.LLM_INPUT_EUR_PER_M  || '3.0'),
  OUTPUT: Number(process.env.LLM_OUTPUT_EUR_PER_M || '15.0'),
}

async function runVisualChecks(handlerStart) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) { console.warn('[visual-check] OPENROUTER_API_KEY not set — skipping'); return 0 }
  const CHECK_MAX      = 2      // per daily invocation; backlog drains across days
  const DEADLINE_MS    = 40000  // never START a check past this elapsed (shared handler clock)
  const LLM_TIMEOUT_MS = 15000
  // Only recent pairs: without a floor, the first deploy of this feature would
  // sweep the entire run history two-per-day for months.
  const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error } = await supabase
    .from('agent_runs')
    .select('id, subscription_id, problem_description, pages_fixed, analysis_result, screenshot_before, screenshot_after')
    .in('status', DEPLOYED_STATUSES)
    .not('screenshot_before', 'is', null)
    .not('screenshot_after', 'is', null)
    .is('visual_check', null)
    .gte('completed_at', sinceIso)
    .order('completed_at', { ascending: false })
    .limit(CHECK_MAX)
  if (error) {
    // 42703 = visual_check column missing (migration not applied yet) — skip quietly.
    if (error.code !== '42703') console.warn('[visual-check] candidate select failed:', error.message)
    return 0
  }

  let checked = 0
  for (const run of candidates || []) {
    if (Date.now() - handlerStart > DEADLINE_MS) break
    try {
      const fix = run.analysis_result || {}
      const replaceSnippet = (fix.code_change?.replace || '').slice(0, 800)
      const prompt = `Two screenshots of the same website's ROOT page ("/", desktop 1280×800) are attached: FIRST the page BEFORE a code change was deployed, SECOND the page ~48h AFTER.

The deployed change:
- Problem it addressed: ${run.problem_description || fix.problem || 'unknown'}
- Files edited: ${(run.pages_fixed || []).join(', ') || 'unknown'}
- New code inserted (excerpt): ${replaceSnippet || 'unknown'}

Question: is the intended change VISIBLE in the AFTER screenshot?
Rules:
- "visible": you can point at a concrete difference matching the change.
- "not_visible": the change should plausibly appear on this root page, but the AFTER shot shows no trace of it (and both shots render fine).
- "not_assessable": the edited files/route would not render on the root page, the change is not visual (logic/analytics/meta), or either screenshot looks blank/broken.
Respond with JSON only: {"verdict":"visible"|"not_visible"|"not_assessable","detail":"one short sentence"}`

      const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: VISUAL_CHECK_MODEL,
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: run.screenshot_before } },
              { type: 'image_url', image_url: { url: run.screenshot_after } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      })
      if (!llmRes.ok) { console.warn(`[visual-check] run=${run.id} LLM HTTP ${llmRes.status}`); continue }
      const json = await llmRes.json()

      // Wallet accounting rides the existing per-subscription RPC, best-effort.
      const u = json?.usage
      if (u && run.subscription_id) {
        await supabase.rpc('agent_llm_usage_increment', {
          p_subscription_id: run.subscription_id,
          p_period:          new Date().toISOString().slice(0, 7),
          p_input_tokens:    u.prompt_tokens || 0,
          p_output_tokens:   u.completion_tokens || 0,
          p_cost_eur:        ((u.prompt_tokens || 0) / 1e6) * VISUAL_LLM_EUR_PER_M.INPUT
                           + ((u.completion_tokens || 0) / 1e6) * VISUAL_LLM_EUR_PER_M.OUTPUT,
        }).then(() => {}, () => {})
      }

      const text = json?.choices?.[0]?.message?.content || ''
      let parsed = null
      try { parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')) } catch {}
      const verdict = ['visible', 'not_visible', 'not_assessable'].includes(parsed?.verdict) ? parsed.verdict : null
      if (!verdict) { console.warn(`[visual-check] run=${run.id} unparseable verdict:`, text.slice(0, 120)); continue }
      const detail = String(parsed.detail || '').slice(0, 300)

      // IS NULL re-assert: a concurrent invocation can't double-write.
      await supabase.from('agent_runs')
        .update({ visual_check: { verdict, detail, model: VISUAL_CHECK_MODEL, checked_at: new Date().toISOString() } })
        .eq('id', run.id)
        .is('visual_check', null)
      checked++

      if (verdict === 'not_visible') {
        // Feed the DNA: the run's entry (written at approval) learns the fix
        // never rendered — future prompts read DNA notes as outcome context.
        const { data: dnaRow } = await supabase.from('agent_business_dna')
          .select('id, notes').eq('run_id', run.id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (dnaRow) {
          await supabase.from('agent_business_dna')
            .update({ notes: `${dnaRow.notes || ''} | visual check 48h+: change NOT visible on the live root page (${detail})`.slice(0, 500) })
            .eq('id', dnaRow.id)
        }
        const { data: subRow } = await supabase.from('agent_subscriptions')
          .select('telegram_chat_id').eq('id', run.subscription_id).single()
        if (subRow?.telegram_chat_id) {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: subRow.telegram_chat_id,
              text: `👀 <b>Velyr Visual Check</b>\n\n<b>Change:</b> ${escapeHtml(run.problem_description || 'recent change')}\n\nThe change was approved and merged, but ~48h later it does <b>not</b> appear on your live landing page.\n<i>${escapeHtml(detail)}</i>\n\nMost common cause: your hosting hasn't redeployed since the merge. Worth a quick look.`,
              parse_mode: 'HTML',
            }),
          }).catch(() => {})
        }
      }
    } catch (e) {
      console.error(`[visual-check] run=${run.id}:`, e?.message)
    }
  }
  return checked
}

// Stage 3: propose a Shopify-direct rollback (no PR). Sends the YES/NO Telegram, pins
// the run via telegram_message_id so the reply resolves it, and flips the run to
// shopify_rollback_pending (off shopify_deployed, so the candidate query won't re-pick
// it). The merchant's YES executes the re-upsert/delete (telegram.js); NO keeps it.
async function proposeShopifyDirectRollback(run, bounceBefore, bounceAfter, bounceDelta, scopeLabel = 'Site-wide bounce rate') {
  const { data: subRow } = await supabase
    .from('agent_subscriptions').select('telegram_chat_id').eq('id', run.subscription_id).single()
  let messageId = null
  if (subRow?.telegram_chat_id) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: subRow.telegram_chat_id,
          text: `⚠️ <b>Velyr Rollback Recommended</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n📉 ${escapeHtml(scopeLabel)}: ${bounceBefore}% → ${bounceAfter}% (+${bounceDelta}pp)\n<i>(correlation, not proven causation)</i>\n\nTap a button below (or reply <b>YES</b> to undo / <b>NO</b> to keep).`,
          parse_mode: 'HTML',
          reply_markup: approvalKeyboard(run.id, 'rollback'),
        }),
      })
      const j = await res.json().catch(() => ({}))
      messageId = j?.result?.message_id || null
    } catch (e) {
      console.error('[rollback] shopify proposal telegram failed:', e?.message)
    }
  }
  await supabase.from('agent_runs').update({
    status:          'shopify_rollback_pending',
    rollback_reason: 'metrics_dropped',
    ...(messageId ? { telegram_message_id: messageId } : {}),
  }).eq('id', run.id)
}

async function handleRollbackCheck(res) {
  // The sole deterministic rollback trigger: site-wide bounce rate rose by at
  // least this many percentage points in the 48h after a change merged. The
  // AI's rollback_signal is a labelled hypothesis only — it never gates this.
  // Keep in sync with the other ROLLBACK_BOUNCE_PP_THRESHOLD declaration
  // (supabase/functions/agent-run/receipt-builder.ts). Format-contract dedup,
  // same reason as encryptSecret: Node and Deno can't share a module cleanly.
  const ROLLBACK_BOUNCE_PP_THRESHOLD = 15
  const handlerStart = Date.now()

  // Promote 7-day-old pending DNA entries to measured_win / survived.
  await promotePendingDNA().catch(e => console.error('DNA promote error:', e))

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // Bounce/rollback measurement runs FIRST and on the full budget — it is the
  // safety-critical path. The lower bound was widened from a single-shot 96h
  // window to a multi-day lookback: the old [48h,96h] window meant a run that
  // was skipped when this inline weekly cron was killed mid-loop (Vercel's 60s
  // budget, looping over every subscriber) was >96h old by the next run and
  // NEVER measured — the promised 48h impact/rollback check silently never
  // happened for that subscriber. A lookback that spans more than the weekly
  // cadence means a skipped run is retried on the following run instead of lost.
  // The before/after bounce windows are anchored to each run's own completed_at
  // (deploy±2d), so measuring later still compares the correct data; the
  // idempotency guard below prevents re-measuring a run that WAS already handled.
  const ROLLBACK_LOOKBACK_MS = Number(process.env.ROLLBACK_LOOKBACK_MS || String(10 * 24 * 60 * 60 * 1000))
  const lookbackStart = new Date(Date.now() - ROLLBACK_LOOKBACK_MS).toISOString()
  const { data: deployedRuns } = await supabase
    .from('agent_runs').select('*')
    // Stage 3: include shopify_deployed so a Shopify-direct change is rollback-checked
    // too. The bounce measurement below is connection-agnostic (keys on posthog_host_
    // filter); only the rollback ACTION branches on connection_source.
    .in('status', ['deployed', 'shopify_deployed'])
    // Stage 4: never bounce-roll-back an analytics-setup run — it doesn't affect
    // conversions, and rolling it back would delete the snippet while the install-once
    // gate (posthog_snippet_installed_at) stays set, silently losing analytics.
    .neq('run_type', 'setup_posthog')
    .gte('completed_at', lookbackStart)
    .lte('completed_at', fortyEightHoursAgo)

  // Idempotency: a bounce-rate learning (site-wide or route-scoped) is written
  // for both a real measurement AND the insufficient_data outcome, so its
  // presence means this run was already processed. Re-measuring is pointless (the deploy±2d windows
  // are fixed, so the result is identical) and would spam duplicate learnings /
  // impact_metrics rows — skip those runs. One query for the whole candidate set.
  const candidateRunIds = (deployedRuns || []).map(r => r.id)
  const measuredRunIds  = new Set()
  if (candidateRunIds.length > 0) {
    const { data: priorLearnings } = await supabase
      .from('agent_learnings')
      .select('run_id')
      .in('metric_type', ['site_wide_bounce_rate', 'route_scoped_bounce_rate'])
      .in('run_id', candidateRunIds)
    for (const l of (priorLearnings || [])) measuredRunIds.add(l.run_id)
  }

  // Note: no early-return when empty — the after-screenshot backfill below must
  // still run even on weeks with nothing in the bounce window.
  for (const run of (deployedRuns || [])) {
    if (measuredRunIds.has(run.id)) continue   // already measured — idempotent skip
    try {
      const { data: conn } = await supabase
        .from('agent_connections').select('*')
        .eq('subscription_id', run.subscription_id).single()

      const apiKey    = decryptSecret(conn?.posthog_api_key)    || process.env.POSTHOG_API_KEY
      const projectId = conn?.posthog_project_id || process.env.POSTHOG_PROJECT_ID
      const host      = conn?.posthog_host       || process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
      if (!apiKey || !projectId) continue

      // Shared-project architecture: scope the before/after bounce comparison to
      // THIS customer's domain via properties.$host, or the rollback check reads
      // the whole shared project (incl. velyr.io) and fabricates a bounce delta.
      // No host → we can't measure this customer's bounce rate, so skip the
      // rollback decision rather than act on the wrong site's data.
      // Resolve the subscription OWNER's Telegram chat once per run so every
      // notification below (couldn't-measure, rollback-recommended, rollback-
      // failed, impact result) reaches the customer — never the global operator
      // TELEGRAM_CHAT_ID, which would leak one tenant's change description to
      // the operator and never reach the owner. No chat bound → sends skipped.
      const { data: ownerSub } = await supabase.from('agent_subscriptions')
        .select('telegram_chat_id, conversion_goal_event').eq('id', run.subscription_id).single()
      const ownerChatId = ownerSub?.telegram_chat_id || null

      const hostFilter = conn?.posthog_host_filter
      if (!hostFilter || !isValidHostFilter(hostFilter)) {
        console.warn(`[rollback_check] run=${run.id} sub=${run.subscription_id}: missing/invalid posthog_host_filter — skipping bounce comparison`)
        // Terminal + visible, not a silent weekly retry: the host filter is set
        // at first-run analytics setup, so a missing one never heals on its own
        // — retrying each cron only re-warned the logs while the owner saw
        // nothing. Record the honest outcome (which is also the idempotency
        // marker) and tell the owner once, gated on the insert succeeding so a
        // transient DB failure retries next cron without double-notifying.
        const { error: hostLearnErr } = await supabase.from('agent_learnings').insert({
          subscription_id: run.subscription_id, run_id: run.id,
          change_type: run.analysis_result?.change_type || 'other',
          summary: 'Impact not measurable: analytics is not configured for this site (missing domain filter), so the bounce comparison was skipped.',
          outcome: 'insufficient_data',
          metric_type: 'site_wide_bounce_rate',
          delta: 0,
          confidence: 'none',
        })
        if (hostLearnErr) {
          console.warn(`[rollback_check] host-filter learning insert failed for run=${run.id}: ${hostLearnErr.message}`)
        } else if (ownerChatId) {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ownerChatId,
              text: `📊 <b>Velyr Impact Check</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n⚠️ Couldn't measure the impact: analytics isn't set up for your site yet, so this change stays live but unmeasured. Future fixes will be measured once analytics is connected.`,
              parse_mode: 'HTML',
            }),
          })
        }
        continue
      }
      const hostWhere     = [`properties.$host = '${String(hostFilter).replace(/'/g, "''")}'`]

      const deployedAt    = new Date(run.completed_at)
      // Split the before/after bounce windows at the exact deploy INSTANT, not the
      // deploy calendar day. Date-granularity (.split('T')[0]) put the deploy day's
      // pre-change hours (00:00 → completed_at) into the "after" bucket, biasing
      // bounceDelta against the change at the ROLLBACK_BOUNCE_PP_THRESHOLD gate.
      // PostHog EventsQuery after/before accept full ISO-8601 timestamps.
      const twoDaysBefore = new Date(deployedAt.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const deployedDate  = deployedAt.toISOString()
      const twoDaysAfter  = new Date(deployedAt.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
      const headers       = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

      // B6: paginate past the 2000-row EventsQuery cap. A site with >2000 pageviews
      // in a ±2d window used to truncate silently with unknown ordering bias in the
      // bounce sample. The windows are fixed historical ranges, so offset pagination
      // is stable; bounded pages keep a viral site from stalling the cron.
      const baseWindowQuery = { kind: 'EventsQuery', select: ['properties.$session_id', 'properties.$pathname'], event: '$pageview', where: hostWhere }
      const [before, after] = await Promise.all([
        fetchWindowRows(host, projectId, headers, { ...baseWindowQuery, after: twoDaysBefore, before: deployedDate }),
        fetchWindowRows(host, projectId, headers, { ...baseWindowQuery, after: deployedDate, before: twoDaysAfter }),
      ])
      if (!before.complete || !after.complete) {
        console.warn(`[rollback_check] run=${run.id}: pageview sample capped at ${before.rows.length}/${after.rows.length} rows — bounce computed on a partial (but 5x larger than before) sample`)
      }

      // Stage 3.5: raise the noise floor. The previous `> 10 sessions` was
      // statistical noise — at 11 sessions one bouncer moves the rate by 9
      // percentage points. We now require ≥100 unique sessions per side; if
      // either side is below that, record an "insufficient_data" learning
      // and skip the rollback decision rather than fabricate a result.
      const MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION = Number(process.env.MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION || '100')

      // Route scoping (api/_lib/route-scope.js, pure + unit-tested): when EVERY
      // file the run touched confidently maps to a route class, compare bounce
      // for sessions that viewed those routes; any layout/section/snippet/
      // component/unknown file → site-wide, exactly the pre-scoping behavior
      // (guard a). Both aggregations come from the same two EventsQuery
      // responses — no extra PostHog calls. The fire threshold and the ±2d
      // windows are untouched; only the measured population changes. This
      // supersedes the older audit-§2 rejection of route mapping: a file the
      // resolver can't map no longer risks mislabeling the run "no data" — it
      // falls back to the site-wide comparison.
      const touchedFiles = (Array.isArray(run.pages_fixed) && run.pages_fixed.length > 0)
        ? run.pages_fixed
        : [run.analysis_result?.file_to_edit].filter(Boolean)
      const scope = resolveAffectedScope(touchedFiles, { fileToRoute: fileToRoutePath })

      const beforeSessions = sessionize(before.rows)
      const afterSessions  = sessionize(after.rows)

      // Site-wide first: it is both the insufficient-data gate and the
      // fallback population (guard b) when the scoped sample is under the floor.
      const siteBefore = bounceFromSessions(beforeSessions, null, MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION)
      const siteAfter  = bounceFromSessions(afterSessions,  null, MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION)

      let beforeMeasure = siteBefore
      let afterMeasure  = siteAfter
      let scopeUsed     = 'site_wide'
      if (siteBefore.rate !== null && siteAfter.rate !== null && scope.kind === 'route') {
        const scopedBefore = bounceFromSessions(beforeSessions, scope.matchers, MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION)
        const scopedAfter  = bounceFromSessions(afterSessions,  scope.matchers, MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION)
        if (scopedBefore.rate !== null && scopedAfter.rate !== null) {
          beforeMeasure = scopedBefore
          afterMeasure  = scopedAfter
          scopeUsed     = 'route'
        }
      }
      const bounceBefore = beforeMeasure.rate
      const bounceAfter  = afterMeasure.rate
      const metricType   = scopeUsed === 'route' ? 'route_scoped_bounce_rate' : 'site_wide_bounce_rate'
      const scopeLabel   = scopeUsed === 'route'
        ? `Bounce rate on the affected page(s) (${scope.routesLabel})`
        : 'Site-wide bounce rate'

      if (bounceBefore === null || bounceAfter === null) {
        // Record the honest "we couldn't measure" outcome so the user sees it
        // in DNA / learnings rather than silently nothing-happened. This row
        // is also the idempotency marker (measuredRunIds above) — a failed
        // insert means the run is re-queried every cron, so surface it.
        // Requires 'insufficient_data' in agent_learnings_outcome_check
        // (migration 20260705) — the insert failed silently before that.
        const { error: learnErr } = await supabase.from('agent_learnings').insert({
          subscription_id: run.subscription_id, run_id: run.id,
          change_type: run.analysis_result?.change_type || 'other',
          summary: `Insufficient data to attribute outcome to this fix (before=${beforeMeasure.sessions} sessions, after=${afterMeasure.sessions} sessions, floor=${MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION}).`,
          outcome: 'insufficient_data',
          metric_type: 'site_wide_bounce_rate',
          delta: 0,
          confidence: 'none',
        })
        if (learnErr) {
          console.warn(`[rollback_check] insufficient_data learning insert failed for run=${run.id}: ${learnErr.message}`)
        } else if (ownerChatId) {
          // Tell the owner instead of going silent — gated on the learning
          // insert (the idempotency marker) so this can never repeat weekly.
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ownerChatId,
              text: `📊 <b>Velyr Impact Check</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n⚠️ Not enough traffic to measure the impact (${beforeMeasure.sessions} sessions before / ${afterMeasure.sessions} after — need ≥${MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION} per side). The change stays live; it just can't be attributed.`,
              parse_mode: 'HTML',
            }),
          })
        }
        continue
      }

      const bounceDelta    = bounceAfter - bounceBefore
      const shouldRollback = bounceDelta >= ROLLBACK_BOUNCE_PP_THRESHOLD

      // (after-screenshot is captured separately by backfillAfterScreenshots,
      // decoupled from this bounce gate — see top of handleRollbackCheck.)

      // Stage 3.6 + route scoping: label the metric by the population that was
      // actually measured. site_wide_bounce_rate = every route on the
      // customer's $host; route_scoped_bounce_rate = only sessions that viewed
      // the routes the change touched (resolveAffectedScope above — falls back
      // to site-wide whenever mapping isn't confident or the scoped sample is
      // under the floor). Downstream consumers (weekly summary, dashboard
      // chip, public timeline) must accept both types and state the scope.
      // FINAL/Flag 2: stamp subscription_id so the dashboard query
      // (.eq('subscription_id', …)) works and the RLS policy can key on it
      // directly like every other child table. run_id is kept as the
      // authoritative FK; subscription_id is a denormalized convenience.
      await supabase.from('impact_metrics').insert({
        run_id: run.id, subscription_id: run.subscription_id,
        metric_type: metricType,
        value_before: bounceBefore, value_after: bounceAfter,
        measured_at: new Date().toISOString(),
      })

      // C5 (measurement half): matched-window GOAL conversion alongside bounce —
      // "we measure what matters to your business", not just bounce. Sessions with
      // ≥1 goal event / all sessions, same ±2d windows, same session floor (the
      // totals already cleared it above). Strictly additive measurement: any
      // failure is logged and skipped, and it NEVER feeds the rollback trigger.
      const goalEvent = ownerSub?.conversion_goal_event
      if (goalEvent?.type && goalEvent?.value) {
        try {
          const escVal = String(goalEvent.value).replace(/'/g, "''")
          const goalWhere = goalEvent.type === 'pageview_path'
            ? [...hostWhere, `properties.$pathname = '${escVal}'`]
            : [...hostWhere, `properties.$event_type = 'click'`, `properties.$el_text ILIKE '%${escVal}%'`]
          const goalQuery = (after, before) => ({
            kind: 'EventsQuery', select: ['properties.$session_id'],
            event: goalEvent.type === 'pageview_path' ? '$pageview' : '$autocapture',
            after, before, limit: 2000, where: goalWhere,
          })
          const [goalBefore, goalAfter] = await Promise.all([
            fetch(`${host}/api/projects/${projectId}/query/`, { method: 'POST', headers, body: JSON.stringify({ query: goalQuery(twoDaysBefore, deployedDate) }) }).then(r => r.json()),
            fetch(`${host}/api/projects/${projectId}/query/`, { method: 'POST', headers, body: JSON.stringify({ query: goalQuery(deployedDate, twoDaysAfter) }) }).then(r => r.json()),
          ])
          // Unique sessions that fired the goal (a 2000-row cap can only undercount —
          // conservative). Rates in %, one decimal.
          const uniqSessions = rows => new Set((rows || []).map(r => r?.[0]).filter(Boolean)).size
          const goalRateBefore = Math.round((uniqSessions(goalBefore?.results) / beforeSessions.size) * 1000) / 10
          const goalRateAfter  = Math.round((uniqSessions(goalAfter?.results)  / afterSessions.size)  * 1000) / 10
          await supabase.from('impact_metrics').insert({
            run_id: run.id, subscription_id: run.subscription_id,
            metric_type: 'goal_conversion_rate',
            value_before: goalRateBefore, value_after: goalRateAfter,
            measured_at: new Date().toISOString(),
          })
        } catch (goalErr) {
          console.warn(`[rollback_check] goal-conversion measurement failed for run=${run.id}: ${goalErr?.message}`)
        }
      }

      // Also the idempotency marker for measured runs — surface a failure.
      const { error: measureLearnErr } = await supabase.from('agent_learnings').insert({
        subscription_id: run.subscription_id, run_id: run.id,
        change_type: run.analysis_result?.change_type || 'other',
        summary: run.analysis_result?.problem || 'Unknown change',
        outcome: shouldRollback ? 'negative' : 'positive',
        metric_type: metricType,
        delta: -bounceDelta,
        // High confidence on the measurement (sessions >= floor); attribution
        // confidence stays medium — route-scoped narrows the population but
        // still can't isolate this change from everything else that week.
        confidence: 'medium',
      })
      if (measureLearnErr) console.warn(`[rollback_check] measurement learning insert failed for run=${run.id}: ${measureLearnErr.message}`)

      // Persist new agent_runs columns (Part 1) for the public timeline + dashboard
      await supabase.from('agent_runs').update({
        bounce_rate_after: bounceAfter,
        ...(shouldRollback ? { rollback_reason: 'metrics_dropped' } : {}),
      }).eq('id', run.id)

      // Business DNA is NOT written here anymore. It has a single lifecycle now:
      //   • recorded 'pending' when a fix is APPROVED (reconcileDeployed for GitHub,
      //     applyShopifyDirectWrite for Shopify-direct),
      //   • promoted to measured_win / survived by promotePendingDNA after 7 days, OR
      //   • resolved to 'rollback' when an auto-rollback is APPROVED (reconcileDeployed
      //     isRollback / executeShopifyDirectRollback).
      // The old proposal-time inserts here recorded a rollback that hadn't happened yet
      // (rollbacks are approval-gated) and double-counted the deployed fix (a second
      // pending row on top of the approval-time one). This 48h check now only MEASURES
      // (impact_metrics + agent_learnings above); it never mutates DNA.

      const isShopifyDirect = conn?.connection_source === 'shopify_direct'
        || (conn?.shopify_shop_domain && !conn?.github_repo_name)
      if (shouldRollback && isShopifyDirect) {
        // Shopify-direct: no revert PR exists. Propose the rollback via Telegram; the
        // merchant's YES reply executes the re-upsert(prior)/delete(created) strategy
        // (api/webhooks/telegram.js executeShopifyDirectRollback). Fully separate from
        // the GitHub revert-PR path below — selected by connection_source, no interleaved
        // if(hasPR) conditionals.
        await proposeShopifyDirectRollback(run, bounceBefore, bounceAfter, bounceDelta, scopeLabel)
      } else if (shouldRollback) {
        const octokit = await getOctokit(conn.github_installation_id)
        const owner   = conn.github_repo_owner
        const repo    = conn.github_repo_name

        try {
          // Stage 5.8: prefer the stored squash-merge SHA (deterministic).
          // Fall back to the legacy commit-message search only for runs that
          // were merged before merge_commit_sha was recorded.
          let agentCommit = null
          if (run.merge_commit_sha) {
            try {
              const { data: c } = await octokit.rest.repos.getCommit({ owner, repo, ref: run.merge_commit_sha })
              agentCommit = c
            } catch (shaErr) {
              console.warn(`[rollback] stored merge_commit_sha ${run.merge_commit_sha} not found, falling back to message search:`, shaErr?.message)
            }
          }
          if (!agentCommit) {
            // Only match on the problem text when it is a real non-empty string.
            // Previously `.includes(problem?.slice(0,30))` coerced a missing problem
            // to `.includes("undefined")`, which could bind the rollback to an
            // unrelated commit that happens to contain the literal "undefined".
            const problemKey = typeof run.analysis_result?.problem === 'string'
              ? run.analysis_result.problem.slice(0, 30)
              : ''
            if (problemKey) {
              const { data: commits } = await octokit.rest.repos.listCommits({ owner, repo, per_page: 10 })
              agentCommit = commits.find(c =>
                c.commit.message.startsWith('fix:') &&
                c.commit.message.includes(problemKey)
              )
            }
          }

          if (agentCommit) {
            // SG3b: target the branch Shopify syncs to the live theme. Only a THEME
            // run honors the connected-branch override (mirrors createPR's isThemeRun
            // guard) so non-theme runs keep targeting the default branch exactly as
            // today. Theme-ness is detected from the edited file living in a Shopify
            // theme directory — robust and independent of the best-effort
            // discovered_framework column; non-theme runs never edit these paths. The
            // branch-cut, current-file read, AND PR base all use the resolved branch, or
            // a merged rollback won't sync.
            // SG4a item 2: include layout/ (e.g. layout/theme.liquid — the marker
            // isShopifyThemeRepo keys on) alongside the templates/sections/snippets
            // conversion surface (SHOPIFY_KEEP_RE in the edge function). Today the
            // forward analyze surface is templates/sections/snippets only, so file_to_edit
            // is never layout/ yet; adding it keeps this guard a forward-compatible
            // superset so a future layout/ edit can't silently roll back to the wrong
            // branch. config/ stays out — it's forbidden-edit; assets/ is compiled.
            const defaultBranch = await getDefaultBranch(octokit, owner, repo)
            // Item 4: a fix may have touched multiple files (pages_fixed holds
            // them all); revert every one — a partial revert of an
            // interdependent edit set could break the site worse than the
            // original change. Legacy runs without pages_fixed fall back to
            // the single file_to_edit.
            const revertFiles   = (Array.isArray(run.pages_fixed) && run.pages_fixed.length > 0)
              ? run.pages_fixed
              : [run.analysis_result?.file_to_edit].filter(Boolean)
            const isThemeRun    = revertFiles.some(f => /^(layout|templates|sections|snippets)\/.+\.(liquid|json)$/i.test(f || ''))
            const baseBranch    = (isThemeRun && conn?.shopify_connected_branch) ? conn.shopify_connected_branch : defaultBranch
            const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` })
            const branchName    = `agent/rollback-${run.id.slice(0, 8)}`
            await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: ref.object.sha })

            const parentSha = agentCommit.parents[0]?.sha
            if (parentSha && revertFiles.length > 0) {
              // The squash-merge's parent predates ALL of the fix's file
              // commits, so it is the correct restore point for every file.
              for (const filePath of revertFiles) {
                const { data: originalFile } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: parentSha })
                const { data: currentFile  } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: baseBranch })

                await octokit.rest.repos.createOrUpdateFileContents({
                  owner, repo, path: filePath,
                  message: `revert: rollback agent change (bounce rate +${bounceDelta}pp)${revertFiles.length > 1 ? ` (${filePath})` : ''}`,
                  content: originalFile.content, sha: currentFile.sha, branch: branchName,
                })
              }

              const { data: pr } = await octokit.rest.pulls.create({
                owner, repo,
                title: `🔄 Auto-Rollback: ${run.analysis_result?.problem}`,
                body: `## Automatic Rollback (awaiting approval)\n\n_**${scopeLabel}** rose by **+${bounceDelta}pp** in the 48h after this PR merged (correlation, not proven causation — ${scopeUsed === 'route' ? `measured over sessions that viewed ${scope.routesLabel}` : `the metric covers every page, not just \`${run.analysis_result?.file_to_edit || 'the edited file'}\``})._\n\n- Bounce before merge: ${bounceBefore}%\n- Bounce after merge:  ${bounceAfter}%\n- Sessions sampled per side: ≥ ${Number(process.env.MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION || '100')}\n\n_Reply *YES* in Telegram to merge this rollback, *NO* to keep the change live and accept the bounce trend._`,
                head: branchName, base: baseBranch,
              })
              // Stage 4.8: do NOT auto-merge. Mark the run waiting_approval and
              // let the user decide. The standard YES/NO flow in
              // api/webhooks/telegram.js handles the merge.
              await supabase.from('agent_runs').update({
                status:           'waiting_approval',
                rollback_reason:  'metrics_dropped',
                pr_number:        pr.number,
                pr_url:           pr.html_url,
              }).eq('id', run.id)

              // Notify the subscription owner (resolved once at the top of the loop).
              if (ownerChatId) {
                await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: ownerChatId,
                    text: `⚠️ <b>Velyr Rollback Recommended</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n📉 ${escapeHtml(scopeLabel)}: ${bounceBefore}% → ${bounceAfter}% (+${bounceDelta}pp)\n<i>(correlation, not proven causation)</i>\n\n🔍 Review PR: ${escapeHtml(pr.html_url)}\n\nTap a button below (or reply <b>YES</b> to merge the rollback / <b>NO</b> to keep the change live).`,
                    parse_mode: 'HTML',
                    reply_markup: approvalKeyboard(run.id, 'rollback'),
                  }),
                })
              }
            }
          }
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr)
          if (ownerChatId) {
            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: ownerChatId,
                text: `⚠️ <b>Velyr Rollback Alert</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n📉 Bounce rate +${bounceDelta}pp — ❌ auto-rollback failed, please revert manually.`,
                parse_mode: 'HTML',
              }),
            })
          }
        }
      } else if (bounceDelta <= -5) {
        if (ownerChatId) {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ownerChatId,
              text: `📈 <b>Velyr Impact Check — Positive</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n✅ ${escapeHtml(scopeLabel)}: ${bounceBefore}% → ${bounceAfter}% (${bounceDelta}pp)`,
              parse_mode: 'HTML',
            }),
          })
        }
      }
      // Within-noise outcomes (−5pp < Δ < +15pp) deliberately do NOT send a
      // standalone message — they surface as one aggregate line in the weekly
      // summary instead (owner's choice: one digest, not per-change pings).
    } catch (err) {
      console.error('Rollback check error for run', run.id, err)
    }
  }

  // After-screenshot backfill (decoupled from the bounce gates above): capture
  // an after-shot for every deployed run still missing one, regardless of
  // traffic volume or approval timing. Runs LAST so it can never starve the
  // rollback measurement of wall-clock budget. See backfillAfterScreenshots.
  const afterShotsCaptured = await backfillAfterScreenshots(handlerStart)
    .catch(e => { console.error('after-screenshot backfill error:', e); return 0 })

  return res.json({ success: true, checked: deployedRuns?.length || 0, afterShotsCaptured })
}

// ─── C9: "BROKEN WINDOWS" SWEEP (zero-LLM deterministic site checks) ──────────
// Cheap, deterministic HTML checks on the customer's homepage — surfaced as one line in
// the weekly summary. Fills skip-weeks with visible, honest signal at NO token cost, and
// catches real SEO/UX regressions the conversion agent doesn't look at. Best-effort: any
// fetch/parse failure returns [] (never throws, never blocks the summary). All checks are
// parseable from the fetched HTML alone — no link-following (which would be slow/expensive).
async function scanBrokenWindows(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VelyrBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const html = await res.text()
    const findings = []
    const isHttps = /^https:/i.test(url)

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    if (!title) findings.push('missing or empty <title> tag')
    else if (title.length > 65) findings.push(`title is ${title.length} chars — search results truncate past ~60`)

    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim()
    if (metaDesc == null) findings.push('no meta description (search engines invent a snippet)')
    else if (metaDesc.length < 50) findings.push('meta description under 50 chars — too thin for search')

    if (!/<meta[^>]+property=["']og:title["']/i.test(html))  findings.push('no og:title — weak link previews when shared')
    if (!/<meta[^>]+property=["']og:image["']/i.test(html))  findings.push('no og:image — no thumbnail on social shares')
    if (!/<meta[^>]+name=["']viewport["']/i.test(html))      findings.push('no viewport meta — mobile layout likely broken')

    const imgs  = html.match(/<img\b[^>]*>/gi) || []
    const noAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length
    if (imgs.length > 0 && noAlt > 0) findings.push(`${noAlt} of ${imgs.length} images have no alt text (accessibility + SEO)`)

    if (isHttps) {
      const mixed = (html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi) || [])
        .filter(u => !/http:\/\/(?:localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|ns\.adobe\.com)/i.test(u)).length
      if (mixed > 0) findings.push(`${mixed} insecure http:// resource(s) on an https page (mixed-content warnings)`)
    }

    return findings.slice(0, 5)
  } catch {
    return []
  }
}

// ─── WEEKLY SUMMARY ───────────────────────────────────────────────────────────
async function handleWeeklySummary(res) {
  const { data: connections } = await supabase
    .from('agent_connections').select('*, agent_subscriptions!inner(*)')
    .eq('agent_subscriptions.status', 'active')
    .in('agent_subscriptions.subscription_status', ['active', 'trialing'])

  if (!connections || connections.length === 0) {
    return res.json({ success: true, message: 'No active connections' })
  }

  await runPool(connections, 4, async (conn) => {
    try {
      const subscriptionId = conn.subscription_id
      const oneWeekAgo     = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [analytics, weekRunsRes, allLearningsRes, subRes] = await Promise.all([
        getPostHogAnalytics(
          decryptSecret(conn.posthog_api_key)    || process.env.POSTHOG_API_KEY,
          conn.posthog_project_id || process.env.POSTHOG_PROJECT_ID,
          conn.posthog_host       || process.env.POSTHOG_HOST,
          conn.posthog_host_filter
        ),
        supabase.from('agent_runs').select('*').eq('subscription_id', subscriptionId).gte('created_at', oneWeekAgo).order('created_at', { ascending: false }),
        supabase.from('agent_learnings').select('outcome, delta, metric_type').eq('subscription_id', subscriptionId),
        supabase.from('agent_subscriptions').select('telegram_chat_id, email, email_opt_out').eq('id', subscriptionId).single(),
      ])

      const weekRuns       = weekRunsRes.data   || []
      const allLearnings   = allLearningsRes.data || []
      // Owner-only. Falling back to the operator TELEGRAM_CHAT_ID leaked one
      // tenant's summary (traffic, deployed changes, DNA) into the global
      // operator chat — and the owner never saw it. No chat bound → no send.
      const chatId         = subRes.data?.telegram_chat_id || null
      // Email digest twin of the Telegram summary (same structured stats, fixed
      // template, no LLM). email_opt_out is the §7(3) UWG objection flag.
      const emailTo        = (subRes.data && !subRes.data.email_opt_out && subRes.data.email) || null
      if (!chatId && !emailTo) {
        console.warn(`[weekly_summary] sub=${subscriptionId}: no telegram_chat_id bound and no email — skipping send`)
        return
      }

      const deployedRunIds = weekRuns.filter(r => DEPLOYED_STATUSES.includes(r.status) || ROLLED_BACK_STATUSES.includes(r.status)).map(r => r.id)
      let impactMetrics    = []
      if (deployedRunIds.length > 0) {
        const { data: metrics } = await supabase.from('impact_metrics').select('*').in('run_id', deployedRunIds)
        impactMetrics = metrics || []
      }

      const totalLearnings   = allLearnings.length
      const winLearnings     = allLearnings.filter(l => l.outcome === 'positive')
      const avgPositiveDelta = winLearnings.length > 0
        ? Math.round(winLearnings.reduce((sum, l) => sum + (l.delta || 0), 0) / winLearnings.length)
        : null

      const a          = analytics?.last7Days
      const deployed   = weekRuns.filter(r => DEPLOYED_STATUSES.includes(r.status)).length
      const rolledBack = weekRuns.filter(r => ROLLED_BACK_STATUSES.includes(r.status)).length
      const rejected   = weekRuns.filter(r => REJECTED_STATUSES.includes(r.status)).length
      const pending    = weekRuns.filter(r => AWAITING_STATUSES.includes(r.status)).length

      const trendEmoji = !a?.trafficChange ? '📊' : a.trafficChange > 10 ? '📈' : a.trafficChange < -10 ? '📉' : '➡️'
      const trendText  = a?.trafficChange == null ? 'First week of tracking'
        : a.trafficChange > 0 ? `+${a.trafficChange}% vs previous week`
        : `${a.trafficChange}% vs previous week`
      const bounceText = !a ? '—'
        : a.bounceRate === 0 ? 'No data'
        : a.bounceRate > 70 ? `⚠️ ${a.bounceRate}% (high)`
        : a.bounceRate > 50 ? `🟡 ${a.bounceRate}%`
        : `✅ ${a.bounceRate}%`

      // Stage 3.6: weekly summary reports the measured bounce delta around each
      // change, explicitly labeled as correlation rather than attribution, and
      // scoped honestly (site-wide vs the routes the change touched). Matches
      // legacy metric_type strings so historical rows still surface. Sort is
      // DESCENDING by improvement — ascending here once picked the worst row
      // and labeled it the best result.
      let bestMetricLine = ''
      const bounceMetrics = impactMetrics.filter(m =>
        (m.metric_type === 'site_wide_bounce_rate' || m.metric_type === 'route_scoped_bounce_rate' || m.metric_type === 'bounce_rate') &&
        m.value_before && m.value_after
      )
      if (bounceMetrics.length > 0) {
        const best        = bounceMetrics.sort((a, b) => (b.value_before - b.value_after) - (a.value_before - a.value_after))[0]
        const improvement = Math.round(best.value_before - best.value_after)
        const scopeText   = best.metric_type === 'route_scoped_bounce_rate'
          ? 'on the pages an agent change touched'
          : 'site-wide in the week of an agent change'
        // Only a real win headlines (aligned with the measured_win bar) — a
        // +1pp blip is noise and belongs in the within-noise line below.
        if (improvement >= MEASURED_WIN_MIN_PP) bestMetricLine = `\n📉 Bounce rate dropped ${improvement}pp ${scopeText} (correlation, not attribution)`
      }
      // Within-noise band (−MEASURED_WIN_MIN_PP < Δ < +15pp; keep the 15 in
      // sync with ROLLBACK_BOUNCE_PP_THRESHOLD in handleRollbackCheck). These
      // measured-but-unremarkable outcomes previously produced no message
      // anywhere — the most common result for a paying customer was silence.
      const mehCount = bounceMetrics.filter(m => {
        const delta = m.value_after - m.value_before
        return delta > -MEASURED_WIN_MIN_PP && delta < 15
      }).length
      const mehLine = mehCount > 0
        ? `\n📊 ${mehCount} change${mehCount !== 1 ? 's' : ''} measured within normal variation (no measurable lift, no harm — still live)`
        : ''

      const dnaSummary       = totalLearnings > 0
        ? `\n🧬 <b>Business DNA:</b> ${totalLearnings} learnings${avgPositiveDelta ? ` · avg +${avgPositiveDelta}% on wins` : ''}`
        : ''
      const deployedChanges  = weekRuns.filter(r => DEPLOYED_STATUSES.includes(r.status)).map(r => `  ✅ ${escapeHtml(r.analysis_result?.problem?.slice(0, 60) || 'Change deployed')}`).join('\n') || ''
      const rolledBackChanges = weekRuns.filter(r => ROLLED_BACK_STATUSES.includes(r.status)).map(r => `  🔄 ${escapeHtml(r.analysis_result?.problem?.slice(0, 60) || 'Rolled back')}`).join('\n') || ''

      // C9: zero-LLM site health sweep — one line, best-effort (never blocks the summary).
      const brokenWindows = conn.website_url ? await scanBrokenWindows(conn.website_url) : []
      const bwLine = brokenWindows.length
        ? `\n\n🔧 <b>Quick wins on your site</b> (not conversion fixes — worth a look):\n${brokenWindows.map(f => `  • ${escapeHtml(f)}`).join('\n')}`
        : ''

      const message = `📋 <b>Velyr — Weekly Executive Summary</b>
<i>Week of ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</i>

${trendEmoji} <b>Traffic</b>
${a ? `${a.uniqueVisitors} visitors · ${a.totalPageviews} pageviews` : 'No data'}
${trendText}
Bounce rate: ${bounceText}${bestMetricLine}${mehLine}

🤖 <b>Agent Activity This Week</b>
• Deployed: ${deployed} change${deployed !== 1 ? 's' : ''}
• Rolled back: ${rolledBack}
• Rejected: ${rejected}
• Awaiting approval: ${pending}
${deployedChanges ? `\n<b>Deployed changes:</b>\n${deployedChanges}` : ''}${rolledBackChanges ? `\n<b>Rolled back:</b>\n${rolledBackChanges}` : ''}${dnaSummary}${bwLine}

<i>Next run: Monday · Reply <b>status</b> for details</i>`

      if (chatId) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
        })
      }

      // Weekly digest email — same structured stats, plain-text field variants
      // (digestEmail does its own HTML escaping; the Telegram-HTML strings above
      // must not leak into it). period_key = ISO week ⇒ exactly one digest per
      // subscription per week, however often the cron fires.
      if (emailTo) {
        const deployedTitles = weekRuns
          .filter(r => DEPLOYED_STATUSES.includes(r.status))
          .map(r => r.analysis_result?.problem_title || r.analysis_result?.problem?.slice(0, 60) || 'Change deployed')
        await logAndSend(supabase, {
          subscriptionId,
          to: emailTo,
          emailType: 'weekly_digest',
          periodKey: isoWeekKey(),
          buildMail: (opts) => digestEmail({
            weekLabel: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            visitors: a?.uniqueVisitors ?? null,
            pageviews: a?.totalPageviews ?? null,
            trendText,
            bounceText,
            deployed, rolledBack, rejected, pending,
            deployedTitles,
            bestMetricLine: bestMetricLine.trim() || null,
            mehLine: mehLine.trim() || null,
          }, opts),
        })
      }
    } catch (err) {
      console.error('Weekly summary error for subscription', conn.subscription_id, err)
    }
  })

  return res.json({ success: true, mode: 'weekly_summary' })
}

// ─── MIDWEEK ──────────────────────────────────────────────────────────────────
async function handleMidweek(res) {
  const { data: connections } = await supabase
    .from('agent_connections').select('*, agent_subscriptions!inner(*)')
    .eq('agent_subscriptions.status', 'active')
    .in('agent_subscriptions.subscription_status', ['active', 'trialing'])

  if (!connections || connections.length === 0) {
    return res.json({ success: true, message: 'No active connections' })
  }

  await runPool(connections, 4, async (conn) => {
   try {
    const analytics = await getPostHogAnalytics(
      decryptSecret(conn.posthog_api_key)    || process.env.POSTHOG_API_KEY,
      conn.posthog_project_id || process.env.POSTHOG_PROJECT_ID,
      conn.posthog_host       || process.env.POSTHOG_HOST,
      conn.posthog_host_filter
    )

    const { data: sub } = await supabase
      .from('agent_subscriptions').select('telegram_chat_id')
      .eq('id', conn.subscription_id).single()

    // Owner-only — same tenant-leak fix as weekly_summary.
    const chatId = sub?.telegram_chat_id || null
    if (!chatId) {
      console.warn(`[midweek] sub=${conn.subscription_id}: no telegram_chat_id bound — skipping send`)
      return
    }
    const a      = analytics?.last7Days
    if (!a) return

    const trendEmoji = a.trafficChange === null ? '📊' : a.trafficChange > 10 ? '📈' : a.trafficChange < -10 ? '📉' : '➡️'
    const trendText  = a.trafficChange === null ? 'first week of tracking'
      : a.trafficChange > 0 ? `+${a.trafficChange}% vs last week`
      : `${a.trafficChange}% vs last week`

    const socialLines = Object.entries(a.socialBreakdown)
      .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)
      .map(([platform, visits]) => {
        const emoji = { tiktok: '🎵', instagram: '📸', youtube: '▶️', twitter: '𝕏', google: '🔍', facebook: '📘' }[platform] || '🌐'
        return `  ${emoji} ${escapeHtml(platform)}: ${visits} visits`
      }).join('\n')

    const pagesLines     = a.topPages.slice(0, 3).map(p => `  • ${escapeHtml(p.path)} — ${p.views} views`).join('\n')
    const bounceAssessment = a.bounceRate > 70
      ? `⚠️ High bounce rate (${a.bounceRate}%) — agent will prioritize this Monday`
      : a.bounceRate > 50 ? `🟡 Bounce rate ${a.bounceRate}% — room to improve`
      : a.bounceRate === 0 ? `📊 No bounce data yet`
      : `✅ Bounce rate ${a.bounceRate}% — looking good`

    const message = `📊 <b>Velyr — Mid-Week Update</b>
<i>${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</i>

${trendEmoji} <b>Traffic this week</b>
${a.uniqueVisitors} visitors · ${a.totalPageviews} pageviews
${trendText}

${bounceAssessment}

${socialLines ? `<b>Top traffic sources:</b>\n${socialLines}` : '<b>No social traffic yet this week</b>'}

${pagesLines ? `<b>Most visited:</b>\n${pagesLines}` : ''}

🤖 <i>Watching 24/7. Every Monday the agent sends the next fix for your approval.</i>`

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    })
   } catch (err) {
     console.error('Midweek error for subscription', conn.subscription_id, err)
   }
  })

  return res.json({ success: true, mode: 'midweek' })
}

// ─── POSTHOG ANALYTICS (needed by weekly_summary + midweek) ──────────────────
// Shared-project architecture: all customers emit to Velyr's single PostHog
// project, partitioned by the customer's domain on properties.$host. Every
// query MUST filter by that host or it reads ALL sites' data (incl. velyr.io's
// own pageviews) and mis-attributes it. `hostFilter` is
// agent_connections.posthog_host_filter; if null/empty we skip the queries and
// return null. Keep this $host logic in sync with the twin in
// supabase/functions/agent-run/index.ts (getPostHogAnalytics).
async function getPostHogAnalytics(posthogApiKey, posthogProjectId, posthogHost = 'https://us.i.posthog.com', hostFilter = null) {
  if (!hostFilter || !isValidHostFilter(hostFilter)) {
    console.warn('PostHog analytics skipped: missing/invalid posthog_host_filter (domain) for this connection')
    return null
  }
  try {
    const headers       = { 'Authorization': `Bearer ${posthogApiKey}`, 'Content-Type': 'application/json' }
    const sevenDaysAgo  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const today         = new Date().toISOString().split('T')[0]
    const hostWhere     = [`properties.$host = '${String(hostFilter).replace(/'/g, "''")}'`]

    const query = (body) => fetch(`${posthogHost}/api/projects/${posthogProjectId}/query/`, { method: 'POST', headers, body: JSON.stringify({ query: { ...body, where: hostWhere } }) })

    const [pageviewsRes, sessionsRes, lastWeekRes, referrersRes, utmRes, deviceRes] = await Promise.all([
      query({ kind: 'EventsQuery', select: ['properties.$pathname', 'count()'], event: '$pageview', after: sevenDaysAgo,    before: today, limit: 10,   orderBy: ['count() DESC'] }),
      query({ kind: 'EventsQuery', select: ['properties.$session_id', 'count()'], event: '$pageview', after: sevenDaysAgo,  before: today, limit: 2000 }),
      query({ kind: 'EventsQuery', select: ['properties.$session_id', 'count()'], event: '$pageview', after: fourteenDaysAgo, before: sevenDaysAgo, limit: 2000 }),
      query({ kind: 'EventsQuery', select: ['properties.$referring_domain', 'count()'], event: '$pageview', after: sevenDaysAgo, before: today, limit: 20, orderBy: ['count() DESC'] }),
      query({ kind: 'EventsQuery', select: ['properties.$utm_source', 'properties.$utm_medium', 'properties.$utm_campaign', 'count()'], event: '$pageview', after: sevenDaysAgo, before: today, limit: 20, orderBy: ['count() DESC'] }),
      query({ kind: 'EventsQuery', select: ['properties.$device_type', 'count()'], event: '$pageview', after: sevenDaysAgo, before: today, limit: 10, orderBy: ['count() DESC'] }),
    ])

    const [pageviews, sessions, lastWeek, referrers, utmData, devices] = await Promise.all([
      pageviewsRes.json(), sessionsRes.json(), lastWeekRes.json(),
      referrersRes.json(), utmRes.json(), deviceRes.json(),
    ])

    const sessionPageCounts = {}
    sessions.results?.forEach(row => { sessionPageCounts[row[0]] = (sessionPageCounts[row[0]] || 0) + 1 })
    const uniqueSessions  = Object.keys(sessionPageCounts).length
    const bouncedSessions = Object.values(sessionPageCounts).filter(c => c === 1).length
    const bounceRate      = uniqueSessions > 0 ? Math.round((bouncedSessions / uniqueSessions) * 100) : 0
    const totalPageviews  = pageviews.results?.reduce((sum, row) => sum + (row[1] || 0), 0) || 0
    const lastWeekSessions = new Set(lastWeek.results?.map(r => r[0])).size || 0
    const trafficChange   = lastWeekSessions > 0 ? Math.round(((uniqueSessions - lastWeekSessions) / lastWeekSessions) * 100) : null

    const socialBreakdown = { tiktok: 0, instagram: 0, youtube: 0, twitter: 0, facebook: 0, google: 0 }
    const trafficSources  = []
    referrers.results?.forEach(row => {
      const domain = row[0] || '', visits = row[1]
      if (domain) trafficSources.push({ domain, visits })
      if (domain.includes('tiktok'))    socialBreakdown.tiktok    += visits
      else if (domain.includes('instagram') || domain.includes('ig.me')) socialBreakdown.instagram += visits
      else if (domain.includes('youtube')   || domain.includes('youtu.be')) socialBreakdown.youtube  += visits
      else if (domain.includes('twitter')   || domain.includes('t.co'))     socialBreakdown.twitter  += visits
      else if (domain.includes('facebook')  || domain.includes('fb.me'))    socialBreakdown.facebook += visits
      else if (domain.includes('google'))   socialBreakdown.google   += visits
    })

    const deviceBreakdown = {}
    devices.results?.forEach(row => { if (row[0]) deviceBreakdown[row[0].toLowerCase()] = row[1] })
    const mobilePercent = deviceBreakdown['mobile'] && totalPageviews > 0
      ? Math.round((deviceBreakdown['mobile'] / totalPageviews) * 100) : null

    return {
      last7Days: {
        totalPageviews, uniqueVisitors: uniqueSessions, bounceRate, mobilePercent, trafficChange, lastWeekSessions,
        topPages:      pageviews.results?.slice(0, 5).map(row => ({ path: row[0], views: row[1] })) || [],
        trafficSources: trafficSources.slice(0, 8),
        socialBreakdown, totalSocialVisits: Object.values(socialBreakdown).reduce((s, v) => s + v, 0),
        utmCampaigns:  utmData.results?.filter(row => row[0] || row[2])?.map(row => ({ source: row[0], medium: row[1], campaign: row[2], visits: row[3] }))?.slice(0, 5) || [],
        deviceBreakdown,
      }
    }
  } catch (error) {
    console.error('PostHog analytics error:', error)
    return null
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC TIMELINE / SETTINGS / DNA EXPORT — handlers consolidated here to stay
// within the Vercel Hobby 12-function limit. All routed via ?action=… branches
// at the top of the default handler.
// ════════════════════════════════════════════════════════════════════════════

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

// ─── C12: PUBLIC WIN BADGE / SHARE CARD (SVG, no auth) ────────────────────────
// Same visibility gate as the public timeline (public_slug + is_public). Serves a
// self-contained SVG: `win_badge` is the small embeddable ("Optimized weekly by
// Velyr — last win −Xpp bounce"), `win_card` the larger before/after share card.
// Everything interpolated is escaped in api/_lib/win-card.js; only denormalized
// fields are projected (never analysis_result wholesale — Stage 4.11).
async function handleWinBadge(req, res, kind) {
  const slug = (req.query?.slug || '').toLowerCase().trim()
  if (!slug || !SLUG_REGEX.test(slug)) return res.status(404).json({ error: 'Not found' })

  const { data: sub } = await supabase
    .from('agent_subscriptions')
    .select('id, public_slug, is_public')
    .eq('public_slug', slug).eq('is_public', true).maybeSingle()
  if (!sub) return res.status(404).json({ error: 'Not found' })

  const { data: conn } = await supabase
    .from('agent_connections').select('website_url')
    .eq('subscription_id', sub.id).maybeSingle()
  let siteHost = ''
  try { siteHost = new URL(conn?.website_url).hostname } catch { /* keep '' */ }

  // Newest measured IMPROVEMENT (bounce went down). Legacy 'bounce_rate' rows count.
  const { data: metrics } = await supabase
    .from('impact_metrics')
    .select('run_id, metric_type, value_before, value_after, measured_at')
    .eq('subscription_id', sub.id)
    .in('metric_type', ['site_wide_bounce_rate', 'route_scoped_bounce_rate', 'bounce_rate'])
    .order('measured_at', { ascending: false }).limit(20)
  const win = (metrics || []).find(m =>
    typeof m.value_before === 'number' && typeof m.value_after === 'number' && m.value_after < m.value_before)

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  if (kind === 'win_badge' || !win) {
    // win_card with no measured win degrades to the badge layout — it tells the
    // "no measured win yet" story honestly instead of 404ing an embedded image.
    return res.status(200).send(buildWinBadgeSvg({
      siteHost,
      win: win ? { deltaPp: win.value_after - win.value_before, scope: win.metric_type } : null,
    }))
  }

  // win_card: include the measured run's problem line (denormalized column only).
  let problem = ''
  if (win.run_id) {
    const { data: run } = await supabase
      .from('agent_runs').select('problem_description')
      .eq('id', win.run_id).maybeSingle()
    problem = run?.problem_description || ''
  }
  return res.status(200).send(buildWinCardSvg({
    siteHost, problem,
    before: win.value_before, after: win.value_after,
    deltaPp: win.value_after - win.value_before,
    scope: win.metric_type, measuredAt: win.measured_at,
  }))
}

// ─── Public Timeline (no auth) ────────────────────────────────────────────────
async function handlePublicTimeline(req, res) {
  const slug = (req.query?.slug || '').toLowerCase().trim()
  if (!slug || !SLUG_REGEX.test(slug)) return res.status(404).json({ error: 'Not found' })

  const { data: sub } = await supabase
    .from('agent_subscriptions')
    .select('id, created_at, public_slug, is_public')
    .eq('public_slug', slug).eq('is_public', true).maybeSingle()
  if (!sub) return res.status(404).json({ error: 'Not found' })

  // website_url lives on agent_connections, not agent_subscriptions.
  const { data: conn } = await supabase
    .from('agent_connections')
    .select('website_url')
    .eq('subscription_id', sub.id)
    .maybeSingle()

  // Stage 4.11: explicit field projection on the public timeline. We used to
  // select `analysis_result` wholesale and then dereference one field from it
  // — that leaked the AI's full JSON (file_to_edit paths, code_change.find/
  // replace snippets, internal confidence reasoning) into any future code
  // path that touched the response. Now we project `problem_description`
  // (already denormalized at run time) and use it directly.
  const [runsRes, dnaRes, imRes] = await Promise.all([
    supabase.from('agent_runs')
      // problem_title: the ONLY analysis_result field projected (->> extracts the
      // one string) — the Stage-4.11 no-wholesale-analysis_result rule still holds.
      .select('id, status, created_at, completed_at, problem_description, problem_title:analysis_result->>problem_title, screenshot_before, screenshot_after, bounce_rate_before, bounce_rate_after, score_before, score_after, pr_url, competitor_changes, pages_fixed')
      .eq('subscription_id', sub.id)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('agent_business_dna')
      .select('fix_type, outcome, notes, created_at')
      .eq('subscription_id', sub.id)
      .order('created_at', { ascending: false }).limit(100),
    // Matched-window bounce pairs (deploy±2d, handleRollbackCheck). The public
    // pair renders from these — never from agent_runs.bounce_rate_before/after,
    // which mix a 7-day pre-analysis snapshot with the 48h post-deploy window.
    supabase.from('impact_metrics')
      .select('run_id, metric_type, value_before, value_after, measured_at')
      .eq('subscription_id', sub.id)
      .in('metric_type', ['site_wide_bounce_rate', 'route_scoped_bounce_rate', 'bounce_rate'])
      .order('measured_at', { ascending: false }).limit(100),
  ])

  // run_id → latest matched-window measurement (rows arrive newest-first).
  const impactByRun = new Map()
  for (const im of (imRes.data || [])) {
    if (im.value_before == null || im.value_after == null) continue
    if (!impactByRun.has(im.run_id)) impactByRun.set(im.run_id, im)
  }

  const runs = (runsRes.data || []).map(r => {
    const im = impactByRun.get(r.id)
    return {
      id: r.id, status: r.status,
      date: r.completed_at || r.created_at,
      problem: r.problem_description || null,
      problem_title: r.problem_title || null,
      screenshot_before: r.screenshot_before, screenshot_after: r.screenshot_after,
      // bounce_rate_after feeds the trend chart (every point shares the same
      // 48h-post-deploy methodology). The BEFORE column is deliberately not
      // exposed: pairing it with bounce_rate_after implied a like-for-like
      // comparison across two different windows. The honest pair is `impact`.
      bounce_rate_after: r.bounce_rate_after,
      impact: im ? { metric_type: im.metric_type, bounce_before: im.value_before, bounce_after: im.value_after } : null,
      score_before: r.score_before, score_after: r.score_after,
      pr_url: r.pr_url,
      competitor_changes: r.competitor_changes,
      pages_fixed: r.pages_fixed,
    }
  })

  // Group DNA by fix_type with per-outcome counts. Legacy 'success' rows
  // (pre-vocabulary migration) fold into 'survived' — they were never
  // measured. Unknown outcomes are skipped, never ++'d into NaN.
  const dnaByType = {}
  for (const d of (dnaRes.data || [])) {
    const outcome = d.outcome === 'success' ? 'survived' : d.outcome
    if (!dnaByType[d.fix_type]) dnaByType[d.fix_type] = { fix_type: d.fix_type, measured_win: 0, survived: 0, rollback: 0, pending: 0, latest_note: null }
    if (dnaByType[d.fix_type][outcome] != null) dnaByType[d.fix_type][outcome]++
    if (!dnaByType[d.fix_type].latest_note) dnaByType[d.fix_type].latest_note = d.notes
  }

  return res.status(200).json({
    website_url: conn?.website_url || null,
    created_at:  sub.created_at,
    runs,
    business_dna: Object.values(dnaByType),
  })
}

// ─── Update Agent Settings (Supabase JWT) ─────────────────────────────────────
async function handleUpdateSettings(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const updates = {}

  if (typeof body.is_public === 'boolean') updates.is_public = body.is_public

  if (body.public_slug !== undefined) {
    const slug = body.public_slug == null ? null : String(body.public_slug).toLowerCase().trim()
    if (slug !== null) {
      if (!SLUG_REGEX.test(slug)) return res.status(400).json({ error: 'Slug must be 3-30 lowercase letters, numbers, or hyphens' })
      // Uniqueness check (excluding rows owned by this user)
      const { data: existing } = await supabase
        .from('agent_subscriptions').select('id, auth_user_id')
        .eq('public_slug', slug).maybeSingle()
      if (existing && existing.auth_user_id !== user.id) {
        return res.status(409).json({ error: 'Slug already taken' })
      }
    }
    updates.public_slug = slug
  }

  if (Array.isArray(body.competitors)) {
    const cleaned = body.competitors
      .map(u => String(u || '').trim())
      .filter(Boolean)
      .filter(u => { try { new URL(u); return true } catch { return false } })
      .slice(0, 2)
    updates.competitors = cleaned
  }

  // C5: owner-defined conversion goal (free text; the Pass-1/Pass-2 optimization
  // objective). null/'' clears it. Capped at 300 chars — it's a natural-language target,
  // not structured. Requires migration 20260706_conversion_goal.sql.
  if (body.conversion_goal !== undefined) {
    if (body.conversion_goal === null || String(body.conversion_goal).trim() === '') {
      updates.conversion_goal = null
    } else {
      updates.conversion_goal = String(body.conversion_goal).trim().slice(0, 300)
    }
  }

  // C5 (measurement half): the OPTIONAL structured, measurable twin of the free-text
  // goal — { type: 'click_text' | 'pageview_path', value }. handleRollbackCheck uses it
  // to measure a matched-window goal_conversion_rate alongside bounce (measurement
  // only, never a rollback trigger). Requires migration 20260707_conversion_goal_event.sql.
  if (body.conversion_goal_event !== undefined) {
    const ev = body.conversion_goal_event
    if (ev === null || ev === '') {
      updates.conversion_goal_event = null
    } else {
      const type = ev?.type
      const value = String(ev?.value ?? '').trim()
      if (!['click_text', 'pageview_path'].includes(type) || !value) {
        return res.status(400).json({ error: 'conversion_goal_event must be { type: click_text | pageview_path, value }' })
      }
      if (type === 'pageview_path' && !/^\/[^\s<>"'`]{0,199}$/.test(value)) {
        return res.status(400).json({ error: 'conversion_goal_event.value must be a site-relative path like /checkout' })
      }
      updates.conversion_goal_event = { type, value: value.slice(0, 120) }
    }
  }

  // "Fix in next run" (Funnel tab): pin one page for the next weekly run. The
  // edge function biases the ranker + Pass-2 prompt toward it, then clears the
  // pin once consumed (loadFocusPage/clearFocusPage). null/'' = un-schedule.
  if (body.focus_page_path !== undefined) {
    if (body.focus_page_path === null || body.focus_page_path === '') {
      updates.focus_page_path = null
    } else {
      const p = String(body.focus_page_path).trim()
      if (!/^\/[^\s<>"'`]{0,199}$/.test(p)) {
        return res.status(400).json({ error: 'focus_page_path must be a site-relative path like /pricing' })
      }
      updates.focus_page_path = p
    }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' })

  // B10: resolve the caller's newest subscription and update BY id. The old
  // update-by-auth_user_id + .select().maybeSingle() throws if a user ever holds 2
  // rows (and would write the slug/settings to BOTH). Mirrors handleDnaVerdict.
  const { data: target } = await supabase
    .from('agent_subscriptions').select('id').eq('auth_user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!target) return res.status(404).json({ error: 'No subscription found' })

  const { data, error } = await supabase
    .from('agent_subscriptions').update(updates)
    .eq('id', target.id).select().maybeSingle()
  if (error) {
    // 23505 = the public_slug UNIQUE index rejected a slug another user already
    // holds — the authoritative close to the check-then-write TOCTOU above (see
    // migration 20260702_public_slug_unique.sql).
    if (error.code === '23505') return res.status(409).json({ error: 'Slug already taken' })
    return res.status(500).json({ error: error.message })
  }
  // maybeSingle (not single): a caller with no subscription row returns null here
  // rather than throwing PGRST116 → a 500. Answer with a clean 404 instead.
  if (!data) return res.status(404).json({ error: 'No subscription found' })
  return res.status(200).json({ success: true, subscription: data })
}

// ─── Re-enable Snippet Tracking (Supabase JWT) ────────────────────────────────
// Resets posthog_snippet_declined + retry_count so the Setup-PR flow will
// offer again on the next weekly run. The dashboard banner calls this.
async function handleReenableSnippet(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { data: sub } = await supabase
    .from('agent_subscriptions').select('id').eq('auth_user_id', user.id).single()
  if (!sub) return res.status(404).json({ error: 'No subscription found' })
  const { error } = await supabase
    .from('agent_connections')
    // Item 6: also clear installed_at. Legacy Shopify declines falsely stamped it
    // (the old overload), which made this button a no-op for those merchants.
    // Clearing it is safe for genuinely-installed connections too: both detection
    // paths re-derive a real install from the marker on the next run and re-stamp.
    .update({ posthog_snippet_declined: false, posthog_snippet_retry_count: 0, posthog_snippet_installed_at: null })
    .eq('subscription_id', sub.id)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ success: true })
}

// ─── DNA verdict (Supabase JWT) ───────────────────────────────────────────────
// The DNA tab's Confirm / Wrong buttons. 'rejected' entries are excluded from
// the agent's prompt context on future runs (loadBusinessDNA in the edge fn);
// verdict null clears a previous verdict (undo). Ownership is enforced by
// scoping the update to the caller's own subscription — a dna_id alone is
// never trusted (no IDOR).
async function handleDnaVerdict(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = req.body || {}
  const dnaId = body.dna_id
  const verdict = body.verdict === undefined ? null : body.verdict
  if (!dnaId || typeof dnaId !== 'string') return res.status(400).json({ error: 'dna_id required' })
  if (verdict !== null && verdict !== 'confirmed' && verdict !== 'rejected') {
    return res.status(400).json({ error: "verdict must be 'confirmed', 'rejected', or null" })
  }
  // limit(1)+maybeSingle mirrors the dashboard's duplicate-row-safe lookup.
  const { data: sub } = await supabase
    .from('agent_subscriptions').select('id').eq('auth_user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!sub) return res.status(404).json({ error: 'No subscription found' })
  const { data, error } = await supabase
    .from('agent_business_dna')
    .update({ user_verdict: verdict, user_verdict_at: verdict ? new Date().toISOString() : null })
    .eq('id', dnaId).eq('subscription_id', sub.id)
    .select('id, user_verdict').maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'DNA entry not found' })
  return res.status(200).json({ success: true, entry: data })
}

// ─── Trigger a manual run ("Run now", Supabase JWT) ───────────────────────────
// Fires a single-subscription run on the Edge Function (intent: 'single_run' —
// the same pipeline as the Monday cron, scoped to one sub). Guards:
//   • subscription must be active (not paused) + subscription_status active/trialing
//   • no run already in-flight (running/waiting_approval) — also protects the
//     "at most one waiting_approval per subscription" invariant
//   • at most ONE manual run per 24h (last_manual_run_at) — trialing subs get a
//     72h cooldown instead (LLM-cost control; the Monday cron is unaffected)
// The post-onboarding auto-run and the scheduled cron runs deliberately do NOT
// set last_manual_run_at, so they don't consume the daily allowance.
// subscriptionId is derived from the authenticated user — never from the request
// body (no IDOR; the user never calls the Edge Function directly).
// Keep the two cooldown values in sync with the StatusHero button logic in
// src/pages/AgentDashboard.jsx (client-side disabled state + label).
const MANUAL_RUN_COOLDOWN_MS       = 24 * 60 * 60 * 1000
const TRIAL_MANUAL_RUN_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000
async function handleTriggerRun(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { data: sub, error: subErr } = await supabase
    .from('agent_subscriptions')
    .select('id, status, subscription_status, last_manual_run_at')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (subErr) {
    console.error('[agent/run] trigger_run subscription lookup failed:', subErr.message)
    return res.status(500).json({ error: 'Could not load your subscription. Try again.' })
  }
  if (!sub) return res.status(404).json({ error: 'No subscription found' })

  if (sub.status === 'paused') {
    return res.status(409).json({ error: 'Your agent is paused. Resume it first, then run.' })
  }
  if (!['active', 'trialing'].includes(sub.subscription_status)) {
    return res.status(402).json({ error: 'Your subscription is not active.' })
  }

  // Sweep zombie rows BEFORE the in-flight check: a hard-killed edge isolate
  // leaves its run status='running' forever, which would 409 this guard until
  // the next cron run sweeps it (incident 2026-07-09). A genuinely live run is
  // younger than the stale threshold and still blocks below.
  await cleanupStaleRuns()

  // In-flight guard: never start a second run while one is running or awaiting
  // approval. This is also what makes the post-onboarding auto-run safe — the
  // dashboard button stays blocked until the user answers that first Setup-PR.
  const { data: inflight } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('subscription_id', sub.id)
    // A8: include the Shopify-direct pending states — a staged theme write awaiting YES
    // (shopify_awaiting_approval) or a proposed rollback (shopify_rollback_pending) is
    // just as much "in flight" as a GitHub waiting_approval; a second manual run would
    // stage a duplicate pending write and break the one-pending-per-sub invariant.
    .in('status', ['running', 'waiting_approval', 'shopify_awaiting_approval', 'shopify_rollback_pending'])
    .limit(1)
    .maybeSingle()
  if (inflight) {
    return res.status(409).json({ error: 'A run is already in progress. Wait for it to finish, or respond to the pending PR in Telegram.' })
  }

  // Rolling limit: one manual run per 24h — per 72h while trialing.
  const isTrialing = sub.subscription_status === 'trialing'
  const cooldownMs = isTrialing ? TRIAL_MANUAL_RUN_COOLDOWN_MS : MANUAL_RUN_COOLDOWN_MS
  if (sub.last_manual_run_at) {
    const last    = new Date(sub.last_manual_run_at).getTime()
    const elapsed = Date.now() - last
    if (elapsed < cooldownMs) {
      const nextManualRunAt = new Date(last + cooldownMs).toISOString()
      res.setHeader('Retry-After', String(Math.ceil((cooldownMs - elapsed) / 1000)))
      return res.status(429).json({
        error: isTrialing
          ? 'During your free trial you can trigger one manual run every 3 days. Your scheduled runs keep going automatically.'
          : 'You can trigger one manual run per day. Your scheduled runs keep going automatically.',
        nextManualRunAt,
      })
    }
  }

  // Fire the Edge Function (single_run) — same 2s-abort fire-and-forget pattern
  // as the cron full-run dispatch. AbortError = the request was sent and the
  // Edge run is (almost certainly) starting.
  const edgeUrl    = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-run`
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 2000)
  let dispatched = true
  try {
    await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ intent: 'single_run', subscriptionId: sub.id }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name !== 'AbortError') {
      dispatched = false
      console.error('[agent/run] trigger_run dispatch failed:', err?.message || String(err))
    }
  } finally {
    clearTimeout(timeoutId)
  }

  if (!dispatched) {
    return res.status(502).json({ error: 'Could not start the run. Please try again.' })
  }

  // Only consume the allowance after a confirmed dispatch.
  const nextManualRunAt = new Date(Date.now() + cooldownMs).toISOString()
  await supabase.from('agent_subscriptions')
    .update({ last_manual_run_at: new Date().toISOString() })
    .eq('id', sub.id)

  return res.status(200).json({ success: true, triggered: true, nextManualRunAt })
}

// ─── Badge install: the agent ships the C12 win badge into the site footer ────
// POST /api/agent/run?action=install_badge (Bearer). The dashboard button IS the
// user's explicit consent, so this ships directly — GitHub: PR created and merged
// in one step (the PR stays as audit trail + revert path); Shopify-direct:
// immediate themeFilesUpsert on the MAIN theme. Runs synchronously inside the
// 60s budget (a handful of API calls, no LLM).
//
// Deliberately does NOT touch last_manual_run_at — installing the badge never
// consumes the daily manual-run allowance. It DOES take the same in-flight guard
// as trigger_run plus the cross-runtime run lock: writing a theme file while a
// staged Shopify fix awaits YES would invalidate that fix's analysis-time
// checksum and abort it.
async function handleInstallBadge(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { data: sub, error: subErr } = await supabase
    .from('agent_subscriptions')
    .select('id, status, subscription_status, is_public, public_slug, telegram_chat_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (subErr) {
    console.error('[install_badge] subscription lookup failed:', subErr.message)
    return res.status(500).json({ error: 'Could not load your subscription. Try again.' })
  }
  if (!sub) return res.status(404).json({ error: 'No subscription found' })
  if (!['active', 'trialing'].includes(sub.subscription_status)) {
    return res.status(402).json({ error: 'Your subscription is not active.' })
  }
  // The badge links to the public timeline and the SVG endpoint is gated on
  // is_public server-side — installing without a public profile would ship a
  // dead link + broken image.
  if (!sub.is_public || !sub.public_slug) {
    return res.status(409).json({ error: 'Make your timeline public and save a slug first — the badge links to it.' })
  }

  const { data: inflight } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('subscription_id', sub.id)
    .in('status', ['running', 'waiting_approval', 'shopify_awaiting_approval', 'shopify_rollback_pending'])
    .limit(1)
    .maybeSingle()
  if (inflight) {
    return res.status(409).json({ error: 'A run is in progress or awaiting your approval. Decide it first, then install the badge.' })
  }

  // Cross-runtime run lock (same RPC the edge fn uses) so a badge install can't
  // interleave with a starting weekly/manual run. Fail-open like the edge fn —
  // the in-flight guard above already caught the common case.
  let locked = true
  try {
    const { data, error } = await supabase.rpc('agent_run_lock_acquire', {
      p_subscription_id: sub.id,
      p_locked_until: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    })
    if (!error) locked = data === true
  } catch { /* fail open */ }
  if (!locked) {
    return res.status(409).json({ error: 'A run is starting right now. Try again in a minute.' })
  }

  try {
    const { data: conn } = await supabase
      .from('agent_connections')
      .select('*')
      .eq('subscription_id', sub.id)
      .maybeSingle()
    if (!conn) return res.status(404).json({ error: 'Connect your repo or store first.' })

    const isShopifyDirect = conn.connection_source === 'shopify_direct'
      || (conn.shopify_shop_domain && !conn.github_repo_name)
    if (isShopifyDirect) return await installBadgeShopifyDirect(res, sub, conn)

    if (!conn.github_installation_id || !conn.github_repo_name) {
      return res.status(409).json({ error: 'No GitHub repo connected.' })
    }
    return await installBadgeGithub(res, sub, conn)
  } catch (err) {
    console.error('[install_badge] failed:', err?.message || String(err))
    return res.status(502).json({ error: 'The install failed before anything shipped. Nothing was changed — you can copy the embed code and paste it manually.' })
  } finally {
    try { await supabase.rpc('agent_run_lock_release', { p_subscription_id: sub.id }) } catch { /* TTL cleans up */ }
  }
}

// Informational Telegram (no approval buttons — the change already shipped).
async function sendBadgeTelegram(chatId, html) {
  if (!chatId) return
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML' }),
  }).catch(() => {})
}

async function installBadgeGithub(res, sub, conn) {
  const octokit = await getOctokit(conn.github_installation_id)
  const owner = conn.github_repo_owner
  const repo  = conn.github_repo_name
  const defaultBranch = await getDefaultBranch(octokit, owner, repo)

  // First existing candidate wins. layout/theme.liquid (a GitHub-synced Shopify
  // theme) honors the connected-branch override — same rule as createPR and the
  // rollback revert PR; every other shell reads from the default branch.
  let target = null, currentFile = null, baseBranch = null
  for (const cand of BADGE_TARGETS) {
    const ref = (cand.path === 'layout/theme.liquid' && conn.shopify_connected_branch)
      ? conn.shopify_connected_branch : defaultBranch
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: cand.path, ref })
      if (data && !Array.isArray(data) && data.type === 'file') {
        target = cand; currentFile = data; baseBranch = ref
        break
      }
    } catch (e) {
      if (e?.status !== 404) throw e
    }
  }
  if (!target) {
    return res.status(422).json({ error: 'No suitable footer file found (index.html, app layout, _document or theme.liquid). Copy the embed code and paste it manually.' })
  }

  const content  = Buffer.from(currentFile.content, 'base64').toString('utf8')
  const expected = buildBadgeBlock(sub.public_slug, target.variant)
  const decision = decideBadgeInjection(content, expected, target.variant)
  if (decision.action === 'skip') {
    return res.status(200).json({ already_installed: true, path: target.path })
  }
  if (decision.action === 'no_anchor') {
    return res.status(422).json({ error: `No </body> found in ${target.path} to anchor the badge on. Copy the embed code and paste it manually.` })
  }

  // Stable per-subscription branch (createSnippetPR pattern): delete a stale one,
  // recut from base, single commit, PR, immediate squash-merge.
  const branchName = `agent/badge-${sub.id.slice(0, 8)}`
  try { await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branchName}` }) } catch { /* absent is fine */ }
  const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` })
  await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: baseRef.object.sha })
  await octokit.rest.repos.createOrUpdateFileContents({
    owner, repo, path: target.path,
    message: 'Add Velyr win badge to the site footer',
    content: Buffer.from(decision.newContent, 'utf8').toString('base64'),
    sha: currentFile.sha, branch: branchName,
  })
  const { data: pr } = await octokit.rest.pulls.create({
    owner, repo,
    title: '🏅 Add Velyr win badge',
    body: `Adds the Velyr win badge to \`${target.path}\` (just above \`</body>\`). It links to your public timeline and updates automatically with your latest measured win.\n\n_Requested from the dashboard ("Let the agent install it") — merged immediately on your click._`,
    head: branchName, base: baseBranch,
  })

  const nowIso = new Date().toISOString()
  const analysis = {
    problem_title: 'Win badge added to your site',
    problem: `Added the Velyr win badge to ${target.path}`,
    solution: 'Inserted the badge embed just above </body> so it renders at the bottom of every page.',
    file_to_edit: target.path,
  }

  let mergeSha = null
  try {
    const { data: merged } = await octokit.rest.pulls.merge({ owner, repo, pull_number: pr.number, merge_method: 'squash' })
    mergeSha = merged?.sha ?? null
  } catch (mergeErr) {
    // Branch protection or a race can block the instant merge. Honest fallback:
    // leave the PR open as a normal waiting_approval run — the existing dashboard
    // approve / Telegram YES machinery merges it.
    console.warn('[install_badge] instant merge failed, leaving PR for approval:', mergeErr?.message)
    await supabase.from('agent_runs').insert({
      subscription_id: sub.id, run_type: 'badge_install', status: 'waiting_approval',
      current_step: 'done', completed_at: nowIso,
      pr_number: pr.number, pr_url: pr.html_url, pages_fixed: [target.path],
      problem_description: 'Install the Velyr win badge',
      analysis_result: analysis,
    })
    await sendBadgeTelegram(sub.telegram_chat_id,
      `🏅 <b>Win badge ready</b>\n\nI prepared the badge for <code>${escapeHtml(target.path)}</code> but couldn't merge automatically (branch protection?). Approve it like a normal fix: ${escapeHtml(pr.html_url)}`)
    return res.status(200).json({ success: true, installed: false, needs_approval: true, pr_url: pr.html_url, path: target.path })
  }

  await supabase.from('agent_runs').insert({
    subscription_id: sub.id, run_type: 'badge_install', status: 'deployed',
    current_step: 'done', completed_at: nowIso,
    pr_number: pr.number, pr_url: pr.html_url, merge_commit_sha: mergeSha,
    pages_fixed: [target.path],
    problem_description: 'Install the Velyr win badge',
    analysis_result: analysis,
  })
  await sendBadgeTelegram(sub.telegram_chat_id,
    `🏅 <b>Win badge installed</b>\n\nAdded to <code>${escapeHtml(target.path)}</code> and merged (PR #${pr.number}). Your deploy pipeline is shipping it now — the badge updates automatically with your latest measured win.`)
  return res.status(200).json({ success: true, installed: true, pr_url: pr.html_url, path: target.path })
}

async function installBadgeShopifyDirect(res, sub, conn) {
  if (!conn.shopify_main_theme_id) {
    return res.status(409).json({ error: 'No Shopify theme selected. Finish onboarding first.' })
  }
  const tok = await refreshShopifyToken(supabase, conn)
  if (!tok.ok) {
    return res.status(tok.reason === 'needs_reconsent' ? 409 : 502).json({
      error: tok.reason === 'needs_reconsent'
        ? 'Your Shopify connection has expired — reconnect your store first.'
        : 'Could not reach Shopify just now. Nothing was changed — try again in a minute.',
    })
  }
  const shop = conn.shopify_shop_domain
  const themeId = conn.shopify_main_theme_id

  const read = await readThemeFile(shop, tok.accessToken, themeId, 'layout/theme.liquid')
  if (!read.ok) {
    return res.status(502).json({ error: `Could not read your theme (${read.reason}). Nothing was changed.` })
  }

  const expected = buildBadgeBlock(sub.public_slug, 'html')
  const decision = decideBadgeInjection(read.content, expected, 'html')
  if (decision.action === 'skip') {
    return res.status(200).json({ already_installed: true, path: 'layout/theme.liquid' })
  }
  if (decision.action === 'no_anchor') {
    return res.status(422).json({ error: 'No </body> found in layout/theme.liquid to anchor the badge on. Copy the embed code and paste it into your theme manually.' })
  }

  const up = await upsertThemeFiles(shop, tok.accessToken, themeId, [
    { filename: 'layout/theme.liquid', content: decision.newContent },
  ])
  if (!up.ok || (up.userErrors && up.userErrors.length > 0)) {
    const detail = up.ok ? up.userErrors.map(e => e.message).join('; ') : up.message
    console.error('[install_badge] theme upsert failed:', detail)
    return res.status(502).json({ error: 'Shopify rejected the theme write. Nothing was changed — you can paste the embed code manually.' })
  }

  await supabase.from('agent_runs').insert({
    subscription_id: sub.id, run_type: 'badge_install', status: 'shopify_deployed',
    current_step: 'done', completed_at: new Date().toISOString(),
    pages_fixed: ['layout/theme.liquid'],
    problem_description: 'Install the Velyr win badge',
    analysis_result: {
      problem_title: 'Win badge added to your store',
      problem: 'Added the Velyr win badge to layout/theme.liquid',
      solution: 'Inserted the badge embed just above </body> so it renders at the bottom of every page.',
      file_to_edit: 'layout/theme.liquid',
      // Rollback basis, same shape executeShopifyDirectRollback consumes.
      applied_write: {
        themeId,
        files: [{ filename: 'layout/theme.liquid', op: 'modified', priorContent: read.content, checksumMd5: read.checksumMd5 }],
      },
    },
  })
  await sendBadgeTelegram(sub.telegram_chat_id,
    `🏅 <b>Win badge installed</b>\n\nWritten to <code>layout/theme.liquid</code> on your live theme. It renders at the bottom of every page and updates automatically with your latest measured win.`)
  return res.status(200).json({ success: true, installed: true, path: 'layout/theme.liquid' })
}

// ─── C2: Approve / reject a run from the DASHBOARD (Supabase JWT) ─────────────
// The web twin of the Telegram YES/NO for GitHub runs — customers who miss the
// Telegram ping can act from the place they already check results. It reuses the SAME
// reconcile helpers + compare-and-swap as the Telegram + GitHub-webhook paths, so a
// dashboard action and a Telegram reply racing each other is safe (one wins, one no-ops)
// and lands the run in exactly the same state (incl. the A1 rollback branches).
//
// Handles BOTH connection types: GitHub runs ('waiting_approval', merge/close the PR) and
// Shopify-direct theme runs ('shopify_awaiting_approval' apply, 'shopify_rollback_pending'
// rollback) via the shared api/_lib/shopify-approval.js executor — the exact same code the
// Telegram YES/NO runs, so a dashboard action and a Telegram reply racing is safe. The
// foreign-analytics choice is the one exception (it needs the edge Setup-PR build) → 409 →
// Telegram. Ownership: the run must belong to one of the caller's own subscriptions (no IDOR).
async function handleRunAction(req, res, user, action) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const runId = req.body?.run_id
  if (!runId || typeof runId !== 'string') return res.status(400).json({ error: 'run_id required' })

  const { data: subs } = await supabase
    .from('agent_subscriptions').select('id').eq('auth_user_id', user.id)
  const subIds = (subs || []).map(s => s.id)
  if (subIds.length === 0) return res.status(404).json({ error: 'No subscription found' })

  const { data: run } = await supabase
    .from('agent_runs').select('*').eq('id', runId).in('subscription_id', subIds).maybeSingle()
  if (!run) return res.status(404).json({ error: 'Run not found' })

  const { data: conn } = await supabase
    .from('agent_connections').select('*').eq('subscription_id', run.subscription_id).single()
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  // ── Shopify-direct theme runs: apply / rollback / reject via the SHARED executor —
  // the exact same code the Telegram YES/NO runs (api/_lib/shopify-approval.js), so a
  // dashboard tap racing a Telegram reply is safe (the executor's own CAS claim means one
  // wins, one returns { noop }). The message is Telegram-HTML → strip tags for the JSON. ──
  if (run.status === 'shopify_awaiting_approval' || run.status === 'shopify_rollback_pending') {
    let r
    if (action === 'reject_run') {
      r = await rejectShopifyDirect(supabase, run)
    } else if (run.status === 'shopify_rollback_pending') {
      r = await executeShopifyDirectRollback(supabase, run, conn)
    } else {
      r = await applyShopifyDirectWrite(supabase, run, conn)
    }
    if (r.noop) return res.status(409).json({ error: 'This run is already being handled — refresh in a moment.' })
    // An executor 'failed' outcome (Shopify unreachable, token dead, …) is NOT a success —
    // report it as one and the UI styles a failure as done. Concurrency abort et al. are
    // honest terminal outcomes and stay 200.
    if (r.status === 'failed') return res.status(502).json({ success: false, error: stripHtml(r.message), status: 'failed' })
    return res.status(200).json({ success: true, status: r.status, message: stripHtml(r.message) })
  }

  // Any other non-pending status (already deployed/rejected/rolled back, or a stale row).
  if (run.status !== 'waiting_approval') {
    return res.status(409).json({ error: 'This run is no longer awaiting approval.' })
  }

  // ── Reject (GitHub) ──
  if (action === 'reject_run') {
    await closeRejectedPr(conn, run, { close: true })
    const result = await reconcileRejected(supabase, run, { rejectLabel: 'dashboard' })
    if (result.kind === 'noop') return res.status(200).json({ success: true, status: run.status, already: true })
    // Declining a ROLLBACK proposal keeps the change live: the run flips back to
    // 'deployed', not 'rejected' — report the state the DB actually landed in.
    if (result.kind === 'rollback_declined') {
      return res.status(200).json({ success: true, status: 'deployed', kind: result.kind, message: 'Rollback declined — the change stays live and the agent keeps watching its metrics.' })
    }
    // Parity with the Telegram NO + GitHub-close paths: a declined Setup-PR still
    // starts the analysis run it consumed.
    if (result.kind === 'setup_declined' || result.kind === 'foreign_declined') {
      await startFollowupRun(supabase, run.subscription_id)
    }
    return res.status(200).json({ success: true, status: 'rejected', kind: result.kind })
  }

  // ── Approve ──
  // Foreign-choice (add-analytics-alongside) needs the edge Setup-PR build — keep it in
  // Telegram (that path fire-and-forgets to the edge fn).
  if (run.run_type === 'setup_posthog_foreign_choice') {
    return res.status(409).json({ error: 'Confirm this analytics choice in Telegram.' })
  }
  if (!run.pr_number) return res.status(409).json({ error: 'This run has no pull request to merge.' })

  const octokit = await getOctokit(conn.github_installation_id)
  let prInfo
  try {
    const { data } = await octokit.rest.pulls.get({ owner: conn.github_repo_owner, repo: conn.github_repo_name, pull_number: run.pr_number })
    prInfo = data
  } catch (err) {
    return res.status(502).json({ error: `Could not fetch PR #${run.pr_number} from GitHub.` })
  }

  // Already merged out-of-band → just reconcile.
  if (prInfo.merged) {
    const r = await reconcileDeployed(supabase, run, prInfo.merge_commit_sha, { approvalLabel: 'dashboard, already merged' })
    if (r.kind === 'setup_installed') await startFollowupRun(supabase, run.subscription_id)
    const rolledBack = r.kind === 'rollback_executed'
    return res.status(200).json({ success: true, status: rolledBack ? 'rolled_back' : 'deployed', already: true, ...(rolledBack ? { message: 'Rolled back — your site is restored to the previous version.' } : {}) })
  }
  if (prInfo.state === 'closed') return res.status(409).json({ error: 'The pull request is closed (not merged).' })
  if (prInfo.mergeable === false) return res.status(409).json({ error: 'The PR is not mergeable (a conflict with the base branch). Resolve it on GitHub, then retry.' })

  let mergeSha = null
  try {
    const { data: mergeResult } = await octokit.rest.pulls.merge({
      owner: conn.github_repo_owner, repo: conn.github_repo_name, pull_number: run.pr_number, merge_method: 'squash',
    })
    mergeSha = mergeResult?.sha || null
  } catch (err) {
    return res.status(502).json({ error: `Merge failed: ${err?.message || 'GitHub error'}. Fix on GitHub and retry, or reject.` })
  }

  const result = await reconcileDeployed(supabase, run, mergeSha, { approvalLabel: 'dashboard' })
  if (result.kind === 'noop') return res.status(200).json({ success: true, status: 'deployed', already: true })
  if (result.kind === 'setup_installed') {
    await startFollowupRun(supabase, run.subscription_id)
    return res.status(200).json({ success: true, status: 'deployed', kind: 'setup_installed' })
  }
  const rolledBack = result.kind === 'rollback_executed'
  return res.status(200).json({ success: true, status: rolledBack ? 'rolled_back' : 'deployed', kind: result.kind, ...(rolledBack ? { message: 'Rolled back — your site is restored to the previous version.' } : {}) })
}
