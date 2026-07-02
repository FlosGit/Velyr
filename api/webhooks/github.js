import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { reconcileDeployed, reconcileRejected, closeRejectedPr } from '../_lib/run-reconcile.js'
import { startFollowupRun } from '../_lib/edge-dispatch.js'

// ─── GitHub App `pull_request` webhook ───────────────────────────────────────
// Keeps the agent_runs row in sync when a customer acts on the agent's PR
// DIRECTLY on github.com instead of via the Telegram YES/NO flow:
//   • merged   → reconcile the waiting_approval run to 'deployed' (same as YES)
//   • closed   → reconcile it to 'rejected'              (same as a Telegram NO)
// Without this, a manual merge/close leaves the run stuck in 'waiting_approval'
// — invisible to the 48h rollback check (keys on status='deployed') and the
// dashboard. The DB/GitHub side effects are the SAME helpers the Telegram bot
// uses (api/_lib/run-reconcile.js), so there's no behavioural drift.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Vercel parses JSON bodies by default, but GitHub's HMAC is computed over the
// RAW bytes — so disable the parser and read the stream ourselves (same pattern
// as api/webhooks/stripe.js).
export const config = { api: { bodyParser: false } }

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Constant-time equality; false on length mismatch / non-string without leaking
// timing. (Twin of safeEqual in api/webhooks/telegram.js.)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// Minimal one-shot Telegram alert (best-effort, never throws). Only ever
// interpolates the integer PR number + literal strings, so no HTML escaping is
// needed. (Same direct-Bot-API approach as api/webhooks/stripe.js.)
async function notifyTelegram(chatId, text) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch (err) {
    console.warn('[gh-webhook] notifyTelegram failed:', err?.message || String(err))
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Authentication: HMAC-SHA256 over the raw body ───────────────────────────
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    console.error('[gh-webhook] GITHUB_WEBHOOK_SECRET not configured — refusing webhook')
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  const rawBody = await getRawBody(req)
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = req.headers['x-hub-signature-256']
  if (!provided || !safeEqual(String(provided), expected)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // From here we always return 200 — GitHub retries (redelivers) on non-2xx,
  // and reprocessing is harmless anyway (the status='waiting_approval' filter
  // below makes every reconcile idempotent), but a quiet 200 avoids noise.
  try {
    const event = req.headers['x-github-event']
    const payload = JSON.parse(rawBody.toString('utf8') || '{}')

    // Only act on a PR being closed (merged or not). Everything else — ping,
    // opened, synchronize, other events — is an explicit no-op.
    if (event !== 'pull_request' || payload.action !== 'closed') {
      return res.status(200).json({ ok: true, ignored: true })
    }

    const pr = payload.pull_request
    const installationId = payload.installation?.id
    const owner = payload.repository?.owner?.login
    const repoName = payload.repository?.name
    const prNumber = pr?.number
    if (!installationId || !owner || !repoName || !prNumber) {
      return res.status(200).json({ ok: true, ignored: 'incomplete_payload' })
    }

    // Resolve the connection from (installation + repo); the list of
    // installations GitHub scopes to is the permission boundary, and
    // (repo + pr_number) uniquely identifies the run.
    const { data: conn } = await supabase
      .from('agent_connections')
      .select('subscription_id, telegram_chat_id, github_installation_id, github_repo_owner, github_repo_name')
      .eq('github_installation_id', installationId)
      .eq('github_repo_owner', owner)
      .eq('github_repo_name', repoName)
      .maybeSingle()
    if (!conn) return res.status(200).json({ ok: true, ignored: 'no_connection' })

    // Only a run still awaiting approval needs reconciling. If it's already
    // deployed/rejected (Telegram beat us to it, or this is a redelivery), the
    // filter returns nothing and we no-op.
    const { data: run } = await supabase
      .from('agent_runs')
      .select('*')
      .eq('subscription_id', conn.subscription_id)
      .eq('pr_number', prNumber)
      .eq('status', 'waiting_approval')
      .maybeSingle()
    if (!run) return res.status(200).json({ ok: true, ignored: 'no_pending_run' })

    if (pr.merged) {
      const reconciled = await reconcileDeployed(supabase, run, pr.merge_commit_sha, { approvalLabel: 'merged on GitHub' })
      // A merged Setup-PR consumed the analysis run — resolving it out-of-band
      // starts the real run now, same as the Telegram YES path.
      if (reconciled.kind === 'setup_installed') {
        const started = await startFollowupRun(supabase, run.subscription_id)
        await notifyTelegram(
          conn.telegram_chat_id,
          started
            ? `🔁 PR #${prNumber} was merged on GitHub — analytics installed. Starting your first analysis run now.`
            : `🔁 PR #${prNumber} was merged on GitHub — analytics installed. I couldn't start your analysis run automatically — tap <b>Run now</b> in your dashboard.`
        )
      } else {
        await notifyTelegram(
          conn.telegram_chat_id,
          `🔁 PR #${prNumber} was merged on GitHub — the run is now marked <b>deployed</b>. I'll check impact after 48h.`
        )
      }
    } else {
      // Closed without merging → same as a Telegram NO. The PR is already
      // closed, so don't re-close it; just clean up the branch + flip the DB.
      await closeRejectedPr(conn, run, { close: false })
      const rejected = await reconcileRejected(supabase, run, { rejectLabel: 'closed on GitHub' })
      // Permanent setup decline unblocks analysis (setup_retry re-offers next
      // run instead — no dispatch, it would just re-ask immediately).
      let startedNote = ''
      if (rejected.kind === 'setup_declined' || rejected.kind === 'foreign_declined') {
        const started = await startFollowupRun(supabase, run.subscription_id)
        startedNote = started ? ' Starting your analysis run now.' : ''
      }
      await notifyTelegram(
        conn.telegram_chat_id,
        `🔁 PR #${prNumber} was closed on GitHub — the run is now marked <b>rejected</b>.${startedNote}`
      )
    }

    return res.status(200).json({ ok: true, reconciled: pr.merged ? 'deployed' : 'rejected' })
  } catch (err) {
    // Log, but still 200 — a redelivery would just re-hit the same bug, and the
    // idempotent status filter means nothing is left half-done.
    console.error('[gh-webhook] handler error:', err?.message || String(err))
    return res.status(200).json({ ok: true, error: 'handled' })
  }
}
