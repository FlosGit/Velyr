import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import { throttling } from '@octokit/plugin-throttling'
import crypto from 'node:crypto'
import { decryptSecret } from '../_lib/secret-crypto.js'

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
}

// Constant-time string equality for shared-secret comparisons.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// ─── LLM COST GUARDRAILS (mirrored from Edge Function) ───────────────────────
// Keep these in sync with supabase/functions/agent-run/index.ts. We duplicate
// rather than share because Vercel (Node) and Supabase (Deno) don't share a
// module graph and this is a single-purpose helper. Override via env vars.
const LLM_MAX_TOKENS_PLAYBOOK   = Number(process.env.LLM_MAX_TOKENS_PLAYBOOK   || '1500')
const LLM_INPUT_EUR_PER_M       = Number(process.env.LLM_INPUT_EUR_PER_M      || '3.0')
const LLM_OUTPUT_EUR_PER_M      = Number(process.env.LLM_OUTPUT_EUR_PER_M     || '15.0')
const LLM_MAX_PROMPT_BYTES      = Number(process.env.LLM_MAX_PROMPT_BYTES     || String(500 * 1024))
const MONTHLY_SPEND_CAP_EUR     = Number(process.env.AGENT_MONTHLY_SPEND_CAP_EUR || '2.0')

async function getMonthlySpend(subscriptionId) {
  const period = new Date().toISOString().slice(0, 7)
  const { data, error } = await supabase
    .from('agent_llm_usage').select('cost_eur')
    .eq('subscription_id', subscriptionId).eq('period', period).maybeSingle()
  if (error) {
    console.warn('[llm-cap] agent_llm_usage read failed (migration not applied?):', error.message)
    return { spent: 0, period, capAvailable: false }
  }
  return { spent: Number(data?.cost_eur ?? 0), period, capAvailable: true }
}

async function recordLLMUsage(subscriptionId, inputTokens, outputTokens, callerLabel) {
  const costEur = (inputTokens / 1_000_000) * LLM_INPUT_EUR_PER_M
                + (outputTokens / 1_000_000) * LLM_OUTPUT_EUR_PER_M
  const period = new Date().toISOString().slice(0, 7)
  const { error } = await supabase.rpc('agent_llm_usage_increment', {
    p_subscription_id: subscriptionId,
    p_period:          period,
    p_input_tokens:    inputTokens,
    p_output_tokens:   outputTokens,
    p_cost_eur:        costEur,
  })
  if (error) console.warn(`[llm-cap] failed to record usage for ${callerLabel}:`, error.message)
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
async function captureScreenshot(url) {
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
      // <=90). Comfortable now that no selector wait burns the budget; capture
      // stays inline and completes well under the ~150s edge wall-clock.
      navigation_timeout: '20', timeout: '30',
      response_type: 'json',
    })
    // Abort exceeds ScreenshotOne's `timeout` (30s) — 35s — so the fetch can't cut
    // off a capture that's still finishing. On failure captureScreenshot returns
    // null and the run continues (non-blocking).
    const res = await fetch(`https://api.screenshotone.com/take?${params}`, { signal: AbortSignal.timeout(35000) })
    if (!res.ok) {
      // Surface the real cause (e.g. request_not_valid + error_details) instead
      // of swallowing the 400 — see ScreenshotOne error response body.
      const body = await res.text()
      console.error('ScreenshotOne failed', res.status, body)
      return null
    }
    const data = await res.json()
    // Canonical field for response_type=json is screenshot_url; cache_url only
    // appears when caching kicks in, store.location only with own-S3 storage.
    return data?.screenshot_url || data?.cache_url || data?.store?.location || null
  } catch { return null }
}

async function recordDNA(subscriptionId, runId, fixType, outcome, notes) {
  await supabase.from('agent_business_dna').insert({
    subscription_id: subscriptionId, run_id: runId, fix_type: fixType, outcome,
    notes: (notes || '').slice(0, 500),
  })
}

// Promote DNA entries with outcome='pending' to 'success' after 7 days
// if their run is still in 'deployed' status (not rolled back).
async function promotePendingDNAToSuccess() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: pending } = await supabase
    .from('agent_business_dna').select('id, run_id, fix_type')
    .eq('outcome', 'pending').lte('created_at', sevenDaysAgo)
  if (!pending?.length) return
  for (const p of pending) {
    if (!p.run_id) continue
    const { data: run } = await supabase.from('agent_runs').select('status').eq('id', p.run_id).single()
    if (run?.status === 'deployed') {
      await supabase.from('agent_business_dna').update({ outcome: 'success' }).eq('id', p.id)
    }
  }
}

// Folded from api/agent/enforce-subscriptions.js (FOLD stage): the daily sweep
// that cancels subscriptions past their period end and GCs the Telegram dedupe
// table. Logic unchanged; it reuses this file's `supabase` client (same project
// + service-role key as the original) and runs under this file's cron auth, so
// the standalone authorizeCron from the old file is no longer needed.
async function handleEnforceSubscriptions(res) {
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

  return res.json({ ok: true, ran_at: now })
}

export default async function handler(req, res) {
  const action = req.query?.action

  // ── PUBLIC TIMELINE (no auth) ─────────────────────────────────────────────
  // GET /api/agent/run?action=public-timeline&slug=florian
  if (action === 'public-timeline') {
    return handlePublicTimeline(req, res)
  }

  // ── Authenticated user actions (Supabase JWT) ─────────────────────────────
  if (action === 'update-settings' || action === 'export-dna' || action === 'reenable_snippet') {
    const authHeader = req.headers.authorization
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

    if (action === 'update-settings')  return handleUpdateSettings(req, res, user)
    if (action === 'export-dna')       return handleExportDNA(req, res, user)
    if (action === 'reenable_snippet') return handleReenableSnippet(req, res, user)
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

      const subIds = subs?.map(s => s.id) || []
      if (subIds.length > 0) {
        await supabase.from('agent_runs').delete().in('subscription_id', subIds)
        await supabase.from('agent_connections').delete().in('subscription_id', subIds)
        await supabase.from('agent_subscriptions').delete().in('id', subIds)
      }
      await supabase.auth.admin.deleteUser(user.id)
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
  if (mode === 'evaluate_ab')          return handleEvaluateAB(res)
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

// ─── EVALUATE A/B ─────────────────────────────────────────────────────────────
async function handleEvaluateAB(res) {
  const { data: tests } = await supabase
    .from('agent_ab_tests')
    .select('*')
    .eq('status', 'running')
    .lt('evaluate_after', new Date().toISOString())

  if (!tests || tests.length === 0) {
    return res.json({ success: true, message: 'No A/B tests to evaluate' })
  }

  for (const test of tests) {
    try {
      const { data: conn } = await supabase
        .from('agent_connections').select('*')
        .eq('subscription_id', test.subscription_id).single()

      const apiKey    = decryptSecret(conn?.posthog_api_key)    || process.env.POSTHOG_API_KEY
      const projectId = conn?.posthog_project_id || process.env.POSTHOG_PROJECT_ID
      const host      = conn?.posthog_host       || process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
      if (!apiKey) continue

      const flagRes  = await fetch(`${host}/api/projects/${projectId}/feature_flags/${test.posthog_flag_id}/`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const flagData = await flagRes.json()
      const results  = flagData?.experiment_results?.result
      if (!results) continue

      const controlRate   = results.control?.conversion_rate   ?? 0
      const treatmentRate = results.treatment?.conversion_rate ?? 0

      let winner = null, delta = 0
      if (treatmentRate > controlRate * 1.05) {
        winner = 'treatment'
        delta  = Math.round(((treatmentRate - controlRate) / (controlRate || 1)) * 100)
      } else if (controlRate > treatmentRate * 1.05) {
        winner = 'control'
        delta  = -Math.round(((controlRate - treatmentRate) / (controlRate || 1)) * 100)
      }
      if (!winner) continue

      await supabase.from('agent_learnings').insert({
        subscription_id: test.subscription_id, run_id: test.run_id,
        change_type: test.change_type, summary: test.summary,
        outcome: winner === 'treatment' ? 'positive' : 'negative',
        metric_type: 'conversion_rate', delta, confidence: 'high',
      })

      // 3d/3i: also write to agent_business_dna so the DNA tab and Claude prompt see this
      await recordDNA(
        test.subscription_id, test.run_id, test.change_type || 'other',
        winner === 'treatment' ? 'success' : 'rollback',
        winner === 'treatment'
          ? `A/B winner (treatment): ${test.summary} (+${delta}% conversion)`
          : `A/B loser (control won): ${test.summary} (${delta}% vs control)`
      )

      await supabase.from('agent_ab_tests')
        .update({ status: 'completed', winner, delta_pct: delta })
        .eq('id', test.id)

      // 3i: if control won, auto-revert the change via a follow-up PR
      let revertedPrUrl = null
      if (winner === 'control') {
        try {
          const { data: run } = await supabase.from('agent_runs').select('*').eq('id', test.run_id).single()
          if (run?.analysis_result?.file_to_edit && conn?.github_installation_id) {
            const octokit = await getOctokit(conn.github_installation_id)
            const owner   = conn.github_repo_owner
            const repo    = conn.github_repo_name
            const { data: commits } = await octokit.rest.repos.listCommits({ owner, repo, per_page: 30 })
            const agentCommit = commits.find(c =>
              c.commit.message.startsWith('fix:') &&
              c.commit.message.includes((run.analysis_result.problem || '').slice(0, 30))
            )
            const parentSha = agentCommit?.parents?.[0]?.sha
            if (parentSha) {
              const defaultBranch = await getDefaultBranch(octokit, owner, repo)
              const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` })
              const branchName    = `agent/ab-revert-${test.run_id.slice(0, 8)}`
              await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: ref.object.sha })
              const { data: originalFile } = await octokit.rest.repos.getContent({ owner, repo, path: run.analysis_result.file_to_edit, ref: parentSha })
              const { data: currentFile  } = await octokit.rest.repos.getContent({ owner, repo, path: run.analysis_result.file_to_edit })
              await octokit.rest.repos.createOrUpdateFileContents({
                owner, repo, path: run.analysis_result.file_to_edit,
                message: `revert: A/B test — control won (${delta}%)`,
                content: originalFile.content, sha: currentFile.sha, branch: branchName,
              })
              // Stage 4.8: do NOT auto-merge revert PRs. Open the PR, mark the
              // run as waiting_approval, and let the user confirm via Telegram.
              const { data: revertPr } = await octokit.rest.pulls.create({
                owner, repo,
                title: `🔄 A/B Auto-Revert: ${run.analysis_result.problem}`,
                body: `## A/B Test — Control Won\n\nAfter 7 days, the control variant outperformed the treatment by ${Math.abs(delta)}%.\n\nThis PR reverts the change to restore the original.\n\n_Reply *YES* in Telegram to merge this revert, or *NO* to keep the treatment live._`,
                head: branchName, base: defaultBranch,
              })
              await supabase.from('agent_runs').update({
                status:     'waiting_approval',
                pr_number:  revertPr.number,
                pr_url:     revertPr.html_url,
              }).eq('id', test.run_id)
              revertedPrUrl = revertPr.html_url
            }
          }
        } catch (revertErr) {
          console.error('A/B auto-revert failed:', revertErr)
        }
      }

      const outcomeMsg = winner === 'treatment'
        ? `✅ *A/B Test Winner: Treatment*\n📈 +${delta}% conversion lift confirmed.\nSaved to your Business DNA.`
        : `📊 *A/B Result: Control Won*\n📉 Change did not improve conversions (${delta}%).\nLearning saved — agent will avoid similar patterns.${revertedPrUrl ? `\n🔄 Revert PR opened (awaiting your approval): ${revertedPrUrl}\nReply *YES* to merge, *NO* to keep the treatment live.` : ''}`

      // Telegram HTML migration intentionally SKIPPED here: handleEvaluateAB is
      // vestigial (the agent no longer creates A/B tests; this mode has no cron
      // entry in vercel.json and is never invoked). Left on legacy Markdown
      // as-is rather than migrated, to avoid touching dead code. If A/B ever
      // returns, migrate this to parse_mode: 'HTML' + escapeHtml(test.summary).
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `🤖 *Velyr Growth Agent — A/B Result*\n\n*${test.summary}*\n\n${outcomeMsg}`,
          parse_mode: 'Markdown',
        }),
      })
    } catch (err) {
      console.error('A/B evaluate error for test', test.id, err)
    }
  }

  return res.json({ success: true, evaluated: tests.length })
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
  return p
    .replace(/^(src\/pages|pages|src\/views|src\/screens)\//, '/')
    .replace(/\.(jsx|tsx|js|ts)$/, '')
    .replace(/\/index$/, '/')
    .toLowerCase()
}

// ─── ROLLBACK CHECK ───────────────────────────────────────────────────────────
async function handleRollbackCheck(res) {
  // The sole deterministic rollback trigger: site-wide bounce rate rose by at
  // least this many percentage points in the 48h after a change merged. The
  // AI's rollback_signal is a labelled hypothesis only — it never gates this.
  // Keep in sync with the other ROLLBACK_BOUNCE_PP_THRESHOLD declaration
  // (supabase/functions/agent-run/receipt-builder.ts). Format-contract dedup,
  // same reason as encryptSecret: Node and Deno can't share a module cleanly.
  const ROLLBACK_BOUNCE_PP_THRESHOLD = 15

  // Promote DNA entries that have stayed deployed for 7+ days to 'success'.
  await promotePendingDNAToSuccess().catch(e => console.error('DNA promote error:', e))

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const ninetyTwoHoursAgo  = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString()

  const { data: deployedRuns } = await supabase
    .from('agent_runs').select('*')
    .eq('status', 'deployed')
    .gte('completed_at', ninetyTwoHoursAgo)
    .lte('completed_at', fortyEightHoursAgo)

  if (!deployedRuns || deployedRuns.length === 0) {
    return res.json({ success: true, message: 'No runs to evaluate for rollback' })
  }

  for (const run of deployedRuns) {
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
      const hostFilter = conn?.posthog_host_filter
      if (!hostFilter) {
        console.warn(`[rollback_check] run=${run.id} sub=${run.subscription_id}: no posthog_host_filter — skipping bounce comparison`)
        continue
      }
      const hostWhere     = [`properties.$host = '${String(hostFilter).replace(/'/g, "''")}'`]

      const deployedAt    = new Date(run.completed_at)
      const twoDaysBefore = new Date(deployedAt - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const deployedDate  = deployedAt.toISOString().split('T')[0]
      const twoDaysAfter  = new Date(deployedAt.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const headers       = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

      const [beforeRes, afterRes] = await Promise.all([
        fetch(`${host}/api/projects/${projectId}/query/`, {
          method: 'POST', headers,
          body: JSON.stringify({ query: { kind: 'EventsQuery', select: ['properties.$session_id', 'count()'], event: '$pageview', after: twoDaysBefore, before: deployedDate, limit: 2000, where: hostWhere } }),
        }),
        fetch(`${host}/api/projects/${projectId}/query/`, {
          method: 'POST', headers,
          body: JSON.stringify({ query: { kind: 'EventsQuery', select: ['properties.$session_id', 'count()'], event: '$pageview', after: deployedDate, before: twoDaysAfter, limit: 2000, where: hostWhere } }),
        }),
      ])
      const [before, after] = await Promise.all([beforeRes.json(), afterRes.json()])

      // Stage 3.5: raise the noise floor. The previous `> 10 sessions` was
      // statistical noise — at 11 sessions one bouncer moves the rate by 9
      // percentage points. We now require ≥100 unique sessions per side; if
      // either side is below that, record an "insufficient_data" learning
      // and skip the rollback decision rather than fabricate a result.
      const MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION = Number(process.env.MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION || '100')
      const calcBounceRate = (results) => {
        const counts = {}
        results?.forEach(row => { counts[row[0]] = (counts[row[0]] || 0) + 1 })
        const total   = Object.keys(counts).length
        const bounced = Object.values(counts).filter(c => c === 1).length
        if (total < MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION) return { rate: null, sessions: total }
        return { rate: Math.round((bounced / total) * 100), sessions: total }
      }

      const beforeMeasure = calcBounceRate(before.results)
      const afterMeasure  = calcBounceRate(after.results)
      const bounceBefore  = beforeMeasure.rate
      const bounceAfter   = afterMeasure.rate

      if (bounceBefore === null || bounceAfter === null) {
        // Record the honest "we couldn't measure" outcome so the user sees it
        // in DNA / learnings rather than silently nothing-happened.
        await supabase.from('agent_learnings').insert({
          subscription_id: run.subscription_id, run_id: run.id,
          change_type: run.analysis_result?.change_type || 'other',
          summary: `Insufficient data to attribute outcome to this fix (before=${beforeMeasure.sessions} sessions, after=${afterMeasure.sessions} sessions, floor=${MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION}).`,
          outcome: 'insufficient_data',
          metric_type: 'site_wide_bounce_rate',
          delta: 0,
          confidence: 'none',
        })
        continue
      }

      const bounceDelta    = bounceAfter - bounceBefore
      const shouldRollback = bounceDelta >= ROLLBACK_BOUNCE_PP_THRESHOLD

      // 3a: capture after-screenshot at the same URL targeted by the original run
      const targetUrl = (() => {
        if (!conn?.website_url) return null
        const editPath = run.analysis_result?.is_multi_page
          ? run.analysis_result?.multi_file_changes?.[0]?.file_to_edit
          : run.analysis_result?.file_to_edit
        const route = fileToRoutePath(editPath || '')   // Stage 2: App-Router-aware
        const base  = conn.website_url.replace(/\/$/, '')
        return route && route !== '/' ? `${base}${route}` : base
      })()
      const screenshotAfter = await captureScreenshot(targetUrl)

      // Stage 3.6: the metric is the SITE-WIDE bounce rate (PostHog $pageview
      // counts across every route, not filtered to the edited page). Storing
      // it under metric_type='bounce_rate' previously let the weekly summary
      // claim "bounce rate −X% after agent change" — false attribution. We
      // now label it as site_wide so downstream consumers state it honestly.
      // Filtering PostHog events to the edited page's route was considered
      // and rejected per audit §2: route mapping from file_to_edit to URL is
      // unreliable (Next.js dynamic routes, basename rewrites, SPA history,
      // etc.) and would silently mislabel many runs as "no data".
      // FINAL/Flag 2: stamp subscription_id so the dashboard query
      // (.eq('subscription_id', …)) works and the RLS policy can key on it
      // directly like every other child table. run_id is kept as the
      // authoritative FK; subscription_id is a denormalized convenience.
      await supabase.from('impact_metrics').insert({
        run_id: run.id, subscription_id: run.subscription_id,
        metric_type: 'site_wide_bounce_rate',
        value_before: bounceBefore, value_after: bounceAfter,
        measured_at: new Date().toISOString(),
      })

      await supabase.from('agent_learnings').insert({
        subscription_id: run.subscription_id, run_id: run.id,
        change_type: run.analysis_result?.change_type || 'other',
        summary: run.analysis_result?.problem || 'Unknown change',
        outcome: shouldRollback ? 'negative' : 'positive',
        metric_type: 'site_wide_bounce_rate',
        delta: -bounceDelta,
        // High confidence on the measurement (sessions >= floor), low
        // confidence on attribution — the metric is site-wide.
        confidence: 'medium',
      })

      // Persist new agent_runs columns (Part 1) for the public timeline + dashboard
      await supabase.from('agent_runs').update({
        bounce_rate_after: bounceAfter,
        screenshot_after:  screenshotAfter,
        ...(shouldRollback ? { rollback_reason: 'metrics_dropped' } : {}),
      }).eq('id', run.id)

      // 3d: Business DNA — record outcome
      const fixType = run.analysis_result?.change_type || 'other'
      const noteSuffix = `${run.analysis_result?.problem || ''} (bounce ${bounceBefore}% → ${bounceAfter}%, Δ${bounceDelta >= 0 ? '+' : ''}${bounceDelta}%)`
      if (shouldRollback) {
        await recordDNA(run.subscription_id, run.id, fixType, 'rollback', `Auto-rolled back: ${noteSuffix}`)
      } else {
        // Pending — gets promoted to 'success' after 7 days if still deployed
        await recordDNA(run.subscription_id, run.id, fixType, 'pending', `48h check positive: ${noteSuffix}`)
      }

      if (shouldRollback) {
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
            const { data: commits } = await octokit.rest.repos.listCommits({ owner, repo, per_page: 10 })
            agentCommit = commits.find(c =>
              c.commit.message.startsWith('fix:') &&
              c.commit.message.includes(run.analysis_result?.problem?.slice(0, 30))
            )
          }

          if (agentCommit) {
            const defaultBranch = await getDefaultBranch(octokit, owner, repo)
            const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` })
            const branchName    = `agent/rollback-${run.id.slice(0, 8)}`
            await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: ref.object.sha })

            const parentSha = agentCommit.parents[0]?.sha
            if (parentSha && run.analysis_result?.file_to_edit) {
              const { data: originalFile } = await octokit.rest.repos.getContent({ owner, repo, path: run.analysis_result.file_to_edit, ref: parentSha })
              const { data: currentFile  } = await octokit.rest.repos.getContent({ owner, repo, path: run.analysis_result.file_to_edit })

              await octokit.rest.repos.createOrUpdateFileContents({
                owner, repo, path: run.analysis_result.file_to_edit,
                message: `revert: rollback agent change (bounce rate +${bounceDelta}%)`,
                content: originalFile.content, sha: currentFile.sha, branch: branchName,
              })

              const { data: pr } = await octokit.rest.pulls.create({
                owner, repo,
                title: `🔄 Auto-Rollback: ${run.analysis_result?.problem}`,
                body: `## Automatic Rollback (awaiting approval)\n\n_**Site-wide** bounce rate rose by **+${bounceDelta}pp** in the 48h after this PR merged (correlation, not proven causation — the metric covers every page, not just \`${run.analysis_result?.file_to_edit || 'the edited file'}\`)._\n\n- Site-wide bounce before merge: ${bounceBefore}%\n- Site-wide bounce after merge:  ${bounceAfter}%\n- Sessions sampled per side: ≥ ${Number(process.env.MIN_SESSIONS_FOR_BOUNCE_ATTRIBUTION || '100')}\n\n_Reply *YES* in Telegram to merge this rollback, *NO* to keep the change live and accept the bounce trend._`,
                head: branchName, base: defaultBranch,
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

              // Always notify the actual subscription owner, not env TELEGRAM_CHAT_ID
              const { data: subRow } = await supabase.from('agent_subscriptions')
                .select('telegram_chat_id').eq('id', run.subscription_id).single()
              if (subRow?.telegram_chat_id) {
                await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: subRow.telegram_chat_id,
                    text: `⚠️ <b>Velyr Rollback Recommended</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n📉 Site-wide bounce rate: ${bounceBefore}% → ${bounceAfter}% (+${bounceDelta}pp)\n<i>(correlation, not proven causation)</i>\n\n🔍 Review PR: ${escapeHtml(pr.html_url)}\n\nReply <b>YES</b> to merge the rollback, or <b>NO</b> to keep the change live.`,
                    parse_mode: 'HTML',
                  }),
                })
              }
            }
          }
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr)
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: process.env.TELEGRAM_CHAT_ID,
              text: `⚠️ <b>Velyr Rollback Alert</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n📉 Bounce rate +${bounceDelta}% — ❌ auto-rollback failed, please revert manually.`,
              parse_mode: 'HTML',
            }),
          })
        }
      } else if (bounceDelta <= -5) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: `📈 <b>Velyr Impact Check — Positive</b>\n\n<b>Change:</b> ${escapeHtml(run.analysis_result?.problem)}\n\n✅ Bounce rate: ${bounceBefore}% → ${bounceAfter}% (${bounceDelta}%)`,
            parse_mode: 'HTML',
          }),
        })
      }
    } catch (err) {
      console.error('Rollback check error for run', run.id, err)
    }
  }

  return res.json({ success: true, checked: deployedRuns.length })
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

  for (const conn of connections) {
    try {
      const subscriptionId = conn.subscription_id
      const oneWeekAgo     = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [analytics, weekRunsRes, completedABRes, allLearningsRes, subRes] = await Promise.all([
        getPostHogAnalytics(
          decryptSecret(conn.posthog_api_key)    || process.env.POSTHOG_API_KEY,
          conn.posthog_project_id || process.env.POSTHOG_PROJECT_ID,
          conn.posthog_host       || process.env.POSTHOG_HOST,
          conn.posthog_host_filter
        ),
        supabase.from('agent_runs').select('*').eq('subscription_id', subscriptionId).gte('created_at', oneWeekAgo).order('created_at', { ascending: false }),
        supabase.from('agent_ab_tests').select('*').eq('subscription_id', subscriptionId).eq('status', 'completed').gte('created_at', oneWeekAgo),
        supabase.from('agent_learnings').select('outcome, delta, metric_type').eq('subscription_id', subscriptionId),
        supabase.from('agent_subscriptions').select('telegram_chat_id').eq('id', subscriptionId).single(),
      ])

      const weekRuns       = weekRunsRes.data   || []
      const completedABTests = completedABRes.data || []
      const allLearnings   = allLearningsRes.data || []
      const chatId         = subRes.data?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID

      const deployedRunIds = weekRuns.filter(r => r.status === 'deployed' || r.status === 'rolled_back').map(r => r.id)
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
      const deployed   = weekRuns.filter(r => r.status === 'deployed').length
      const rolledBack = weekRuns.filter(r => r.status === 'rolled_back').length
      const rejected   = weekRuns.filter(r => r.status === 'rejected').length
      const pending    = weekRuns.filter(r => r.status === 'waiting_approval').length

      const trendEmoji = !a?.trafficChange ? '📊' : a.trafficChange > 10 ? '📈' : a.trafficChange < -10 ? '📉' : '➡️'
      const trendText  = a?.trafficChange == null ? 'First week of tracking'
        : a.trafficChange > 0 ? `+${a.trafficChange}% vs previous week`
        : `${a.trafficChange}% vs previous week`
      const bounceText = !a ? '—'
        : a.bounceRate === 0 ? 'No data'
        : a.bounceRate > 70 ? `⚠️ ${a.bounceRate}% (high)`
        : a.bounceRate > 50 ? `🟡 ${a.bounceRate}%`
        : `✅ ${a.bounceRate}%`

      // Stage 3.6: weekly summary now reports SITE-WIDE bounce delta in the
      // week of each change, explicitly labeled as correlation rather than
      // attribution. Old text ("Best result: bounce rate −X% after agent
      // change") was fabrication — the agent edits one page, the metric is
      // every page. Matches both the new and legacy metric_type strings so
      // historical rows still surface.
      let bestMetricLine = ''
      const bounceMetrics = impactMetrics.filter(m =>
        (m.metric_type === 'site_wide_bounce_rate' || m.metric_type === 'bounce_rate') &&
        m.value_before && m.value_after
      )
      if (bounceMetrics.length > 0) {
        const best        = bounceMetrics.sort((a, b) => (a.value_before - a.value_after) - (b.value_before - b.value_after))[0]
        const improvement = Math.round(best.value_before - best.value_after)
        if (improvement > 0) bestMetricLine = `\n📉 Site-wide bounce rate dropped ${improvement}% in the week of an agent change (correlation, not attribution — the metric covers every page)`
      }

      let abSummary = ''
      if (completedABTests.length > 0) {
        const winners  = completedABTests.filter(t => t.winner === 'treatment')
        abSummary      = `\n🔬 <b>A/B Tests:</b> ${completedABTests.length} completed · ${winners.length} won`
        if (winners.length > 0) {
          const avgLift = Math.round(winners.reduce((sum, t) => sum + (t.delta_pct || 0), 0) / winners.length)
          abSummary    += ` · avg +${avgLift}% lift`
        }
      }

      const dnaSummary       = totalLearnings > 0
        ? `\n🧬 <b>Business DNA:</b> ${totalLearnings} learnings${avgPositiveDelta ? ` · avg +${avgPositiveDelta}% on wins` : ''}`
        : ''
      const deployedChanges  = weekRuns.filter(r => r.status === 'deployed').map(r => `  ✅ ${escapeHtml(r.analysis_result?.problem?.slice(0, 60) || 'Change deployed')}`).join('\n') || ''
      const rolledBackChanges = weekRuns.filter(r => r.status === 'rolled_back').map(r => `  🔄 ${escapeHtml(r.analysis_result?.problem?.slice(0, 60) || 'Rolled back')}`).join('\n') || ''

      const message = `📋 <b>Velyr — Weekly Executive Summary</b>
<i>Week of ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</i>

${trendEmoji} <b>Traffic</b>
${a ? `${a.uniqueVisitors} visitors · ${a.totalPageviews} pageviews` : 'No data'}
${trendText}
Bounce rate: ${bounceText}${bestMetricLine}

🤖 <b>Agent Activity This Week</b>
• Deployed: ${deployed} change${deployed !== 1 ? 's' : ''}
• Rolled back: ${rolledBack}
• Rejected: ${rejected}
• Awaiting approval: ${pending}
${deployedChanges ? `\n<b>Deployed changes:</b>\n${deployedChanges}` : ''}${rolledBackChanges ? `\n<b>Rolled back:</b>\n${rolledBackChanges}` : ''}${abSummary}${dnaSummary}

<i>Next run: Monday · Reply <b>status</b> for details</i>`

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
      })
    } catch (err) {
      console.error('Weekly summary error for subscription', conn.subscription_id, err)
    }
  }

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

  for (const conn of connections) {
    const analytics = await getPostHogAnalytics(
      decryptSecret(conn.posthog_api_key)    || process.env.POSTHOG_API_KEY,
      conn.posthog_project_id || process.env.POSTHOG_PROJECT_ID,
      conn.posthog_host       || process.env.POSTHOG_HOST,
      conn.posthog_host_filter
    )

    const { data: sub } = await supabase
      .from('agent_subscriptions').select('telegram_chat_id')
      .eq('id', conn.subscription_id).single()

    const chatId = sub?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID
    const a      = analytics?.last7Days
    if (!a) continue

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
  }

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
  if (!hostFilter) {
    console.warn('PostHog analytics skipped: no posthog_host_filter (domain) for this connection')
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
  const [runsRes, dnaRes] = await Promise.all([
    supabase.from('agent_runs')
      .select('id, status, created_at, completed_at, problem_description, screenshot_before, screenshot_after, bounce_rate_before, bounce_rate_after, score_before, score_after, pr_url, competitor_changes, ab_test_variants, pages_fixed')
      .eq('subscription_id', sub.id)
      .order('created_at', { ascending: false }).limit(50),
    supabase.from('agent_business_dna')
      .select('fix_type, outcome, notes, created_at')
      .eq('subscription_id', sub.id)
      .order('created_at', { ascending: false }).limit(100),
  ])

  // Strip A/B variants details to "winner only if resolved" — withhold the
  // raw find/replace strings so visitors don't see the unchanged-from-control
  // copy of an in-flight test.
  const runs = (runsRes.data || []).map(r => {
    const ab = r.ab_test_variants
    const abPublic = ab && ab.winner ? { winner: ab.winner, change_type: ab.change_type } : null
    return {
      id: r.id, status: r.status,
      date: r.completed_at || r.created_at,
      problem: r.problem_description || null,
      screenshot_before: r.screenshot_before, screenshot_after: r.screenshot_after,
      bounce_rate_before: r.bounce_rate_before, bounce_rate_after: r.bounce_rate_after,
      score_before: r.score_before, score_after: r.score_after,
      pr_url: r.pr_url,
      competitor_changes: r.competitor_changes,
      ab_test: abPublic,
      pages_fixed: r.pages_fixed,
    }
  })

  // Group DNA by fix_type with success/rollback counts
  const dnaByType = {}
  for (const d of (dnaRes.data || [])) {
    if (!dnaByType[d.fix_type]) dnaByType[d.fix_type] = { fix_type: d.fix_type, success: 0, rollback: 0, pending: 0, latest_note: null }
    dnaByType[d.fix_type][d.outcome]++
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
      .slice(0, 5)
    updates.competitors = cleaned
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' })

  const { data, error } = await supabase
    .from('agent_subscriptions').update(updates)
    .eq('auth_user_id', user.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
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
    .update({ posthog_snippet_declined: false, posthog_snippet_retry_count: 0 })
    .eq('subscription_id', sub.id)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ success: true })
}

// ─── Export DNA Playbook (Supabase JWT) ───────────────────────────────────────
async function handleExportDNA(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { data: sub } = await supabase
    .from('agent_subscriptions').select('id').eq('auth_user_id', user.id).single()
  if (!sub) return res.status(404).json({ error: 'No subscription found' })

  // website_url lives on agent_connections, not agent_subscriptions.
  const { data: conn } = await supabase
    .from('agent_connections')
    .select('website_url')
    .eq('subscription_id', sub.id)
    .maybeSingle()

  const [dnaRes, snapsRes] = await Promise.all([
    supabase.from('agent_business_dna')
      .select('fix_type, outcome, notes, created_at')
      .eq('subscription_id', sub.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('agent_competitor_snapshots')
      .select('competitor_url, snapshot_data, captured_at')
      .eq('subscription_id', sub.id).order('captured_at', { ascending: false }).limit(20),
  ])
  const dna   = dnaRes.data   || []
  const snaps = snapsRes.data || []

  // Keep only most recent snapshot per competitor (max 4)
  const latestByCompetitor = {}
  for (const s of snaps) if (!latestByCompetitor[s.competitor_url]) latestByCompetitor[s.competitor_url] = s
  const competitorBlock = Object.values(latestByCompetitor).slice(0, 4)
    .map(s => `${s.competitor_url}: ${JSON.stringify(s.snapshot_data)}`).join('\n') || 'no competitors tracked'

  const wins     = dna.filter(d => d.outcome === 'success')
  const losses   = dna.filter(d => d.outcome === 'rollback')
  const pending  = dna.filter(d => d.outcome === 'pending')

  const prompt = `You are a senior conversion strategist. Based on this website's 90-day agent history, write a Website Playbook.

WEBSITE: ${conn?.website_url || ''}

WHAT HAS WORKED (${wins.length} successes):
${wins.map(d => `- ${d.fix_type}: ${d.notes || ''}`).join('\n') || 'none yet'}

WHAT WAS ROLLED BACK (${losses.length} failures):
${losses.map(d => `- ${d.fix_type}: ${d.notes || ''}`).join('\n') || 'none yet'}

CURRENTLY PENDING (${pending.length}):
${pending.map(d => `- ${d.fix_type}: ${d.notes || ''}`).join('\n') || 'none'}

COMPETITOR CONTEXT:
${competitorBlock}

Write the Playbook in 4 sections, no fluff:
1. What has worked — proven fix patterns for THIS specific site (be concrete with the data above).
2. What to avoid — patterns that were rolled back and why.
3. Top 3 recommendations for the next 90 days based on what hasn't been tried yet.
4. Competitor context — what the tracked competitors are doing differently.
Max 600 words. Clear, direct language. Use short headers for each section.`

  // Monthly spend pre-flight — share the same per-subscription ceiling as
  // the Edge Function's weekly run. User-initiated, so respond with 429 and
  // a clear message rather than silently failing.
  const spend = await getMonthlySpend(sub.id)
  if (spend.capAvailable && spend.spent >= MONTHLY_SPEND_CAP_EUR) {
    return res.status(429).json({
      error: 'monthly_llm_cap_reached',
      message: `Monthly AI usage cap reached for this subscription (€${spend.spent.toFixed(2)} / €${MONTHLY_SPEND_CAP_EUR.toFixed(2)} in ${spend.period}). Resets on the 1st of next month.`,
    })
  }

  try {
    const requestBody = JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: LLM_MAX_TOKENS_PLAYBOOK,
      messages: [{ role: 'user', content: prompt }],
    })
    if (Buffer.byteLength(requestBody, 'utf8') > LLM_MAX_PROMPT_BYTES) {
      console.error(`[llm-cap] export-dna prompt size exceeds ceiling — aborting`)
      return res.status(413).json({ error: 'Prompt too large' })
    }

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: requestBody,
    })
    const data = await aiRes.json()
    if (data?.usage) {
      await recordLLMUsage(sub.id, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0, 'export-dna')
    }
    const playbook = data.choices?.[0]?.message?.content?.trim()
    if (!playbook) return res.status(502).json({ error: 'Empty response from AI' })
    return res.status(200).json({ playbook })
  } catch (err) {
    console.error('export-dna AI error:', err)
    return res.status(500).json({ error: 'AI request failed' })
  }
}