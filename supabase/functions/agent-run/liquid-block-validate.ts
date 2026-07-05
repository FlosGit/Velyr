// ─── LIQUID BLOCK-TAG PAIRING + {% schema %} JSON VALIDATION ─────────────────
//
// Second validation layer for .liquid theme writes, run AFTER
// liquidDelimitersBalanced (index.ts) has confirmed {{ }} / {% %} delimiters
// pair up — this module may assume every `{% ... %}` it finds is terminated.
//
// CONTRACT — conservative, provable-only. Liquid blocks cannot span files
// ({% render %} / {% include %} are isolated scopes), so within one file each
// of these IS a provable error, never a style call:
//   • an opened paired block ({% if %}, {% for %}, …) that never closes
//   • an {% endif %}/{% endfor %}/… with no matching open
//   • improper interleaving ({% if %}{% for %}{% endif %}{% endfor %})
//   • an unclosed {% raw %} or {% comment %}
//   • a {% schema %} body that is not valid JSON (Shopify rejects the file)
// Anything this scanner cannot reason about with certainty is let through:
//   • a file containing a {% liquid %} tag opts out of block checking entirely
//     (its multi-statement body can open/close blocks this tag-level scanner
//     cannot see) — delimiter checking still applied upstream
//   • unknown/app tag names are ignored, matching Liquid's extensibility
//   • bodies of raw / comment / schema are excluded from tag scanning
// This preserves the original design rule: false-rejecting a valid theme is
// worse than passing a rare broken one (the merchant still approves via YES).
//
// Pure, dependency-free (no Deno APIs) — unit-tested from Node via esbuild
// bundling: see scripts/test-liquid-blocks.mjs.

const PAIRED = new Set([
  'if', 'unless', 'for', 'case', 'capture', 'form', 'paginate',
  'tablerow', 'schema', 'style', 'stylesheet', 'javascript',
])

// {%- ... -%} inclusive; body non-greedy. Delimiter balance is pre-validated,
// so every open has a terminator and non-greedy matching cannot overrun.
const TAG_RE = /\{%-?([\s\S]*?)-?%\}/g

export function validateLiquidBlocks(content: string): { ok: true } | { ok: false; reason: string } {
  type Tag = { name: string; bodyEnd: number; tagStart: number }
  const tags: Tag[] = []
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(content)) !== null) {
    const name = (m[1].trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)/) || [])[1] || ''
    if (!name) continue                       // {% # inline comment %}, {% %} — ignore
    tags.push({ name: name.toLowerCase(), bodyEnd: m.index + m[0].length, tagStart: m.index })
  }

  // A {% liquid %} tag's body is a multi-statement program whose block opens/
  // closes are invisible at this tag level — opt the whole file out (provable-
  // only contract) rather than risk a false reject.
  if (tags.some(t => t.name === 'liquid')) return { ok: true }

  const stack: string[] = []
  let exclusion: 'raw' | 'comment' | 'schema' | null = null
  let schemaBodyStart = -1

  for (const t of tags) {
    if (exclusion) {
      // Inside raw/comment/schema only the matching end tag is significant.
      if (t.name === `end${exclusion}`) {
        if (exclusion === 'schema') {
          const body = content.slice(schemaBodyStart, t.tagStart)
          try {
            JSON.parse(body)
          } catch (err) {
            return { ok: false, reason: `invalid JSON in {% schema %}: ${(err as Error)?.message || String(err)}` }
          }
          // schema is also a PAIRED block — pop it now that it closed cleanly.
          stack.pop()
        }
        exclusion = null
      }
      continue
    }

    if (t.name === 'raw' || t.name === 'comment') {
      exclusion = t.name
      continue
    }

    if (PAIRED.has(t.name)) {
      stack.push(t.name)
      if (t.name === 'schema') { exclusion = 'schema'; schemaBodyStart = t.bodyEnd }
      continue
    }

    if (t.name.startsWith('end')) {
      const opens = t.name.slice(3)
      if (!PAIRED.has(opens)) continue        // end-tag of an unknown block — ignore
      if (stack.length === 0) {
        return { ok: false, reason: `{% ${t.name} %} with no matching {% ${opens} %}` }
      }
      const top = stack[stack.length - 1]
      if (top !== opens) {
        return { ok: false, reason: `expected {% end${top} %} to close {% ${top} %}, found {% ${t.name} %}` }
      }
      stack.pop()
    }
    // any other tag (render, include, assign, echo, section, when, else, …) — ignore
  }

  if (exclusion === 'raw' || exclusion === 'comment') {
    return { ok: false, reason: `unclosed {% ${exclusion} %} block` }
  }
  if (exclusion === 'schema') {
    return { ok: false, reason: 'unclosed {% schema %} block' }
  }
  if (stack.length > 0) {
    return { ok: false, reason: `unclosed {% ${stack[stack.length - 1]} %} block (missing {% end${stack[stack.length - 1]} %})` }
  }
  return { ok: true }
}
