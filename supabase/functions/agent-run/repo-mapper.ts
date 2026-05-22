// ─── STAGE RA1 — REPO MAPPING & FRAMEWORK DETECTION ──────────────────────────
//
// Supersedes the Stage 5 `detectFramework` gate in index.ts. Where the old
// gate read a single root package.json and returned a yes/no verdict, this
// module builds a structural map of the repo in ONE recursive git.getTree
// call plus a handful of targeted content reads:
//
//   • framework (incl. monorepo workspace resolution)
//   • the selected site root (workspace) the rest of the pipeline scopes to
//   • entry points, TS path aliases, CSS approach, global-styles location
//   • the full repo tree, returned on mapResult.repoTree
//
// ARCHITECTURAL CONTRACT (see prompt's architectural rules):
//   • No module-level mutable state. Under bounded-concurrency=3 the Edge
//     Function module is shared across customers; a module-scope cache would
//     leak repo A's tree into repo B's run. The tree is returned on the result
//     and threaded explicitly to downstream stages — never cached at module
//     scope here.
//   • Helpers are pure: they take inputs and return outputs. The only impure
//     surface is the octokit network access inside the exported entry point.
//   • Honest fail: when we cannot determine the framework we return
//     `unsupported` with a concrete `unsupportedReason`, never a guess.
//
// GitHub API budget (typical single-project repo): 1 getTree + 1 package.json
// (+ 1 tsconfig.json if present) ≈ 2-3 calls. Entry-point / config / style
// existence is resolved from the already-fetched tree, NOT via per-file HEAD
// requests. Monorepos additionally pay one package.json read per workspace,
// plus one listCommits per web-app candidate only when a recency tie-break is
// actually required.

export type Framework =
  | 'vite-react' | 'cra' | 'nextjs-app' | 'nextjs-pages' | 'remix'
  | 'astro' | 'sveltekit' | 'vue-vite' | 'nuxt' | 'plain-html' | 'unsupported'

export type CssApproach =
  | 'css-modules' | 'tailwind' | 'styled-components' | 'emotion'
  | 'plain-css' | 'unknown'

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

export interface Workspace {
  path: string
  framework: string
  hasWebApp: boolean
  // Whole days since this workspace's last commit. -1 means "not measured"
  // (only populated for web-app candidates when a recency tie-break runs, to
  // stay within the GitHub call budget).
  lastCommitDays: number
}

export interface MapResult {
  framework: Framework
  isMonorepo: boolean
  workspaces: Workspace[]
  selectedWorkspacePath: string         // '' for non-monorepo, else 'apps/web'
  siteRoot: string                      // same as selectedWorkspacePath
  entryPoints: string[]                 // paths relative to siteRoot
  tsConfigPaths: Record<string, string[]>
  cssApproach: CssApproach
  tailwindConfigPath: string | null
  globalStylesPath: string | null
  unsupportedReason: string | null
  tsStrict: boolean                     // compilerOptions.strict at siteRoot (RA6)
  repoTree: TreeEntry[]                 // threaded explicitly downstream
}

// RA6: best-effort lint/type-strictness awareness for the receipt. Detection
// only — we never run ESLint or tsc in this environment, so we don't claim to.
export interface LintInfo {
  eslint: boolean
  eslintPath: string | null
  tsStrict: boolean
}

// ─── PURE HELPERS ────────────────────────────────────────────────────────────

function b64decode(content: string): string {
  const bin = atob(content.replace(/\n/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// Join a site-root with a relative path. base '' → rel unchanged.
function joinPath(base: string, rel: string): string {
  const r = rel.replace(/^\.?\//, '')
  if (!base) return r
  return `${base.replace(/\/$/, '')}/${r}`
}

function basename(p: string): string {
  const parts = p.replace(/\/$/, '').split('/')
  return parts[parts.length - 1]
}

function treeHasFile(tree: TreeEntry[], path: string): boolean {
  return tree.some(e => e.type === 'blob' && e.path === path)
}

function treeHasDir(tree: TreeEntry[], path: string): boolean {
  const p = path.replace(/\/$/, '')
  return tree.some(e =>
    (e.type === 'tree' && e.path === p) ||
    e.path.startsWith(p + '/'))
}

// Tolerant JSONC parse — strips // and /* */ comments and trailing commas.
// Best-effort: a // sequence inside a string literal would be mis-stripped,
// but tsconfig/package.json almost never contain those. Returns null on failure.
function parseJsonc(text: string): any | null {
  try {
    const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '')
    const noLine  = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1')
    const noTrailingCommas = noLine.replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(noTrailingCommas)
  } catch {
    return null
  }
}

// Parse pnpm-workspace.yaml's `packages:` list without a YAML dependency.
// Handles the common `- 'glob'` / `- "glob"` / `- glob` item forms.
function parsePnpmWorkspaceGlobs(yaml: string): string[] {
  const out: string[] = []
  const lines = yaml.split(/\r?\n/)
  let inPackages = false
  for (const line of lines) {
    if (/^packages\s*:/.test(line)) { inPackages = true; continue }
    if (inPackages) {
      // A new top-level key ends the packages block.
      if (/^\S/.test(line) && !/^\s*-/.test(line)) break
      const m = line.match(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*(#.*)?$/)
      if (m) out.push(m[1].trim())
    }
  }
  return out
}

// Expand workspace globs against the tree by locating package.json files.
// Supports trailing '/*' (one level) and '/**' (any depth) plus literal paths.
function expandWorkspaceGlobs(globs: string[], tree: TreeEntry[]): string[] {
  const out = new Set<string>()
  for (const raw of globs) {
    const glob = raw.replace(/\/$/, '')
    if (glob.endsWith('/**')) {
      const prefix = glob.slice(0, -3)
      for (const e of tree) {
        if (e.type === 'blob' && e.path.startsWith(prefix + '/') && e.path.endsWith('/package.json')) {
          out.add(e.path.slice(0, -'/package.json'.length))
        }
      }
    } else if (glob.endsWith('/*')) {
      const prefix = glob.slice(0, -2)
      for (const e of tree) {
        if (e.type === 'blob' && e.path.startsWith(prefix + '/') && e.path.endsWith('/package.json')) {
          const rest = e.path.slice(prefix.length + 1)
          if (rest.split('/').length === 2) out.add(`${prefix}/${rest.split('/')[0]}`)
        }
      }
    } else {
      if (treeHasFile(tree, `${glob}/package.json`)) out.add(glob)
    }
  }
  return [...out]
}

// Framework classification from a parsed package.json + the tree (for app/pages
// dir probing), scoped to a workspace root. Returns the framework string only;
// hasWebApp / build-script checks are the caller's job.
function classifyFramework(pkg: any, wsRoot: string, tree: TreeEntry[]): Framework {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const hasDir = (p: string) => treeHasDir(tree, joinPath(wsRoot, p))

  if (deps['next']) {
    if (hasDir('app') || hasDir('src/app')) return 'nextjs-app'
    return 'nextjs-pages' // pages-router fallback; entry-point filter self-corrects
  }
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix'
  if (deps['astro']) return 'astro'
  if (deps['@sveltejs/kit']) return 'sveltekit'
  if (deps['nuxt'] || deps['nuxt3']) return 'nuxt'
  if (deps['vue'] && deps['vite']) return 'vue-vite'
  if (deps['react'] && deps['vite']) return 'vite-react'
  if (deps['react'] && deps['react-scripts']) return 'cra'

  // No JS framework dependency. A root index.html means a static/plain site.
  if (treeHasFile(tree, joinPath(wsRoot, 'index.html'))) return 'plain-html'
  return 'unsupported'
}

// Entry-point candidates per framework, relative to siteRoot. The src/* Next
// variants extend the prompt's literal list because classification already
// probes src/app — see RA1 product-decision flag. All candidates are filtered
// against the tree; non-existent ones drop out.
const ENTRY_CANDIDATES: Record<Framework, string[]> = {
  'vite-react':   ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'src/App.tsx', 'src/App.jsx'],
  'cra':          ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'src/App.tsx', 'src/App.jsx'],
  'nextjs-app':   ['app/page.tsx', 'app/page.jsx', 'app/layout.tsx', 'app/layout.jsx', 'src/app/page.tsx', 'src/app/page.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx'],
  'nextjs-pages': ['pages/index.tsx', 'pages/index.jsx', 'pages/_app.tsx', 'pages/_app.jsx', 'src/pages/index.tsx', 'src/pages/index.jsx', 'src/pages/_app.tsx', 'src/pages/_app.jsx'],
  'remix':        ['app/root.tsx', 'app/routes/_index.tsx', 'app/routes/index.tsx'],
  'astro':        ['src/pages/index.astro'],
  'sveltekit':    ['src/routes/+page.svelte', 'src/routes/+layout.svelte'],
  'vue-vite':     ['src/main.ts', 'src/main.js', 'src/App.vue'],
  'nuxt':         ['app.vue', 'pages/index.vue'],
  'plain-html':   ['index.html'],
  'unsupported':  [],
}

function resolveEntryPoints(framework: Framework, siteRoot: string, tree: TreeEntry[]): string[] {
  return (ENTRY_CANDIDATES[framework] || []).filter(rel => treeHasFile(tree, joinPath(siteRoot, rel)))
}

// Parse compilerOptions.baseUrl + paths from a tsconfig, resolving each target
// relative to siteRoot. Does NOT follow `extends` (flagged limitation).
function parseTsConfigPaths(tsconfigText: string, siteRoot: string): Record<string, string[]> {
  const cfg = parseJsonc(tsconfigText)
  const co = cfg?.compilerOptions
  if (!co || !co.paths) return {}
  const baseUrl: string = (co.baseUrl || '.').replace(/^\.?\//, '').replace(/^\.$/, '')
  const out: Record<string, string[]> = {}
  for (const [alias, targets] of Object.entries(co.paths as Record<string, string[]>)) {
    if (!Array.isArray(targets)) continue
    out[alias] = targets.map(t => {
      const withBase = baseUrl ? joinPath(baseUrl, t) : t.replace(/^\.?\//, '')
      // Keep relative to siteRoot (downstream RA2 also receives siteRoot).
      return withBase
    })
  }
  return out
}

function detectCssApproach(
  pkg: any, siteRoot: string, tree: TreeEntry[],
): { cssApproach: CssApproach; tailwindConfigPath: string | null } {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }

  const tailwindCandidates = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']
  const tailwindConfigPath = tailwindCandidates
    .map(c => joinPath(siteRoot, c))
    .find(p => treeHasFile(tree, p)) || null

  if (tailwindConfigPath) return { cssApproach: 'tailwind', tailwindConfigPath }

  const scopePrefix = siteRoot ? siteRoot.replace(/\/$/, '') + '/' : ''
  const hasModuleCss = tree.some(e =>
    e.type === 'blob' && e.path.endsWith('.module.css') &&
    (!scopePrefix || e.path.startsWith(scopePrefix)))
  if (hasModuleCss) return { cssApproach: 'css-modules', tailwindConfigPath: null }

  if (deps['styled-components']) return { cssApproach: 'styled-components', tailwindConfigPath: null }
  if (Object.keys(deps).some(d => d.startsWith('@emotion/'))) return { cssApproach: 'emotion', tailwindConfigPath: null }

  const anyCss = tree.some(e =>
    e.type === 'blob' && e.path.endsWith('.css') &&
    (!scopePrefix || e.path.startsWith(scopePrefix)))
  return { cssApproach: anyCss ? 'plain-css' : 'unknown', tailwindConfigPath: null }
}

function findGlobalStyles(siteRoot: string, tree: TreeEntry[]): string | null {
  const candidates = ['src/index.css', 'src/globals.css', 'app/globals.css', 'styles/globals.css']
  return candidates.map(c => joinPath(siteRoot, c)).find(p => treeHasFile(tree, p)) || null
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export async function discoverFrameworkAndStructure(
  octokit: any,
  owner: string,
  repo: string,
  defaultBranch: string,
): Promise<MapResult> {
  // One recursive tree read. GitHub truncates very large trees (>100k entries
  // or >7MB); when truncated, existence checks may miss files. We log it and
  // proceed — the downstream no-data / empty-repo gates remain the backstop.
  const { data: treeData } = await octokit.rest.git.getTree({
    owner, repo, tree_sha: defaultBranch, recursive: 'true',
  })
  const repoTree: TreeEntry[] = (treeData?.tree || []).map((e: any) => ({
    path: e.path, type: e.type, sha: e.sha, size: e.size,
  }))
  if (treeData?.truncated) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'repo_tree_truncated', owner, repo, entries: repoTree.length }))
  }

  const readText = async (path: string): Promise<string | null> => {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: defaultBranch })
      if (Array.isArray(data) || typeof (data as any)?.content !== 'string') return null
      return b64decode((data as any).content)
    } catch {
      return null
    }
  }

  const rootPkgText = treeHasFile(repoTree, 'package.json') ? await readText('package.json') : null
  const rootPkg = rootPkgText ? parseJsonc(rootPkgText) : null

  const empty = (reason: string): MapResult => ({
    framework: 'unsupported', isMonorepo: false, workspaces: [],
    selectedWorkspacePath: '', siteRoot: '', entryPoints: [], tsConfigPaths: {},
    cssApproach: 'unknown', tailwindConfigPath: null, globalStylesPath: null,
    unsupportedReason: reason, tsStrict: false, repoTree,
  })

  // ── Monorepo detection (first match wins) ───────────────────────────────────
  let workspacePaths: string[] = []
  let isMonorepo = false

  if (treeHasFile(repoTree, 'pnpm-workspace.yaml')) {
    const yaml = await readText('pnpm-workspace.yaml')
    if (yaml) {
      workspacePaths = expandWorkspaceGlobs(parsePnpmWorkspaceGlobs(yaml), repoTree)
      isMonorepo = workspacePaths.length > 0
    }
  }
  if (!isMonorepo && rootPkg?.workspaces) {
    const globs = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces.packages || [])
    workspacePaths = expandWorkspaceGlobs(globs, repoTree)
    isMonorepo = workspacePaths.length > 0
  }
  if (!isMonorepo && treeHasFile(repoTree, 'turbo.json')) {
    const globs = Array.isArray(rootPkg?.workspaces)
      ? rootPkg.workspaces
      : (rootPkg?.workspaces?.packages || [])
    workspacePaths = expandWorkspaceGlobs(globs, repoTree)
    isMonorepo = workspacePaths.length > 0
  }
  if (!isMonorepo && treeHasFile(repoTree, 'nx.json')) {
    const nx = parseJsonc((await readText('nx.json')) || '') || {}
    const layout = nx.workspaceLayout || {}
    const appsDir = layout.appsDir || 'apps'
    const libsDir = layout.libsDir || 'libs'
    workspacePaths = expandWorkspaceGlobs([`${appsDir}/*`, `${libsDir}/*`], repoTree)
    isMonorepo = workspacePaths.length > 0
  }

  // ── Single-project path ─────────────────────────────────────────────────────
  if (!isMonorepo) {
    const framework = classifyFramework(rootPkg, '', repoTree)
    if (framework === 'unsupported') {
      return empty('Could not detect a supported framework — no recognized framework dependency in package.json and no root index.html.')
    }
    return finalizeMap(framework, '', false, [], rootPkg, repoTree, readText)
  }

  // ── Monorepo path: classify every workspace ─────────────────────────────────
  const workspaces: Workspace[] = []
  for (const wsPath of workspacePaths) {
    const wsPkgText = await readText(joinPath(wsPath, 'package.json'))
    const wsPkg = wsPkgText ? parseJsonc(wsPkgText) : null
    const framework = classifyFramework(wsPkg, wsPath, repoTree)
    const hasBuild = Boolean(wsPkg?.scripts?.build)
    workspaces.push({
      path: wsPath,
      framework,
      hasWebApp: framework !== 'unsupported' && hasBuild,
      lastCommitDays: -1,
    })
  }

  const webApps = workspaces.filter(w => w.hasWebApp)
  if (webApps.length === 0) {
    return { ...empty('Monorepo detected, but no workspace contains a supported web app with a build script.'), isMonorepo: true, workspaces }
  }

  let selected: Workspace | null = null
  if (webApps.length === 1) {
    selected = webApps[0]
  } else {
    // Name priority first.
    const prefer = ['web', 'app', 'site', 'marketing', 'landing']
    for (const name of prefer) {
      const m = webApps.find(w => basename(w.path) === name)
      if (m) { selected = m; break }
    }
    // Recency tie-break: measure last commit for each web-app candidate.
    if (!selected) {
      for (const w of webApps) {
        try {
          const { data: commits } = await octokit.rest.repos.listCommits({ owner, repo, path: w.path, per_page: 1 })
          const when = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date
          w.lastCommitDays = when ? Math.floor((Date.now() - new Date(when).getTime()) / 86_400_000) : -1
        } catch {
          w.lastCommitDays = -1
        }
      }
      const measured = webApps.filter(w => w.lastCommitDays >= 0)
      if (measured.length > 0) {
        // Most recent = fewest days since last commit. NOTE: the prompt phrases
        // this as "highest lastCommitDays recency"; the honest, semantically
        // correct selection is the most-recently-committed workspace = LOWEST
        // days-ago. See RA1 product-decision flag.
        const sorted = [...measured].sort((a, b) => a.lastCommitDays - b.lastCommitDays)
        if (sorted.length === 1 || sorted[0].lastCommitDays !== sorted[1].lastCommitDays) {
          selected = sorted[0]
        }
      }
    }
  }

  if (!selected) {
    return { ...empty('Monorepo with multiple web apps — could not select one (no name match and recency was tied or unavailable).'), isMonorepo: true, workspaces }
  }

  const selectedPkgText = await readText(joinPath(selected.path, 'package.json'))
  const selectedPkg = selectedPkgText ? parseJsonc(selectedPkgText) : null
  return finalizeMap(selected.framework as Framework, selected.path, true, workspaces, selectedPkg, repoTree, readText)
}

// Shared tail: resolve entry points, TS aliases, CSS approach, global styles
// for the chosen site root, and assemble the final MapResult.
async function finalizeMap(
  framework: Framework,
  siteRoot: string,
  isMonorepo: boolean,
  workspaces: Workspace[],
  pkg: any,
  repoTree: TreeEntry[],
  readText: (path: string) => Promise<string | null>,
): Promise<MapResult> {
  const entryPoints = resolveEntryPoints(framework, siteRoot, repoTree)
  if (entryPoints.length === 0) {
    return {
      framework: 'unsupported', isMonorepo, workspaces,
      selectedWorkspacePath: siteRoot, siteRoot, entryPoints: [], tsConfigPaths: {},
      cssApproach: 'unknown', tailwindConfigPath: null, globalStylesPath: null,
      unsupportedReason: `no entry point found for detected framework (${framework})`,
      tsStrict: false, repoTree,
    }
  }

  let tsConfigPaths: Record<string, string[]> = {}
  let tsStrict = false
  const tsconfigPath = joinPath(siteRoot, 'tsconfig.json')
  if (treeHasFile(repoTree, tsconfigPath)) {
    const tsText = await readText(tsconfigPath)
    if (tsText) {
      tsConfigPaths = parseTsConfigPaths(tsText, siteRoot)
      // RA6: same tsconfig already in hand — read compilerOptions.strict here
      // so RA6 needs no extra GitHub read. `extends` is not followed (flagged).
      tsStrict = parseJsonc(tsText)?.compilerOptions?.strict === true
    }
  }

  const { cssApproach, tailwindConfigPath } = detectCssApproach(pkg, siteRoot, repoTree)
  const globalStylesPath = findGlobalStyles(siteRoot, repoTree)

  return {
    framework, isMonorepo, workspaces,
    selectedWorkspacePath: siteRoot, siteRoot, entryPoints, tsConfigPaths,
    cssApproach, tailwindConfigPath, globalStylesPath,
    unsupportedReason: null, tsStrict, repoTree,
  }
}

// ─── RA6: LINT / TYPE-STRICTNESS AWARENESS (detection only) ───────────────────
// Pure, repoTree-only — no extra GitHub call. We deliberately do NOT run ESLint
// or tsc here (a heavy bundle, and the honesty rule forbids faking validation);
// the receipt records detection + "verify your CI". tsStrict comes from the
// tsconfig RA1 already parsed.
const ESLINT_CONFIGS = [
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
]
export function detectLintInfo(mapResult: MapResult): LintInfo {
  const eslintPath = ESLINT_CONFIGS
    .map(c => joinPath(mapResult.siteRoot, c))
    .find(p => treeHasFile(mapResult.repoTree, p)) || null
  return { eslint: eslintPath !== null, eslintPath, tsStrict: mapResult.tsStrict }
}
