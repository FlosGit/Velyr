// ─── STAGE RA7 — RECEIPT-FIRST PR BODY ───────────────────────────────────────
//
// Builds the PR body markdown from everything the pipeline actually did. The
// guiding rule (matching the Pass-2 system prompt) is HONESTY: the receipt
// states what was inspected, what wasn't, what was forced-included by the
// safety override, what couldn't be resolved, and what was NOT verified in this
// environment (lint / TS strict). It REPLACES the old risk/impact-prediction
// PR template entirely.
//
// Pure: takes the threaded stage outputs, returns a string. No side effects, no
// network. FixResult is imported type-only (erased at runtime → no import cycle
// with index.ts).

import type { MapResult, LintInfo } from './repo-mapper.ts'
import type { ImportGraph } from './import-graph.ts'
import type { RankerResult } from './component-ranker.ts'
import type { DeepContext } from './deep-reader.ts'
import type { FixResult } from './index.ts'

export interface ReceiptInput {
  mapResult: MapResult
  graph: ImportGraph
  rankerResult: RankerResult
  deepContext: DeepContext
  fixResult: FixResult
  lintInfo: LintInfo
  runId: string        // for the footer (added to the spec signature — see RA7 flag)
  behavioralNote?: string  // scroll-depth / click signals inspected this run (or honest reason none were)
  screenshotNote?: string  // which live screenshots Pass 2 actually saw (or honest reason none did)
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function extOf(p: string): string {
  const m = (p || '').match(/\.[^./]+$/)
  return m ? m[0].toLowerCase().slice(1) : ''
}

// list() renders bullet items, or an honest "_none_" when empty.
function list(items: string[]): string {
  return items.length ? items.map(i => `- ${i}`).join('\n') : '_none_'
}

// The deterministic auto-rollback trigger, in percentage points of site-wide
// bounce-rate increase within 48h. Receipt-side copy so the PR body states the
// real trigger value. Keep in sync with the other ROLLBACK_BOUNCE_PP_THRESHOLD
// declaration (api/agent/run.js — handleRollbackCheck, which owns the actual
// decision). Format-contract dedup, same reason as encryptSecret: Node and Deno
// can't share a module cleanly.
const ROLLBACK_BOUNCE_PP_THRESHOLD = 15

export function buildReceipt(input: ReceiptInput): string {
  const { mapResult, graph, rankerResult, deepContext, fixResult, lintInfo, runId, behavioralNote, screenshotNote } = input
  const em = fixResult.expected_metric

  // ── Files read deeply ──
  const readDeeply = deepContext.components.map(c => {
    const bytes = byteLength(c.content)
    const extras = [c.cssContent ? '+CSS' : '', c.truncated ? 'truncated' : ''].filter(Boolean).join(', ')
    return `\`${c.path}\` (${bytes} bytes${extras ? `, ${extras}` : ''})`
  })
  const supporting = [
    deepContext.tailwindTheme ? 'tailwind theme' : '',
    deepContext.globalStyles  ? 'global styles' : '',
    deepContext.indexHtml     ? 'index.html' : '',
    deepContext.llmsTxt       ? 'llms.txt' : '',
    deepContext.packageJsonDeps && deepContext.packageJsonDeps !== '{}' ? 'package.json deps' : '',
  ].filter(Boolean)

  // ── Considered but not read deeply (skipped + unsure) ──
  const notDeep = [
    ...rankerResult.skipped.map(s => `\`${s.path}\` — ${s.reason}`),
    ...rankerResult.unsure.map(u => `\`${u.path}\` — ${u.reason} _(unsure)_`),
  ]

  // ── Forced-included by the safety override ──
  const forced = rankerResult.ranked
    .filter(r => r.source === 'forced')
    .map(r => `\`${r.path}\` — matched "${r.matched_pattern ?? '?'}"`)

  // ── In the graph but not analyzed (depth/count limit + budget + unreadable) ──
  const notAnalyzed: string[] = []
  if (graph.truncatedAt === 'depth') notAnalyzed.push(`graph traversal hit the depth limit — deeper imports were not visited`)
  if (graph.truncatedAt === 'count') notAnalyzed.push(`graph traversal hit the file-count limit — some imports were not visited`)
  for (const s of deepContext.skippedDueToBudget) notAnalyzed.push(`\`${s.path}\` — skipped (deep-read byte budget exceeded)`)
  for (const s of deepContext.skippedUnreadable) notAnalyzed.push(`\`${s.path}\` — could not read (${s.reason})`)

  // ── Unresolved imports ──
  const unresolved = graph.unresolved.map(u => `\`${u.source}\` (imported by \`${u.importer}\`) — ${u.reason}`)

  // ── Blind spots ──
  const blindSpots = (fixResult.blind_spots || []).map(b => b)

  // ── Rollback: AI hypothesis line ──
  // The AI's stated 48h success signal is a LABELLED hypothesis only — it never
  // gates the rollback (the deterministic +Npp bounce check does). Omitted
  // entirely when absent so we never render "…hypothesis: undefined".
  const aiHypothesisLine = fixResult.rollback_signal
    ? `\n- AI's stated success hypothesis (not used for rollback): ${fixResult.rollback_signal}`
    : ''

  // ── Environment checks ──
  // Item 4: a fix may carry additional_edits — the syntax verdict must cover
  // every modified file, not just the primary.
  const editedPaths = [fixResult.file_to_edit || '', ...(fixResult.additional_edits || []).map(e => e.file_to_edit)].filter(Boolean)
  const PARSEABLE = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx']
  const unparseable = editedPaths.filter(p => !PARSEABLE.includes(extOf(p)))
  const syntaxLine = unparseable.length === 0
    ? `Syntax (Babel parse of ${editedPaths.length > 1 ? `all ${editedPaths.length} modified files` : 'modified file'}): ✓ passed`
    : `Syntax: not verified for ${unparseable.join(', ')} — Velyr can't Babel-parse ${[...new Set(unparseable.map(p => `.${extOf(p) || '?'}`))].join('/')}; verify your CI`
  const lintLine = lintInfo.eslint
    ? 'Lint config detected: yes — not run in this environment, verify your CI'
    : 'Lint config detected: no'
  const tsLine = lintInfo.tsStrict
    ? 'TS strict mode detected: type errors not checked in this environment, verify your CI'
    : 'TS strict mode detected: no'

  const repoStructure = mapResult.isMonorepo
    ? `${mapResult.framework} (monorepo, workspace: ${mapResult.selectedWorkspacePath})`
    : `${mapResult.framework} (single project)`

  return `# Velyr — Conversion Fix Proposal

**Hypothesis:** ${fixResult.hypothesis || '_not stated_'}

**Problem:** ${fixResult.problem || '_not stated_'}

## Why this fix

${fixResult.ranked_higher_than || '_no alternatives recorded_'}

## Expected outcome

${em ? `${em.direction} ${em.metric} by approximately ${em.magnitude_pp}pp.` : '_no quantified estimate_'}

${em?.caveat ? `Caveat: ${em.caveat}` : 'Caveat: site-wide measurement, not page-level attribution.'}

## Confidence

${fixResult.confidence || 'unknown'} — ${fixResult.confidence_reason || '_no reason given_'}

## What I did and didn't inspect

**Repo structure detected:** ${repoStructure}

**Files I read deeply (${deepContext.components.length} + supporting):**
${list(readDeeply)}
${supporting.length ? `- + ${supporting.join(' / ')} (as available)` : '- (no supporting files available)'}

**Components considered but NOT inspected deeply (${rankerResult.skipped.length + rankerResult.unsure.length} files):**
${list(notDeep)}

**Components forced-included by safety override:**
${list(forced)}

**Files in the graph but not analyzed (depth limit / count limit / budget):**
${list(notAnalyzed)}

**Imports I couldn't resolve:**
${list(unresolved)}

**Behavioral signals inspected (scroll depth / clicks):** ${behavioralNote || 'not recorded'}

**Live screenshots inspected:** ${screenshotNote || 'not recorded'}

## Known blind spots

${list(blindSpots)}

## Rollback

- Revert this PR (GitHub UI: "Revert" button on the merged PR page).
- If metrics regress, the agent's 48h rollback check will open a revert PR automatically and ping you for approval.
- Auto-rollback trigger: bounce +${ROLLBACK_BOUNCE_PP_THRESHOLD}pp within 48h — measured on the affected route(s) when the change maps confidently to them, otherwise site-wide (correlation, not attribution)${aiHypothesisLine}

## Environment checks

- ${syntaxLine}
- ${lintLine}
- ${tsLine}

---

Agent run ID: ${runId} · ${new Date().toISOString()}
`
}
