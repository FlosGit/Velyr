// Unit test for the PURE HTML shell validator (an edge-fn TS module, W3).
// Node can't import .ts directly, so this bundles it with esbuild (ships with
// vite) into a temp file first. Run with:
//   node scripts/test-html-validate.mjs
// Exits 0 if all assertions pass, 1 (with the failing cases) otherwise.

import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'html-validate-'))
const outFile = join(outDir, 'html-validate.mjs')
execSync(`npx esbuild supabase/functions/agent-run/html-validate.ts --bundle --format=esm --outfile="${outFile}" --log-level=error`, { stdio: 'inherit' })
const { validateHtmlShell, extractInlineScripts } = await import(pathToFileURL(outFile).href)

let passed = 0
const failures = []
function ok(label, input) {
  const r = validateHtmlShell(input)
  if (r.ok === true) { passed++; return }
  failures.push(`${label}\n    expected ok, got: ${JSON.stringify(r)}`)
}
function bad(label, input, reasonPart) {
  const r = validateHtmlShell(input)
  if (r.ok === false && (!reasonPart || r.reason.includes(reasonPart))) { passed++; return }
  failures.push(`${label}\n    expected reason containing "${reasonPart}", got: ${JSON.stringify(r)}`)
}
function scripts(label, input, expected) {
  const got = extractInlineScripts(input)
  if (JSON.stringify(got) === JSON.stringify(expected)) { passed++; return }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}, got: ${JSON.stringify(got)}`)
}

// ── realistic shells pass ────────────────────────────────────────────────────
ok('realistic vite shell',
  `<!doctype html><html><head><meta charset="utf-8"><title>x</title>
   <style>#a{color:red}</style>
   <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
   <script>var consent=null;try{consent=localStorage.getItem('velyr_consent')}catch(e){}</script>
   </head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`)
ok('comments containing script text are inert',
  `<head><!-- <script>broken(</script> --><script>var a=1;</script></head>`)
ok('balanced multiple script/style pairs',
  `<script>1</script><style>.a{}</style><script src="/x.js"></script><style>.b{}</style>`)
ok('empty file', '')
ok('stray close-comment is tolerated (conservative asymmetry)', 'text --> more text')
ok('script-tag lookalike without delimiter is not counted', '<div>describe scripting here: script, style</div>')

// ── provable breakage rejected ───────────────────────────────────────────────
bad('dropped </script>', '<script>var a=1;<div></div>', 'script')
bad('stray </script>', '<div></div></script>', 'script')
bad('dropped </style>', '<style>.a{color:red}', 'style')
bad('orphan open-comment', '<div></div><!-- broken', 'orphan')
bad('invalid JSON-LD', '<script type="application/ld+json">{"a":,}</script>', 'ld+json')
bad('truncated JSON-LD', '<script type="application/ld+json">{"a":"b"</script>', 'ld+json')

// ── extractInlineScripts ─────────────────────────────────────────────────────
scripts('plain inline script found', '<script>var a=1;</script>', [{ body: 'var a=1;', isModule: false }])
scripts('module inline script found', '<script type="module">import x from "y";</script>', [{ body: 'import x from "y";', isModule: true }])
scripts('src script excluded', '<script src="/x.js"></script>', [])
scripts('ld+json excluded', '<script type="application/ld+json">{"a":1}</script>', [])
scripts('commented-out script excluded', '<!-- <script>dead(</script> -->', [])
scripts('text/javascript type included', '<script type="text/javascript">f()</script>', [{ body: 'f()', isModule: false }])
scripts('mixed order preserved', '<script>a()</script><script src="/x.js"></script><script type="module">b()</script>',
  [{ body: 'a()', isModule: false }, { body: 'b()', isModule: true }])

// ── report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`html-validate tests: ${failures.length} FAILED, ${passed} passed\n`)
  for (const f of failures) console.error(`  ✕ ${f}\n`)
  process.exit(1)
}
console.log(`html-validate tests: all ${passed} passed`)
