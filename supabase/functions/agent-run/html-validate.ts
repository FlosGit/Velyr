// ─── W3: PROVABLE-ONLY HTML SHELL VALIDATION (2026-07-14) ────────────────────
// Conservative validation for the editable root index.html — same philosophy
// as liquid-block-validate.ts: flag ONLY provable breakage, never style.
// General tag balancing is deliberately NOT attempted (HTML5 optional and void
// elements make it unprovable without a real parser — a false-rejection
// machine). Also deliberately skipped: attribute quoting, duplicate ids,
// head/body presence. The caller (validateHtmlEdit in index.ts) applies these
// checks COMPARATIVELY — only a regression the edit introduced rejects; a
// pre-existing quirk is tolerated with a warn.
//
// Pure + dependency-free by contract, so scripts/test-html-validate.mjs can
// bundle this module with esbuild and run the matrix in Node (there is no
// local Deno toolchain — the edge fn type-checks only at deploy).

export type HtmlShellResult = { ok: true } | { ok: false; reason: string }

export interface InlineScript { body: string; isModule: boolean }

// Strip complete HTML comments. A REMAINING '<!--' after stripping is an
// orphan open-comment that swallows everything behind it. A stray '-->' is
// NOT flagged — it renders as harmless text (conservative asymmetry, the
// Liquid-delimiter rule's spirit). Working on stripped text also keeps
// commented-out <script> blocks from being counted or parsed.
function stripComments(html: string): { stripped: string; orphanOpen: boolean } {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '')
  return { stripped, orphanOpen: stripped.includes('<!--') }
}

function countTag(stripped: string, tag: string): { open: number; close: number } {
  const open = (stripped.match(new RegExp(`<${tag}(?=[\\s>/])`, 'gi')) || []).length
  const close = (stripped.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length
  return { open, close }
}

// Provable shell checks: orphan open-comment, <script>/<style> open/close
// count balance, and every <script type="application/ld+json"> body still
// parsing as JSON (broken structured data silently kills rich results).
// Either direction of a count mismatch is provable breakage in real HTML
// parsing (the parser stays in script-data state until the close tag).
export function validateHtmlShell(html: string): HtmlShellResult {
  const { stripped, orphanOpen } = stripComments(html)
  if (orphanOpen) return { ok: false, reason: 'orphan "<!--" opens a comment that never closes' }
  for (const tag of ['script', 'style']) {
    const { open, close } = countTag(stripped, tag)
    if (open !== close) return { ok: false, reason: `<${tag}> open/close mismatch (${open} open vs ${close} close)` }
  }
  const ldRe = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi
  let m: RegExpExecArray | null
  while ((m = ldRe.exec(stripped))) {
    try { JSON.parse(m[1]) } catch { return { ok: false, reason: 'a <script type="application/ld+json"> block no longer parses as JSON' } }
  }
  return { ok: true }
}

// Every inline <script> body that holds executable JS: src= scripts are
// skipped (no body to check) and non-JS types (application/ld+json etc.) are
// skipped — the JSON-LD check lives in validateHtmlShell. Extraction runs on
// comment-stripped text so a commented-out (often deliberately broken)
// script block is never parsed; the caller compensates by only judging bodies
// the edit actually touched.
export function extractInlineScripts(html: string): InlineScript[] {
  const { stripped } = stripComments(html)
  const out: InlineScript[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    const attrs = m[1] || ''
    const body = m[2] || ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)
    const type = (typeMatch?.[1] || '').toLowerCase()
    if (type && type !== 'module' && !/javascript|ecmascript/.test(type)) continue
    out.push({ body, isModule: type === 'module' })
  }
  return out
}
