// Staged publish-date assignment. Implements the agreed rollout:
//   - First 50 drafts: 10/day over 5 days (days 0–4).
//   - Then a 5-day GAP (days 5–9) with nothing due — the Search Console checkpoint.
//   - Remaining drafts: resume 10/day, gapless, from day 10 onward.
//
// publishedAt is the publish gate (scripts/lib/blog.mjs renders only
// publishedAt <= today), so assigning dates IS scheduling. The daily GitHub Action
// rebuild (.github/workflows/blog-daily-publish.yml) then publishes each day's due batch.
//
// SAFE BY DESIGN: default is DRY-RUN (prints the plan, writes nothing). Pass
// --apply with --start=YYYY-MM-DD to stamp dates into existing drafts' frontmatter
// (only files that exist and currently carry publishedAt: "PUBLISH_DATE").
//
// Usage:
//   node scripts/assign-publish-dates.mjs --start=2026-06-15            (dry run)
//   node scripts/assign-publish-dates.mjs --start=2026-06-15 --apply    (writes)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const TOPICS = join(ROOT, 'content', 'blog-topics.json')
const BLOG_DIR = join(ROOT, 'content', 'blog')

const PER_DAY = 10
const FIRST_BATCH = 50      // first 50 over 5 days
const GAP_DAYS = 5          // then a 5-day checkpoint gap

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Day offset for the i-th (0-based) draft under the 50 / gap / rest rule.
export function dayOffset(i) {
  if (i < FIRST_BATCH) return Math.floor(i / PER_DAY)              // days 0..4
  const firstBatchDays = FIRST_BATCH / PER_DAY                      // 5
  return firstBatchDays + GAP_DAYS + Math.floor((i - FIRST_BATCH) / PER_DAY) // 10+
}

// slugs: ordered draft slugs. Returns [{ slug, date }].
export function planDates(slugs, startDate) {
  return slugs.map((slug, i) => ({ slug, date: addDays(startDate, dayOffset(i)) }))
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const startArg = argv.find((a) => a.startsWith('--start='))
const start = startArg ? startArg.slice(8) : new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
  console.error(`assign-publish-dates: invalid --start "${start}" (expected YYYY-MM-DD)`)
  process.exit(1)
}

const topics = JSON.parse(readFileSync(TOPICS, 'utf8'))
// Schedule ONLY the drafts that exist on disk (the generated wave), in list
// order — so the first 50 generated map to 10/day over 5 days. Topics not yet
// generated get no date; the gap/rest applies once a later wave lands on disk.
const onDisk = existsSync(BLOG_DIR)
  ? new Set(readdirSync(BLOG_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')))
  : new Set()
const draftSlugs = topics.filter((t) => t.status === 'draft' && onDisk.has(t.slug)).map((t) => t.slug)
const plan = planDates(draftSlugs, start)

// Summarise per-day.
const byDate = new Map()
for (const { date } of plan) byDate.set(date, (byDate.get(date) || 0) + 1)
const dates = [...byDate.keys()].sort()
const lastDue = dates[dates.length - 1]
const gapStart = addDays(start, FIRST_BATCH / PER_DAY)            // day 5
const gapEnd = addDays(start, FIRST_BATCH / PER_DAY + GAP_DAYS - 1) // day 9

console.log(`assign-publish-dates: ${draftSlugs.length} on-disk drafts, start ${start} (${apply ? 'APPLY' : 'DRY RUN'})`)
const batch1 = Math.min(draftSlugs.length, FIRST_BATCH)
console.log(`  Batch 1: ${start} → ${lastDue}  (${batch1} articles, 10/day)`)
if (draftSlugs.length > FIRST_BATCH) {
  console.log(`  GAP:     ${gapStart} → ${gapEnd}  (5-day Search Console checkpoint, 0 due)`)
  console.log(`  Resume:  ${addDays(start, 10)} → ${lastDue}  (${draftSlugs.length - FIRST_BATCH} articles, 10/day)`)
} else {
  console.log(`  GAP:     ${addDays(start, 5)} onward — no wave 2 on disk yet, so the checkpoint happens naturally.`)
}
console.log(`  Spans ${dates.length} publish days; last article due ${lastDue}.`)
console.log('  First/last few publish days:')
for (const d of [...dates.slice(0, 6), '…', ...dates.slice(-3)]) {
  if (d === '…') { console.log('     …'); continue }
  console.log(`     ${d}: ${byDate.get(d)} article(s)`)
}

if (!apply) {
  console.log('assign-publish-dates: dry run — no files changed. Re-run with --apply to write.')
  process.exit(0)
}

// APPLY: stamp publishedAt/updatedAt into existing drafts that still carry the placeholder.
let written = 0, missing = 0, already = 0
for (const { slug, date } of plan) {
  const p = join(BLOG_DIR, `${slug}.md`)
  if (!existsSync(p)) { missing++; continue }
  let md = readFileSync(p, 'utf8')
  if (!md.includes('"PUBLISH_DATE"')) { already++; continue }
  md = md
    .replace(/publishedAt:\s*"PUBLISH_DATE"/, `publishedAt: "${date}"`)
    .replace(/updatedAt:\s*"PUBLISH_DATE"/, `updatedAt: "${date}"`)
  writeFileSync(p, md, 'utf8')
  written++
}
console.log(`assign-publish-dates: stamped ${written} file(s); ${missing} not yet generated; ${already} already dated.`)
