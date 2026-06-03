// Build gate: every ```sql / ```hogql block in content/blog/*.md may only use
// functions and $-properties on the allowlist (scripts/lib/hogql-allowlist.mjs).
// Any other function call or $-property FAILS the build. This stops us shipping
// an invented HogQL function or a hallucinated $-property to readers.
//
// Wired into the build chain AFTER assert-blog-parity.mjs.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALLOWED_FUNCTIONS, ALLOWED_PROPERTIES, SQL_KEYWORDS } from './lib/hogql-allowlist.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = join(__dirname, '..', 'content', 'blog')

// ```sql or ```hogql fenced blocks (case-insensitive language tag).
const BLOCK_RE = /```(?:sql|hogql)\s*\n([\s\S]*?)```/gi
// identifier immediately or loosely before "(" — function-call candidate.
const FN_RE = /([A-Za-z_]\w*)\s*\(/g
// $-property / $-event token.
const PROP_RE = /\$[A-Za-z_]\w*/g

function stripStringsAndComments(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')        // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    // NOTE: we deliberately do NOT strip string literals, because allowed
    // $-event names appear inside them (event = '$pageview') and we want those
    // validated too. All such tokens are on the allowlist, so this is safe.
}

function checkBlock(sql, file, violations) {
  const cleaned = stripStringsAndComments(sql)

  let m
  FN_RE.lastIndex = 0
  while ((m = FN_RE.exec(cleaned)) !== null) {
    const name = m[1]
    if (SQL_KEYWORDS.has(name.toLowerCase())) continue // structural keyword
    if (ALLOWED_FUNCTIONS.has(name)) continue           // allowed (case-sensitive)
    violations.push(`${file}: disallowed function "${name}(...)"`)
  }

  PROP_RE.lastIndex = 0
  while ((m = PROP_RE.exec(cleaned)) !== null) {
    const prop = m[0]
    if (ALLOWED_PROPERTIES.has(prop)) continue
    violations.push(`${file}: disallowed $-property "${prop}"`)
  }
}

if (!existsSync(CONTENT_DIR)) {
  console.log('hogql-safe: no content/blog dir — nothing to check')
  process.exit(0)
}

const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))
const violations = []
let blocks = 0

for (const file of files) {
  const raw = readFileSync(join(CONTENT_DIR, file), 'utf8')
  let bm
  BLOCK_RE.lastIndex = 0
  while ((bm = BLOCK_RE.exec(raw)) !== null) {
    blocks++
    checkBlock(bm[1], file, violations)
  }
}

if (violations.length) {
  // De-duplicate identical messages for readability.
  const unique = [...new Set(violations)]
  console.error('hogql-safe: FAILED — disallowed tokens in HogQL/SQL blocks:')
  for (const v of unique) console.error('  ' + v)
  console.error(`\n${unique.length} violation(s). Allowlist: scripts/lib/hogql-allowlist.mjs`)
  process.exit(1)
}

console.log(`hogql-safe: OK — ${blocks} SQL/HogQL block(s) across ${files.length} file(s), all functions + $-properties on the allowlist`)
