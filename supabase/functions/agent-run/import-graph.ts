// ─── STAGE RA2 — IMPORT-GRAPH TRAVERSAL ──────────────────────────────────────
//
// BFS over the repo's import graph, starting from the entry points discovered
// in RA1. Produces a structural graph (nodes + edges + unresolved imports)
// that RA3 ranks and RA4 reads deeply. We fetch each file's content to parse
// its imports + JSX usage, then DISCARD the content — the graph itself stays
// lightweight (no source bytes). RA4 re-reads the chosen components.
//
// ARCHITECTURAL CONTRACT:
//   • mapResult (incl. repoTree) is passed in explicitly — never read from a
//     module-scope cache. Under bounded-concurrency=3 a shared cache would
//     leak repo A's tree into repo B's run.
//   • Blob SHAs come from mapResult.repoTree, so traversal costs ONE getBlob
//     per visited file (no per-file getContent round-trips). getContent is a
//     fallback only for heuristic paths absent from the initial tree (e.g. a
//     truncated tree) — logged when it happens.
//   • All node/edge paths are relative to mapResult.siteRoot. The repoTree is
//     relative to repo root, so we translate via siteRoot only at fetch /
//     existence-check time.
//   • Honest fail: imports we can't resolve land in `unresolved` with a reason,
//     never silently dropped (external packages are skipped, not "unresolved").

import { parse as babelParse } from 'npm:@babel/parser@7.27.0'
import type { MapResult } from './repo-mapper.ts'

export interface GraphNode {
  path: string                                  // relative to siteRoot
  depth: number                                 // 0 = entry point
  size: number                                  // raw bytes of file content
  componentName: string | null                  // default export or filename
  jsxElements: string[]                         // unique capitalized tag names
  cssPath: string | null                        // sibling CSS, relative to siteRoot
  framework: 'js' | 'svelte' | 'astro' | 'vue' | 'html' | 'shopify-liquid'
  // First ~400 chars of body (import/export-from header stripped). This IS the
  // content cache RA3 reads for its compact graph summary — RA3 must NOT add a
  // second blob-fetch path; read node.firstChars instead.
  firstChars: string
}

export interface GraphEdge { from: string; to: string }

export interface UnresolvedImport { source: string; importer: string; reason: string }

export interface ImportGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: UnresolvedImport[]
  truncatedAt: 'depth' | 'count' | null
}

export interface GraphOpts { maxDepth?: number; maxFiles?: number }

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

function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

function extOf(p: string): string {
  const m = p.match(/\.[^./]+$/)
  return m ? m[0].toLowerCase() : ''
}

// Resolve a relative import against the importer's directory, collapsing
// '.' and '..'. All inputs/outputs are siteRoot-relative.
function normalizeRel(baseDir: string, rel: string): string {
  const out = baseDir ? baseDir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

function frameworkOf(p: string): GraphNode['framework'] {
  const e = extOf(p)
  if (e === '.svelte') return 'svelte'
  if (e === '.astro') return 'astro'
  if (e === '.vue') return 'vue'
  if (e === '.html' || e === '.htm') return 'html'
  return 'js'
}

function isParseableJs(p: string): boolean {
  return ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'].includes(extOf(p))
}
function isRegexParseable(p: string): boolean {
  return ['.svelte', '.astro', '.vue'].includes(extOf(p))
}

function babelPlugins(p: string): any[] {
  const e = extOf(p)
  const plugins: any[] = []
  if (e === '.tsx' || e === '.jsx' || e === '.js' || e === '.mjs' || e === '.cjs') plugins.push('jsx')
  if (e === '.ts' || e === '.tsx') plugins.push('typescript')
  return plugins
}

const RESOLVE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte', '.astro']

// Resolved paths matching any of these are dropped (not traversed, not edged).
const SKIP_RE: RegExp[] = [
  /\.test\./, /\.spec\./, /\.stories\./, /\.d\.ts$/,
  /(^|\/)node_modules\//, /(^|\/)dist\//, /(^|\/)build\//, /(^|\/)out\//,
  /(^|\/)\.next\//, /(^|\/)\.nuxt\//, /(^|\/)\.svelte-kit\//, /(^|\/)\.vercel\//,
  /(^|\/)coverage\//, /(^|\/)__tests__\//, /(^|\/)__mocks__\//,
]
function isSkipped(p: string): boolean {
  return SKIP_RE.some(r => r.test(p))
}

// Manual AST walk (no @babel/traverse dependency). Collects import sources
// (incl. `export … from`) and unique capitalized JSX element names.
function collectFromAst(ast: any): { imports: string[]; jsx: string[] } {
  const imports: string[] = []
  const jsx = new Set<string>()
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) visit(n); return }
    const t = node.type
    if ((t === 'ImportDeclaration' || t === 'ExportNamedDeclaration' || t === 'ExportAllDeclaration') && node.source?.value) {
      imports.push(node.source.value)
    } else if (t === 'JSXOpeningElement') {
      const name = node.name
      if (name?.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)) jsx.add(name.name)
      else if (name?.type === 'JSXMemberExpression') {
        let obj = name.object
        while (obj?.type === 'JSXMemberExpression') obj = obj.object
        if (obj?.type === 'JSXIdentifier' && /^[A-Z]/.test(obj.name)) jsx.add(obj.name)
      }
    }
    for (const key in node) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue
      const child = (node as any)[key]
      if (child && typeof child === 'object') visit(child)
    }
  }
  visit(ast)
  return { imports, jsx: [...jsx] }
}

function getDefaultExportName(ast: any): string | null {
  const body = ast?.program?.body || []
  for (const n of body) {
    if (n.type === 'ExportDefaultDeclaration') {
      const d = n.declaration
      if (!d) return null
      if (d.type === 'Identifier') return d.name
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) return d.id.name
      return null
    }
  }
  return null
}

// Regex fallback for .svelte/.astro/.vue and for JS files Babel couldn't parse.
const IMPORT_RE = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g
const TAG_RE = /<([A-Z][A-Za-z0-9]*)/g
function regexExtract(content: string): { imports: string[]; jsx: string[] } {
  const imports: string[] = []
  const jsx = new Set<string>()
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content))) imports.push(m[1])
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(content))) jsx.add(m[1])
  return { imports, jsx: [...jsx] }
}

// Strip the contiguous import/export-from header block, then take the first
// 400 chars (string slice, not bytes) of what remains. Works on any framework
// content (JS, .svelte/.astro/.vue, .html) since it's purely line-based.
const HEADER_LINE_RE = /^\s*(import\s|export\s+(?:\*|\{|type\s|default\s+)?[\w*{},\s]*\s+from\s)/
function computeFirstChars(content: string): string {
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length && (lines[i].trim() === '' || HEADER_LINE_RE.test(lines[i]))) i++
  return lines.slice(i).join('\n').slice(0, 400).replace(/\s+$/, '')
}

function filenameToComponent(relPath: string): string | null {
  const file = relPath.split('/').pop() || ''
  let base = file.replace(/\.[^.]+$/, '')
  if (['index', 'page', 'layout', '_app', '+page', '+layout'].includes(base)) {
    const parts = relPath.split('/')
    base = parts[parts.length - 2] || base
  }
  return base || null
}

// Sibling CSS: Component.tsx → Component.module.css | .module.scss | .css.
// Returns siteRoot-relative path or null.
function detectSiblingCss(relPath: string, fullPath: (r: string) => string, has: (full: string) => boolean): string | null {
  const base = relPath.replace(/\.[^./]+$/, '')
  for (const c of [`${base}.module.css`, `${base}.module.scss`, `${base}.css`]) {
    if (has(fullPath(c))) return c
  }
  return null
}

function matchAlias(alias: string, source: string): string | null {
  if (alias.endsWith('*')) {
    const prefix = alias.slice(0, -1) // '@/*' → '@/', '@comp/*'→'@comp/'
    return source.startsWith(prefix) ? source.slice(prefix.length) : null
  }
  return source === alias ? '' : null
}

function substituteTarget(target: string, rest: string): string {
  if (target.endsWith('/*')) return rest ? `${target.slice(0, -2)}/${rest}` : target.slice(0, -2)
  if (target.endsWith('*')) return `${target.slice(0, -1)}${rest}`
  return target
}

type ResolveResult = { resolved: string } | { external: true } | { reason: string }

// Resolve an import source to a siteRoot-relative file that exists in the tree.
function resolveImport(
  source: string,
  importerRel: string,
  mapResult: MapResult,
  has: (full: string) => boolean,
  fullPath: (r: string) => string,
): ResolveResult {
  const tryExts = (candidate: string): string | null => {
    const c = candidate.replace(/^\.?\//, '')
    if (extOf(c) && has(fullPath(c))) return c
    for (const ext of RESOLVE_EXTS) if (has(fullPath(c + ext))) return c + ext
    for (const ext of RESOLVE_EXTS) if (has(fullPath(`${c}/index${ext}`))) return `${c}/index${ext}`
    return null
  }

  // 1. relative
  if (source.startsWith('.')) {
    const r = tryExts(normalizeRel(dirname(importerRel), source))
    return r ? { resolved: r } : { reason: 'relative import not found in tree' }
  }
  // 2. tsconfig path alias
  for (const [alias, targets] of Object.entries(mapResult.tsConfigPaths)) {
    const rest = matchAlias(alias, source)
    if (rest !== null) {
      for (const target of targets) {
        const r = tryExts(substituteTarget(target, rest))
        if (r) return { resolved: r }
      }
      return { reason: `tsconfig alias "${alias}" matched but target not found in tree` }
    }
  }
  // 3. '@/' Next.js convention when not declared in tsconfig → baseUrl = siteRoot
  if (source.startsWith('@/')) {
    const r = tryExts(source.slice(2))
    return r ? { resolved: r } : { reason: '"@/" alias assumed siteRoot-relative but file not found' }
  }
  // 4. bare specifier → external package, skip
  return { external: true }
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export async function buildImportGraph(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  mapResult: MapResult,
  opts: GraphOpts = {},
): Promise<ImportGraph> {
  const maxDepth = opts.maxDepth ?? Number(Deno.env.get('AGENT_GRAPH_MAX_DEPTH') ?? '3')
  // Default 50 (not 30): typical SMB-site fan-out from App-level into pages +
  // components routinely exceeds 30 — the 30 cap fired on Velyr's own repo in
  // the RA2 sample (truncatedAt: 'count').
  const maxFiles = opts.maxFiles ?? Number(Deno.env.get('AGENT_GRAPH_MAX_FILES') ?? '50')
  const siteRoot = mapResult.siteRoot

  const fullPath = (rel: string) => (siteRoot ? `${siteRoot}/${rel}` : rel)

  // SHA lookup from the already-fetched tree — one getBlob per visited file.
  const shaMap = new Map<string, string>()
  for (const e of mapResult.repoTree) if (e.type === 'blob') shaMap.set(e.path, e.sha)
  const has = (full: string) => shaMap.has(full)

  const fetchContent = async (relPath: string): Promise<string | null> => {
    const full = fullPath(relPath)
    const sha = shaMap.get(full)
    try {
      if (sha) {
        const { data } = await octokit.rest.git.getBlob({ owner, repo, file_sha: sha })
        return data.encoding === 'base64' ? b64decode(data.content) : (data.content ?? '')
      }
      // Heuristic path not in the initial tree (e.g. truncated tree). Rare.
      console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'graph_getcontent_fallback', path: full }))
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: full, ref: branch })
      if (Array.isArray(data) || typeof (data as any)?.content !== 'string') return null
      return b64decode((data as any).content)
    } catch {
      return null
    }
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const unresolved: UnresolvedImport[] = []
  const visited = new Set<string>()
  const enqueued = new Set<string>()
  let truncatedAt: ImportGraph['truncatedAt'] = null

  const queue: Array<{ path: string; depth: number }> = []
  for (const ep of mapResult.entryPoints) {
    if (!enqueued.has(ep)) { queue.push({ path: ep, depth: 0 }); enqueued.add(ep) }
  }

  while (queue.length > 0) {
    if (nodes.length >= maxFiles) { truncatedAt = 'count'; break }
    const { path: relPath, depth } = queue.shift()!
    if (visited.has(relPath)) continue
    visited.add(relPath)

    const content = await fetchContent(relPath)
    const fw = frameworkOf(relPath)
    let imports: string[] = []
    let jsxElements: string[] = []
    let componentName: string | null = null

    if (content != null) {
      if (isParseableJs(relPath)) {
        try {
          const ast = babelParse(content, { sourceType: 'module', plugins: babelPlugins(relPath), errorRecovery: true })
          const got = collectFromAst(ast)
          imports = got.imports; jsxElements = got.jsx
          componentName = getDefaultExportName(ast)
        } catch {
          const got = regexExtract(content)
          imports = got.imports; jsxElements = got.jsx
        }
      } else if (isRegexParseable(relPath)) {
        const got = regexExtract(content)
        imports = got.imports; jsxElements = got.jsx
      }
      // .html / other: node with no parsed imports
    }
    if (!componentName) componentName = filenameToComponent(relPath)

    nodes.push({
      path: relPath,
      depth,
      size: content != null ? byteLength(content) : 0,
      componentName,
      jsxElements,
      cssPath: detectSiblingCss(relPath, fullPath, has),
      framework: fw,
      firstChars: content != null ? computeFirstChars(content) : '',
    })

    for (const src of imports) {
      const res = resolveImport(src, relPath, mapResult, has, fullPath)
      if ('external' in res) continue
      if ('reason' in res) { unresolved.push({ source: src, importer: relPath, reason: res.reason }); continue }
      const target = res.resolved
      if (isSkipped(target)) continue
      edges.push({ from: relPath, to: target })
      if (depth < maxDepth) {
        if (!enqueued.has(target) && !visited.has(target)) {
          queue.push({ path: target, depth: depth + 1 })
          enqueued.add(target)
        }
      } else if (!truncatedAt) {
        truncatedAt = 'depth'
      }
    }
  }

  return { nodes, edges, unresolved, truncatedAt }
}
