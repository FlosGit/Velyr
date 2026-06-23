// Offline bulk article generator. Reads the topic plan (content/blog-topics.json)
// and the system prompt (scripts/generation-prompt.txt), and for each DRAFT topic
// without an existing .md file, asks a strong model (via OpenRouter) to write the
// article, then saves content/blog/<slug>.md.
//
// SAFE BY DESIGN:
//   - Idempotent: skips any topic whose content/blog/<slug>.md already exists, so
//     re-running never overwrites or duplicates.
//   - Refuses to run against the placeholder prompt unless --force.
//   - --dry-run prints the plan and makes ZERO API calls.
//   - --limit N caps how many to generate in one run (review before scaling).
//   - --cluster <slug> restricts to one cluster.
//
// Generated drafts carry publishedAt: "PUBLISH_DATE"; they will not publish until
// scripts/assign-publish-dates.mjs stamps real dates. The build's quality gates
// (dedupe, HogQL-safe, parity) still scan them every build.
//
// Usage:
//   node scripts/generate-articles.mjs --dry-run
//   node scripts/generate-articles.mjs --limit 5 --cluster posthog-recipes
//   OPENROUTER_API_KEY=... node scripts/generate-articles.mjs --limit 10

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Minimal .env loader — Node scripts don't read .env automatically. Loads
// .env.local then .env, never clobbering a value already in the environment.
for (const name of ['.env.local', '.env']) {
  const p = join(ROOT, name)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].replace(/^['"]|['"]$/g, '')
    if (process.env[key] === undefined) process.env[key] = val
  }
}
const TOPICS = join(ROOT, 'content', 'blog-topics.json')
const BLOG_DIR = join(ROOT, 'content', 'blog')
const PROMPT_FILE = join(__dirname, 'generation-prompt.txt')

const MODEL = process.env.GEN_MODEL || 'anthropic/claude-sonnet-4.6' // strong; not haiku-class
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

function parseArgs(argv) {
  const args = { limit: Infinity, clusters: null, each: null, dryRun: false, force: false }
  const asList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--force') args.force = true
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice(8), 10)
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10)
    else if (a.startsWith('--cluster=')) args.clusters = asList(a.slice(10))
    else if (a === '--cluster') args.clusters = asList(argv[++i])
    else if (a.startsWith('--each=')) args.each = parseInt(a.slice(7), 10)
    else if (a === '--each') args.each = parseInt(argv[++i], 10)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

const topics = JSON.parse(readFileSync(TOPICS, 'utf8'))
const systemPrompt = readFileSync(PROMPT_FILE, 'utf8')
const isPlaceholder = systemPrompt.startsWith('PLACEHOLDER')

if (isPlaceholder && !args.force && !args.dryRun) {
  console.error('generate-articles: generation-prompt.txt is still the PLACEHOLDER.')
  console.error('Drop the final prompt in first, or pass --force to override (not recommended).')
  process.exit(1)
}

const existingSlugs = () =>
  existsSync(BLOG_DIR)
    ? readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    : []

let pending = topics.filter(
  (t) => t.status === 'draft' && (!args.clusters || args.clusters.includes(t.cluster))
)
const present = new Set(existingSlugs())
pending = pending.filter((t) => !present.has(t.slug))

// --each N with --cluster a,b,c → take the first N pending from EACH listed
// cluster (e.g. one sample per article type). Otherwise honour --limit.
let toMake
if (args.each && args.clusters) {
  toMake = []
  for (const c of args.clusters) toMake.push(...pending.filter((t) => t.cluster === c).slice(0, args.each))
} else {
  toMake = Number.isFinite(args.limit) ? pending.slice(0, args.limit) : pending
}

console.log(`generate-articles: model=${MODEL} clusters=${args.clusters ? args.clusters.join(',') : 'all'} ${args.each ? 'each=' + args.each : 'limit=' + args.limit}`)
console.log(`  ${topics.length} topics, ${present.size} already on disk, ${pending.length} pending → generating ${toMake.length}`)

if (args.dryRun) {
  for (const t of toMake) console.log(`  would generate [${t.cluster}] ${t.slug}`)
  console.log('generate-articles: dry run — no API calls made.')
  process.exit(0)
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error('generate-articles: OPENROUTER_API_KEY is not set.')
  process.exit(1)
}

function stripFences(s) {
  // The model is told to output only the .md; strip an accidental ```markdown wrapper.
  return s.replace(/^\s*```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim() + '\n'
}

async function generate(topic, knownSlugs) {
  const userMsg =
    `Target query (article title): ${topic.title}\n` +
    `Cluster: ${topic.cluster}\n` +
    `Use exactly this slug in the frontmatter: ${topic.slug}\n` +
    `Existing article slugs (choose related links ONLY from these): ${knownSlugs.join(', ')}\n\n` +
    `Output the .md file content now and nothing else.`

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://velyr.io',
      'X-Title': 'Velyr blog generation',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('empty completion')
  return stripFences(content)
}

let made = 0
const known = existingSlugs()
for (const topic of toMake) {
  const outPath = join(BLOG_DIR, `${topic.slug}.md`)
  if (existsSync(outPath)) { console.log(`  skip (exists) ${topic.slug}`); continue }
  try {
    const md = await generate(topic, known)
    writeFileSync(outPath, md, 'utf8')
    known.push(topic.slug) // later articles may link to this one
    made++
    console.log(`  ✓ [${topic.cluster}] ${topic.slug}`)
  } catch (err) {
    console.error(`  ✗ ${topic.slug}: ${err.message}`)
  }
}
console.log(`generate-articles: generated ${made} article(s). Review, then run the build + assign-publish-dates.`)
