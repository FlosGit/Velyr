// ════════════════════════════════════════════════════════════════════════════
// Shopify-direct write/rollback SAFETY LOGIC — PURE, deterministic, unit-tested.
//
// This module contains the dangerous DECISION logic for the Shopify-direct theme
// write + rollback path, deliberately separated from all I/O so it can be tested
// WITHOUT a live Shopify (see shopify-rollback.test.mjs). The actual themeFilesUpsert
// / themeFilesDelete / checksum re-query I/O lives in shopify-theme-io.js and is
// verified against a Shopify dev store before any merchant write.
//
// NOTHING here performs I/O, reads the clock, or has side effects. Every function is
// a pure transform of its inputs → output. The `_` prefix on the directory keeps this
// out of Vercel's route set (it does not count toward the 12-function cap).
//
// ── Data shapes ──────────────────────────────────────────────────────────────
// A TouchedFile, as staged in agent_runs.analysis_result.pending_write.files[] at
// analysis time, and (after a successful apply) recorded in .applied_write.files[]:
//   {
//     filename:     string,
//     op:           'created' | 'modified',
//     newContent:   string,                 // (pending only) bytes we will write
//     priorContent: string | null,          // bytes BEFORE our write — null iff op==='created'
//     checksumMd5:  string | null,          // Shopify's MD5 at analysis time — null iff op==='created'
//   }
//   op='modified' → the file existed; priorContent + checksumMd5 are captured so we can
//                   (a) detect a merchant edit since analysis, and (b) restore on rollback.
//   op='created'  → the file did NOT exist (e.g. a Stage-4 snippet file); rollback DELETES it.
// ════════════════════════════════════════════════════════════════════════════

// ── 1. OPTIMISTIC CONCURRENCY ────────────────────────────────────────────────
// Did the merchant edit any analyzed file between analysis and the write? Compares
// each MODIFIED file's analysis-time checksumMd5 to the CURRENT checksum re-queried
// (by the caller) immediately before the write.
//
//   currentChecksumByFilename: { [filename]: string | null }   // null ⇒ file absent now
//
// A file is a CONFLICT when its current checksum differs from the stored one, OR the
// file has vanished (current == null) — in both cases the live theme no longer matches
// what we analyzed, so overwriting would clobber a merchant edit. A null STORED checksum
// (created file, or a legacy pending_write) is unverifiable and is NOT treated as a
// conflict here (created files get an existence guard at write time via
// classifyCreatedCollisions).
export function classifyConcurrency(files, currentChecksumByFilename) {
  const conflicts = []
  for (const f of files) {
    if (f.op !== 'modified') continue          // only modified files carry a prior checksum
    if (f.checksumMd5 == null) continue         // unverifiable (legacy) → do not block
    const current = currentChecksumByFilename ? currentChecksumByFilename[f.filename] : undefined
    if (current == null || current !== f.checksumMd5) conflicts.push(f.filename)
  }
  return conflicts.length === 0 ? { ok: true } : { ok: false, conflicts }
}

// ── 1b. CREATED-FILE EXISTENCE GUARD ─────────────────────────────────────────
// A staged op:'created' file asserts the file did NOT exist at analysis time, so
// classifyConcurrency deliberately skips it (no prior checksum). Before writing it
// we MUST re-confirm it is still absent: if it now exists live, an upsert would
// silently OVERWRITE merchant content and a later rollback (planRollbackOps:
// created → delete) would DELETE bytes we never owned. Returns the colliding
// created filenames (those present live now).
//   currentChecksumByFilename: { [filename]: string | null }   // null ⇒ absent (safe)
export function classifyCreatedCollisions(files, currentChecksumByFilename) {
  const collisions = []
  for (const f of files) {
    if (f.op !== 'created') continue
    const current = currentChecksumByFilename ? currentChecksumByFilename[f.filename] : undefined
    if (current != null) collisions.push(f.filename)
  }
  return collisions.length === 0 ? { ok: true } : { ok: false, collisions }
}

// ── 2. PARTIAL-BATCH RESOLUTION ──────────────────────────────────────────────
// themeFilesUpsert can partially apply: some files land (upsertedThemeFiles), others
// error (userErrors). Rollback must revert ONLY the files that actually landed — never
// the ones that never changed. Returns the subset of `files` whose filename is in the
// upserted set, preserving order.
export function resolveAppliedFiles(files, upsertedFilenames) {
  const applied = new Set(upsertedFilenames || [])
  return files.filter(f => applied.has(f.filename))
}

// ── 3. ROLLBACK OP PER FILE ──────────────────────────────────────────────────
// THE dangerous decision. A MODIFIED file rolls back by re-upserting its priorContent.
// A CREATED file rolls back by DELETING it — re-upserting empty content would leave an
// orphan empty file in the theme (the bug a naive "re-upsert prior_content" hits).
// A modified file with no priorContent cannot be restored (an invalid state that should
// never occur) — it is reported in `unrollbackable` so the caller surfaces it instead of
// silently corrupting the theme.
//
// Returns { ops, unrollbackable }:
//   ops:            [{ filename, action: 'upsert', content } | { filename, action: 'delete' }]
//   unrollbackable: [filename]   // modified files we cannot restore (priorContent missing)
export function planRollbackOps(appliedFiles) {
  const ops = []
  const unrollbackable = []
  for (const f of appliedFiles) {
    if (f.op === 'created') {
      ops.push({ filename: f.filename, action: 'delete' })
    } else if (f.priorContent != null) {
      ops.push({ filename: f.filename, action: 'upsert', content: f.priorContent })
    } else {
      unrollbackable.push(f.filename)
    }
  }
  return { ops, unrollbackable }
}

// ── 4. APPLY-CONFIRMATION (option a: trust the mutation response) ─────────────
// A write is confirmed applied when every requested file appears in upsertedThemeFiles
// AND there are no userErrors — Shopify's documented success contract. We deliberately
// do NOT re-query+md5-compare, because Shopify normalizes stored bodies (line endings /
// trailing newline) so md5(newContent) would not reliably equal the stored checksumMd5
// even on a fully successful write.
export function confirmApplied(requestedFilenames, upsertedFilenames, userErrors) {
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    return { ok: false, reason: 'user_errors', userErrors }
  }
  const applied = new Set(upsertedFilenames || [])
  const missing = (requestedFilenames || []).filter(fn => !applied.has(fn))
  if (missing.length > 0) return { ok: false, reason: 'missing', missing }
  return { ok: true }
}

// ── Helper: normalize a stored pending_write into the files[] shape ───────────
// Back-compat for the legacy single-file pending_write ({ filename, themeId, newContent })
// staged before Stage 3. A legacy record becomes a single 'modified' file with no prior
// content/checksum (so its concurrency check is skipped and it is flagged unrollbackable
// if ever rolled back — honest, since we never captured its prior bytes).
export function normalizePendingWrite(pending) {
  if (!pending || typeof pending !== 'object') return { themeId: null, files: [] }
  if (Array.isArray(pending.files)) {
    return { themeId: pending.themeId ?? null, files: pending.files }
  }
  if (pending.filename && typeof pending.newContent === 'string') {
    return {
      themeId: pending.themeId ?? null,
      files: [{
        filename: pending.filename,
        op: 'modified',
        newContent: pending.newContent,
        priorContent: pending.priorContent ?? null,
        checksumMd5: pending.checksumMd5 ?? null,
      }],
    }
  }
  return { themeId: pending.themeId ?? null, files: [] }
}
