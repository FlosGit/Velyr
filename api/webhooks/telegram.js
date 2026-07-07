import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { getOctokit } from '../_lib/github-app.js'
import { reconcileDeployed, reconcileRejected, closeRejectedPr } from '../_lib/run-reconcile.js'
import { dispatchAgentRun, startFollowupRun } from '../_lib/edge-dispatch.js'
import { applyShopifyDirectWrite, executeShopifyDirectRollback, rejectShopifyDirect } from '../_lib/shopify-approval.js'
import { captureScreenshot } from '../_lib/screenshot.js'
import { refreshShopifyToken } from '../_lib/shopify-token-refresh.js'
import { duplicateTheme, deleteTheme, upsertThemeFiles } from '../_lib/shopify-theme-io.js'
import { normalizePendingWrite } from '../_lib/shopify-rollback.js'

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
    .replace(/"/g, '&quot;')
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

// C1: acknowledge an inline-button tap so Telegram stops the button's loading spinner.
// Best-effort — never throws. Optional `text` shows a toast to the user.
async function answerCallbackQuery(callbackQueryId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    })
  } catch (err) {
    console.warn('[telegram] answerCallbackQuery failed:', err?.message)
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
    // Trial customers have subscription_status='trialing' (Stripe) and get full
    // feature access — the cron run-eligibility queries accept both (api/agent/
    // run.js:880,1005). The Telegram trust gate must match, or trial users get
    // "subscription no longer active" for every command (incl. YES/NO approval)
    // and can never approve the PRs the agent opens for them.
    .in('agent_subscriptions.subscription_status', ['active', 'trialing'])
    .eq('agent_subscriptions.status', 'active')
    .not('verification_code_id', 'is', null)
    .not('verified_at',          'is', null)
    // A15: a chat CAN be verified for >1 connection (SG3a shared-chat). Without .limit(1)
    // the bare .maybeSingle() errored on 2 rows → null → every non-approval command
    // (status/dna/note/competitor) answered "subscription no longer active", even though
    // YES/NO worked (run-scoped via getChatAuthorizedSubIds). For these sub-scoped
    // commands any one of the chat's authorized subs is a valid target, so pick the
    // newest deterministically instead of failing closed. Approval stays run-scoped.
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[telegram] getActiveSubId query error for chat_id', chatId, error)
    return null
  }
  return data?.subscription_id ?? null
}

// Approval-path (RUN-scoped) counterpart to getActiveSubId. A YES/NO targets a
// specific run, so — unlike getActiveSubId, which is sub-scoped and deliberately
// refuses when >1 connection shares a chat — we resolve EVERY subscription this
// chat is verified to control and let the caller authorize by the run's own
// subscription. This is what keeps approval working when two connections share one
// telegram chat (SG3a). Same trust gates as getActiveSubId (verified binding +
// active/trialing subscription). Returns [] when none / on error (fail closed).
async function getChatAuthorizedSubIds(chatId) {
  const { data, error } = await supabase
    .from('agent_connections')
    .select('subscription_id, agent_subscriptions!inner(subscription_status, status)')
    .eq('telegram_chat_id', chatId)
    .in('agent_subscriptions.subscription_status', ['active', 'trialing'])
    .eq('agent_subscriptions.status', 'active')
    .not('verification_code_id', 'is', null)
    .not('verified_at',          'is', null)
  if (error) {
    console.error('[telegram] getChatAuthorizedSubIds query error for chat_id', chatId, error)
    return []
  }
  return [...new Set((data || []).map(r => r.subscription_id).filter(Boolean))]
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
  // SG3a: resolve across EVERY subscription the chat controls (not a single sub),
  // and take the NEWEST waiting_approval run instead of .maybeSingle() — so a chat
  // with >1 eligible run degrades to "newest" rather than nulling out and bricking
  // approval. The preferred, unambiguous path is reply-based (resolveApprovalRunId);
  // this bare-fallback only fires for a "yes"/"no" with no reply context.
  const subIds = await getChatAuthorizedSubIds(chatId)
  if (subIds.length === 0) return null

  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id')
    .in('subscription_id', subIds)
    .in('status', ['waiting_approval', 'shopify_awaiting_approval', 'shopify_rollback_pending'])
    .order('created_at', { ascending: false })
    .limit(1)

  return runs?.[0]?.id || null
}

// SG3a: which run does a bare YES/NO target? PREFERRED — the user replied to a
// specific approval message, so reply_to_message.message_id pins the exact run via
// agent_runs.telegram_message_id. Unambiguous no matter how many connections share
// the chat. The .in(subIds) clause is the ownership guard: the pinned run's
// subscription must be one this chat controls. FALLBACK (no reply, or the reply
// pointed at a stale/non-approval message) — the chat-based newest-run lookup.
async function resolveApprovalRunId(message, chatId) {
  const repliedId = message.reply_to_message?.message_id
  if (repliedId != null) {
    const subIds = await getChatAuthorizedSubIds(chatId)
    if (subIds.length > 0) {
      const { data: run } = await supabase
        .from('agent_runs')
        .select('id')
        .eq('telegram_message_id', repliedId)
        .in('status', ['waiting_approval', 'shopify_awaiting_approval', 'shopify_rollback_pending'])
        .in('subscription_id', subIds)
        .maybeSingle()
      if (run?.id) return run.id
    }
    // Reply didn't resolve a live approval — fall through to the chat-based lookup.
  }
  return findPendingRunForChat(chatId)
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
    // A13: a Shopify-direct NO lands the fix in 'shopify_rejected', not 'rejected', so
    // `note <reason>` after one previously answered "No recently skipped run".
    // C11: the owner-question message ("Reply note <answer>") accompanies a
    // 'skipped_low_confidence' run — without it here, the archetypal C11 customer
    // (only skips, no rejections) got "No recently skipped run" and the answer was lost.
    .in('status', ['rejected', 'shopify_rejected', 'skipped_low_confidence'])
    .eq('run_type', 'conversion_fix')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return run?.id || null
}

// ─── APPROVE ────────────────────────────────────────────────────────────────
async function handleApprove(runId, chatId) {
  // SG3a: authorize by the RUN's subscription being one this chat controls (across
  // ALL chat-bound subs) — not the single-sub getActiveSubId, which refuses (and so
  // bricked approval) when two connections shared a chat. maybeSingle stays safe:
  // the filter is on the run PK, so at most one row can match.
  const subIds = await getChatAuthorizedSubIds(chatId)
  if (subIds.length === 0) return notifyInactive(chatId)

  const { data: run } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .in('subscription_id', subIds)
    .maybeSingle()

  if (!run) return sendMessage(chatId, '❌ Run not found.')
  // SG: a pure-Shopify Admin-API run lands in 'shopify_awaiting_approval' (forward
  // apply) or 'shopify_rollback_pending' (a 48h-drop rollback awaiting approval); let
  // both past this gate so the Shopify branches below handle them. GitHub runs
  // ('waiting_approval') are unaffected and flow on unchanged.
  if (run.status !== 'waiting_approval' && run.status !== 'shopify_awaiting_approval' && run.status !== 'shopify_rollback_pending')
    return sendMessage(chatId, '⚠️ This run is no longer waiting for approval.')

  // ── Setup-PR: foreign-choice YES → fire Edge Function to build the PR ─────
  // The foreign-choice row has no pr_number yet. Fire-and-forget to the Edge
  // Function (same 2s-AbortController pattern as the cron trigger), which runs
  // createForeignSetupPR and converts this row to a normal setup_posthog run.
  if (run.run_type === 'setup_posthog_foreign_choice') {
    // CAS the claim so two concurrent YES messages don't both dispatch a setup PR.
    const { data: claimed } = await supabase.from('agent_runs')
      .update({ status: 'running' }).eq('id', runId).eq('status', 'waiting_approval').select('id')
    if (!claimed || claimed.length === 0) return  // another invocation already claimed it
    // A failed dispatch would leave the run stuck in 'running' (the stale sweep
    // silently fails it ~1h later) while the user was promised a PR that never
    // comes — roll the run back and ask them to retry.
    const dispatched = await dispatchAgentRun({ intent: 'foreign_setup_pr', subscriptionId: run.subscription_id })
    if (!dispatched) {
      await supabase.from('agent_runs').update({ status: 'waiting_approval' }).eq('id', runId)
      return sendMessage(chatId, `⚠️ I couldn't start preparing the analytics PR just now. Please reply <b>YES</b> again in a moment.`)
    }
    return sendMessage(chatId, `⚙️ Got it — preparing the analytics PR now. I'll message you when it's ready for review.`)
  }

  const { data: conn } = await supabase
    .from('agent_connections')
    .select('*')
    .eq('subscription_id', run.subscription_id)
    .single()

  // ── SG / Stage 3: Shopify-direct theme write (Admin API, NOT the GitHub theme
  // path) ─────────────────────────────────────────────────────────────────────
  // A Shopify-direct run has no PR. The per-file pending write was staged in
  // analysis_result.pending_write.files[] at run time. YES applies it to the live
  // theme via themeFilesUpsert (needs write_themes), guarded by an optimistic-
  // concurrency check, then returns BEFORE any octokit/PR logic. The PURE decision
  // logic (shopify-rollback.js) is unit-tested; the GraphQL I/O (shopify-theme-io.js)
  // is dev-store-verified. Both branches keep the status off the success value on any
  // failure and send an honest message.
  if (run.status === 'shopify_awaiting_approval') {
    const r = await applyShopifyDirectWrite(supabase, run, conn)
    if (r.noop) return  // another invocation already owns this approval
    return sendMessage(chatId, r.message)
  }
  // A 48h bounce/revenue-drop check recommended a rollback (handleRollbackCheck set
  // 'shopify_rollback_pending' + stored applied_write). YES executes the rollback via
  // the same re-upsert(prior)/delete(created) strategy; NO (handleReject) keeps it.
  if (run.status === 'shopify_rollback_pending') {
    const r = await executeShopifyDirectRollback(supabase, run, conn)
    if (r.noop) return
    return sendMessage(chatId, r.message)
  }

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
    const reconciled = await reconcileDeployed(supabase, run, prInfo.merge_commit_sha, { approvalLabel: 'YES, already merged' })
    if (reconciled.kind === 'noop') return sendMessage(chatId, `✅ <b>Already merged.</b> (Reconciled — status updated.)`)
    if (reconciled.kind === 'rollback_executed') {
      return sendMessage(chatId, `🔄 <b>Rollback merged.</b> The change has been reverted on your site (the revert PR was already merged).`)
    }
    if (reconciled.kind === 'setup_installed') {
      const started = await startFollowupRun(supabase, run.subscription_id)
      return sendMessage(chatId, started
        ? `✅ <b>Already merged — analytics installed.</b> Starting your first analysis run now.`
        : `✅ <b>Already merged — analytics installed.</b> I couldn't start your analysis run automatically — tap <b>Run now</b> in your dashboard.`)
    }
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
  if (result.kind === 'noop') return  // another invocation already reconciled this merge

  // Auto-rollback revert PR merged → the earlier fix has been undone.
  if (result.kind === 'rollback_executed') {
    return sendMessage(chatId, `🔄 <b>Rolled back.</b> The revert PR was merged — Vercel is deploying the reverted version now. Your site is back to before this change.`)
  }

  // Setup-PR YES → "analytics installed" + start the analysis run the setup consumed;
  // conversion fix → "deploying" message.
  if (result.kind === 'setup_installed') {
    const started = await startFollowupRun(supabase, run.subscription_id)
    return sendMessage(chatId, started
      ? `✅ <b>Analytics installed.</b> Starting your first analysis run with real visitor data now — I'll message you when it's ready.`
      : `✅ <b>Analytics installed.</b> I couldn't start your analysis run automatically — tap <b>Run now</b> in your dashboard to start it.`)
  }

  // SG4b item 4: a Shopify-via-GitHub theme fix goes live when Shopify syncs the
  // merged connected branch into the live theme — NOT a Vercel deploy — so the
  // post-merge wording must say that for a merchant. Detect theme-ness from the
  // edited file living in a Shopify theme directory, the SAME signal SG4a's
  // rollback guard uses (layout/templates/sections/snippets *.liquid|*.json) —
  // reused, not reinvented. Non-theme wording stays byte-identical to before.
  const isThemeRun = /^(layout|templates|sections|snippets)\/.+\.(liquid|json)$/i.test(run.analysis_result?.file_to_edit || '')
  await sendMessage(
    chatId,
    isThemeRun
      ? `✅ <b>PR merged!</b> Shopify is syncing the change to your connected theme now.\n\n<i>The agent will check impact after 48h and recommend a rollback (waiting on your approval) if metrics drop.</i>`
      : `✅ <b>PR merged!</b> Vercel is deploying the change now.\n\n<i>The agent will check impact after 48h and recommend a rollback (waiting on your approval) if metrics drop.</i>`
  )
}

// ─── REJECT ─────────────────────────────────────────────────────────────────
async function handleReject(runId, chatId) {
  // SG3a: same chat-bound, run-scoped authorization as handleApprove (works when
  // multiple connections share a chat).
  const subIds = await getChatAuthorizedSubIds(chatId)
  if (subIds.length === 0) return notifyInactive(chatId)

  const { data: run } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .in('subscription_id', subIds)
    .maybeSingle()

  if (!run) return sendMessage(chatId, '❌ Run not found.')
  // SG: let pure-Shopify 'shopify_awaiting_approval' and 'shopify_rollback_pending' runs
  // past this gate (handled by the no-PR branches below). GitHub 'waiting_approval' runs
  // are unchanged.
  if (run.status !== 'waiting_approval' && run.status !== 'shopify_awaiting_approval' && run.status !== 'shopify_rollback_pending')
    return sendMessage(chatId, '⚠️ This run is no longer waiting for approval.')

  // SG: a pure-Shopify forward proposal / rollback proposal has no PR to close — reject
  // is a status flip + confirmation, handled by the shared rejectShopifyDirect (also used
  // by the dashboard Skip button). shopify_awaiting_approval → shopify_rejected (setup
  // decline stamps the install gate + starts the analysis run); shopify_rollback_pending →
  // shopify_deployed (keep the change live). Returns before any GitHub close/reconcile.
  if (run.status === 'shopify_awaiting_approval' || run.status === 'shopify_rollback_pending') {
    const r = await rejectShopifyDirect(supabase, run)
    if (r.noop) return  // another invocation already handled it
    return sendMessage(chatId, r.message)
  }

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
  if (result.kind === 'noop') return  // another invocation already rejected this run

  // NO on an auto-rollback proposal = keep the change live (the run is flipped back to
  // 'deployed'). The revert PR + its agent/rollback-* branch were just cleaned up above.
  if (result.kind === 'rollback_declined') {
    return sendMessage(chatId, `👍 <b>Kept the change live.</b> No rollback — I'll keep watching the metrics.`)
  }

  switch (result.kind) {
    // setup_retry deliberately does NOT dispatch a follow-up run: the next run
    // re-offers the setup once more, so an immediate run would just re-ask.
    case 'setup_retry':
      return sendMessage(chatId, `⏭️ Skipped for now — I'll offer it once more next run.`)
    case 'foreign_declined':
    case 'setup_declined': {
      // Permanent decline unblocks analysis — start the run the setup consumed.
      const started = await startFollowupRun(supabase, run.subscription_id)
      return sendMessage(chatId, started
        ? `Understood — I won't ask again. Starting your analysis run now; re-enable tracking from your dashboard anytime.`
        : `Understood — I won't ask again. Re-enable tracking from your dashboard anytime.`)
    }
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
  // Bounce-type learnings store percentage-POINT deltas, not percentages.
  const fmtDelta = (d, metricType) => {
    const unit = /bounce/.test(metricType || '') ? 'pp' : '%'
    return d > 0 ? `+${d}${unit}` : `${d}${unit}`
  }

  const winsText = wins.length
    ? wins.map(l => `✅ ${escapeHtml(l.change_type)}: ${escapeHtml(l.summary)} (${fmtDelta(l.delta, l.metric_type)} ${escapeHtml(l.metric_type)})`).join('\n')
    : '<i>None yet</i>'

  const lossesText = losses.length
    ? losses.map(l => `❌ ${escapeHtml(l.change_type)}: ${escapeHtml(l.summary)} (${fmtDelta(l.delta, l.metric_type)} ${escapeHtml(l.metric_type)})`).join('\n')
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
    approved: '✅', rejected: '❌', deployed: '🚀', failed: '💥', rolled_back: '🔄',
    // A13: Shopify-direct lifecycle — without these every shopify_* run rendered as ❓.
    shopify_awaiting_approval: '⏸', shopify_deployed: '🚀', shopify_rejected: '❌',
    shopify_rollback_pending: '⏸', shopify_rolled_back: '🔄', shopify_concurrency_abort: '🛑',
    shopify_needs_reconsent: '🔌', shopify_not_configured: '⚙️', shopify_token_failed: '🔌',
    shopify_theme_read_failed: '⚠️',
    // Honest skips / find problems (both connection types).
    skipped_low_confidence: '🤷', skipped_no_data: '🤷', skipped_insufficient_graph: '🤷',
    skipped_cost_cap: '💸', skipped_repo_unavailable: '⚠️', skipped_unsupported_framework: '⚠️',
    skipped_setup_pending: '⏭️', find_mismatch: '🔍', find_ambiguous: '🔍',
  }

  const lines = runs?.map(r => {
    const emoji = statusEmoji[r.status] ?? '❓'
    const date = new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    const prLink = r.pr_url ? ` — <a href="${escapeHtml(r.pr_url)}">PR</a>` : ''
    // replace(/_/g, …): multi-underscore statuses (shopify_awaiting_approval) need a
    // global replace, not the first-only .replace('_', ' ').
    return `${emoji} <code>${escapeHtml(r.id.slice(0, 8))}</code> ${escapeHtml(r.status.replace(/_/g, ' '))} (${date})${prLink}`
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
  if (competitorLines.length) msg += `\n\n<b>Tracked Competitors:</b>\n${competitorLines.join('\n')}`

  await sendMessage(chatId, msg)
}

// ─── C4: PREVIEW (inline button on GitHub approval messages) ──────────────────
// Vercel/Netlify already build a preview deployment per PR; surface it as "current
// vs proposed" — the preview URL always, a before/after photo pair when
// ScreenshotOne is configured. ONE bounded pass, no polling: if CI hasn't finished
// the user taps Preview again in a minute. Authorization mirrors handleApprove
// (the run must belong to a chat-authorized subscription; callback_data is only a
// pointer, never trusted).
async function handlePreview(runId, chatId) {
  const subIds = await getChatAuthorizedSubIds(chatId)
  if (subIds.length === 0) return notifyInactive(chatId)
  const { data: run } = await supabase
    .from('agent_runs').select('*')
    .eq('id', runId).in('subscription_id', subIds).maybeSingle()
  if (!run) return sendMessage(chatId, '❌ Run not found.')
  // C3: a Shopify-direct approval previews via a throwaway duplicate theme.
  if (run.status === 'shopify_awaiting_approval') return handleShopifyThemePreview(run, chatId)
  if (run.status !== 'waiting_approval' || !run.pr_number) {
    return sendMessage(chatId, 'ℹ️ This run has no open PR to preview.')
  }
  const { data: conn } = await supabase
    .from('agent_connections').select('*')
    .eq('subscription_id', run.subscription_id).maybeSingle()
  if (!conn?.github_installation_id) return sendMessage(chatId, '❌ GitHub connection not found.')

  try {
    const octokit = await getOctokit(conn.github_installation_id)
    const owner = conn.github_repo_owner, repo = conn.github_repo_name
    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: run.pr_number })
    // Vercel/Netlify register a GitHub Deployment for the PR head sha; the successful
    // deployment status carries environment_url. Newest first, 3 deployments is plenty.
    const { data: deployments } = await octokit.rest.repos.listDeployments({ owner, repo, sha: pr.head.sha, per_page: 3 })
    let previewUrl = null
    for (const d of (deployments || [])) {
      const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({ owner, repo, deployment_id: d.id, per_page: 5 })
      const ok = (statuses || []).find(s => s.state === 'success' && s.environment_url)
      if (ok) { previewUrl = ok.environment_url; break }
    }
    if (!previewUrl) {
      return sendMessage(chatId, '⏳ No finished preview deployment for this PR yet — your CI may still be building. Tap 🔍 Preview again in a minute.')
    }

    // Before-shot was captured at analysis time; the after-shot renders the CI
    // preview now. Both best-effort — the URL message below is the guaranteed part.
    const afterShot = await captureScreenshot(supabase, previewUrl)
    const beforeShot = run.screenshot_before || null
    if (afterShot && beforeShot) {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          media: [
            { type: 'photo', media: beforeShot, caption: 'Before — your live site today' },
            { type: 'photo', media: afterShot,  caption: 'After — with the proposed change (PR preview)' },
          ],
        }),
      }).catch(err => console.warn('[telegram] preview media group failed:', err?.message))
    }
    await sendMessage(chatId, `🔍 <b>PR preview</b>\n\n<a href="${escapeHtml(previewUrl)}">${escapeHtml(previewUrl)}</a>\n\nThis is your site <b>with</b> the proposed change, built by your own CI. Reply YES to apply it or NO to skip.`)
  } catch (err) {
    console.error('[telegram] preview failed:', err?.message)
    await sendMessage(chatId, '❌ Could not fetch the PR preview from GitHub — you can open the PR itself to find your CI’s preview link.')
  }
}

// ─── C3: SHOPIFY-DIRECT THEME PREVIEW (flag-gated, default OFF) ────────────────
// Stages the pending fix onto a throwaway DUPLICATE of the analyzed theme and
// replies with Shopify's native ?preview_theme_id link — the merchant sees the
// change on their real store before anything touches the live theme. The duplicate
// is deleted when they decide (cleanupPreviewTheme in shopify-approval.js).
//
// GATE: AGENT_SHOPIFY_PREVIEW_THEMES=1 (Vercel env; the edge fn shows the button
// under its own copy of the flag). Enable ONLY after scripts/shopify-dv-verify.mjs
// steps (5)+(6) — themeDuplicate/themeDelete are Admin API 2026-07 shapes and were
// NOT dev-store-exercised when this shipped.
async function handleShopifyThemePreview(run, chatId) {
  if (process.env.AGENT_SHOPIFY_PREVIEW_THEMES !== '1') {
    return sendMessage(chatId, 'ℹ️ Theme previews aren’t enabled yet — reply YES / NO, or check the Find/Replace above.')
  }
  const { data: conn } = await supabase
    .from('agent_connections').select('*')
    .eq('subscription_id', run.subscription_id).maybeSingle()
  if (!conn?.shopify_shop_domain) return sendMessage(chatId, '❌ Shopify connection not found.')
  const shop = conn.shopify_shop_domain

  const previewMsg = (themeId) =>
    `🔍 <b>Preview ready</b>\n\n<a href="https://${escapeHtml(shop)}/?preview_theme_id=${encodeURIComponent(themeId)}">View your store WITH the proposed change</a>\n\nThat's a throwaway copy — your live theme is untouched. I'll delete it automatically when you decide. Reply YES to apply / NO to skip.`

  // Reuse the preview this run already created (second tap = same link).
  if (run.analysis_result?.preview_theme_id) {
    return sendMessage(chatId, previewMsg(run.analysis_result.preview_theme_id))
  }

  const pending = normalizePendingWrite(run.analysis_result?.pending_write)
  if (!pending.themeId || pending.files.length === 0) {
    return sendMessage(chatId, '❌ I couldn’t find the prepared change for this run, so there’s nothing to preview.')
  }
  const tok = await refreshShopifyToken(supabase, conn)
  if (!tok.ok) {
    return sendMessage(chatId, tok.reason === 'needs_reconsent'
      ? '🔌 Your Shopify connection has expired — reconnect your store, then tap Preview again.'
      : '⚠️ Couldn’t reach Shopify just now — tap Preview again in a minute.')
  }

  const dup = await duplicateTheme(shop, tok.accessToken, pending.themeId, `Velyr preview ${new Date().toISOString().slice(0, 10)}`)
  if (!dup.ok) {
    return sendMessage(chatId, `❌ Couldn’t create a preview copy of your theme.\n\n<i>${escapeHtml(dup.message || '')}</i>\n\nA full theme library (Shopify caps stores at 20 themes) is the usual cause — delete an unused theme and tap Preview again.`)
  }
  const up = await upsertThemeFiles(shop, tok.accessToken, dup.themeId, pending.files.map(f => ({ filename: f.filename, content: f.newContent })))
  if (!up.ok || (up.userErrors || []).length > 0) {
    // Never leave a half-written preview behind.
    await deleteTheme(shop, tok.accessToken, dup.themeId).catch(() => {})
    return sendMessage(chatId, '❌ Couldn’t stage the change onto the preview copy — nothing to preview. Your live theme is untouched.')
  }

  // Persist the preview id for reuse + decide-time cleanup — but ONLY while the run
  // is still awaiting approval. The status condition means a racing YES (which CAS-
  // claims status='running', then writes applied_write into analysis_result) can
  // never have its rollback basis clobbered by this update; worst case the id isn't
  // recorded and this one duplicate lingers until manually deleted.
  const { data: freshRun } = await supabase.from('agent_runs')
    .select('analysis_result').eq('id', run.id).eq('status', 'shopify_awaiting_approval').maybeSingle()
  if (freshRun) {
    await supabase.from('agent_runs')
      .update({ analysis_result: { ...freshRun.analysis_result, preview_theme_id: dup.themeId } })
      .eq('id', run.id).eq('status', 'shopify_awaiting_approval')
  }
  return sendMessage(chatId, previewMsg(dup.themeId))
}

// ─── NOTE ─────────────────────────────────────────────────────────────────────
async function handleNote(runId, reason, chatId) {
  const subId = await getActiveSubId(chatId)
  if (!subId) return notifyInactive(chatId)

  const { data: run } = await supabase
    .from('agent_runs')
    .select('subscription_id, analysis_result, status')
    .eq('id', runId)
    .eq('subscription_id', subId)
    .maybeSingle()

  if (!run) return sendMessage(chatId, '❌ Run not found.')

  // C11: a note on a REJECTED run explains the rejection → 'negative' (feeds the
  // never-do-again block). A note on a SKIPPED run is the owner ANSWERING the agent's
  // question (or volunteering context) — storing that as 'negative' inverted its
  // meaning into an anti-pattern. 'neutral' + metric_type 'manual' rows are injected
  // as OWNER CONTEXT by the edge fn's fetchBusinessDNA.
  const isRejection = run.status === 'rejected' || run.status === 'shopify_rejected'
  await supabase.from('agent_learnings').insert({
    subscription_id: run.subscription_id,
    run_id: runId,
    change_type: run.analysis_result?.change_type || 'other',
    summary: reason,
    outcome: isRejection ? 'negative' : 'neutral',
    metric_type: 'manual',
    delta: 0,
    confidence: 'low'
  })

  await sendMessage(chatId, isRejection
    ? `🧬 <b>Note saved to Business DNA.</b>\n<i>"${escapeHtml(reason)}"</i>\n\nThe agent will factor this in on the next run.`
    : `🧬 <b>Answer saved.</b>\n<i>"${escapeHtml(reason)}"</i>\n\nThe agent will use this as business context in every future run.`)
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

  // Precise match. The previous `.ilike('url', '%'+url+'%')` over-matched on a
  // substring — removing "a.com" would also deactivate "data.com". Compare on a
  // normalized form (lowercased, scheme + trailing slash stripped) so the user
  // removes exactly the competitor they named, and tell them when nothing matched.
  const norm = (u) => String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const target = norm(url)

  const { data: rows } = await supabase
    .from('agent_competitor_urls')
    .select('id, url')
    .eq('subscription_id', subId)
    .eq('active', true)

  const matchIds = (rows || []).filter(r => norm(r.url) === target).map(r => r.id)
  if (matchIds.length === 0) {
    return sendMessage(chatId, `⚠️ No tracked competitor matches <code>${escapeHtml(url)}</code>. Send <b>status</b> to see the exact URLs.`)
  }

  await supabase
    .from('agent_competitor_urls')
    .update({ active: false })
    .in('id', matchIds)

  await sendMessage(chatId, `🗑️ <b>Competitor removed.</b> The agent will no longer scan that URL.`)
}

// ─── SET CONNECTED BRANCH (SG3b) ─────────────────────────────────────────────
// Shopify-via-GitHub: tell Velyr which branch Shopify syncs to the live theme, so
// theme PRs target it (a merged PR on the wrong branch silently never syncs). NULL
// (the default) = the repo's default branch. `branchName === null` clears the
// override. We validate the branch EXISTS in the repo before saving so a typo can't
// silently re-break sync. Chat-scoped via getChatAuthorizedSubIds (SG3a) — safe on
// shared-chat test setups: we only write a connection whose repo actually contains
// the branch (so a non-theme connection sharing the chat is left untouched unless it
// genuinely has that branch, where the column is harmlessly ignored for non-theme runs).
async function handleSetBranch(branchName, chatId) {
  const subIds = await getChatAuthorizedSubIds(chatId)
  if (subIds.length === 0) return notifyInactive(chatId)

  const { data: conns } = await supabase
    .from('agent_connections')
    .select('subscription_id, github_installation_id, github_repo_owner, github_repo_name')
    .in('subscription_id', subIds)

  if (!conns || conns.length === 0) {
    return sendMessage(chatId, '❌ No connected repo found for your account.')
  }

  // Clear → back to the repo default branch.
  if (!branchName) {
    await supabase.from('agent_connections')
      .update({ shopify_connected_branch: null })
      .in('subscription_id', subIds)
    return sendMessage(chatId, `✅ <b>Cleared.</b> Fixes will target your repo's default branch.`)
  }

  const branch = branchName.trim()
  const written = []
  const skipped = []
  for (const c of conns) {
    if (!c.github_installation_id || !c.github_repo_owner || !c.github_repo_name) continue
    const repoLabel = `${c.github_repo_owner}/${c.github_repo_name}`
    try {
      const octokit = await getOctokit(c.github_installation_id)
      // Typo guard: getBranch 404s if the branch doesn't exist → we do NOT save.
      await octokit.rest.repos.getBranch({ owner: c.github_repo_owner, repo: c.github_repo_name, branch })
      await supabase.from('agent_connections')
        .update({ shopify_connected_branch: branch })
        .eq('subscription_id', c.subscription_id)
      written.push(repoLabel)
    } catch (err) {
      if (err?.status === 404) skipped.push(`${repoLabel} (no branch "${branch}")`)
      else skipped.push(`${repoLabel} (${err?.message || 'error'})`)
    }
  }

  if (written.length === 0) {
    return sendMessage(chatId, `❌ Branch <code>${escapeHtml(branch)}</code> not found in your connected repo${conns.length > 1 ? 's' : ''}. Nothing was changed — check the name and try again.`)
  }
  let msg = `✅ Fixes will now target branch <code>${escapeHtml(branch)}</code> (${written.map(escapeHtml).join(', ')}).`
  if (skipped.length) msg += `\n\n⚠️ Skipped: ${skipped.map(escapeHtml).join('; ')}`
  return sendMessage(chatId, msg)
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
          // A redelivered callback_query still needs its ACK or the user's button
          // spinner runs until Telegram times out.
          if (body.callback_query?.id) await answerCallbackQuery(body.callback_query.id)
          return res.status(200).json({ ok: true, deduped: true })
        }
        // Any other DB error: log but proceed (better to risk a double-fire
        // once than to brick the webhook on a transient DB hiccup). If the
        // dedupe table is missing entirely the agent_runs status guard
        // (`run.status !== 'waiting_approval'`) still prevents double-merge.
        console.warn(`[telegram] dedupe insert failed for update_id ${updateId}:`, insertErr.message)
      }
    }

    // C1: inline-button taps arrive as callback_query (no body.message). callback_data is
    // 'approve:<runId>' | 'reject:<runId>' — the exact run id, so a tap resolves the precise
    // run (unlike a bare text "YES", which degrades to newest-pending). Authorization is
    // identical to the `approve <run-id>` command: handleApprove/handleReject validate the
    // run against the chat's authorized subs, so callback_data is never blindly trusted. The
    // update_id dedupe above already guards Telegram redelivery / double-taps (and the CAS
    // inside reconcile* is the final guard).
    const cbq = body.callback_query
    if (cbq) {
      const cbChatId = cbq.message?.chat?.id
      const data = typeof cbq.data === 'string' ? cbq.data : ''
      const m = /^(approve|reject|preview):(.+)$/.exec(data)
      // Stop the button spinner immediately; a preview tap gets a status toast
      // because its work (GitHub lookup + screenshot) takes a few seconds.
      await answerCallbackQuery(cbq.id, m?.[1] === 'preview' ? '📸 Looking for the PR preview…' : undefined)
      if (m && cbChatId != null) {
        const [, action, runId] = m
        if (action === 'approve')      await handleApprove(runId, cbChatId)
        else if (action === 'reject')  await handleReject(runId, cbChatId)
        else                           await handlePreview(runId, cbChatId)
      }
      return res.status(200).json({ ok: true })
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
      const runId = await resolveApprovalRunId(message, chatId)
      if (!runId) await sendMessage(chatId, '⚠️ No pending approval found. The agent will message you when the next run is ready.')
      else        await handleApprove(runId, chatId)

    } else if ((cmd === 'no' || cmd === 'n' || cmd === '❌') && parts.length === 1) {
      const runId = await resolveApprovalRunId(message, chatId)
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

    } else if (cmd === 'set' && parts[1]?.toLowerCase() === 'branch') {
      // SG3b: `set branch <name>` → theme fixes target that branch; `set branch`
      // with no name clears the override back to the repo default branch.
      await handleSetBranch(parts[2] || null, chatId)

    } else if (cmd === 'unset' && parts[1]?.toLowerCase() === 'branch') {
      await handleSetBranch(null, chatId)

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
        `<b>competitor remove &lt;url&gt;</b> — stop tracking\n` +
        `<b>set branch &lt;name&gt;</b> — Shopify theme: branch fixes target (else default)\n` +
        `<b>unset branch</b> — clear it back to the default branch`
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