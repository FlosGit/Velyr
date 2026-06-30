// Standalone unit test for the PURE Shopify-direct rollback/concurrency logic.
// No framework (the repo has none) and no live Shopify — run with:
//   node api/_lib/shopify-rollback.test.mjs
// Exits 0 if all assertions pass, 1 (with the failing case) otherwise.

import {
  classifyConcurrency,
  resolveAppliedFiles,
  planRollbackOps,
  confirmApplied,
  normalizePendingWrite,
} from './shopify-rollback.js'

let passed = 0
const failures = []
function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`)
}

// ── classifyConcurrency ──────────────────────────────────────────────────────
const mod = (filename, checksumMd5) => ({ filename, op: 'modified', checksumMd5, priorContent: 'x', newContent: 'y' })

eq('concurrency: matching checksum → ok',
  classifyConcurrency([mod('sections/hero.liquid', 'abc')], { 'sections/hero.liquid': 'abc' }),
  { ok: true })

eq('concurrency: changed checksum → conflict (merchant edited)',
  classifyConcurrency([mod('sections/hero.liquid', 'abc')], { 'sections/hero.liquid': 'DEF' }),
  { ok: false, conflicts: ['sections/hero.liquid'] })

eq('concurrency: file vanished (current null) → conflict',
  classifyConcurrency([mod('sections/hero.liquid', 'abc')], { 'sections/hero.liquid': null }),
  { ok: false, conflicts: ['sections/hero.liquid'] })

eq('concurrency: file missing from map → conflict',
  classifyConcurrency([mod('sections/hero.liquid', 'abc')], {}),
  { ok: false, conflicts: ['sections/hero.liquid'] })

eq('concurrency: null stored checksum (legacy) → not blocked',
  classifyConcurrency([mod('sections/hero.liquid', null)], { 'sections/hero.liquid': 'whatever' }),
  { ok: true })

eq('concurrency: created file is skipped (no prior checksum)',
  classifyConcurrency([{ filename: 'snippets/velyr.liquid', op: 'created', checksumMd5: null, priorContent: null }], {}),
  { ok: true })

eq('concurrency: mixed — one clean, one edited → only the edited conflicts',
  classifyConcurrency(
    [mod('sections/a.liquid', 'a1'), mod('sections/b.liquid', 'b1')],
    { 'sections/a.liquid': 'a1', 'sections/b.liquid': 'b2' }),
  { ok: false, conflicts: ['sections/b.liquid'] })

// ── resolveAppliedFiles (partial-batch) ──────────────────────────────────────
eq('partial-batch: only upserted files are returned',
  resolveAppliedFiles(
    [mod('sections/a.liquid', 'a1'), mod('sections/b.liquid', 'b1')],
    ['sections/a.liquid']).map(f => f.filename),
  ['sections/a.liquid'])

eq('partial-batch: none landed → empty',
  resolveAppliedFiles([mod('sections/a.liquid', 'a1')], []).map(f => f.filename),
  [])

// ── planRollbackOps ──────────────────────────────────────────────────────────
eq('rollback: modified → re-upsert priorContent',
  planRollbackOps([{ filename: 'sections/hero.liquid', op: 'modified', priorContent: 'OLD' }]),
  { ops: [{ filename: 'sections/hero.liquid', action: 'upsert', content: 'OLD' }], unrollbackable: [] })

eq('rollback: created → DELETE (never re-upsert empty)',
  planRollbackOps([{ filename: 'snippets/velyr.liquid', op: 'created', priorContent: null }]),
  { ops: [{ filename: 'snippets/velyr.liquid', action: 'delete' }], unrollbackable: [] })

eq('rollback: modified with no priorContent → unrollbackable, not a blind upsert',
  planRollbackOps([{ filename: 'sections/hero.liquid', op: 'modified', priorContent: null }]),
  { ops: [], unrollbackable: ['sections/hero.liquid'] })

eq('rollback: mixed batch picks the right op per file',
  planRollbackOps([
    { filename: 'sections/hero.liquid', op: 'modified', priorContent: 'OLD' },
    { filename: 'snippets/velyr.liquid', op: 'created', priorContent: null },
  ]),
  { ops: [
    { filename: 'sections/hero.liquid', action: 'upsert', content: 'OLD' },
    { filename: 'snippets/velyr.liquid', action: 'delete' },
  ], unrollbackable: [] })

// ── confirmApplied (option a) ────────────────────────────────────────────────
eq('confirm: all requested upserted, no userErrors → ok',
  confirmApplied(['sections/a.liquid'], ['sections/a.liquid'], []),
  { ok: true })

eq('confirm: userErrors present → not ok',
  confirmApplied(['sections/a.liquid'], ['sections/a.liquid'], [{ message: 'bad' }]),
  { ok: false, reason: 'user_errors', userErrors: [{ message: 'bad' }] })

eq('confirm: a requested file missing from upserted → not ok',
  confirmApplied(['sections/a.liquid', 'sections/b.liquid'], ['sections/a.liquid'], []),
  { ok: false, reason: 'missing', missing: ['sections/b.liquid'] })

// ── normalizePendingWrite (back-compat) ──────────────────────────────────────
eq('normalize: new files[] shape passes through',
  normalizePendingWrite({ themeId: 7, files: [{ filename: 'x', op: 'modified', priorContent: 'p', checksumMd5: 'c', newContent: 'n' }] }),
  { themeId: 7, files: [{ filename: 'x', op: 'modified', priorContent: 'p', checksumMd5: 'c', newContent: 'n' }] })

eq('normalize: legacy single-file shape → one modified file, null prior/checksum',
  normalizePendingWrite({ filename: 'sections/hero.liquid', themeId: 9, newContent: 'NEW' }),
  { themeId: 9, files: [{ filename: 'sections/hero.liquid', op: 'modified', newContent: 'NEW', priorContent: null, checksumMd5: null }] })

eq('normalize: garbage → empty files',
  normalizePendingWrite(null),
  { themeId: null, files: [] })

// ── report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n❌ ${failures.length} assertion(s) FAILED (${passed} passed):\n`)
  for (const f of failures) console.error('  • ' + f + '\n')
  process.exit(1)
}
console.log(`✅ shopify-rollback: all ${passed} assertions passed`)
