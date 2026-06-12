import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { getOctokit } from '../_lib/github-app.js'
import { reconcileDeployed, reconcileRejected, closeRejectedPr } from '../_lib/run-reconcile.js'

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

// ─── TELEGRAM HTML ESCAPING ──────────────────────────────────────────────────
// Cross-runtime twin of escapeHtml() in supabase/functions/agent-run/index.ts.
// The Node (api/) and Deno (supabase/functions/) bundles can't share a module
// (different crypto/resolver), so this is duplicated — same pattern as the
// ROLLBACK_BOUNCE_PP_THRESHOLD / fileToRoutePath twins. Keep in sync.
//
// Every message in this file is sent as parse_mode: 'HTML' (the sendMessage
// default below). Telegram's legacy v1 Markdown has NO reliable escape for a
// stray *, _, [ or ` in an interpolated value (LLM output, file paths, error
// strings, competitor URLs, user note text), which used to break sends with
// "can't parse entities". HTML escaping of <, >, & is reliable, so every
// interpolated user/LLM/error value below is wrapped in escapeHtml(), and any
// literal placeholder like <url> is written as &lt;url&gt;.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra })
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
    `👋 <b>Hi ${escapeHtml(firstName)}!</b>\n\n` +
    `Welcome to <b>Velyr Growth Agent</b>.\n\n` +
    `Your verification code is:\n\n` +
    `<code>${escapeHtml(code)}</code>\n\n` +
    `Copy this code and paste it into the setup wizard on velyr.io to connect your Telegram.\n\n` +
    `<i>This code expires in 30 minutes.</i>`
  )
}

// ─── FIND LATEST PENDING RUN FOR CHAT ────────────────────────────────────────
// Used by the simple YES/NO flow — locates the most recent waiting_approval run
// belonging to the subscription that owns this Telegram chat.
//
// INVARIANT: there is at most ONE waiting_approval run per subscription at any
// time. The Setup-PR gate (maybeRunSnippetSetup in the Edge Function) returns
// BEFORE createPR is ever reached, so a setup_posthog and a conversion_fix run
// can never both be in waiting_approval simultaneously. The dedupe check inside
// maybeRunSnippetSetup prevents double-opening Setup-PRs. This query is therefore
// always unambiguous.
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

// ─── FIND LATEST REJECTED CONVERSION-FIX RUN FOR CHAT ────────────────────────
// Anchor for the ID-less `note <reason>` flow. The note prompt only ever
// appears AFTER a NO, by which point handleReject has already flipped the run
// OUT of waiting_approval into 'rejected' — so findPendingRunForChat would
// return null here. We instead target the most recently rejected run for the
// subscription that owns this chat. Chat-bound via getActiveSubId (the same B3
// trust gate every command uses): a note can never land on another chat_id's
// run.
//
// SCOPE: run_type = 'conversion_fix' ONLY. A note is a *fix* learning
// (outcome:'negative' in agent_learnings). Setup-PR rejects (setup_posthog /
// setup_posthog_foreign_choice) and legacy ab_test rows are not fix proposals
// the user weighed — and during onboarding a setup reject can be the youngest
// rejected run, which would steal the note. Same spirit as the honest-skip
// exclusion: only runs the user saw as a rejectable fix qualify. run_type is
// NOT NULL DEFAULT 'conversion_fix' and (subscription_id, run_type, status) is
// indexed, so this filter is both correct and cheap.
//
// Ordering: handleReject now stamps completed_at on rejection, so we sort by
// that (most recent rejection first), with created_at as a tiebreaker. Legacy
// rejected rows predating the completed_at-on-reject change have a null
// completed_at and sort LAST (nullsFirst: false), so they never shadow a
// freshly-skipped run.
async function findLatestRejectedRunForChat(chatId) {
  const subscriptionId = await getActiveSubId(chatId)
  if (!subscriptionId) return null

  const { data: run } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'rejected')
    .eq('run_type', 'conversion_fix')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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

  // ── Setup-PR: foreign-choice YES → fire Edge Function to build the PR ─────
  // The foreign-choice row has no pr_number yet. Fire-and-forget to the Edge
  // Function (same 2s-AbortController pattern as the cron trigger), which runs
  // createForeignSetupPR and converts this row to a normal setup_posthog run.
  if (run.run_type === 'setup_posthog_foreign_choice') {
    await supabase.from('agent_runs').update({ status: 'running' }).eq('id', runId)
    const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-run`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    try {
      await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ intent: 'foreign_setup_pr', subscriptionId: run.subscription_id }),
        signal: controller.signal,
      })
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('[telegram] foreign_setup_pr Edge trigger failed:', err?.message)
      }
    } finally {
      clearTimeout(timeoutId)
    }
    return sendMessage(chatId, `⚙️ Got it — preparing the analytics PR now. I'll message you when it's ready for review.`)
  }

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
    return sendMessage(chatId, `❌ Could not fetch PR #${run.pr_number}: ${escapeHtml(err?.message || 'GitHub error')}`)
  }

  if (prInfo.merged) {
    // Already merged — reconcile the DB to 'deployed' and tell the user. Same
    // reconcile path the GitHub pull_request webhook uses for a manual merge.
    await reconcileDeployed(supabase, run, prInfo.merge_commit_sha, { approvalLabel: 'YES, already merged' })
    return sendMessage(chatId, `✅ <b>Already merged.</b> (Reconciled — the PR was merged out-of-band, status updated.)`)
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
    return sendMessage(chatId, `⚠️ PR #${run.pr_number} is not mergeable right now (likely a conflict with the base branch). Resolve on github.com, then reply <b>YES</b> again.`)
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
    return sendMessage(chatId, `⚠️ Cannot merge PR #${run.pr_number}: ${escapeHtml(stateExplain)}.\n\nFix on github.com, then reply <b>YES</b> again.`)
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
    return sendMessage(chatId, `❌ Merge failed: ${escapeHtml(err?.message || 'GitHub error')}.\n\nThe run stays in <b>waiting_approval</b> — fix the issue and reply <b>YES</b> again, or <b>NO</b> to skip.`)
  }

  // Reconcile to 'deployed' (+ merge SHA, + DNA / setup install-stamp). Same
  // helper the GitHub pull_request webhook calls for a manual merge.
  const result = await reconcileDeployed(supabase, run, mergeSha, { approvalLabel: 'YES' })

  // Setup-PR YES → "analytics installed"; conversion fix → "deploying" message.
  if (result.kind === 'setup_installed') {
    return sendMessage(chatId, `✅ <b>Analytics installed.</b> Your next run will use real visitor data.`)
  }

  await sendMessage(
    chatId,
    `✅ <b>PR merged!</b> Vercel is deploying the change now.\n\n<i>The agent will check impact after 48h and recommend a rollback (waiting on your approval) if metrics drop.</i>`
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

  // Close the PR + delete the agent/* branch on GitHub, then reconcile the DB
  // to 'rejected'. Both the GitHub cleanup (Stage 4.7: don't leave a dangling
  // PR / re-mergeable agent/* branch) and the DB effects (status, rollback
  // reason, DNA / setup-retry) are shared with the GitHub pull_request webhook
  // (closed-without-merge), so a manual close lands the run in exactly the same
  // state as this Telegram NO. closeRejectedPr is a no-op for foreign-choice
  // rows (no pr_number); everything is best-effort — DB state is the source of
  // truth even if GitHub returns 404/410/permissions issues.
  const { data: conn } = await supabase
    .from('agent_connections')
    .select('github_installation_id, github_repo_owner, github_repo_name')
    .eq('subscription_id', run.subscription_id)
    .single()

  await closeRejectedPr(conn, run, { close: true })
  const result = await reconcileRejected(supabase, run, { rejectLabel: 'NO' })

  switch (result.kind) {
    case 'setup_retry':
      return sendMessage(chatId, `⏭️ Skipped for now — I'll offer it once more next run.`)
    case 'foreign_declined':
    case 'setup_declined':
      return sendMessage(chatId, `Understood — I won't ask again. Re-enable tracking from your dashboard anytime.`)
    default: // 'fix_rejected'
      return sendMessage(
        chatId,
        `❌ <b>PR skipped.</b> The agent will analyze again on the next scheduled run.\n\n<i>Optionally tell me why — reply <b>note &lt;reason&gt;</b> and I'll attach it to this run.</i>`
      )
  }
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
      `🧬 <b>Business DNA</b>\n\nNo learnings yet. DNA builds up after approved changes and A/B test results.`
    )
  }

  const wins = learnings.filter(l => l.outcome === 'positive')
  const losses = learnings.filter(l => l.outcome === 'negative')
  const fmtDelta = d => (d > 0 ? `+${d}%` : `${d}%`)

  const winsText = wins.length
    ? wins.map(l => `✅ ${escapeHtml(l.change_type)}: ${escapeHtml(l.summary)} (${fmtDelta(l.delta)} ${escapeHtml(l.metric_type)})`).join('\n')
    : '<i>None yet</i>'

  const lossesText = losses.length
    ? losses.map(l => `❌ ${escapeHtml(l.change_type)}: ${escapeHtml(l.summary)} (${fmtDelta(l.delta)} ${escapeHtml(l.metric_type)})`).join('\n')
    : '<i>None yet</i>'

  await sendMessage(
    chatId,
    `🧬 <b>Business DNA</b> (${learnings.length} learnings)\n\n<b>What worked:</b>\n${winsText}\n\n<b>What didn't work:</b>\n${lossesText}`
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
    const prLink = r.pr_url ? ` — <a href="${escapeHtml(r.pr_url)}">PR</a>` : ''
    return `${emoji} <code>${escapeHtml(r.id.slice(0, 8))}</code> ${escapeHtml(r.status.replace('_', ' '))} (${date})${prLink}`
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
      return `📊 ${escapeHtml(t.summary)} → ${t.winner === 'treatment' ? `✅ +${t.delta_pct}%` : `❌ ${t.delta_pct}%`}`
    }
    return `🔬 ${escapeHtml(t.summary)} — results on ${evalDate}`
  }) ?? []

  const { data: competitors } = await supabase
    .from('agent_competitor_urls')
    .select('url, active')
    .eq('subscription_id', subId)
    .limit(5)

  const competitorLines = competitors?.map(c =>
    `${c.active ? '🟢' : '⚫'} ${escapeHtml(c.url)}`
  ) ?? []

  let msg = `📊 <b>Velyr Agent Status</b>\n\n<b>Last 5 runs:</b>\n${lines.join('\n') || '<i>No runs yet</i>'}`
  if (abLines.length) msg += `\n\n<b>A/B Tests:</b>\n${abLines.join('\n')}`
  if (competitorLines.length) msg += `\n\n<b>Tracked Competitors:</b>\n${competitorLines.join('\n')}`

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

  await sendMessage(chatId, `🧬 <b>Note saved to Business DNA.</b>\n<i>"${escapeHtml(reason)}"</i>\n\nThe agent will factor this in on the next run.`)
}

// ─── COMPETITOR ───────────────────────────────────────────────────────────────
async function handleAddCompetitor(url, chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  try { new URL(url) } catch {
    return sendMessage(chatId, `❌ Invalid URL: <code>${escapeHtml(url)}</code>\n\nUsage: <b>competitor add https://example.com</b>`)
  }

  const { data: existing } = await supabase
    .from('agent_competitor_urls')
    .select('id')
    .eq('subscription_id', subId)
    .eq('active', true)

  if (existing && existing.length >= 2) {
    return sendMessage(chatId, `⚠️ You already have 2 competitors tracked (maximum).\n\nRemove one first: <b>competitor remove &lt;url&gt;</b>`)
  }

  await supabase.from('agent_competitor_urls').upsert({
    subscription_id: subId,
    url,
    active: true,
  }, { onConflict: 'subscription_id,url' })

  await sendMessage(chatId, `✅ <b>Competitor added:</b> <code>${escapeHtml(url)}</code>\n\nThe agent will scan this site on every Monday run and suggest differentiation opportunities.`)
}

async function handleRemoveCompetitor(url, chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  await supabase
    .from('agent_competitor_urls')
    .update({ active: false })
    .eq('subscription_id', subId)
    .ilike('url', `%${url}%`)

  await sendMessage(chatId, `🗑️ <b>Competitor removed.</b> The agent will no longer scan that URL.`)
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

    } else if (cmd === 'note' && parts.length >= 2) {
      // `note <reason>` (preferred, ID-less) attaches to the most recently
      // skipped run in THIS chat — resolved chat-bound via getActiveSubId, so a
      // note can never land on another chat_id's run. `note <run-id> <reason>`
      // (explicit UUID as first arg) stays as a SILENT power-user fallback:
      // still works, no longer advertised. We disambiguate purely on whether
      // the first arg is a UUID — a reason word being a full UUID by accident
      // is not a real case.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (UUID_RE.test(parts[1]) && parts.length >= 3) {
        await handleNote(parts[1], parts.slice(2).join(' '), chatId)
      } else {
        const runId = await findLatestRejectedRunForChat(chatId)
        if (!runId) await sendMessage(chatId, '⚠️ No recently skipped run to attach a note to.')
        else        await handleNote(runId, parts.slice(1).join(' '), chatId)
      }

    } else if (cmd === 'competitor' && parts.length >= 3) {
      const subCmd = parts[1].toLowerCase()
      const url = parts[2]
      if (subCmd === 'add') {
        await handleAddCompetitor(url, chatId)
      } else if (subCmd === 'remove') {
        await handleRemoveCompetitor(url, chatId)
      } else {
        await sendMessage(chatId, `❓ Unknown competitor command.\n\n<b>competitor add &lt;url&gt;</b> — track a competitor\n<b>competitor remove &lt;url&gt;</b> — stop tracking`)
      }

    } else {
      await sendMessage(
        chatId,
        `🤖 <b>Velyr Growth Agent</b>\n\n` +
        `<b>Commands:</b>\n` +
        `<b>YES</b> — deploy the pending PR\n` +
        `<b>NO</b> — skip the pending PR\n` +
        `<b>approve &lt;run-id&gt;</b> — deploy a specific run (power users)\n` +
        `<b>reject &lt;run-id&gt;</b> — skip a specific run (power users)\n` +
        `<b>note &lt;reason&gt;</b> — add context to the last skipped PR\n` +
        `<b>dna</b> — view your Business DNA\n` +
        `<b>status</b> — last runs &amp; tracked competitors\n` +
        `<b>competitor add &lt;url&gt;</b> — track a competitor site\n` +
        `<b>competitor remove &lt;url&gt;</b> — stop tracking`
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