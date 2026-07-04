import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { getOctokit } from '../_lib/github-app.js'
import { reconcileDeployed, reconcileRejected, closeRejectedPr } from '../_lib/run-reconcile.js'
import { dispatchAgentRun, startFollowupRun } from '../_lib/edge-dispatch.js'
import { normalizePendingWrite, classifyConcurrency, confirmApplied, resolveAppliedFiles, planRollbackOps, classifyCreatedCollisions } from '../_lib/shopify-rollback.js'
import { queryThemeChecksums, upsertThemeFiles, deleteThemeFiles } from '../_lib/shopify-theme-io.js'
import { refreshShopifyToken } from '../_lib/shopify-token-refresh.js'

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
    .eq('status', 'rejected')
    .eq('run_type', 'conversion_fix')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return run?.id || null
}

// ─── SHOPIFY-DIRECT: forward apply (YES on shopify_awaiting_approval) ─────────
// Optimistic concurrency → upsert → confirm (option a) → record applied_write.
// The checksum re-query and the upsert run BACK-TO-BACK (only pure compares between),
// so a merchant edit since analysis is caught with the smallest possible race window.
async function applyShopifyDirectWrite(run, conn, chatId) {
  const pending = normalizePendingWrite(run.analysis_result?.pending_write)
  if (!pending.themeId || pending.files.length === 0) {
    return sendMessage(chatId, `❌ I couldn't find the prepared change for this run (missing pending write). Nothing was applied — the agent will retry on the next run.`)
  }
  // Atomically CLAIM the run before any write so two concurrent YES messages can't
  // both apply (which would double-write and false-abort each other). The winner
  // flips shopify_awaiting_approval → 'running'; the loser gets 0 rows and bails.
  // 'running' is also the honest in-progress status: a crash mid-write leaves it
  // 'running' (stale-swept to failed), never a dishonest shopify_awaiting_approval,
  // and applied_write is persisted before the upsert so the change stays recoverable.
  const { data: claimed } = await supabase.from('agent_runs')
    .update({ status: 'running' }).eq('id', run.id).eq('status', 'shopify_awaiting_approval').select('id')
  if (!claimed || claimed.length === 0) return  // another invocation already owns this approval

  // Refresh the Shopify access token if needed BEFORE any theme I/O. The merchant
  // typically approves far more than the ~60-min access-token life after the run, so
  // a stored token is usually expired here; without this every delayed YES 401'd.
  const tok = await refreshShopifyToken(supabase, conn)
  if (!tok.ok) {
    // Un-claim so the merchant can retry after reconnecting / transient recovery.
    await supabase.from('agent_runs').update({ status: 'shopify_awaiting_approval' }).eq('id', run.id)
    return sendMessage(chatId, tok.reason === 'needs_reconsent'
      ? `🔌 Your Shopify connection has expired — please reconnect your store, then I can apply changes again.`
      : `⚠️ I couldn't reach Shopify to refresh access just now, so I applied nothing. The agent will retry on the next run.`)
  }
  const token = tok.accessToken
  const shop = conn.shopify_shop_domain

  // 1. Optimistic concurrency — re-query the CURRENT checksum of every modified file.
  const modifiedFilenames = pending.files
    .filter(f => f.op === 'modified' && f.checksumMd5 != null)
    .map(f => f.filename)
  if (modifiedFilenames.length > 0) {
    const cks = await queryThemeChecksums(shop, token, pending.themeId, modifiedFilenames)
    if (!cks.ok) {
      // Couldn't read the live state → never overwrite blind.
      await supabase.from('agent_runs').update({
        status: 'failed', error_message: `Pre-write checksum re-query failed: ${cks.message}`.slice(0, 500),
      }).eq('id', run.id)
      return sendMessage(chatId, `❌ I couldn't verify your theme's current state, so I applied nothing. The agent will retry on the next run.`)
    }
    const concurrency = classifyConcurrency(pending.files, cks.byFilename)
    if (!concurrency.ok) {
      await supabase.from('agent_runs').update({
        status: 'shopify_concurrency_abort', completed_at: new Date().toISOString(),
        error_message: `Theme changed since analysis: ${concurrency.conflicts.join(', ')}`.slice(0, 500),
      }).eq('id', run.id)
      return sendMessage(chatId, `🛑 Your theme changed since we analyzed it (<code>${concurrency.conflicts.map(escapeHtml).join(', ')}</code>), so I did <b>not</b> apply this — I won't overwrite your edit. Re-run the agent to analyze the current version.`)
    }
  }

  // 1b. Created-file existence guard — a staged op:'created' file must still be
  //     ABSENT live, or the upsert below would overwrite merchant content (and a
  //     later rollback would DELETE it: planRollbackOps created → delete). No-op
  //     today (all staged files are op:'modified'); guards the Stage-4 created path.
  const createdFilenames = pending.files.filter(f => f.op === 'created').map(f => f.filename)
  if (createdFilenames.length > 0) {
    const cks = await queryThemeChecksums(shop, token, pending.themeId, createdFilenames)
    if (!cks.ok) {
      await supabase.from('agent_runs').update({
        status: 'failed', error_message: `Pre-write existence re-query failed: ${cks.message}`.slice(0, 500),
      }).eq('id', run.id)
      return sendMessage(chatId, `❌ I couldn't verify your theme's current state, so I applied nothing. The agent will retry on the next run.`)
    }
    const collision = classifyCreatedCollisions(pending.files, cks.byFilename)
    if (!collision.ok) {
      await supabase.from('agent_runs').update({
        status: 'shopify_concurrency_abort', completed_at: new Date().toISOString(),
        error_message: `File I planned to create already exists: ${collision.collisions.join(', ')}`.slice(0, 500),
      }).eq('id', run.id)
      return sendMessage(chatId, `🛑 A file I planned to create (<code>${collision.collisions.map(escapeHtml).join(', ')}</code>) already exists on your theme, so I did <b>not</b> apply this — I won't overwrite it. Re-run the agent to analyze the current version.`)
    }
  }

  // 1c. Persist the rollback basis (priorContent for every file) BEFORE the live
  //     write. If the process crashes between the upsert and the shopify_deployed
  //     flip, applied_write is already recorded so the change is recoverable rather
  //     than an orphaned, un-rollbackable live edit. The confirm/partial/success
  //     branches below overwrite applied_write with the ACTUAL landed set.
  const intendedApplied = pending.files.map(f => ({ filename: f.filename, op: f.op, priorContent: f.priorContent ?? null }))
  await supabase.from('agent_runs').update({
    analysis_result: { ...run.analysis_result, applied_write: { themeId: pending.themeId, files: intendedApplied, upsertJobId: null } },
  }).eq('id', run.id)

  // 2. Apply — full-file upsert (immediately after the check; nothing slow between).
  const up = await upsertThemeFiles(shop, token, pending.themeId, pending.files.map(f => ({ filename: f.filename, content: f.newContent })))
  if (!up.ok) {
    // TODO (re-consent, write stages): up.reason === 'unauthorized' (403) likely means
    // this connection was authorized under the OLD read_themes-only scope. Surface a
    // specific "reconnect your store to grant theme-write access" prompt (re-run Shopify
    // OAuth) instead of this generic retry — a silent 403 is trust-breaking for a
    // live-theme tool. The new write_themes scope only applies to connections authorized
    // after Stage 2a deploys.
    await supabase.from('agent_runs').update({
      status: 'failed', error_message: `Shopify theme write failed: ${up.message}`.slice(0, 500),
    }).eq('id', run.id)
    return sendMessage(chatId, `❌ I couldn't apply the change to your live theme.\n\n<i>${escapeHtml(up.message)}</i>\n\nNothing was changed — the agent will retry on the next run.`)
  }

  // 3. Confirm (option a — trust the response: every requested file upserted, no userErrors).
  const confirmed = confirmApplied(pending.files.map(f => f.filename), up.upsertedFilenames, up.userErrors)
  if (!confirmed.ok) {
    const detail = confirmed.reason === 'user_errors'
      ? up.userErrors.map(e => e?.message).filter(Boolean).join('; ')
      : `not applied: ${confirmed.missing.join(', ')}`
    // Record whatever DID land (partial batch) as the rollback basis so a future
    // rollback/cleanup can revert it — never orphan a landed file with no prior record.
    // (Unreachable for today's single-file flow, where nothing-landed = clean fail; it
    // matters once a run writes multiple files, e.g. the Stage-4 PostHog injection.)
    const landed = resolveAppliedFiles(pending.files, up.upsertedFilenames)
      .map(f => ({ filename: f.filename, op: f.op, priorContent: f.priorContent ?? null }))
    await supabase.from('agent_runs').update({
      status: 'failed', error_message: `Shopify theme write not confirmed: ${detail}`.slice(0, 500),
      ...(landed.length ? { analysis_result: { ...run.analysis_result, applied_write: { themeId: pending.themeId, files: landed, upsertJobId: up.jobId ?? null } } } : {}),
    }).eq('id', run.id)
    return sendMessage(chatId, `❌ I couldn't confirm the change applied to your live theme.\n\n<i>${escapeHtml(detail)}</i>\n\nThe agent will retry on the next run.`)
  }

  // 4. Record the APPLIED set (partial-batch aware) as the rollback basis, then deploy.
  const appliedResolved = resolveAppliedFiles(pending.files, up.upsertedFilenames)
  // H4: re-query the POST-DEPLOY live checksum of each restorable (modified) file so a
  // future rollback can optimistic-concurrency-check against the merchant's live theme
  // (they may hand-edit during the ~48h before a rollback). Best-effort: a failed
  // re-query leaves checksumMd5 null → that file's rollback degrades to the legacy
  // unguarded restore (classifyConcurrency skips null recorded checksums).
  const restorable = appliedResolved.filter(f => f.op === 'modified').map(f => f.filename)
  let deployedCks = {}
  if (restorable.length > 0) {
    const q = await queryThemeChecksums(shop, token, pending.themeId, restorable)
    if (q.ok) deployedCks = q.byFilename
  }
  const appliedFiles = appliedResolved.map(f => ({
    filename: f.filename, op: f.op, priorContent: f.priorContent ?? null,
    checksumMd5: f.op === 'modified' ? (deployedCks[f.filename] ?? null) : null,
  }))
  await supabase.from('agent_runs').update({
    status: 'shopify_deployed', completed_at: new Date().toISOString(),
    // upsertJobId: the themeFilesUpsert async job id — persisted for a future option-(b)
    // confirm-via-poll upgrade; not polled today (confirmation stays option (a)).
    analysis_result: { ...run.analysis_result, applied_write: { themeId: pending.themeId, files: appliedFiles, upsertJobId: up.jobId ?? null } },
  }).eq('id', run.id)

  // Stage 4: a PostHog-setup apply also stamps the install-once gate + gets its own copy.
  // The setup proposal consumed the run the user actually asked for — resolving it
  // starts the real analysis immediately instead of stranding them behind the cooldown.
  if (run.analysis_result?.setup_kind === 'posthog') {
    await supabase.from('agent_connections')
      .update({ posthog_snippet_installed_at: new Date().toISOString() })
      .eq('subscription_id', run.subscription_id)
    const started = await startFollowupRun(supabase, run.subscription_id)
    return sendMessage(chatId, started
      ? `✅ Analytics installed on your live theme — Velyr can now measure your conversions. Starting your first analysis run now — I'll message you when it's ready.`
      : `✅ Analytics installed on your live theme — but I couldn't start your analysis run automatically. Tap <b>Run now</b> in your dashboard to start it.`)
  }
  return sendMessage(chatId, `✅ Applied <code>${escapeHtml(appliedFiles.map(f => f.filename).join(', '))}</code> to your live theme.`)
}

// ─── SHOPIFY-DIRECT: rollback execution (YES on shopify_rollback_pending) ─────
// Reverts ONLY the files that actually landed (applied_write), each by the op the pure
// planner picks: modified → re-upsert priorContent; created → delete. Separate from the
// GitHub PR-revert path (selected by status; no interleaved if(hasPR)).
// TODO (deferred): a merchant-initiated one-tap "revert last change" command would reuse
// this same executor against the most recent shopify_deployed run's applied_write — no
// auto-proposal needed. Not built (parity with the GitHub flow's no-standalone-undo today).
async function executeShopifyDirectRollback(run, conn, chatId) {
  const applied = run.analysis_result?.applied_write
  const files = Array.isArray(applied?.files) ? applied.files : []
  const themeId = applied?.themeId
  if (!themeId || files.length === 0) {
    return sendMessage(chatId, `❌ I couldn't find what to roll back for this run. Nothing was changed.`)
  }
  // Atomically CLAIM (see applyShopifyDirectWrite): flip shopify_rollback_pending →
  // 'running' so two concurrent YES messages can't both roll back; loser bails.
  const { data: claimed } = await supabase.from('agent_runs')
    .update({ status: 'running' }).eq('id', run.id).eq('status', 'shopify_rollback_pending').select('id')
  if (!claimed || claimed.length === 0) return  // another invocation already owns this rollback

  const tok = await refreshShopifyToken(supabase, conn)
  if (!tok.ok) {
    // Un-claim so the merchant can retry after reconnecting / transient recovery.
    await supabase.from('agent_runs').update({ status: 'shopify_rollback_pending' }).eq('id', run.id)
    return sendMessage(chatId, tok.reason === 'needs_reconsent'
      ? `🔌 Your Shopify connection has expired — please reconnect your store to roll back.`
      : `⚠️ I couldn't reach Shopify to refresh access just now, so I rolled back nothing. Please try again shortly.`)
  }
  const token = tok.accessToken
  const shop = conn.shopify_shop_domain

  const { ops, unrollbackable } = planRollbackOps(files)
  let upserts = ops.filter(o => o.action === 'upsert')
  const deletes = ops.filter(o => o.action === 'delete').map(o => o.filename)
  const problems = []
  const clobberGuard = []

  // H4: before restoring a MODIFIED file, re-check the live theme still matches what
  // WE deployed (checksumMd5 recorded at apply time). If the merchant hand-edited it
  // since our change, do NOT overwrite their edit — drop it from the restore set and
  // report it. classifyConcurrency skips files with a null recorded checksum (legacy
  // runs deployed before this fix), so those degrade to the prior unguarded restore.
  const guardable = files.filter(f => f.op === 'modified' && f.checksumMd5 != null).map(f => f.filename)
  if (upserts.length > 0 && guardable.length > 0) {
    const cks = await queryThemeChecksums(shop, token, themeId, guardable)
    if (!cks.ok) {
      await supabase.from('agent_runs').update({
        status: 'failed', error_message: `Rollback pre-check checksum re-query failed: ${cks.message}`.slice(0, 500),
      }).eq('id', run.id)
      return sendMessage(chatId, `❌ I couldn't verify your theme's current state, so I rolled back nothing. Please review your theme in Shopify.`)
    }
    const concurrency = classifyConcurrency(files, cks.byFilename)
    if (!concurrency.ok) {
      const conflicts = new Set(concurrency.conflicts)
      clobberGuard.push(...concurrency.conflicts)
      upserts = upserts.filter(o => !conflicts.has(o.filename))
    }
  }

  if (upserts.length > 0) {
    const r = await upsertThemeFiles(shop, token, themeId, upserts.map(o => ({ filename: o.filename, content: o.content })))
    if (!r.ok) problems.push(`restore failed: ${r.message}`)
    else {
      const c = confirmApplied(upserts.map(o => o.filename), r.upsertedFilenames, r.userErrors)
      if (!c.ok) problems.push('restore not confirmed')
    }
  }
  if (deletes.length > 0) {
    const r = await deleteThemeFiles(shop, token, themeId, deletes)
    if (!r.ok) problems.push(`delete failed: ${r.message}`)
    // Mirror the upsert branch's confirmApplied: a transport-OK response can still
    // carry userErrors (Shopify refused the delete) or omit the file from
    // deletedThemeFiles — either way the file is still live, so it is NOT rolled back.
    else if (Array.isArray(r.userErrors) && r.userErrors.length > 0) {
      problems.push(`delete refused: ${r.userErrors.map(e => e.message).join(', ')}`)
    } else {
      const notDeleted = deletes.filter(fn => !(r.deletedFilenames || []).includes(fn))
      if (notDeleted.length > 0) problems.push(`delete not confirmed for ${notDeleted.join(', ')}`)
    }
  }

  if (problems.length > 0 || unrollbackable.length > 0 || clobberGuard.length > 0) {
    const detail = [
      ...problems,
      ...(clobberGuard.length ? [`changed since deploy, not overwritten: ${clobberGuard.join(', ')}`] : []),
      ...(unrollbackable.length ? [`no original content for ${unrollbackable.join(', ')}`] : []),
    ].join('; ')
    await supabase.from('agent_runs').update({
      status: 'failed', error_message: `Rollback incomplete: ${detail}`.slice(0, 500),
    }).eq('id', run.id)
    return sendMessage(chatId, `⚠️ I couldn't fully roll back your theme.${clobberGuard.length ? ` You edited <code>${clobberGuard.map(escapeHtml).join(', ')}</code> since our change, so I left ${clobberGuard.length > 1 ? 'them' : 'it'} untouched.` : ''}${unrollbackable.length ? ` I don't have the original of <code>${unrollbackable.map(escapeHtml).join(', ')}</code>.` : ''} Please review your theme in Shopify.`)
  }

  await supabase.from('agent_runs').update({
    status: 'shopify_rolled_back', completed_at: new Date().toISOString(),
  }).eq('id', run.id)
  return sendMessage(chatId, `🔄 Rolled back — your theme is restored to before this change.`)
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
    return await applyShopifyDirectWrite(run, conn, chatId)
  }
  // A 48h bounce/revenue-drop check recommended a rollback (handleRollbackCheck set
  // 'shopify_rollback_pending' + stored applied_write). YES executes the rollback via
  // the same re-upsert(prior)/delete(created) strategy; NO (handleReject) keeps it.
  if (run.status === 'shopify_rollback_pending') {
    return await executeShopifyDirectRollback(run, conn, chatId)
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

  // SG: a pure-Shopify forward proposal has no PR to close — reject is just a status
  // flip + a short confirmation, returning before any GitHub close/reconcile logic.
  if (run.status === 'shopify_awaiting_approval') {
    const { data: claimed } = await supabase.from('agent_runs').update({
      status: 'shopify_rejected', completed_at: new Date().toISOString(),
    }).eq('id', run.id).eq('status', 'shopify_awaiting_approval').select('id')
    if (!claimed || claimed.length === 0) return  // another invocation already handled it
    // Stage 4: NO on the analytics-setup proposal = "don't ask again". Stamp the
    // install-once gate (resolved) so it isn't re-proposed every run; the agent then
    // runs on funnel-only signal. (A future "enable analytics" re-trigger is a TODO —
    // this reuses posthog_snippet_installed_at as a resolved sentinel, no new column.)
    if (run.analysis_result?.setup_kind === 'posthog') {
      await supabase.from('agent_connections')
        .update({ posthog_snippet_installed_at: new Date().toISOString() })
        .eq('subscription_id', run.subscription_id)
      // The decline is permanent (install-once gate stamped), so analysis is
      // unblocked — start the run the setup proposal consumed.
      const started = await startFollowupRun(supabase, run.subscription_id)
      return sendMessage(chatId, started
        ? `👍 No problem — I won't add analytics. Starting your analysis run from your funnel structure now. You can enable analytics later from your dashboard.`
        : `👍 No problem — I won't add analytics. I couldn't start your analysis run automatically — tap <b>Run now</b> in your dashboard. You can enable analytics later from there too.`)
    }
    return sendMessage(chatId, `❌ <b>Skipped.</b> Nothing was changed in your theme — the agent will analyze again on the next run.`)
  }

  // Stage 3: NO on a rollback proposal = KEEP the change live (the inverse of the
  // forward flow). Flip back to shopify_deployed so a later check can re-evaluate.
  if (run.status === 'shopify_rollback_pending') {
    const { data: claimed } = await supabase.from('agent_runs').update({
      status: 'shopify_deployed',
    }).eq('id', run.id).eq('status', 'shopify_rollback_pending').select('id')
    if (!claimed || claimed.length === 0) return  // another invocation already handled it
    return sendMessage(chatId, `👍 Kept the change live — no rollback. I'll keep watching the metrics.`)
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
    .maybeSingle()

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