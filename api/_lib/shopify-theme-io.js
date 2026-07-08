// ════════════════════════════════════════════════════════════════════════════
// Shopify Admin GraphQL theme I/O — the I/O HALF of the Shopify-direct write path.
//
// Pairs with shopify-rollback.js (the PURE decision logic). Everything here performs
// network I/O against the Shopify Admin API, so it is NOT unit-tested — it is verified
// against a Shopify DEV STORE before any merchant write. Each function NEVER throws;
// it returns a result object the caller branches on. Shared by the apply path
// (api/webhooks/telegram.js) and the auto-rollback (api/agent/run.js) so the GraphQL
// is written once.
//
// `_`-prefixed dir ⇒ not a Vercel route (no function-cap cost).
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_API_VERSION = '2026-04' // keep in sync with shopify-oauth / agent-run

function endpoint(shop, apiVersion) {
  return `https://${shop}/admin/api/${apiVersion || DEFAULT_API_VERSION}/graphql.json`
}
function gid(themeId) {
  return `gid://shopify/OnlineStoreTheme/${themeId}`
}
async function post(shop, token, apiVersion, body) {
  const res = await fetch(endpoint(shop, apiVersion), {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

// ── Re-query checksumMd5 for specific files (the optimistic-concurrency read) ──
// Returns { ok: true, byFilename: { [filename]: md5|null } } — a requested file
// absent from the theme maps to null (so classifyConcurrency treats it as a conflict).
// On any transport/GraphQL failure returns { ok: false, reason, message } so the caller
// can ABORT the write rather than proceed blind.
export async function queryThemeChecksums(shop, token, themeId, filenames, apiVersion) {
  // `files(first: 50)` — if more than 50 filenames are requested the surplus are
  // absent from the response and map to null, which the caller treats as a conflict
  // (fail-safe abort, never a blind overwrite). Log it so the truncation is not
  // silent. Single-file writes never hit this today; revisit with pagination if
  // multi-file theme writes ship.
  if (Array.isArray(filenames) && filenames.length > 50) {
    console.warn(`[shopify-theme-io] queryThemeChecksums requested ${filenames.length} files but the query caps at 50 — surplus treated as conflicts (fail-safe).`)
  }
  const query = `query VelyrThemeChecksums($themeId: ID!, $filenames: [String!]) {
    theme(id: $themeId) {
      files(first: 50, filenames: $filenames) {
        edges { node { filename checksumMd5 } }
      }
    }
  }`
  let res, json
  try {
    ({ res, json } = await post(shop, token, apiVersion, { query, variables: { themeId: gid(themeId), filenames } }))
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: `checksum re-query threw: ${err?.message || String(err)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: `Shopify returned ${res.status} re-querying checksums` }
  if (!res.ok || json?.errors || json?.data?.theme?.files == null) {
    return { ok: false, reason: 'graphql_error', message: `checksum re-query failed (HTTP ${res.status})` }
  }
  // Initialize every requested file to null (absent), then fill from the response.
  const byFilename = {}
  for (const fn of filenames) byFilename[fn] = null
  for (const edge of json.data.theme.files.edges || []) {
    const node = edge?.node
    if (node?.filename != null) byFilename[node.filename] = node.checksumMd5 ?? null
  }
  return { ok: true, byFilename }
}

// ── Upsert (full-file TEXT replacement) ──────────────────────────────────────
// files: [{ filename, content }]. Returns { ok: true, upsertedFilenames, userErrors, jobId }
// — the caller passes upsertedFilenames + userErrors to confirmApplied/resolveAppliedFiles
// (option a: trust the response). HTTP/transport failure → { ok: false, reason, message }.
//
// themeFilesUpsert ALSO returns an async-processing `job { id done }`. We select + return
// its id (jobId) and the caller persists it on the apply record. We do NOT poll it yet —
// confirmation stays option (a). Persisting jobId now keeps a future option (b) upgrade
// (poll the job to done + re-query checksum to confirm landed content) a non-breaking add.
export async function upsertThemeFiles(shop, token, themeId, files, apiVersion) {
  const mutation = `mutation VelyrThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      job { id done }
      upsertedThemeFiles { filename }
      userErrors { code filename message }
    }
  }`
  const variables = {
    themeId: gid(themeId),
    files: files.map(f => ({ filename: f.filename, body: { type: 'TEXT', value: f.content } })),
  }
  let res, json
  try {
    ({ res, json } = await post(shop, token, apiVersion, { query: mutation, variables }))
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: `themeFilesUpsert threw: ${err?.message || String(err)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: `Shopify returned ${res.status} on themeFilesUpsert` }
  if (!res.ok || json?.errors) return { ok: false, reason: 'graphql_error', message: `themeFilesUpsert failed (HTTP ${res.status})` }
  const payload = json?.data?.themeFilesUpsert || {}
  return {
    ok: true,
    upsertedFilenames: (payload.upsertedThemeFiles || []).map(f => f.filename).filter(Boolean),
    userErrors: payload.userErrors || [],
    jobId: payload.job?.id ?? null,
  }
}

// ── Theme-level operations (C3 preview themes) ───────────────────────────────
// themeDuplicate / themeDelete exist only from Admin API 2026-07 (the file-level
// mutations above are pinned to 2026-04). Theme-level ops therefore pin their OWN
// version and never inherit DEFAULT_API_VERSION. Both need write_themes + the
// theme-modification exemption (granted — ticket 68049335). Shapes are verified
// against a dev store via scripts/shopify-dv-verify.mjs steps (5)/(6) BEFORE the
// AGENT_SHOPIFY_PREVIEW_THEMES flag may be enabled.
const THEME_OPS_API_VERSION = '2026-07'

// Duplicates a theme (unpublished copy). Returns { ok: true, themeId, name } or
// { ok: false, reason, message }. themeId is the NUMERIC id extracted from the gid,
// ready for https://<shop>/?preview_theme_id=<id>.
export async function duplicateTheme(shop, token, themeId, name, apiVersion) {
  const mutation = `mutation VelyrThemeDuplicate($id: ID!, $name: String) {
    themeDuplicate(id: $id, name: $name) {
      newTheme { id name role }
      userErrors { field message }
    }
  }`
  let res, json
  try {
    ({ res, json } = await post(shop, token, apiVersion || THEME_OPS_API_VERSION, { query: mutation, variables: { id: gid(themeId), name } }))
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: `themeDuplicate threw: ${err?.message || String(err)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: `Shopify returned ${res.status} on themeDuplicate` }
  if (!res.ok || json?.errors) return { ok: false, reason: 'graphql_error', message: `themeDuplicate failed (HTTP ${res.status}): ${JSON.stringify(json?.errors || {}).slice(0, 300)}` }
  const payload = json?.data?.themeDuplicate || {}
  if (payload.userErrors?.length) return { ok: false, reason: 'user_errors', message: payload.userErrors.map(e => e.message).join('; ') }
  const newGid = payload.newTheme?.id || ''
  const numericId = newGid.split('/').pop()
  if (!numericId) return { ok: false, reason: 'no_theme', message: 'themeDuplicate returned no newTheme id' }
  return { ok: true, themeId: numericId, name: payload.newTheme?.name || name || '' }
}

// Polls the duplicate's `processing` flag until Shopify finishes copying its files.
// Dev-store-verified necessity: themeDuplicate is ASYNC — themeDelete (and by
// implication themeFilesUpsert) on a fresh duplicate fails with "You can't delete
// this theme until it has finished uploading" until processing flips to false.
export async function waitForThemeReady(shop, token, themeId, { timeoutMs = 30000, intervalMs = 2500 } = {}, apiVersion) {
  const query = `query VelyrThemeProcessing($id: ID!) { theme(id: $id) { processing } }`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let res, json
    try {
      ({ res, json } = await post(shop, token, apiVersion || THEME_OPS_API_VERSION, { query, variables: { id: gid(themeId) } }))
    } catch (err) {
      return { ok: false, reason: 'request_failed', message: `theme processing poll threw: ${err?.message || String(err)}` }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: `Shopify returned ${res.status} polling theme processing` }
    if (json?.data?.theme === null) return { ok: false, reason: 'not_found', message: 'theme vanished while processing' }
    if (json?.data?.theme?.processing === false) return { ok: true }
    if (Date.now() + intervalMs > deadline) return { ok: false, reason: 'timeout', message: `theme still processing after ${Math.round(timeoutMs / 1000)}s` }
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

// Deletes an entire theme (used ONLY to remove Velyr-created preview duplicates —
// callers must guard that the id is a Velyr preview theme, never the live theme).
// Returns { ok: true, deletedThemeId } or { ok: false, reason, message }.
export async function deleteTheme(shop, token, themeId, apiVersion) {
  const mutation = `mutation VelyrThemeDelete($id: ID!) {
    themeDelete(id: $id) {
      deletedThemeId
      userErrors { field message }
    }
  }`
  let res, json
  try {
    ({ res, json } = await post(shop, token, apiVersion || THEME_OPS_API_VERSION, { query: mutation, variables: { id: gid(themeId) } }))
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: `themeDelete threw: ${err?.message || String(err)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: `Shopify returned ${res.status} on themeDelete` }
  if (!res.ok || json?.errors) return { ok: false, reason: 'graphql_error', message: `themeDelete failed (HTTP ${res.status}): ${JSON.stringify(json?.errors || {}).slice(0, 300)}` }
  const payload = json?.data?.themeDelete || {}
  if (payload.userErrors?.length) return { ok: false, reason: 'user_errors', message: payload.userErrors.map(e => e.message).join('; ') }
  if (!payload.deletedThemeId) return { ok: false, reason: 'not_deleted', message: 'themeDelete returned no deletedThemeId' }
  return { ok: true, deletedThemeId: payload.deletedThemeId }
}

// ── Delete (rollback of a CREATED file) ──────────────────────────────────────
// filenames: [string]. Returns { ok: true, deletedFilenames, userErrors } or
// { ok: false, reason, message }.
export async function deleteThemeFiles(shop, token, themeId, filenames, apiVersion) {
  const mutation = `mutation VelyrThemeFilesDelete($themeId: ID!, $files: [String!]!) {
    themeFilesDelete(themeId: $themeId, files: $files) {
      deletedThemeFiles { filename }
      userErrors { code filename message }
    }
  }`
  let res, json
  try {
    ({ res, json } = await post(shop, token, apiVersion, { query: mutation, variables: { themeId: gid(themeId), files: filenames } }))
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: `themeFilesDelete threw: ${err?.message || String(err)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', message: `Shopify returned ${res.status} on themeFilesDelete` }
  if (!res.ok || json?.errors) return { ok: false, reason: 'graphql_error', message: `themeFilesDelete failed (HTTP ${res.status})` }
  const payload = json?.data?.themeFilesDelete || {}
  return {
    ok: true,
    deletedFilenames: (payload.deletedThemeFiles || []).map(f => f.filename).filter(Boolean),
    userErrors: payload.userErrors || [],
  }
}
