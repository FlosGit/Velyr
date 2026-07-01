// Standalone unit test for the PURE PostHog self-heal decision. No framework, no live
// Shopify. Sibling of shopify-rollback.test.mjs; imports the SINGLE source module the
// Deno edge fn also uses. Run with:
//   node api/_lib/posthog-inject.test.mjs
// Exits 0 if all assertions pass, 1 (with the failing case) otherwise.

import { decidePostHogInjection, buildMarkerBlock } from '../../supabase/functions/agent-run/posthog-inject.mjs'

const OPEN = '<!-- Velyr Analytics -->'
const CLOSE = '<!-- /Velyr Analytics -->'
const TOKEN = 'phc_TESTtoken123'
const markers = { open: OPEN, close: CLOSE }

// The "expected" block for the current token/host.
const inner = `<script>\nposthog.init('${TOKEN}',{});posthog.register({$host:'shop.com'});\n</script>`
const expectedBlock = buildMarkerBlock(OPEN, CLOSE, inner)

const layout = (middle) => `<!doctype html><html><head><title>x</title>${middle}</head><body>{{content_for_layout}}</body></html>`

let passed = 0
const failures = []
function assert(label, cond, detail) {
  if (cond) { passed++; return }
  failures.push(`${label}${detail ? ' — ' + detail : ''}`)
}
function eq(label, a, b) { assert(label, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

// (i) markers absent → inject a fresh block before </head>.
{
  const d = decidePostHogInjection(layout(''), expectedBlock, markers, TOKEN)
  eq('(i) absent → inject', d.action, 'inject')
  assert('(i) newContent contains the block', d.newContent.includes(expectedBlock))
  assert('(i) block is before </head>', d.newContent.indexOf(expectedBlock) < d.newContent.indexOf('</head>'))
}

// (ii) markers present + correct loader → skip (installed). Also tolerant of a benign
// line-ending/indent renormalization by Shopify.
{
  const d = decidePostHogInjection(layout(expectedBlock), expectedBlock, markers, TOKEN)
  eq('(ii) correct → skip', d.action, 'skip')

  const renormed = expectedBlock.replace(/\n/g, '\r\n').replace('<script>', '  <script>')
  const d2 = decidePostHogInjection(layout(renormed), expectedBlock, markers, TOKEN)
  eq('(ii) ws-renormalized correct → skip', d2.action, 'skip')
}

// (iii) markers present + altered/broken loader body → reinject (replace in place),
// exactly one block, and it is the corrected one.
{
  const broken = buildMarkerBlock(OPEN, CLOSE, `<script>\nposthog.init('OLD_WRONG_TOKEN',{}); /* merchant broke this */\n</script>`)
  const d = decidePostHogInjection(layout(broken), expectedBlock, markers, TOKEN)
  eq('(iii) altered → reinject', d.action, 'reinject')
  assert('(iii) corrected block present', d.newContent.includes(expectedBlock))
  assert('(iii) broken token gone', !d.newContent.includes('OLD_WRONG_TOKEN'))
  const count = d.newContent.split(OPEN).length - 1
  eq('(iii) exactly one marker block (no double-inject)', count, 1)
}

// (iv) no markers but a bare loader with our token already present → skip (no double-init).
{
  const d = decidePostHogInjection(layout(`<script>posthog.init('${TOKEN}',{});</script>`), expectedBlock, markers, TOKEN)
  eq('(iv) bare token present → skip', d.action, 'skip')
}

// (v) no markers AND no </head>/</body> anchor → no_anchor (skip setup safely).
{
  const d = decidePostHogInjection('{% section "main" %}', expectedBlock, markers, TOKEN)
  eq('(v) no anchor → no_anchor', d.action, 'no_anchor')
}

if (failures.length) {
  console.error(`\n❌ ${failures.length} assertion(s) FAILED (${passed} passed):\n`)
  for (const f of failures) console.error('  • ' + f)
  process.exit(1)
}
console.log(`✅ posthog-inject: all ${passed} assertions passed`)
