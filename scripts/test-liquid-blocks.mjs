// Unit test for the PURE Liquid block-tag validator (an edge-fn TS module).
// Node can't import .ts directly, so this bundles it with esbuild (ships with
// vite) into a temp file first. Run with:
//   node scripts/test-liquid-blocks.mjs
// Exits 0 if all assertions pass, 1 (with the failing cases) otherwise.

import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'liquid-validate-'))
const outFile = join(outDir, 'liquid-block-validate.mjs')
execSync(`npx esbuild supabase/functions/agent-run/liquid-block-validate.ts --bundle --format=esm --outfile="${outFile}" --log-level=error`, { stdio: 'inherit' })
const { validateLiquidBlocks } = await import(pathToFileURL(outFile).href)

let passed = 0
const failures = []
function ok(label, input) {
  const r = validateLiquidBlocks(input)
  if (r.ok === true) { passed++; return }
  failures.push(`${label}\n    expected ok, got: ${JSON.stringify(r)}`)
}
function bad(label, input, reasonPart) {
  const r = validateLiquidBlocks(input)
  if (r.ok === false && (!reasonPart || r.reason.includes(reasonPart))) { passed++; return }
  failures.push(`${label}\n    expected reason containing "${reasonPart}", got: ${JSON.stringify(r)}`)
}

// ── balanced blocks pass ─────────────────────────────────────────────────────
ok('plain HTML, no liquid', '<div class="x">hello</div>')
ok('simple if/endif', '{% if a %}x{% endif %}')
ok('nested blocks', '{% if a %}{% for i in c %}{{ i }}{% endfor %}{% endif %}')
ok('whitespace-control forms', '{%- if a -%}x{%- endif -%}')
ok('case/when', '{% case t %}{% when "a" %}x{% else %}y{% endcase %}')
ok('unless + capture + form', '{% unless a %}{% capture c %}x{% endcapture %}{% form "cart" %}f{% endform %}{% endunless %}')
ok('style block with CSS braces', '{% style %}.hero { color: {{ settings.c }}; }{% endstyle %}')
ok('unknown tags ignored', "{% render 'card' %}{% section 'hero' %}{% assign x = 1 %}{% echo x %}")
ok('inline comment tag ignored', '{% # just a note %}{% if a %}x{% endif %}')
ok('paginate/tablerow', '{% paginate c by 5 %}{% tablerow p in c %}{{ p }}{% endtablerow %}{% endpaginate %}')

// ── provable errors rejected ─────────────────────────────────────────────────
bad('dropped endif', '{% if a %}x', 'unclosed {% if %}')
bad('stray endif', 'x{% endif %}', 'no matching {% if %}')
bad('interleaved close', '{% if a %}{% for i in c %}{% endif %}{% endfor %}', 'expected {% endfor %}')
bad('dropped endfor in nest', '{% if a %}{% for i in c %}{% endif %}', 'expected {% endfor %}')
bad('unclosed raw', '{% raw %}{{ not liquid }}', 'unclosed {% raw %}')
bad('unclosed comment', '{% comment %}note', 'unclosed {% comment %}')
bad('unclosed schema', '{% schema %}{ "name": "x" }', 'unclosed {% schema %}')

// ── exclusion zones ──────────────────────────────────────────────────────────
ok('broken tags inside raw are inert', '{% raw %}{% endif %}{% if %}{% endraw %}')
ok('broken tags inside comment are inert', '{% comment %}{% endfor %}{% endcomment %}')
ok('endraw-lookalike text handled', '{% raw %}text{% endraw %}{% if a %}x{% endif %}')

// ── {% liquid %} opt-out ─────────────────────────────────────────────────────
ok('liquid tag opts the file out entirely', '{% liquid\n if a\n  echo "x"\n endif %}{% if b %}unclosed-would-fail')

// ── schema JSON ──────────────────────────────────────────────────────────────
ok('valid schema JSON', '{% schema %}\n{ "name": "Hero", "settings": [] }\n{% endschema %}')
bad('invalid schema JSON', '{% schema %}\n{ "name": "Hero", }\n{% endschema %}', 'invalid JSON in {% schema %}')
bad('truncated schema JSON', '{% schema %}\n{ "name": "He\n{% endschema %}', 'invalid JSON in {% schema %}')
ok('tag-like text inside schema hits JSON check, not the stack',
  '{% schema %}\n{ "note": "{% endif %} looks like a tag" }\n{% endschema %}')
ok('schema followed by real blocks', '{% schema %}{ "a": 1 }{% endschema %}{% if x %}y{% endif %}')

// ── section-file tags ────────────────────────────────────────────────────────
ok('stylesheet/javascript blocks', '{% stylesheet %}.a{}{% endstylesheet %}{% javascript %}const a={};{% endjavascript %}')

// ── report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`liquid-block tests: ${failures.length} FAILED, ${passed} passed\n`)
  for (const f of failures) console.error(`  ✕ ${f}\n`)
  process.exit(1)
}
console.log(`liquid-block tests: all ${passed} passed`)
