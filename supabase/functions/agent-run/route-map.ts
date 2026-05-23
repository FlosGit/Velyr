// ─── STAGE 2 — FILE → URL ROUTE MAPPING ──────────────────────────────────────
//
// Single source for "given a repo source path, what URL route does it render?"
// Shared by the funnel routePath matcher and the before-screenshot URL (both in
// index.ts). A byte-compatible Node twin lives in api/agent/run.js (rollback
// after-screenshot URL) — keep them in sync. Same Node/Deno bundle boundary as
// encryptSecret / ROLLBACK_BOUNCE_PP_THRESHOLD: a single cross-runtime import
// isn't viable, so the two copies are kept in lockstep by this contract.
// Update both together if the mapping rules change.
//
// Rules (Stage 2 decision 3):
//   App Router (app/ or src/app/):
//     - strip the app/ | src/app/ prefix
//     - a route resolves only for `page.*` / `layout.*` files; route handlers
//       (route.*), loading/error/not-found/template/default, and ordinary
//       components return null (no clean URL — callers fall back to the site
//       root for screenshots, and the funnel skips them)
//     - (group) segments are dropped wholesale
//     - _private folders and @slot (parallel-route) folders → null (skipped)
//     - [param] → :param ; [...slug] / [[...slug]] kept as-is (refine later)
//   Pages Router / Vite (unchanged from the pre-Stage-2 behavior):
//     - strip src/pages | pages | src/views | src/screens prefix → '/'
//     - strip extension, /index → '/'
//
// Returns a lowercased route ('/pricing', '/'), or null when the path has no
// clean public route. Inputs may be repo-root-relative (single-project funnel
// paths) or siteRoot-relative (graph/ranker file_to_edit paths); both work
// because the prefixes we match (app/, pages/, …) sit at the start either way
// for single-project repos. Monorepo funnel paths keep the pre-existing
// root-relative limitation (documented in index.ts detectAllPages).

const ROUTE_FILE_RE = /^(page|layout)\.(tsx|jsx|ts|js)$/

function toRouteSegment(seg: string): string {
  // catch-all [...slug] and optional catch-all [[...slug]] kept verbatim
  if (/^\[\[?\.\.\..+\]\]?$/.test(seg)) return seg
  const dyn = seg.match(/^\[(.+)\]$/)
  return dyn ? `:${dyn[1]}` : seg
}

function normalizeRoute(route: string): string {
  let r = route.replace(/\/{2,}/g, '/')
  if (r.length > 1) r = r.replace(/\/$/, '')
  return r.toLowerCase()
}

export function fileToRoutePath(filePath: string): string | null {
  const p = (filePath || '').replace(/\\/g, '/')

  // ── App Router ──
  const appMatch = p.match(/^(?:src\/)?app\/(.+)$/)
  if (appMatch) {
    const parts = appMatch[1].split('/')
    const file = parts.pop() || ''
    if (!ROUTE_FILE_RE.test(file)) return null   // not a page/layout → no clean route
    const segs: string[] = []
    for (const s of parts) {
      if (s.startsWith('_') || s.startsWith('@')) return null   // private / parallel slot
      if (/^\(.*\)$/.test(s)) continue                          // route group — dropped
      segs.push(toRouteSegment(s))
    }
    return normalizeRoute('/' + segs.join('/'))
  }

  // ── Pages Router / Vite (preserved verbatim) ──
  return p
    .replace(/^(src\/pages|pages|src\/views|src\/screens)\//, '/')
    .replace(/\.(jsx|tsx|js|ts)$/, '')
    .replace(/\/index$/, '/')
    .toLowerCase()
}
