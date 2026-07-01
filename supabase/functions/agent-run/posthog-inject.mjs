// ════════════════════════════════════════════════════════════════════════════
// PURE self-heal decision for the Shopify-direct PostHog theme injection.
//
// Plain ESM with NO runtime-specific APIs (no Deno.*, no node:*) so it is a SINGLE
// source of truth importable by BOTH the Deno edge function (agent-run/index.ts, via
// `./posthog-inject.mjs`) AND the Node unit test (api/_lib/posthog-inject.test.mjs) —
// not a format-locked twin. All I/O (reading theme.liquid, the themeFilesUpsert) stays
// in the callers; this module only DECIDES and computes the corrected content.
//
// Fixes the too-loose original detection (marker-presence alone counted as "installed"),
// which left a merchant-broken loader in place. Now: a marker block whose body doesn't
// match the expected loader is treated as NOT-correctly-installed and REPLACED in place.
// ════════════════════════════════════════════════════════════════════════════

// Collapse whitespace runs to a single space + trim. The comparison must tolerate a
// benign line-ending / indentation normalization by Shopify but still catch a real edit
// to the loader body (the token, $host, or the IIFE changing).
function normWs(s) {
  return String(s ?? '').replace(/[ \t\r\n]+/g, ' ').trim()
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Wrap an inner snippet (<script>…</script>) in the marker comments. The block is the
// unit we detect / compare / replace, so callers build the EXPECTED block with this.
export function buildMarkerBlock(open, close, innerSnippet) {
  return `${open}\n${innerSnippet}\n${close}`
}

// Decide what to do with the current layout/theme.liquid given the EXPECTED marker block.
//   markers:    { open, close }
//   looseToken: (optional) our loader token — if a bare loader (no markers) already
//               carries it, treat as installed rather than double-injecting.
//
// Returns exactly one of:
//   { action: 'skip' }                 — (ii) the correct block is already present
//   { action: 'inject',   newContent } — (i)  no block → insert before </head> (fallback </body>)
//   { action: 'reinject', newContent } — (iii) a broken/edited/stale block → REPLACE it in place
//   { action: 'no_anchor' }            — no block AND no </head>/</body> to inject at
export function decidePostHogInjection(currentContent, expectedBlock, markers, looseToken) {
  const content = String(currentContent ?? '')
  const { open, close } = markers
  const blockRe = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`)
  const existing = content.match(blockRe)

  if (existing) {
    // (ii) vs (iii): does the existing block match the expected one (ws-normalized)?
    if (normWs(existing[0]) === normWs(expectedBlock)) return { action: 'skip' }
    // (iii) altered / broken / stale (e.g. old token or $host) → replace in place; the
    // non-greedy regex + single replace guarantees we never leave two marker blocks.
    return { action: 'reinject', newContent: content.replace(blockRe, expectedBlock) }
  }

  // No marker block. A bare loader (our token) pasted without markers counts as installed
  // — injecting again would double-initialize PostHog.
  if (looseToken && content.includes(looseToken)) return { action: 'skip' }

  // (i) fresh injection before </head> (fallback </body>).
  const m = content.match(/<\/head>/i) || content.match(/<\/body>/i)
  if (!m || m.index == null) return { action: 'no_anchor' }
  return { action: 'inject', newContent: content.slice(0, m.index) + expectedBlock + '\n' + content.slice(m.index) }
}
