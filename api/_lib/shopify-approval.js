// ════════════════════════════════════════════════════════════════════════════
// Shopify-direct approval EXECUTION — the apply / rollback / reject side effects for a
// shopify_* run, shared by the Telegram bot (api/webhooks/telegram.js) and the dashboard
// action (api/agent/run.js handleRunAction, C2). Extracted verbatim from the Telegram
// handler: every DB write, Shopify I/O call, guard, and ordering is preserved — the ONLY
// change is that each terminal branch RETURNS { status, message } instead of calling
// sendMessage, so the caller delivers the message (Telegram HTML for the bot, tag-stripped
// text for the dashboard). The race-loser bail returns { noop: true }.
//
// `message` is Telegram-HTML (contains <b>/<i>/<code>); the dashboard strips tags.
// `supabase` is passed in (this _lib has no client of its own). `_`-prefixed dir ⇒ not a
// Vercel route.
// ════════════════════════════════════════════════════════════════════════════

import { refreshShopifyToken } from './shopify-token-refresh.js'
import { queryThemeChecksums, upsertThemeFiles, deleteThemeFiles, deleteTheme } from './shopify-theme-io.js'
import {
  normalizePendingWrite, classifyConcurrency, confirmApplied, resolveAppliedFiles,
  planRollbackOps, classifyCreatedCollisions,
} from './shopify-rollback.js'
import { startFollowupRun } from './edge-dispatch.js'

// Local escapeHtml twin (same as telegram.js / run.js) for values interpolated into the
// HTML messages below.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// C3: delete the run's throwaway preview theme (if the merchant tapped 🔍 Preview)
// once they decide. Strictly best-effort — a leftover preview only occupies one of
// the store's theme slots; it never affects the outcome. Deliberately NO
// analysis_result mutation here: racing the applied_write writes below could
// clobber the rollback basis.
async function cleanupPreviewTheme(shop, token, run) {
  const previewId = run.analysis_result?.preview_theme_id
  if (!previewId || !shop || !token) return
  try {
    let del = await deleteTheme(shop, token, previewId)
    // themeDuplicate is async — deciding within seconds of tapping Preview can hit
    // "can't delete until it has finished uploading". One short retry covers it.
    if (!del.ok && /finished uploading/i.test(del.message || '')) {
      await new Promise(r => setTimeout(r, 5000))
      del = await deleteTheme(shop, token, previewId)
    }
    if (!del.ok) console.warn(`[shopify-approval] preview theme ${previewId} not deleted: ${del.message}`)
  } catch (e) { console.warn(`[shopify-approval] preview theme cleanup threw: ${e?.message}`) }
}

// ─── FORWARD APPLY (approve on shopify_awaiting_approval) ─────────────────────
export async function applyShopifyDirectWrite(supabase, run, conn) {
  const pending = normalizePendingWrite(run.analysis_result?.pending_write)
  if (!pending.themeId || pending.files.length === 0) {
    return { status: run.status, message: `❌ I couldn't find the prepared change for this run (missing pending write). Nothing was applied — the agent will retry on the next run.` }
  }
  // Atomically CLAIM the run before any write so two concurrent approvals can't both apply.
  const { data: claimed } = await supabase.from('agent_runs')
    .update({ status: 'running' }).eq('id', run.id).eq('status', 'shopify_awaiting_approval').select('id')
  if (!claimed || claimed.length === 0) return { noop: true }

  const tok = await refreshShopifyToken(supabase, conn)
  if (!tok.ok) {
    await supabase.from('agent_runs').update({ status: 'shopify_awaiting_approval' }).eq('id', run.id)
    return { status: 'shopify_awaiting_approval', message: tok.reason === 'needs_reconsent'
      ? `🔌 Your Shopify connection has expired — please reconnect your store, then I can apply changes again.`
      : `⚠️ I couldn't reach Shopify to refresh access just now, so I applied nothing. The agent will retry on the next run.` }
  }
  const token = tok.accessToken
  const shop = conn.shopify_shop_domain

  // C3: the merchant has decided — the preview theme (if any) has served its
  // purpose. Deleting it up-front keeps this a single call site regardless of
  // which terminal branch below wins.
  await cleanupPreviewTheme(shop, token, run)

  // 1. Optimistic concurrency (STRICT: a null analysis-time checksum aborts).
  const modifiedFiles      = pending.files.filter(f => f.op === 'modified')
  const checkableFilenames = modifiedFiles.filter(f => f.checksumMd5 != null).map(f => f.filename)
  if (modifiedFiles.length > 0) {
    let byFilename = {}
    if (checkableFilenames.length > 0) {
      const cks = await queryThemeChecksums(shop, token, pending.themeId, checkableFilenames)
      if (!cks.ok) {
        await supabase.from('agent_runs').update({
          status: 'failed', error_message: `Pre-write checksum re-query failed: ${cks.message}`.slice(0, 500),
        }).eq('id', run.id)
        return { status: 'failed', message: `❌ I couldn't verify your theme's current state, so I applied nothing. The agent will retry on the next run.` }
      }
      byFilename = cks.byFilename
    }
    const concurrency = classifyConcurrency(pending.files, byFilename, { strictNullChecksum: true })
    if (!concurrency.ok) {
      const changed      = concurrency.conflicts || []
      const unverifiable = concurrency.unverifiable || []
      const parts = []
      if (changed.length)      parts.push(`changed since analysis: ${changed.join(', ')}`)
      if (unverifiable.length) parts.push(`unverifiable (no analysis-time checksum): ${unverifiable.join(', ')}`)
      await supabase.from('agent_runs').update({
        status: 'shopify_concurrency_abort', completed_at: new Date().toISOString(),
        error_message: `Theme write aborted — ${parts.join('; ')}`.slice(0, 500),
      }).eq('id', run.id)
      const message = changed.length
        ? `🛑 Your theme changed since we analyzed it (<code>${changed.map(escapeHtml).join(', ')}</code>), so I did <b>not</b> apply this — I won't overwrite your edit. Re-run the agent to analyze the current version.`
        : `🛑 I couldn't verify that your theme is unchanged since analysis (<code>${unverifiable.map(escapeHtml).join(', ')}</code>), so I did <b>not</b> apply this — safer than risking an overwrite. Re-run the agent to analyze the current version.`
      return { status: 'shopify_concurrency_abort', message }
    }
  }

  // 1b. Created-file existence guard.
  const createdFilenames = pending.files.filter(f => f.op === 'created').map(f => f.filename)
  if (createdFilenames.length > 0) {
    const cks = await queryThemeChecksums(shop, token, pending.themeId, createdFilenames)
    if (!cks.ok) {
      await supabase.from('agent_runs').update({
        status: 'failed', error_message: `Pre-write existence re-query failed: ${cks.message}`.slice(0, 500),
      }).eq('id', run.id)
      return { status: 'failed', message: `❌ I couldn't verify your theme's current state, so I applied nothing. The agent will retry on the next run.` }
    }
    const collision = classifyCreatedCollisions(pending.files, cks.byFilename)
    if (!collision.ok) {
      await supabase.from('agent_runs').update({
        status: 'shopify_concurrency_abort', completed_at: new Date().toISOString(),
        error_message: `File I planned to create already exists: ${collision.collisions.join(', ')}`.slice(0, 500),
      }).eq('id', run.id)
      return { status: 'shopify_concurrency_abort', message: `🛑 A file I planned to create (<code>${collision.collisions.map(escapeHtml).join(', ')}</code>) already exists on your theme, so I did <b>not</b> apply this — I won't overwrite it. Re-run the agent to analyze the current version.` }
    }
  }

  // 1c. Persist the rollback basis BEFORE the live write.
  const intendedApplied = pending.files.map(f => ({ filename: f.filename, op: f.op, priorContent: f.priorContent ?? null }))
  await supabase.from('agent_runs').update({
    analysis_result: { ...run.analysis_result, applied_write: { themeId: pending.themeId, files: intendedApplied, upsertJobId: null } },
  }).eq('id', run.id)

  // 2. Apply.
  const up = await upsertThemeFiles(shop, token, pending.themeId, pending.files.map(f => ({ filename: f.filename, content: f.newContent })))
  if (!up.ok) {
    await supabase.from('agent_runs').update({
      status: 'failed', error_message: `Shopify theme write failed: ${up.message}`.slice(0, 500),
    }).eq('id', run.id)
    return { status: 'failed', message: `❌ I couldn't apply the change to your live theme.\n\n<i>${escapeHtml(up.message)}</i>\n\nNothing was changed — the agent will retry on the next run.` }
  }

  // 3. Confirm.
  const confirmed = confirmApplied(pending.files.map(f => f.filename), up.upsertedFilenames, up.userErrors)
  if (!confirmed.ok) {
    const detail = confirmed.reason === 'user_errors'
      ? up.userErrors.map(e => e?.message).filter(Boolean).join('; ')
      : `not applied: ${confirmed.missing.join(', ')}`
    const landed = resolveAppliedFiles(pending.files, up.upsertedFilenames)
      .map(f => ({ filename: f.filename, op: f.op, priorContent: f.priorContent ?? null }))
    await supabase.from('agent_runs').update({
      status: 'failed', error_message: `Shopify theme write not confirmed: ${detail}`.slice(0, 500),
      ...(landed.length ? { analysis_result: { ...run.analysis_result, applied_write: { themeId: pending.themeId, files: landed, upsertJobId: up.jobId ?? null } } } : {}),
    }).eq('id', run.id)
    return { status: 'failed', message: `❌ I couldn't confirm the change applied to your live theme.\n\n<i>${escapeHtml(detail)}</i>\n\nThe agent will retry on the next run.` }
  }

  // 4. Record the APPLIED set as the rollback basis, then deploy.
  const appliedResolved = resolveAppliedFiles(pending.files, up.upsertedFilenames)
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
    analysis_result: { ...run.analysis_result, applied_write: { themeId: pending.themeId, files: appliedFiles, upsertJobId: up.jobId ?? null } },
  }).eq('id', run.id)

  // Business DNA — pending for a conversion fix (mirrors reconcileDeployed).
  if (run.analysis_result?.setup_kind !== 'posthog') {
    await supabase.from('agent_business_dna').insert({
      subscription_id: run.subscription_id, run_id: run.id,
      fix_type: run.analysis_result?.change_type || 'other',
      outcome: 'pending',
      notes: `Applied to live theme (YES): ${(run.analysis_result?.problem || '').slice(0, 400)}`,
    })
  }

  // A PostHog-setup apply stamps the install gate + starts the analysis run it consumed.
  if (run.analysis_result?.setup_kind === 'posthog') {
    await supabase.from('agent_connections')
      .update({ posthog_snippet_installed_at: new Date().toISOString() })
      .eq('subscription_id', run.subscription_id)
    const started = await startFollowupRun(supabase, run.subscription_id)
    return { status: 'shopify_deployed', message: started
      ? `✅ Analytics installed on your live theme — Velyr can now measure your conversions. Starting your first analysis run now — I'll message you when it's ready.`
      : `✅ Analytics installed on your live theme — but I couldn't start your analysis run automatically. Tap <b>Run now</b> in your dashboard to start it.` }
  }
  return { status: 'shopify_deployed', message: `✅ Applied <code>${escapeHtml(appliedFiles.map(f => f.filename).join(', '))}</code> to your live theme.` }
}

// ─── ROLLBACK EXECUTION (approve on shopify_rollback_pending) ─────────────────
export async function executeShopifyDirectRollback(supabase, run, conn) {
  const applied = run.analysis_result?.applied_write
  const files = Array.isArray(applied?.files) ? applied.files : []
  const themeId = applied?.themeId
  if (!themeId || files.length === 0) {
    return { status: run.status, message: `❌ I couldn't find what to roll back for this run. Nothing was changed.` }
  }
  const { data: claimed } = await supabase.from('agent_runs')
    .update({ status: 'running' }).eq('id', run.id).eq('status', 'shopify_rollback_pending').select('id')
  if (!claimed || claimed.length === 0) return { noop: true }

  const tok = await refreshShopifyToken(supabase, conn)
  if (!tok.ok) {
    await supabase.from('agent_runs').update({ status: 'shopify_rollback_pending' }).eq('id', run.id)
    return { status: 'shopify_rollback_pending', message: tok.reason === 'needs_reconsent'
      ? `🔌 Your Shopify connection has expired — please reconnect your store to roll back.`
      : `⚠️ I couldn't reach Shopify to refresh access just now, so I rolled back nothing. Please try again shortly.` }
  }
  const token = tok.accessToken
  const shop = conn.shopify_shop_domain

  const { ops, unrollbackable } = planRollbackOps(files)
  let upserts = ops.filter(o => o.action === 'upsert')
  const deletes = ops.filter(o => o.action === 'delete').map(o => o.filename)
  const problems = []
  const clobberGuard = []

  const guardable = files.filter(f => f.op === 'modified' && f.checksumMd5 != null).map(f => f.filename)
  if (upserts.length > 0 && guardable.length > 0) {
    const cks = await queryThemeChecksums(shop, token, themeId, guardable)
    if (!cks.ok) {
      await supabase.from('agent_runs').update({
        status: 'failed', error_message: `Rollback pre-check checksum re-query failed: ${cks.message}`.slice(0, 500),
      }).eq('id', run.id)
      return { status: 'failed', message: `❌ I couldn't verify your theme's current state, so I rolled back nothing. Please review your theme in Shopify.` }
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
    return { status: 'failed', message: `⚠️ I couldn't fully roll back your theme.${clobberGuard.length ? ` You edited <code>${clobberGuard.map(escapeHtml).join(', ')}</code> since our change, so I left ${clobberGuard.length > 1 ? 'them' : 'it'} untouched.` : ''}${unrollbackable.length ? ` I don't have the original of <code>${unrollbackable.map(escapeHtml).join(', ')}</code>.` : ''} Please review your theme in Shopify.` }
  }

  await supabase.from('agent_runs').update({
    status: 'shopify_rolled_back', completed_at: new Date().toISOString(),
  }).eq('id', run.id)
  await supabase.from('agent_business_dna')
    .update({ outcome: 'rollback' })
    .eq('run_id', run.id).eq('outcome', 'pending')
  return { status: 'shopify_rolled_back', message: `🔄 Rolled back — your theme is restored to before this change.` }
}

// ─── REJECT (skip) a shopify_awaiting_approval / shopify_rollback_pending run ──
export async function rejectShopifyDirect(supabase, run) {
  if (run.status === 'shopify_awaiting_approval') {
    const { data: claimed } = await supabase.from('agent_runs').update({
      status: 'shopify_rejected', completed_at: new Date().toISOString(),
    }).eq('id', run.id).eq('status', 'shopify_awaiting_approval').select('id')
    if (!claimed || claimed.length === 0) return { noop: true }
    // C3: drop the throwaway preview theme, if one was created. Needs a fresh
    // token — fetched only when a preview actually exists (the common NO has none).
    if (run.analysis_result?.preview_theme_id) {
      const { data: conn } = await supabase.from('agent_connections')
        .select('*').eq('subscription_id', run.subscription_id).maybeSingle()
      if (conn?.shopify_shop_domain) {
        const tok = await refreshShopifyToken(supabase, conn)
        if (tok.ok) await cleanupPreviewTheme(conn.shopify_shop_domain, tok.accessToken, run)
      }
    }
    // NO on the analytics-setup proposal = don't ask again + start the analysis run.
    // Item 6 (2026-07-08): stamp the honest `posthog_snippet_declined` flag (the same
    // one the GitHub Setup-PR decline path uses) — NOT posthog_snippet_installed_at,
    // which used to be overloaded here and made "declined" indistinguishable from
    // "analytics active". The propose-gate (maybeProposeShopifyPostHogSetup caller)
    // honors declined, and the dashboard's reenable_snippet action clears it.
    if (run.analysis_result?.setup_kind === 'posthog') {
      await supabase.from('agent_connections')
        .update({ posthog_snippet_declined: true })
        .eq('subscription_id', run.subscription_id)
      const started = await startFollowupRun(supabase, run.subscription_id)
      return { status: 'shopify_rejected', message: started
        ? `👍 No problem — I won't add analytics. Starting your analysis run from your funnel structure now. You can enable analytics later from your dashboard.`
        : `👍 No problem — I won't add analytics. I couldn't start your analysis run automatically — tap <b>Run now</b> in your dashboard. You can enable analytics later from there too.` }
    }
    return { status: 'shopify_rejected', message: `❌ <b>Skipped.</b> Nothing was changed in your theme — the agent will analyze again on the next run.\n\n<i>Optionally tell me why — reply <b>note &lt;reason&gt;</b> and I'll attach it to this run.</i>` }
  }

  // NO on a rollback proposal = KEEP the change live.
  if (run.status === 'shopify_rollback_pending') {
    const { data: claimed } = await supabase.from('agent_runs').update({
      status: 'shopify_deployed',
    }).eq('id', run.id).eq('status', 'shopify_rollback_pending').select('id')
    if (!claimed || claimed.length === 0) return { noop: true }
    return { status: 'shopify_deployed', message: `👍 Kept the change live — no rollback. I'll keep watching the metrics.` }
  }

  return { status: run.status, message: `⚠️ This run is no longer waiting for approval.` }
}
