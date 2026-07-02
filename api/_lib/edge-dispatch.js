// ─── Edge Function dispatch (fire-and-forget) ────────────────────────────────
// Shared 2s-AbortController trigger for the Supabase `agent-run` Edge Function.
// The Edge Function keeps working via EdgeRuntime.waitUntil after the 2s abort,
// so an AbortError means the request WAS sent — only a non-abort error means
// the dispatch never landed. Same pattern as the cron trigger in
// api/agent/run.js; kept here (underscore prefix ⇒ not a Vercel route) so the
// Telegram and GitHub webhooks can share it.

// Returns true when the dispatch landed (including the deliberate 2s abort),
// false when it never reached the Edge Function.
export async function dispatchAgentRun(body) {
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
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return true
  } catch (err) {
    if (err?.name === 'AbortError') return true
    console.error('[edge-dispatch] agent-run trigger failed:', err?.message)
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

// Start the analysis run that a PostHog-setup proposal consumed. The setup
// question intercepted the run the user actually asked for (and, on a manual
// "Run now", the 24h allowance) — so resolving the proposal starts the real
// run immediately. On dispatch failure the manual-run cooldown is refunded
// (last_manual_run_at → NULL) so "Run now" is clickable right away instead of
// stranding the user for 24h.
export async function startFollowupRun(supabase, subscriptionId) {
  const dispatched = await dispatchAgentRun({ intent: 'single_run', subscriptionId })
  if (!dispatched) {
    await supabase.from('agent_subscriptions')
      .update({ last_manual_run_at: null })
      .eq('id', subscriptionId)
  }
  return dispatched
}
