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
