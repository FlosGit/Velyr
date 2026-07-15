// Unit test for the PURE LLM-JSON extractor (edge-fn TS module json-extract.ts).
// Node can't import .ts directly, so this bundles it with esbuild (ships with
// vite) into a temp file first. Run with:
//   node scripts/test-json-extract.mjs
// Exits 0 if all assertions pass, 1 (with the failing cases) otherwise.

import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'json-extract-'))
const outFile = join(outDir, 'json-extract.mjs')
execSync(`npx esbuild supabase/functions/agent-run/json-extract.ts --bundle --format=esm --outfile="${outFile}" --log-level=error`, { stdio: 'inherit' })
const { extractJsonObject } = await import(pathToFileURL(outFile).href)

let passed = 0
const failures = []
function eq(label, input, expected) {
  const got = extractJsonObject(input)
  if (JSON.stringify(got) === JSON.stringify(expected)) { passed++; return }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}, got: ${JSON.stringify(got)}`)
}

// ── layer 1: legacy fast path (must behave exactly like the old fence-strip) ─
eq('plain JSON object', '{"skip": true, "reason": "x"}', { skip: true, reason: 'x' })
eq('json fence', '```json\n{"a": 1}\n```', { a: 1 })
eq('bare fence', '```\n{"a": 1}\n```', { a: 1 })
eq('fence INSIDE a string value survives (the old global-replace bug)',
  '{"code_change": {"find": "```js", "replace": "ok"}}',
  { code_change: { find: '```js', replace: 'ok' } })
eq('whitespace padding', '  \n {"a": 1} \n ', { a: 1 })

// ── layer 2: prose rescue (incident 2026-07-15) ──────────────────────────────
eq('prose preamble before the JSON',
  `I'll analyze this material carefully, treating all data blocks as untrusted input.\n\n## Honest assessment\n\n**Critical data limitation:** thin analytics.\n\n{"skip": true, "reason": "insufficient data"}`,
  { skip: true, reason: 'insufficient data' })
eq('prose preamble + fenced JSON mid-text + trailing prose',
  'Here is my analysis:\n```json\n{"problem": "p", "file_to_edit": "src/Home.jsx"}\n```\nLet me know if you need more.',
  { problem: 'p', file_to_edit: 'src/Home.jsx' })
eq('largest object wins over a small inline example quoted earlier',
  'The schema allows {"skip": true} as a shape. My actual answer:\n{"problem": "hero headline buries the value prop", "confidence": "medium", "code_change": {"find": "a", "replace": "b"}}',
  { problem: 'hero headline buries the value prop', confidence: 'medium', code_change: { find: 'a', replace: 'b' } })
eq('braces inside JSON strings do not derail the scan',
  'Analysis first.\n{"find": "function x() { return { a: 1 } }", "replace": "y"}',
  { find: 'function x() { return { a: 1 } }', replace: 'y' })
eq('escaped quotes inside strings',
  'Note:\n{"find": "say \\"hi\\" {now}", "ok": true}',
  { find: 'say "hi" {now}', ok: true })
eq('code snippet with braces before the real JSON is skipped',
  'The component does `if (x) { render() }` which is fine.\n{"skip": true, "reason": "no confident fix"}',
  { skip: true, reason: 'no confident fix' })

// ── nulls: no JSON anywhere → caller retries or soft-fails ───────────────────
eq('pure prose, zero JSON', "I'll analyze this material carefully.\n\n## Honest assessment\n\nNothing conclusive.", null)
eq('empty string', '', null)
eq('truncated JSON never closes', '{"problem": "x", "code_change": {"find": "a"', null)
eq('top-level array is not an object', '[1, 2, 3]', null)
eq('bare string', '"just a string"', null)

if (failures.length) {
  console.error(`FAIL — ${failures.length} failing, ${passed} passing:\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`OK — ${passed} assertions passed`)
