// Dev-store verification harness for the shopify_direct theme I/O GraphQL shapes.
// GATE: run this against a SHOPIFY DEV STORE (never a real merchant) BEFORE enabling
// any Stage-3/4 write on a real store. Safe — it creates, reads, re-queries, and deletes
// ONE throwaway snippet file (snippets/velyr-dv-verify-<ts>.liquid); it never touches a
// real theme file. It exercises the ACTUAL production helpers in api/_lib/shopify-theme-io.js.
//
// Usage (dev store token needs read_themes + write_themes):
//   SHOPIFY_SHOP=your-dev.myshopify.com SHOPIFY_TOKEN=shpat_xxx SHOPIFY_THEME_ID=123456789 \
//     node scripts/shopify-dv-verify.mjs
//
// Verifies the six unexercised shapes:
//   (1) themeFilesUpsert  → write EFFECT (upserted + reads back). NOTE: `job` is
//       OPTIONAL — Shopify returns a job only for ASYNC ops; a small single-file upsert
//       completes SYNCHRONOUSLY with job=null + upsertedThemeFiles populated. Production
//       confirmApplied (option a) checks upsertedThemeFiles, not job.id, so a null job is
//       a valid success — we report the job id for info but never fail on its absence.
//   (2) checksumMd5 re-query (queryThemeChecksums)
//   (3) readShopifyThemeFile's OnlineStoreThemeFileBodyText body union (read content)
//   (4) themeFilesDelete
//   (5) themeDuplicate  → C3 preview-theme gate (Admin API 2026-07; needs write_themes
//       + the theme-modification exemption). Creates ONE throwaway duplicate of the
//       given theme, then (6) themeDelete removes it. Steps 5+6 must BOTH pass before
//       AGENT_SHOPIFY_PREVIEW_THEMES may be enabled; 1–4 alone still gate live writes.

import { upsertThemeFiles, deleteThemeFiles, queryThemeChecksums, duplicateTheme, deleteTheme } from '../api/_lib/shopify-theme-io.js'

const shop = process.env.SHOPIFY_SHOP
const token = process.env.SHOPIFY_TOKEN
const themeId = process.env.SHOPIFY_THEME_ID
const API = process.env.SHOPIFY_API_VERSION || '2026-04'

if (!shop || !token || !themeId) {
  console.error('Set SHOPIFY_SHOP, SHOPIFY_TOKEN, SHOPIFY_THEME_ID (DEV STORE only).')
  process.exit(2)
}

const filename = `snippets/velyr-dv-verify-${Date.now()}.liquid`
const bodyText = `{% comment %} velyr dev-store verify — safe to delete {% endcomment %}\nhello`

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
}

// (3) The body-union read shape (mirror of the edge fn's readShopifyThemeFile query).
async function readBodyUnion() {
  const query = `query($themeId: ID!, $filenames: [String!]) {
    theme(id: $themeId) { files(first: 1, filenames: $filenames) {
      edges { node { filename checksumMd5 body { ... on OnlineStoreThemeFileBodyText { content } } } }
    } }
  }`
  const res = await fetch(`https://${shop}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { themeId: `gid://shopify/OnlineStoreTheme/${themeId}`, filenames: [filename] } }),
  })
  return res.json().catch(() => ({}))
}

try {
  // (1) upsert — assert the write EFFECT (call ok + file upserted), NOT job presence.
  // job=null is a valid synchronous completion (proven by the readback in step 3).
  const up = await upsertThemeFiles(shop, token, themeId, [{ filename, content: bodyText }], API)
  check('(1) themeFilesUpsert succeeded (job optional)', up.ok, up.ok ? `job=${up.jobId ?? 'null (synchronous)'}` : up.message)
  check('(1b) upsertedThemeFiles contains file', up.ok && up.upsertedFilenames.includes(filename), up.ok ? '' : (up.userErrors || []).map(e => e.message).join('; '))

  // (3) body-union read + (2) checksumMd5 field on the same read
  const read = await readBodyUnion()
  const node = read?.data?.theme?.files?.edges?.[0]?.node
  check('(3) OnlineStoreThemeFileBodyText body union', typeof node?.body?.content === 'string', node?.body?.content != null ? 'got content' : JSON.stringify(read?.errors || read).slice(0, 200))
  check('(2) checksumMd5 field present', typeof node?.checksumMd5 === 'string', node?.checksumMd5 || 'null/absent')

  // (2b) checksumMd5 via the production re-query helper
  const cks = await queryThemeChecksums(shop, token, themeId, [filename], API)
  check('(2b) queryThemeChecksums helper', cks.ok && cks.byFilename[filename] != null, cks.ok ? cks.byFilename[filename] : cks.message)

  // (4) delete (also the cleanup)
  const del = await deleteThemeFiles(shop, token, themeId, [filename], API)
  check('(4) themeFilesDelete', del.ok && del.deletedFilenames.includes(filename), del.ok ? 'deleted' : del.message)

  // (5)+(6) theme-level ops — the C3 preview-theme gate. Duplicate the given theme,
  // then delete the DUPLICATE (never the original: deleteTheme is only ever called
  // with the id themeDuplicate just returned).
  const dupName = `velyr-dv-preview-${Date.now()}`
  const dup = await duplicateTheme(shop, token, themeId, dupName)
  check('(5) themeDuplicate (2026-07)', dup.ok && !!dup.themeId, dup.ok ? `new theme ${dup.themeId} "${dup.name}"` : dup.message)
  if (dup.ok && dup.themeId) {
    console.log(`      preview URL shape: https://${shop}/?preview_theme_id=${dup.themeId}`)
    const delTheme = await deleteTheme(shop, token, dup.themeId)
    check('(6) themeDelete (2026-07)', delTheme.ok, delTheme.ok ? `deleted ${delTheme.deletedThemeId}` : `${delTheme.message} — DELETE THEME ${dup.themeId} ("${dupName}") MANUALLY in the dev-store admin`)
  } else {
    check('(6) themeDelete (2026-07)', false, 'skipped — themeDuplicate failed, nothing to delete')
  }
} catch (e) {
  check('harness', false, e?.message || String(e))
} finally {
  // Best-effort cleanup if an early failure left the file behind.
  try { await deleteThemeFiles(shop, token, themeId, [filename], API) } catch { /* ignore */ }
}

const failed = results.filter(r => !r.ok).length
console.log(`\n${failed ? `❌ ${failed} shape(s) FAILED — do NOT enable the gated feature(s): 1–4 gate live writes, 5–6 gate AGENT_SHOPIFY_PREVIEW_THEMES` : '✅ all six shapes verified — live writes AND preview themes unblocked'}`)
process.exit(failed ? 1 : 0)
