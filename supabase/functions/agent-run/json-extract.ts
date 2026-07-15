// ─── LLM JSON EXTRACTION (shared, PURE) ──────────────────────────────────────
//
// Extracts the JSON object from an LLM reply. Used by every LLM-JSON caller
// (Pass 2 / fix_verify / find_repair in index.ts, Pass 1 in component-ranker.ts).
// Pure — no I/O, no Deno APIs — node-tested via scripts/test-json-extract.mjs.
//
// Layer 1 (fast path — exact legacy behavior): strip ONE leading/trailing
// markdown code fence and JSON.parse the remainder. The strip is deliberately
// edge-only: a global replace(/```json|```/g) once nuked fences INSIDE the JSON
// body (a code_change string containing a fence) and corrupted valid output.
//
// Layer 2 (prose rescue — incident 2026-07-15): Opus sometimes ignores the
// "JSON only" instruction and answers with a markdown analysis ("I'll analyze
// this material carefully… ## Honest assessment…"), with the JSON object buried
// mid-prose or absent entirely. We scan for balanced top-level {...} candidates
// (string/escape aware, so braces inside JSON strings don't derail the scan)
// and return the LARGEST candidate that parses to a plain object — the schema'd
// answer always dwarfs any small inline example the prose might quote. No
// object anywhere → null; the caller decides between retry and soft-fail.

const MAX_CANDIDATES = 200 // bound the scan on brace-heavy prose (quoted code)

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return null

  let cleaned = trimmed
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7).trim()
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3).trim()
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3).trim()
  const direct = tryParseObject(cleaned)
  if (direct) return direct

  let best: Record<string, unknown> | null = null
  let bestLen = -1
  let candidates = 0
  for (let i = trimmed.indexOf('{'); i !== -1 && candidates < MAX_CANDIDATES; i = trimmed.indexOf('{', i + 1)) {
    const end = scanBalancedObject(trimmed, i)
    if (end === -1) continue
    candidates++
    if (end - i + 1 <= bestLen) continue // can't beat the current best; skip the parse
    const parsed = tryParseObject(trimmed.slice(i, end + 1))
    if (parsed) { best = parsed; bestLen = end - i + 1 }
  }
  return best
}

function tryParseObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

// From an opening `{` at `start`, return the index of its matching `}` —
// tracking JSON string state so braces inside string values don't count —
// or -1 if the object never closes (truncated / not actually JSON).
function scanBalancedObject(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
