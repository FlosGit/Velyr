// ─── STAGE RA4 — DEEP CONTEXT READER ─────────────────────────────────────────
//
// Reads the FULL source of the components RA3 ranked (plus a fixed set of
// supporting files) so RA5's Pass-2 prompt reasons over real code instead of
// the 300-char snippets RA3 ranked on. Bounded by a byte budget so a fat
// component list can't blow the prompt-size cap or the wallet.
//
// Read order (most→least conversion-relevant), each gated by the budget:
//   per ranked component: the file (truncated) + its sibling CSS
//   once per run:          tailwind theme · global styles · index.html head/body
//                          · public/llms.txt · package.json deps
//
// ARCHITECTURAL CONTRACT:
//   • rankerResult + mapResult (incl. repoTree) are passed in explicitly — no
//     module-scope cache. Blob SHAs come from repoTree → one getBlob per file.
//   • Honest fail: every file dropped for budget is recorded in
//     skippedDueToBudget; nothing is silently omitted.
//   • truncateForLLM mirrors index.ts's Stage-2 cap and reads the SAME env var
//     (LLM_MAX_FILE_BYTES) so the two can't diverge in production. See RA4 flag.

import type { MapResult } from './repo-mapper.ts'
import type { RankerResult } from './component-ranker.ts'

export interface DeepComponent {
  path: string
  content: string
  cssContent: string | null
  truncated: boolean
}

export interface DeepContext {
  components: DeepComponent[]
  tailwindTheme: string | null
  globalStyles: string | null
  indexHtml: string | null
  llmsTxt: string | null
  packageJsonDeps: string                 // stringified { dependencies, devDependencies }
  skippedDueToBudget: Array<{ path: string; reason: 'budget_exceeded' }>
  skippedUnreadable: Array<{ path: string; reason: 'fetch_failed' | 'decode_failed' }>
  totalBytes: number
}

export interface DeepReaderOpts { sizeBudgetBytes?: number }

// ─── PURE HELPERS ────────────────────────────────────────────────────────────

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function b64decode(content: string): string {
  const bin = atob(content.replace(/\n/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// Mirror of index.ts's Stage-2 truncateForLLM (same LLM_MAX_FILE_BYTES env,
// same 60 KB default, same loud marker) — kept local so this module stays
// self-contained and free of a circular import on index.ts.
const MAX_FILE_BYTES = () => Number(Deno.env.get('LLM_MAX_FILE_BYTES') || String(60 * 1024))
function truncateForLLM(content: string): { content: string; truncated: boolean } {
  if (typeof content !== 'string') return { content: '', truncated: false }
  const cap = MAX_FILE_BYTES()
  const bytes = byteLength(content)
  if (bytes <= cap) return { content, truncated: false }
  return {
    content: content.slice(0, cap) + `\n/* … truncated by Velyr LLM size cap (${cap}B / ${bytes}B original) … */`,
    truncated: true,
  }
}

// Sibling CSS for a component, derived from repoTree (RA4 isn't passed the
// graph, so it re-detects the same way RA2 does). Returns siteRoot-relative.
function detectSiblingCss(relPath: string, has: (full: string) => boolean, fullPath: (r: string) => string): string | null {
  const base = relPath.replace(/\.[^./]+$/, '')
  for (const c of [`${base}.module.css`, `${base}.module.scss`, `${base}.css`]) {
    if (has(fullPath(c))) return c
  }
  return null
}

// Extract the tailwind `theme: { … }` block (balanced braces, best-effort —
// braces inside strings/comments aren't handled), capped at 5 KB. Falls back
// to the first 5 KB of the config if no theme key is found.
function extractTailwindTheme(src: string): string {
  const idx = src.search(/\btheme\s*:/)
  if (idx === -1) return src.slice(0, 5 * 1024)
  const open = src.indexOf('{', idx)
  if (open === -1) return src.slice(idx, idx + 5 * 1024)
  let depth = 0, end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++
    else if (src[end] === '}') { depth--; if (depth === 0) { end++; break } }
  }
  return src.slice(idx, Math.min(end, idx + 5 * 1024))
}

function firstLines(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n')
}

// index.html <head> + the first 100 lines of <body>.
function extractHtmlHeadAndBody(html: string): string {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] || ''
  const bodyAt = html.search(/<body[^>]*>/i)
  const bodyFirst = bodyAt !== -1 ? firstLines(html.slice(bodyAt), 100) : ''
  return [head, bodyFirst].filter(Boolean).join('\n')
}

function extractDeps(pkgText: string): string {
  try {
    const pkg = JSON.parse(pkgText)
    return JSON.stringify({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} })
  } catch {
    return '{}'
  }
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export async function readDeepContext(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  rankerResult: RankerResult,
  mapResult: MapResult,
  opts: DeepReaderOpts = {},
): Promise<DeepContext> {
  const budget = opts.sizeBudgetBytes ?? Number(Deno.env.get('AGENT_DEEP_CONTEXT_BYTES') ?? '400000')
  const siteRoot = mapResult.siteRoot
  const fullPath = (rel: string) => (siteRoot ? `${siteRoot}/${rel}` : rel)

  const shaMap = new Map<string, string>()
  for (const e of mapResult.repoTree) if (e.type === 'blob') shaMap.set(e.path, e.sha)
  const has = (full: string) => shaMap.has(full)

  type FetchResult = { ok: true; content: string } | { ok: false; reason: 'fetch_failed' | 'decode_failed' }
  const fetchByFull = async (full: string): Promise<FetchResult> => {
    const sha = shaMap.get(full)
    let data: any
    try {
      data = sha
        ? (await octokit.rest.git.getBlob({ owner, repo, file_sha: sha })).data
        : (await octokit.rest.repos.getContent({ owner, repo, path: full, ref: branch })).data
    } catch {
      return { ok: false, reason: 'fetch_failed' }
    }
    try {
      if (sha) {
        return { ok: true, content: data.encoding === 'base64' ? b64decode(data.content) : (data.content ?? '') }
      }
      if (Array.isArray(data) || typeof data?.content !== 'string') return { ok: false, reason: 'decode_failed' }
      return { ok: true, content: b64decode(data.content) }
    } catch {
      return { ok: false, reason: 'decode_failed' }
    }
  }

  let totalBytes = 0
  const components: DeepComponent[] = []
  const skippedDueToBudget: Array<{ path: string; reason: 'budget_exceeded' }> = []
  const skippedUnreadable: Array<{ path: string; reason: 'fetch_failed' | 'decode_failed' }> = []

  const readSupporting = async (full: string, exists: boolean, transform: (raw: string) => string): Promise<string | null> => {
    if (!exists) return null
    if (totalBytes >= budget) { skippedDueToBudget.push({ path: full, reason: 'budget_exceeded' }); return null }
    const res = await fetchByFull(full)
    if (!res.ok) return null   // supporting-file read failures stay null (not surfaced as unreadable)
    const out = transform(res.content)
    totalBytes += byteLength(out)
    return out
  }

  // Supporting reads FIRST — they're small (~25KB aggregate) and Pass-2-critical
  // (framework theme / global styles / deps). Component reads then consume the
  // remainder of the budget. Reading components first risked an 8+ component
  // repo exhausting the budget before any supporting context was read.
  let tailwindTheme: string | null = null
  let globalStyles: string | null = null
  let indexHtml: string | null = null
  let llmsTxt: string | null = null
  let packageJsonDeps = '{}'

  // W3 (2026-07-14): on vite-react / plain-html the root index.html is PROMOTED
  // from read-only supporting context (head extract) to a FULL, editable
  // component — it is the served page shell where cookie banners, meta tags and
  // inline styles live (the PR-#10 class of unreachable root causes). When
  // promoted, the head-extract supporting read is skipped (no duplicate bytes);
  // the full file is appended LAST after the ranked walk so it can never starve
  // a ranked component's budget. Kill-switch: AGENT_HTML_EDIT=false (keep in
  // sync with createPR's html allowlist in index.ts).
  const htmlEditable = (Deno.env.get('AGENT_HTML_EDIT') ?? 'true') !== 'false'
    && (mapResult.framework === 'vite-react' || mapResult.framework === 'plain-html')

  // Item 8b: the five supporting reads are independent — fetch them
  // concurrently. The sequential budget gating between them was theoretical
  // (they aggregate ~25KB against a budget an order of magnitude larger), and
  // the component walk below still enforces the budget strictly.
  {
    const idx  = fullPath('index.html')
    const llms = fullPath('public/llms.txt')
    // "top-level" package.json = the SELECTED site's package.json (siteRoot),
    // which holds the deps that actually ship — for a monorepo the repo-root
    // manifest is just workspace plumbing. See RA4 flag.
    const pkg  = fullPath('package.json')
    const [tw, gs, ih, lt, deps] = await Promise.all([
      mapResult.tailwindConfigPath ? readSupporting(mapResult.tailwindConfigPath, true, extractTailwindTheme) : Promise.resolve(null),
      mapResult.globalStylesPath   ? readSupporting(mapResult.globalStylesPath, true, raw => firstLines(raw, 200)) : Promise.resolve(null),
      readSupporting(idx, has(idx) && !htmlEditable, extractHtmlHeadAndBody),
      readSupporting(llms, has(llms), raw => raw),
      readSupporting(pkg, has(pkg), extractDeps),
    ])
    tailwindTheme = tw
    globalStyles  = gs
    indexHtml     = ih
    llmsTxt       = lt
    if (deps != null) packageJsonDeps = deps
  }

  // Then per ranked component (in rank order): file + sibling CSS. Styled-
  // components / emotion declarations need no extra fetch — they live in the
  // component file already and are covered by reading it.
  // Item 8b: fetches run CONCURRENTLY (pool of 8, mirroring the theme reader);
  // the budget walk below stays strictly in rank order, so the bytes that reach
  // the prompt are identical to the sequential version. Past-budget files may
  // be fetched and discarded — a few wasted blob calls, never wasted prompt
  // bytes (≤10 components + siblings, bounded by FINAL_RANKED_CAP).
  const DEEP_FETCH_CONCURRENCY = 8
  const tasks = rankerResult.ranked.map(item => ({ item, cssRel: detectSiblingCss(item.path, has, fullPath) }))
  const prefetched = new Map<string, { res: FetchResult; cssRes: FetchResult | null }>()
  let nextTask = 0
  await Promise.all(Array.from({ length: Math.min(DEEP_FETCH_CONCURRENCY, tasks.length) }, async () => {
    while (nextTask < tasks.length) {
      const t = tasks[nextTask++]
      const res = await fetchByFull(fullPath(t.item.path))
      const cssRes = t.cssRel ? await fetchByFull(fullPath(t.cssRel)) : null
      prefetched.set(t.item.path, { res, cssRes })
    }
  }))
  for (const { item, cssRel } of tasks) {
    if (totalBytes >= budget) { skippedDueToBudget.push({ path: item.path, reason: 'budget_exceeded' }); continue }
    const pf = prefetched.get(item.path)
    const res = pf?.res ?? { ok: false as const, reason: 'fetch_failed' as const }
    if (!res.ok) { skippedUnreadable.push({ path: item.path, reason: res.reason }); continue }
    const { content, truncated } = truncateForLLM(res.content)
    totalBytes += byteLength(content)

    let cssContent: string | null = null
    if (cssRel) {
      if (totalBytes >= budget) {
        skippedDueToBudget.push({ path: cssRel, reason: 'budget_exceeded' })
      } else {
        const cssRes = pf?.cssRes
        if (cssRes?.ok) {
          cssContent = truncateForLLM(cssRes.content).content
          totalBytes += byteLength(cssContent)
        }
      }
    }
    components.push({ path: item.path, content, cssContent, truncated })
  }

  // W3: append the FULL root index.html as the LAST editable component (see the
  // htmlEditable comment above). Dedupe covers plain-html, where index.html is
  // already the graph entry and may have been ranked into the walk above.
  if (htmlEditable && has(fullPath('index.html')) && !components.some(c => c.path === 'index.html')) {
    if (totalBytes >= budget) {
      skippedDueToBudget.push({ path: 'index.html', reason: 'budget_exceeded' })
    } else {
      const res = await fetchByFull(fullPath('index.html'))
      if (!res.ok) {
        skippedUnreadable.push({ path: 'index.html', reason: res.reason })
      } else {
        const { content, truncated } = truncateForLLM(res.content)
        totalBytes += byteLength(content)
        components.push({ path: 'index.html', content, cssContent: null, truncated })
      }
    }
  }

  return { components, tailwindTheme, globalStyles, indexHtml, llmsTxt, packageJsonDeps, skippedDueToBudget, skippedUnreadable, totalBytes }
}
