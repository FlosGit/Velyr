import { createClient } from '@supabase/supabase-js'
import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import crypto from 'node:crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Constant-time string equality. Returns false on length mismatch or non-string
// inputs without leaking timing information about either value.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

async function getOctokit(installationId) {
  const app = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: Buffer.from(
      process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64'
    ).toString('utf-8')
  })

  const { data: { token } } = await app.octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    { installation_id: installationId }
  )

  return new Octokit({ auth: token })
}

async function sendMessage(chatId, text, extra = {}) {
  // Stage 5.9: handle a blocked/deactivated bot. Telegram returns 403 with
  // "bot was blocked by the user" (or 400 "chat not found") when the user has
  // blocked us or deleted the chat. Previously we fire-and-forgot, so these
  // failures were invisible. Surface them so they're debuggable; never throw
  // — a send failure must not crash the webhook handler.
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const desc = body?.description || `HTTP ${res.status}`
      if (res.status === 403 || /blocked|deactivated|chat not found/i.test(desc)) {
        console.warn(`[telegram] sendMessage to chat ${chatId} rejected (bot blocked / chat gone): ${desc}`)
      } else {
        console.error(`[telegram] sendMessage to chat ${chatId} failed: ${desc}`)
      }
      return { ok: false, status: res.status, description: desc }
    }
    return { ok: true }
  } catch (err) {
    console.error(`[telegram] sendMessage network error for chat ${chatId}:`, err?.message)
    return { ok: false, error: err?.message }
  }
}

// ─── TRUST MODEL: chat_id ↔ subscription binding ─────────────────────────────
// We treat the Telegram chat_id as the caller's identity for every command
// except /start. The binding now has an explicit audit trail (Stage 4.13):
//
//   1. User runs /start → we generate a code in `telegram_verification_codes`
//      keyed by chat_id (30 min TTL, single-use).
//   2. During web onboarding, the user pastes that code; the onboarding flow
//      (src/pages/AgentOnboarding.jsx) validates that the code is unused,
//      unexpired, and matches the chat_id, then writes:
//        - agent_connections.telegram_chat_id      = chatId
//        - agent_connections.verification_code_id  = the row's id (FK)
//        - agent_connections.verified_at           = now()
//      and marks the code `used = true`.
//   3. From then on, every command requires all three of those columns to be
//      set. A future bug or rogue DB writer that creates an agent_connections
//      row with only telegram_chat_id (no verification_code_id) cannot
//      authorize commands.
//
// EVERY command handler must call `getActiveSubId(chatId)` and treat a null
// result as "not authorized" — never trust chat_id alone or message metadata.
// Do not add a code path that looks up subscription/run data by chat_id
// without going through this helper.
async function getActiveSubId(chatId) {
  const { data, error } = await supabase
    .from('agent_connections')
    .select('subscription_id, verification_code_id, verified_at, agent_subscriptions!inner(subscription_status, status)')
    .eq('telegram_chat_id', chatId)
    .eq('agent_subscriptions.subscription_status', 'active')
    .eq('agent_subscriptions.status', 'active')
    .not('verification_code_id', 'is', null)
    .not('verified_at',          'is', null)
    .maybeSingle()
  if (error) {
    // Defense in depth: if Postgres returned an error (e.g. multiple rows
    // matched the chat_id — should be impossible under the trust model),
    // refuse to authorize rather than silently picking one.
    console.error('[telegram] getActiveSubId query error for chat_id', chatId, error)
    return null
  }
  return data?.subscription_id ?? null
}

async function notifyInactive(chatId) {
  await sendMessage(chatId, 'Your Velyr subscription is no longer active. Visit velyr.io to reactivate.')
}

// ─── HELPER: Generate unique verification code ────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars (0/O, 1/I)
  let code = 'VELYR-'
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ─── /start — Onboarding verification ────────────────────────────────────────
// B3: /start must carry a start token minted by the authenticated onboarding
// UI (deep link t.me/VelyrBot?start=<token>). The token resolves to the
// auth_user_id that initiated setup, which we stamp onto the verification code
// so a leaked code is non-transferable across accounts. A bare /start (no
// token, or a bad/used/expired one) is refused — there's no trustworthy
// identity to bind, so we point the user back to the web onboarding.
const REFUSE_START_MSG =
  'To connect Telegram, please start onboarding from velyr.io/agent/onboarding — ' +
  'it will give you a personal setup link to open the bot. (Opening the bot directly ' +
  "can't be linked to your account.)"

async function handleStart(message, startPayload) {
  const chatId = message.chat.id
  const username = message.from?.username || null
  const firstName = message.from?.first_name || 'there'

  // B3: require a start token and atomically consume it BEFORE minting a code.
  if (!startPayload) {
    return sendMessage(chatId, REFUSE_START_MSG)
  }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from('telegram_start_tokens')
    .select('token, auth_user_id, used, expires_at')
    .eq('token', startPayload)
    .maybeSingle()
  if (tokenErr) {
    console.error('[telegram] start token lookup failed:', tokenErr.message)
    return sendMessage(chatId, REFUSE_START_MSG)
  }
  if (!tokenRow || tokenRow.used ||
      (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date())) {
    return sendMessage(chatId, REFUSE_START_MSG)
  }

  // Atomic single-use consume: the `.eq('used', false)` guard means only one
  // request can flip it. 0 rows back ⇒ another /start consumed it first → refuse.
  const { data: consumed, error: consumeErr } = await supabase
    .from('telegram_start_tokens')
    .update({ used: true })
    .eq('token', startPayload)
    .eq('used', false)
    .select('token')
  if (consumeErr) {
    console.error('[telegram] start token consume failed:', consumeErr.message)
    return sendMessage(chatId, REFUSE_START_MSG)
  }
  if (!consumed || consumed.length === 0) {
    return sendMessage(chatId, REFUSE_START_MSG)
  }
  const authUserId = tokenRow.auth_user_id

  // Delete any old unused codes for this chat_id
  await supabase
    .from('telegram_verification_codes')
    .delete()
    .eq('chat_id', chatId)
    .eq('used', false)

  // Generate a new unique code
  let code
  let attempts = 0
  while (attempts < 10) {
    const candidate = generateCode()
    const { data: existing } = await supabase
      .from('telegram_verification_codes')
      .select('id')
      .eq('code', candidate)
      .single()
    if (!existing) { code = candidate; break }
    attempts++
  }

  if (!code) {
    return sendMessage(chatId, '❌ Something went wrong generating your code. Please try again.')
  }

  // Save code to DB — include expires_at so the frontend query works.
  // B3: auth_user_id comes from the consumed start token; verify + finalize
  // enforce it matches the caller's JWT.
  await supabase.from('telegram_verification_codes').insert({
    code,
    chat_id: chatId,
    telegram_username: username,
    auth_user_id: authUserId,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // ✅ 30 min TTL
  })

  await sendMessage(
    chatId,
    `👋 *Hi ${firstName}!*\n\n` +
    `Welcome to *Velyr Growth Agent*.\n\n` +
    `Your verification code is:\n\n` +
    `\`${code}\`\n\n` +
    `Copy this code and paste it into the setup wizard on velyr.io to connect your Telegram.\n\n` +
    `_This code expires in 30 minutes._`
  )
}

// ─── FIND LATEST PENDING RUN FOR CHAT ────────────────────────────────────────
// Used by the simple YES/NO flow — locates the most recent waiting_approval run
// belonging to the subscription that owns this Telegram chat.
async function findPendingRunForChat(chatId) {
  const subscriptionId = await getActiveSubId(chatId)
  if (!subscriptionId) return null

  const { data: run } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'waiting_approval')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return run?.id || null
}

// ─── APPROVE ────────────────────────────────────────────────────────────────
async function handleApprove(runId, chatId) {
  const subscriptionId = await getActiveSubId(chatId)
  if (!subscriptionId) return notifyInactive(chatId)

  const { data: run } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .eq('subscription_id', subscriptionId)
    .single()

  if (!run) return sendMessage(chatId, '❌ Run not found.')
  if (run.status !== 'waiting_approval')
    return sendMessage(chatId, '⚠️ This run is no longer waiting for approval.')

  const { data: conn } = await supabase
    .from('agent_connections')
    .select('*')
    .eq('subscription_id', run.subscription_id)
    .single()

  const octokit = await getOctokit(conn.github_installation_id)

  // ── Stage 4.10: PR/DB drift reconciliation ─────────────────────────────
  // Before attempting merge, check the PR's current state on GitHub. If it
  // was already merged (e.g. on a previous attempt where the merge succeeded
  // but the DB update failed, or the user merged manually on github.com),
  // skip the merge call and just reconcile the DB state.
  let prInfo
  try {
    const { data } = await octokit.rest.pulls.get({
      owner: conn.github_repo_owner,
      repo:  conn.github_repo_name,
      pull_number: run.pr_number,
    })
    prInfo = data
  } catch (err) {
    return sendMessage(chatId, `❌ Could not fetch PR #${run.pr_number}: ${err?.message || 'GitHub error'}`)
  }

  if (prInfo.merged) {
    // Already merged — just flip the DB and tell the user we reconciled.
    await supabase.from('agent_runs').update({ status: 'deployed', completed_at: new Date().toISOString() }).eq('id', runId)
    await supabase.from('agent_business_dna').insert({
      subscription_id: run.subscription_id, run_id: runId,
      fix_type: run.analysis_result?.change_type || 'other',
      outcome: 'pending',
      notes: `Approved (YES, already merged): ${(run.analysis_result?.problem || '').slice(0, 400)}`,
    })
    return sendMessage(chatId, `✅ *Already merged.* (Reconciled — the PR was merged out-of-band, status updated.)`)
  }
  if (prInfo.state === 'closed') {
    return sendMessage(chatId, `⚠️ PR #${run.pr_number} is closed (not merged). Cannot approve a closed PR — open a new one.`)
  }

  // ── Stage 4.5: protected-branch pre-flight ─────────────────────────────
  // If the target branch has protection rules (required reviews, status
  // checks, signed commits, etc.) that this installation cannot satisfy,
  // surface the exact reason now instead of letting the merge fail mid-way
  // and leaving the run stuck in 'waiting_approval'.
  if (prInfo.mergeable === false) {
    return sendMessage(chatId, `⚠️ PR #${run.pr_number} is not mergeable right now (likely a conflict with the base branch). Resolve on github.com, then reply *YES* again.`)
  }
  // `mergeable_state` is one of: clean, dirty, blocked, behind, unstable,
  // has_hooks, draft, unknown. Anything other than 'clean' / 'unstable' /
  // 'has_hooks' / 'unknown' means a protection check will likely block us.
  const blockingStates = ['blocked', 'dirty', 'behind', 'draft']
  if (blockingStates.includes(prInfo.mergeable_state)) {
    const stateExplain = {
      blocked: 'branch protection requires reviews or passing checks that aren\'t satisfied',
      dirty:   'merge conflict with the base branch — resolve on github.com',
      behind:  'PR is behind the base branch — update it on github.com',
      draft:   'PR is still in draft — mark it ready for review on github.com',
    }[prInfo.mergeable_state] || prInfo.mergeable_state
    return sendMessage(chatId, `⚠️ Cannot merge PR #${run.pr_number}: ${stateExplain}.\n\nFix on github.com, then reply *YES* again.`)
  }

  let mergeSha = null
  try {
    const { data: mergeResult } = await octokit.rest.pulls.merge({
      owner: conn.github_repo_owner,
      repo:  conn.github_repo_name,
      pull_number: run.pr_number,
      merge_method: 'squash'
    })
    // Stage 5.8: persist the squash-merge commit SHA so the 48h rollback can
    // find the exact change deterministically, instead of fuzzy-matching
    // commit messages (which squash-merge rewrites).
    mergeSha = mergeResult?.sha || null
  } catch (err) {
    // GitHub merge errors include 405 (not mergeable), 409 (HEAD changed),
    // 422 (validation, e.g. required status checks). Surface the message
    // verbatim rather than leaving the user wondering what went wrong.
    return sendMessage(chatId, `❌ Merge failed: ${err?.message || 'GitHub error'}.\n\nThe run stays in *waiting_approval* — fix the issue and reply *YES* again, or *NO* to skip.`)
  }

  await supabase.from('agent_runs').update({ status: 'deployed', completed_at: new Date().toISOString(), merge_commit_sha: mergeSha }).eq('id', runId)

  // 3d: Business DNA — record as 'pending'; the 48h rollback check will promote to 'success' after 7 days deployed
  await supabase.from('agent_business_dna').insert({
    subscription_id: run.subscription_id, run_id: runId,
    fix_type: run.analysis_result?.change_type || 'other',
    outcome: 'pending',
    notes: `Approved (YES): ${(run.analysis_result?.problem || '').slice(0, 400)}`,
  })

  await sendMessage(
    chatId,
    `✅ *PR merged!* Vercel is deploying the change now.\n\n_The agent will check impact after 48h and recommend a rollback (waiting on your approval) if metrics drop._`
  )
}

// ─── REJECT ─────────────────────────────────────────────────────────────────
async function handleReject(runId, chatId) {
  const subscriptionId = await getActiveSubId(chatId)
  if (!subscriptionId) return notifyInactive(chatId)

  const { data: run } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .eq('subscription_id', subscriptionId)
    .single()

  if (!run) return sendMessage(chatId, '❌ Run not found.')
  if (run.status !== 'waiting_approval')
    return sendMessage(chatId, '⚠️ This run is no longer waiting for approval.')

  // Stage 4.7: actually close the PR and delete the branch on reject. We used
  // to just flip status in the DB and leave the PR dangling on GitHub, which
  // (a) confused users who saw an open PR for a "rejected" run, and (b) left
  // an `agent/fix-*` branch around that could be re-merged later by anyone
  // with repo write access. Both ops are best-effort — DB state is still
  // flipped to 'rejected' even if GitHub returns 404/410/permissions issues.
  const { data: conn } = await supabase
    .from('agent_connections')
    .select('github_installation_id, github_repo_owner, github_repo_name')
    .eq('subscription_id', run.subscription_id)
    .single()
  if (conn?.github_installation_id && run.pr_number) {
    try {
      const octokit = await getOctokit(conn.github_installation_id)
      // Close the PR (state=closed, not merged)
      await octokit.rest.pulls.update({
        owner: conn.github_repo_owner,
        repo:  conn.github_repo_name,
        pull_number: run.pr_number,
        state: 'closed',
      })
      // Find and delete the branch the PR was on
      const { data: prInfo } = await octokit.rest.pulls.get({
        owner: conn.github_repo_owner,
        repo:  conn.github_repo_name,
        pull_number: run.pr_number,
      })
      const branchRef = prInfo?.head?.ref
      if (branchRef && branchRef.startsWith('agent/')) {
        await octokit.rest.git.deleteRef({
          owner: conn.github_repo_owner,
          repo:  conn.github_repo_name,
          ref:   `heads/${branchRef}`,
        }).catch(err => {
          // 422 = already deleted, 404 = branch gone — both fine
          if (err?.status !== 404 && err?.status !== 422) {
            console.warn(`[reject] branch delete failed for ${branchRef}:`, err?.message)
          }
        })
      }
    } catch (err) {
      console.warn(`[reject] PR close/delete failed for run ${runId} PR #${run.pr_number}:`, err?.message)
    }
  }

  await supabase.from('agent_runs').update({
    status: 'rejected',
    rollback_reason: 'user_rejected',
  }).eq('id', runId)

  // 3d: Business DNA — record rollback so future runs avoid the pattern
  await supabase.from('agent_business_dna').insert({
    subscription_id: run.subscription_id, run_id: runId,
    fix_type: run.analysis_result?.change_type || 'other',
    outcome: 'rollback',
    notes: `User rejected (NO): ${(run.analysis_result?.problem || '').slice(0, 400)}`,
  })

  await sendMessage(
    chatId,
    `❌ *PR skipped.* The agent will analyze again on the next scheduled run.\n\n_Optionally add context: *note ${runId} <reason>*_`
  )
}

// ─── BUSINESS DNA ─────────────────────────────────────────────────────────────
async function handleDNA(chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  const { data: learnings } = await supabase
    .from('agent_learnings')
    .select('*')
    .eq('subscription_id', subId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!learnings || learnings.length === 0) {
    return sendMessage(
      chatId,
      `🧬 *Business DNA*\n\nNo learnings yet. DNA builds up after approved changes and A/B test results.`
    )
  }

  const wins = learnings.filter(l => l.outcome === 'positive')
  const losses = learnings.filter(l => l.outcome === 'negative')
  const fmtDelta = d => (d > 0 ? `+${d}%` : `${d}%`)

  const winsText = wins.length
    ? wins.map(l => `✅ ${l.change_type}: ${l.summary} (${fmtDelta(l.delta)} ${l.metric_type})`).join('\n')
    : '_None yet_'

  const lossesText = losses.length
    ? losses.map(l => `❌ ${l.change_type}: ${l.summary} (${fmtDelta(l.delta)} ${l.metric_type})`).join('\n')
    : '_None yet_'

  await sendMessage(
    chatId,
    `🧬 *Business DNA* (${learnings.length} learnings)\n\n*What worked:*\n${winsText}\n\n*What didn't work:*\n${lossesText}`
  )
}

// ─── STATUS ──────────────────────────────────────────────────────────────────
async function handleStatus(chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id, status, pr_url, created_at')
    .eq('subscription_id', subId)
    .order('created_at', { ascending: false })
    .limit(5)

  const statusEmoji = {
    pending: '⏳', running: '🔄', waiting_approval: '⏸',
    approved: '✅', rejected: '❌', deployed: '🚀', failed: '💥', rolled_back: '🔄'
  }

  const lines = runs?.map(r => {
    const emoji = statusEmoji[r.status] ?? '❓'
    const date = new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    const prLink = r.pr_url ? ` — [PR](${r.pr_url})` : ''
    return `${emoji} \`${r.id.slice(0, 8)}\` ${r.status.replace('_', ' ')} (${date})${prLink}`
  }) ?? []

  const { data: abTests } = await supabase
    .from('agent_ab_tests')
    .select('summary, status, winner, delta_pct, evaluate_after')
    .eq('subscription_id', subId)
    .order('created_at', { ascending: false })
    .limit(3)

  const abLines = abTests?.map(t => {
    const evalDate = new Date(t.evaluate_after).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    if (t.status === 'completed') {
      return `📊 ${t.summary} → ${t.winner === 'treatment' ? `✅ +${t.delta_pct}%` : `❌ ${t.delta_pct}%`}`
    }
    return `🔬 ${t.summary} — results on ${evalDate}`
  }) ?? []

  const { data: competitors } = await supabase
    .from('agent_competitor_urls')
    .select('url, active')
    .eq('subscription_id', subId)
    .limit(5)

  const competitorLines = competitors?.map(c =>
    `${c.active ? '🟢' : '⚫'} ${c.url}`
  ) ?? []

  let msg = `📊 *Velyr Agent Status*\n\n*Last 5 runs:*\n${lines.join('\n') || '_No runs yet_'}`
  if (abLines.length) msg += `\n\n*A/B Tests:*\n${abLines.join('\n')}`
  if (competitorLines.length) msg += `\n\n*Tracked Competitors:*\n${competitorLines.join('\n')}`

  await sendMessage(chatId, msg)
}

// ─── NOTE ─────────────────────────────────────────────────────────────────────
async function handleNote(runId, reason, chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  const { data: run } = await supabase
    .from('agent_runs')
    .select('subscription_id, analysis_result')
    .eq('id', runId)
    .eq('subscription_id', subId)
    .single()

  if (!run) return sendMessage(chatId, '❌ Run not found.')

  await supabase.from('agent_learnings').insert({
    subscription_id: run.subscription_id,
    run_id: runId,
    change_type: run.analysis_result?.change_type || 'other',
    summary: reason,
    outcome: 'negative',
    metric_type: 'manual',
    delta: 0,
    confidence: 'low'
  })

  await sendMessage(chatId, `🧬 *Note saved to Business DNA.*\n_"${reason}"_\n\nThe agent will factor this in on the next run.`)
}

// ─── COMPETITOR ───────────────────────────────────────────────────────────────
async function handleAddCompetitor(url, chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  try { new URL(url) } catch {
    return sendMessage(chatId, `❌ Invalid URL: \`${url}\`\n\nUsage: *competitor add https://example.com*`)
  }

  const { data: existing } = await supabase
    .from('agent_competitor_urls')
    .select('id')
    .eq('subscription_id', subId)
    .eq('active', true)

  if (existing && existing.length >= 2) {
    return sendMessage(chatId, `⚠️ You already have 2 competitors tracked (maximum).\n\nRemove one first: *competitor remove <url>*`)
  }

  await supabase.from('agent_competitor_urls').upsert({
    subscription_id: subId,
    url,
    active: true,
  }, { onConflict: 'subscription_id,url' })

  await sendMessage(chatId, `✅ *Competitor added:* \`${url}\`\n\nThe agent will scan this site on every Monday run and suggest differentiation opportunities.`)
}

async function handleRemoveCompetitor(url, chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  await supabase
    .from('agent_competitor_urls')
    .update({ active: false })
    .eq('subscription_id', subId)
    .ilike('url', `%${url}%`)

  await sendMessage(chatId, `🗑️ *Competitor removed.* The agent will no longer scan that URL.`)
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── Webhook authentication ──────────────────────────────────────────────
  // Telegram sets this header on every request when the webhook was
  // registered with a secret_token. Verify BEFORE touching the body so an
  // unauthenticated caller cannot trigger DB queries, Telegram API calls,
  // or log noise via crafted payloads. Constant-time compare; never log
  // either the expected or provided value.
  const expectedWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expectedWebhookSecret) {
    console.error('[telegram] TELEGRAM_WEBHOOK_SECRET not configured — refusing webhook')
    return res.status(500).json({ error: 'Server misconfigured' })
  }
  const providedWebhookSecret = req.headers['x-telegram-bot-api-secret-token']
  if (!providedWebhookSecret || !safeEqual(String(providedWebhookSecret), expectedWebhookSecret)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // ── Stage 4.9: update_id dedupe + always-200 on internal error ─────────
  // Telegram retries the webhook with the same `update_id` if we don't return
  // 2xx promptly, OR if we hard-crash. Re-processing a "YES" could merge the
  // PR twice on top of a flaky DB. We persist seen update_ids in a tiny
  // table and short-circuit duplicates.
  //
  // We also wrap every handler error to return 200 — Telegram only retries
  // on non-2xx. Returning 500 on an internal bug means a bot user sees the
  // bot behave inconsistently while Telegram re-fires the same update.
  // Crashes are logged here; nothing is silently swallowed.
  try {
    const body = req.body
    if (!body) return res.status(200).json({ ok: true })

    const updateId = body.update_id
    if (typeof updateId === 'number') {
      const { error: insertErr } = await supabase
        .from('telegram_webhook_dedupe')
        .insert({ update_id: updateId, received_at: new Date().toISOString() })
      if (insertErr) {
        // Postgres duplicate-key error code → we've already handled this update
        if (insertErr.code === '23505') {
          console.log(`[telegram] duplicate update_id ${updateId} — skipping`)
          return res.status(200).json({ ok: true, deduped: true })
        }
        // Any other DB error: log but proceed (better to risk a double-fire
        // once than to brick the webhook on a transient DB hiccup). If the
        // dedupe table is missing entirely the agent_runs status guard
        // (`run.status !== 'waiting_approval'`) still prevents double-merge.
        console.warn(`[telegram] dedupe insert failed for update_id ${updateId}:`, insertErr.message)
      }
    }

    const message = body.message
    if (!message || !message.text) return res.status(200).json({ ok: true })

    const chatId = message.chat.id
    const text = message.text.trim()
    const parts = text.split(' ')
    const cmd = parts[0].toLowerCase()

    // /start — always respond, no auth needed. B3: parts[1] is the deep-link
    // start token (t.me/VelyrBot?start=<token>); handleStart requires it.
    if (cmd === '/start' || cmd === 'start') {
      await handleStart(message, parts[1] || null)

    } else if ((cmd === 'yes' || cmd === 'y' || cmd === '✅') && parts.length === 1) {
      const runId = await findPendingRunForChat(chatId)
      if (!runId) await sendMessage(chatId, '⚠️ No pending approval found. The agent will message you when the next run is ready.')
      else        await handleApprove(runId, chatId)

    } else if ((cmd === 'no' || cmd === 'n' || cmd === '❌') && parts.length === 1) {
      const runId = await findPendingRunForChat(chatId)
      if (!runId) await sendMessage(chatId, '⚠️ No pending approval found.')
      else        await handleReject(runId, chatId)

    } else if (cmd === 'approve' && parts.length === 2) {
      await handleApprove(parts[1], chatId)

    } else if (cmd === 'reject' && parts.length === 2) {
      await handleReject(parts[1], chatId)

    } else if (cmd === 'dna') {
      await handleDNA(chatId)

    } else if (cmd === 'status') {
      await handleStatus(chatId)

    } else if (cmd === 'note' && parts.length >= 3) {
      await handleNote(parts[1], parts.slice(2).join(' '), chatId)

    } else if (cmd === 'competitor' && parts.length >= 3) {
      const subCmd = parts[1].toLowerCase()
      const url = parts[2]
      if (subCmd === 'add') {
        await handleAddCompetitor(url, chatId)
      } else if (subCmd === 'remove') {
        await handleRemoveCompetitor(url, chatId)
      } else {
        await sendMessage(chatId, `❓ Unknown competitor command.\n\n*competitor add <url>* — track a competitor\n*competitor remove <url>* — stop tracking`)
      }

    } else {
      await sendMessage(
        chatId,
        `🤖 *Velyr Growth Agent*\n\n` +
        `*Commands:*\n` +
        `*YES* — deploy the pending PR\n` +
        `*NO* — skip the pending PR\n` +
        `*approve <run-id>* — deploy a specific run (power users)\n` +
        `*reject <run-id>* — skip a specific run (power users)\n` +
        `*note <run-id> <reason>* — add a manual learning\n` +
        `*dna* — view your Business DNA\n` +
        `*status* — last runs, A/B tests & competitors\n` +
        `*competitor add <url>* — track a competitor site\n` +
        `*competitor remove <url>* — stop tracking`
      )
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    // Stage 4.9: 200-on-error so Telegram does NOT retry into a duplicate
    // approve/reject. The error is logged for our side; the bot user sees
    // nothing, which is the right trade-off — better silent than double-fire.
    console.error('Telegram webhook error:', error)
    res.status(200).json({ ok: true, error: 'internal' })
  }
}