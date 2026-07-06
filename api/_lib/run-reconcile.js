import { getOctokit } from './github-app.js'

// ─── Run state reconciliation (single source of truth) ───────────────────────
// These helpers own every DB side effect of approving (→ deployed) or rejecting
// (→ rejected) an agent run. Both the Telegram bot (api/webhooks/telegram.js,
// where the user replies YES/NO) and the GitHub pull_request webhook
// (api/webhooks/github.js, where the user merges/closes the PR directly on
// github.com) call them, so a manual GitHub action lands the run in exactly the
// same state as the equivalent Telegram command — no drift between two copies.
//
// They are pure DB/GitHub effects and never send Telegram messages: each caller
// owns its own user-facing messaging, switching on the returned `kind`.

// Flip a run to 'deployed' and replicate the YES-handler's post-merge effects.
// `mergeSha` is the squash/merge commit SHA (used by the 48h rollback check to
// find the exact change); pass null if unknown. Returns { kind } so the caller
// can pick the right confirmation message.
export async function reconcileDeployed(supabase, run, mergeSha, { approvalLabel = 'YES', expectedStatus = 'waiting_approval' } = {}) {
  // A run carrying rollback_reason='metrics_dropped' is in its AUTO-ROLLBACK phase:
  // handleRollbackCheck opened a revert PR and flipped it back to waiting_approval.
  // Merging that PR UNDOES the earlier fix, so the run is 'rolled_back' (NOT 'deployed'
  // — that dishonestly credited the reverted fix and let promotePendingDNA mark a failed
  // change 'survived'), and the fix's pending DNA row resolves to 'rollback'. A rollback
  // run is always a conversion_fix (setup_posthog runs are excluded from the rollback
  // check), so this branch precedes the run_type handling below.
  if (run.rollback_reason === 'metrics_dropped') {
    const { data: claimed } = await supabase.from('agent_runs').update({
      status:           'rolled_back',
      completed_at:     new Date().toISOString(),
      merge_commit_sha: mergeSha ?? null,
    }).eq('id', run.id).eq('status', expectedStatus).select('id')
    if (!claimed || claimed.length === 0) return { kind: 'noop', claimed: false }
    // Resolve the fix's pending DNA (recorded at the original approval) to 'rollback'.
    await supabase.from('agent_business_dna')
      .update({ outcome: 'rollback' })
      .eq('run_id', run.id).eq('outcome', 'pending')
    return { kind: 'rollback_executed', claimed: true }
  }

  // Compare-and-swap the terminal transition: two concurrent approvals (two distinct
  // Telegram messages — "yes" + "y" — or a Telegram YES racing the GitHub-merge
  // webhook) must not both run the non-idempotent side effects below (a duplicate
  // agent_business_dna row, a double setup-install stamp). Only the invocation that
  // actually flips the row FROM expectedStatus proceeds; the loser returns
  // { kind: 'noop' } and its caller stays silent.
  const { data: claimed } = await supabase.from('agent_runs').update({
    status:           'deployed',
    completed_at:     new Date().toISOString(),
    merge_commit_sha: mergeSha ?? null,
  }).eq('id', run.id).eq('status', expectedStatus).select('id')
  if (!claimed || claimed.length === 0) return { kind: 'noop', claimed: false }

  // Setup-PR: record install time, skip DNA (no conversion logic to learn from).
  if (run.run_type === 'setup_posthog') {
    await supabase.from('agent_connections')
      .update({ posthog_snippet_installed_at: new Date().toISOString() })
      .eq('subscription_id', run.subscription_id)
    return { kind: 'setup_installed', claimed: true }
  }

  // Business DNA — record as 'pending'; the 48h rollback check promotes it to
  // 'success' after 7 days still-deployed.
  await supabase.from('agent_business_dna').insert({
    subscription_id: run.subscription_id, run_id: run.id,
    fix_type: run.analysis_result?.change_type || 'other',
    outcome: 'pending',
    notes: `Approved (${approvalLabel}): ${(run.analysis_result?.problem || '').slice(0, 400)}`,
  })
  return { kind: 'fix_deployed', claimed: true }
}

// Flip a run to 'rejected' and replicate the NO-handler's effects. Does NOT
// touch GitHub — call closeRejectedPr() for that. Returns { kind } so the
// caller can pick the right message (and so setup-PR retry vs. permanent
// decline is observable).
export async function reconcileRejected(supabase, run, { rejectLabel = 'NO', expectedStatus = 'waiting_approval' } = {}) {
  // NO on an auto-rollback proposal (rollback_reason='metrics_dropped') = KEEP the
  // change live, the inverse of the forward flow. Flip the run back to 'deployed'
  // (mirror of the Shopify shopify_rollback_pending → NO → shopify_deployed path) and
  // stamp 'rollback_declined' so the next rollback_check doesn't re-detect it as a
  // rollback run. No DNA insert: the fix's pending DNA stays pending, so a later check
  // can still promote it if the metrics recover. Precedes the run_type branches (a
  // rollback run is always a conversion_fix).
  if (run.rollback_reason === 'metrics_dropped') {
    const { data: claimed } = await supabase.from('agent_runs')
      .update({ status: 'deployed', rollback_reason: 'rollback_declined' })
      .eq('id', run.id).eq('status', expectedStatus).select('id')
    if (!claimed || claimed.length === 0) return { kind: 'noop', claimed: false }
    return { kind: 'rollback_declined', claimed: true }
  }

  // Foreign-choice rows never opened a PR — permanent decline, no completed_at
  // (matches the original handler; this branch predates the completed_at stamp).
  if (run.run_type === 'setup_posthog_foreign_choice') {
    // CAS the terminal flip FIRST (see reconcileDeployed) so the connection decline
    // runs exactly once under a double NO; the loser returns noop.
    const { data: claimed } = await supabase.from('agent_runs')
      .update({ status: 'rejected', rollback_reason: 'user_rejected' })
      .eq('id', run.id).eq('status', expectedStatus).select('id')
    if (!claimed || claimed.length === 0) return { kind: 'noop', claimed: false }
    await supabase.from('agent_connections')
      .update({ posthog_snippet_declined: true })
      .eq('subscription_id', run.subscription_id)
    return { kind: 'foreign_declined', claimed: true }
  }

  // Stamp completed_at on rejection so the ID-less `note <reason>` flow can order
  // rejected runs by when they were skipped (not just created_at). CAS the flip so a
  // double NO can't insert two DNA rows or lose the retry-count read-modify-write.
  const { data: claimed } = await supabase.from('agent_runs').update({
    status: 'rejected',
    rollback_reason: 'user_rejected',
    completed_at: new Date().toISOString(),
  }).eq('id', run.id).eq('status', expectedStatus).select('id')
  if (!claimed || claimed.length === 0) return { kind: 'noop', claimed: false }

  // Setup-PR: offer once more, then permanently decline.
  if (run.run_type === 'setup_posthog') {
    const { data: connForRetry } = await supabase
      .from('agent_connections')
      .select('posthog_snippet_retry_count')
      .eq('subscription_id', run.subscription_id)
      .single()
    const retryCount = connForRetry?.posthog_snippet_retry_count || 0
    if (retryCount < 1) {
      await supabase.from('agent_connections')
        .update({ posthog_snippet_retry_count: retryCount + 1 })
        .eq('subscription_id', run.subscription_id)
      return { kind: 'setup_retry', claimed: true }
    }
    await supabase.from('agent_connections')
      .update({ posthog_snippet_declined: true })
      .eq('subscription_id', run.subscription_id)
    return { kind: 'setup_declined', claimed: true }
  }

  // Business DNA — record rollback so future runs avoid the pattern.
  await supabase.from('agent_business_dna').insert({
    subscription_id: run.subscription_id, run_id: run.id,
    fix_type: run.analysis_result?.change_type || 'other',
    outcome: 'rollback',
    notes: `User rejected (${rejectLabel}): ${(run.analysis_result?.problem || '').slice(0, 400)}`,
  })
  return { kind: 'fix_rejected', claimed: true }
}

// Best-effort GitHub cleanup for a rejected run: close the PR (skip with
// close:false when it's already closed, e.g. the user closed it on github.com)
// and delete the agent/* branch. GitHub failures only warn — the run's DB
// status is the source of truth.
export async function closeRejectedPr(conn, run, { close = true } = {}) {
  if (!conn?.github_installation_id || !run.pr_number) return
  try {
    const octokit = await getOctokit(conn.github_installation_id)
    if (close) {
      await octokit.rest.pulls.update({
        owner: conn.github_repo_owner,
        repo:  conn.github_repo_name,
        pull_number: run.pr_number,
        state: 'closed',
      })
    }
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
          console.warn(`[reconcile] branch delete failed for ${branchRef}:`, err?.message)
        }
      })
    }
  } catch (err) {
    console.warn(`[reconcile] PR close/delete failed for run ${run.id} PR #${run.pr_number}:`, err?.message)
  }
}
