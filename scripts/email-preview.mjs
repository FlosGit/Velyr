// ─── LIFECYCLE EMAIL PREVIEW / TEST-SEND HARNESS ─────────────────────────────
// Renders every template in api/_lib/email.js with sample data so the footer
// (Impressum block, objection notice, unsubscribe link) and layout can be
// eyeballed in a browser before anything ships. No LLM, no network in preview
// mode.
//
//   node scripts/email-preview.mjs                    → writes .email-preview/*.html
//   node scripts/email-preview.mjs --send you@x.com   → ALSO sends all 4 mails
//                                                       via Mailjet (real send!)
//
// Env comes from the shell or .env.local (simple KEY=VALUE parse, no dep).
// Preview mode works without any env — a placeholder HMAC secret is injected
// so buildUnsubscribeUrl can render; --send requires the real Mailjet keys.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Load .env.local without a dotenv dependency (values already in the shell win).
const envFile = path.join(repoRoot, '.env.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const sendTo = (() => {
  const i = process.argv.indexOf('--send')
  return i !== -1 ? process.argv[i + 1] : null
})()

// Preview must render without the production secret; a real --send against
// production data never happens here (the sample subscription id is fake, so
// the unsubscribe link in a test mail 403s — that is expected and fine).
if (!process.env.AGENT_APPROVAL_TOKEN_SECRET) {
  if (sendTo) console.warn('[email-preview] AGENT_APPROVAL_TOKEN_SECRET not set — using a placeholder (unsubscribe links in the test mail will 403)')
  process.env.AGENT_APPROVAL_TOKEN_SECRET = 'email-preview-placeholder-secret'
}

const { welcomeEmail, setupReminderEmail, tipsEmail, digestEmail, buildUnsubscribeUrl, sendEmail } =
  await import('../api/_lib/email.js')

const sampleSubId = '00000000-0000-4000-8000-000000000000'
const unsubscribeUrl = buildUnsubscribeUrl(sampleSubId)

const digestStats = {
  weekLabel: '13 July 2026',
  visitors: 412,
  pageviews: 1893,
  trendText: '+18% vs previous week',
  bounceText: '✅ 43%',
  deployed: 2, rolledBack: 0, rejected: 1, pending: 1,
  deployedTitles: [
    'CTA hidden below the fold on mobile',
    'Checkout trust <signals> missing near buy button', // deliberate <>: proves escaping
  ],
  bestMetricLine: '📉 Bounce rate dropped 7pp on the pages an agent change touched (correlation, not attribution)',
  mehLine: null,
}

const mails = {
  'welcome':        welcomeEmail({ unsubscribeUrl }),
  'setup-reminder': setupReminderEmail({ unsubscribeUrl }),
  'tips':           tipsEmail({ unsubscribeUrl }),
  'weekly-digest':  digestEmail(digestStats, { unsubscribeUrl }),
}

const outDir = path.join(repoRoot, '.email-preview')
mkdirSync(outDir, { recursive: true })
for (const [name, mail] of Object.entries(mails)) {
  const htmlPath = path.join(outDir, `${name}.html`)
  writeFileSync(htmlPath, mail.html, 'utf8')
  writeFileSync(path.join(outDir, `${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}`, 'utf8')
  console.log(`rendered ${path.relative(repoRoot, htmlPath)}  (subject: ${mail.subject})`)
}

if (sendTo) {
  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    console.error('[email-preview] --send requires MAILJET_API_KEY + MAILJET_SECRET_KEY (shell or .env.local)')
    process.exit(1)
  }
  for (const [name, mail] of Object.entries(mails)) {
    const r = await sendEmail({ ...mail, to: sendTo, subject: `[test:${name}] ${mail.subject}`, unsubscribeUrl })
    console.log(`send ${name} → ${sendTo}:`, r.ok ? 'ok' : `FAILED (${r.reason})`)
  }
}
