// ─── EMAIL LIFECYCLE (Mailjet Send API v3.1) ─────────────────────────────────
// Template-only lifecycle emails — welcome / day-2 setup reminder / day-7 tips /
// weekly digest. NO LLM involvement anywhere: every mail is a fixed template
// filled from structured DB fields. Telegram remains the approval channel;
// email is the lifecycle/summary channel.
//
// Legal design (DE — see supabase/migrations/20260711_email_lifecycle.sql):
//   • Welcome + setup reminder ride on contract performance (Art. 6(1)(b)
//     GDPR); tips + digest ride on §7 Abs. 3 UWG (Bestandskunden, confirmed
//     for free-account signups by ECJ C-654/23). The four §7(3) duties are
//     implemented here: address collected at signup, own-service content only,
//     email_opt_out honored everywhere, objection notice at collection
//     (AgentAuth.jsx) and in EVERY mail (renderLayout footer).
//   • One-click unsubscribe: HMAC-signed link (+ RFC 8058 List-Unsubscribe
//     headers) → api/agent/run.js ?action=email_opt_out. No login required.
//   • Impressum block (§5 DDG Pflichtangaben) in every mail's footer.
//   • Open/click tracking is force-disabled per send (TDDDG — no consent).
//
// Idempotency: logAndSend() INSERTs the email_log claim first (unique on
// subscription_id + email_type + period_key; 23505 → already sent, skip),
// then sends, and deletes the claim on a failed send so the next daily cron
// retries. Two concurrent crons can never double-send.
//
// Vercel-only (crons + onboarding). The edge function never sends email, so
// there is deliberately NO Deno twin of this module.

import crypto from 'node:crypto'

const SITE_URL   = 'https://velyr.io'
const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'info@velyr.io'
const FROM_NAME  = 'Velyr'

// Keep in sync with the email_type CHECK in 20260711_email_lifecycle.sql.
export const EMAIL_TYPES = ['welcome', 'setup_reminder', 'tips', 'weekly_digest']

// All three must be present: the Mailjet pair to send at all, and the HMAC
// secret because a mail whose unsubscribe link can't be honored must never
// leave the building (§7(3) Nr. 4 UWG is not optional).
export function emailConfigured() {
  return Boolean(
    process.env.MAILJET_API_KEY &&
    process.env.MAILJET_SECRET_KEY &&
    process.env.AGENT_APPROVAL_TOKEN_SECRET
  )
}

// Local escape for values interpolated into email HTML (run titles come from
// LLM output via analysis_result). Same shape as the Telegram escapeHtml twins
// but NOT one of them — email HTML is a different sink with no cross-runtime
// counterpart, so no sync obligation.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Unsubscribe tokens ──────────────────────────────────────────────────────
// HMAC-SHA256 keyed with AGENT_APPROVAL_TOKEN_SECRET, domain-separated from the
// trial-fingerprint use of the same secret by the version prefix. Rotating the
// secret invalidates old links (a dead unsubscribe link is a legal problem —
// prefer rotating only with a re-send of active sequences, or not at all).
const OPTOUT_PREFIX = 'velyr_email_optout:v1:'

export function buildUnsubscribeToken(subscriptionId) {
  const secret = process.env.AGENT_APPROVAL_TOKEN_SECRET
  if (!secret) throw new Error('email: AGENT_APPROVAL_TOKEN_SECRET not configured')
  return crypto.createHmac('sha256', secret)
    .update(`${OPTOUT_PREFIX}${subscriptionId}`)
    .digest('hex')
}

export function verifyUnsubscribeToken(subscriptionId, token) {
  if (typeof subscriptionId !== 'string' || typeof token !== 'string') return false
  let expected
  try {
    expected = buildUnsubscribeToken(subscriptionId)
  } catch {
    return false
  }
  const a = Buffer.from(token, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function buildUnsubscribeUrl(subscriptionId) {
  return `${SITE_URL}/api/agent/run?action=email_opt_out&sub=${encodeURIComponent(subscriptionId)}&token=${buildUnsubscribeToken(subscriptionId)}`
}

// ISO-8601 week key ("2026-W28") — the weekly digest's period_key, so the
// unique claim allows exactly one digest per subscription per calendar week.
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7            // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)    // nearest Thursday decides the week's year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// ─── Layout ──────────────────────────────────────────────────────────────────
// Conservative single-column HTML (inline styles only — email clients strip
// <style>), brand palette from the site (#f7f4ef bg, #2a5c45 accent). The
// footer carries every per-mail legal obligation: Impressum data (§5 DDG),
// the objection notice, and the one-click unsubscribe link (§7(3) Nr. 4 UWG).
function renderLayout({ bodyHtml, unsubscribeUrl }) {
  return `<div style="background:#f7f4ef;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="text-align:center;padding-bottom:24px;">
      <span style="font-size:22px;letter-spacing:-0.01em;color:#1c1917;">Velyr</span>
    </div>
    <div style="background:#ffffff;border:1px solid rgba(28,25,23,0.08);border-radius:12px;padding:32px 28px;color:#1c1917;font-size:15px;line-height:1.7;">
      ${bodyHtml}
    </div>
    <div style="padding:24px 8px 0;font-size:12px;line-height:1.7;color:#a09890;text-align:center;">
      <p style="margin:0 0 10px;">You're receiving product emails about your Velyr account (onboarding help and your weekly agent summary). You can object to these emails at any time, free of charge —
        <a href="${unsubscribeUrl}" style="color:#2a5c45;">unsubscribe with one click</a> or email <a href="mailto:info@velyr.io" style="color:#2a5c45;">info@velyr.io</a>.</p>
      <p style="margin:0 0 10px;">Velyr &middot; Florian Rappold &middot; Maik&auml;ferstra&szlig;e 3f &middot; 85551 Kirchheim bei M&uuml;nchen, Germany &middot; <a href="mailto:info@velyr.io" style="color:#a09890;">info@velyr.io</a></p>
      <p style="margin:0;"><a href="${SITE_URL}/impressum" style="color:#a09890;">Imprint</a> &middot; <a href="${SITE_URL}/privacy" style="color:#a09890;">Privacy Policy</a></p>
    </div>
  </div>
</div>`
}

// Plain-text twin of the footer for the TextPart.
function textFooter(unsubscribeUrl) {
  return [
    '—',
    'You\'re receiving product emails about your Velyr account. Object anytime, free of charge:',
    `Unsubscribe: ${unsubscribeUrl}`,
    'Velyr · Florian Rappold · Maikäferstraße 3f · 85551 Kirchheim bei München, Germany · info@velyr.io',
    `Imprint: ${SITE_URL}/impressum · Privacy: ${SITE_URL}/privacy`,
  ].join('\n')
}

const CTA_STYLE = 'display:inline-block;background:#2a5c45;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;'
const H_STYLE   = 'margin:0 0 14px;font-size:21px;font-weight:normal;letter-spacing:-0.01em;color:#1c1917;'
const P_STYLE   = 'margin:0 0 14px;color:#44403c;'
const MUTED     = 'margin:0;color:#6b6460;font-size:13px;'

// ─── Templates (fixed copy — never LLM-generated) ───────────────────────────

export function welcomeEmail({ unsubscribeUrl }) {
  const onboardingUrl = `${SITE_URL}/agent/onboarding`
  const bodyHtml = `
      <h1 style="${H_STYLE}">Welcome to Velyr</h1>
      <p style="${P_STYLE}">Your account is ready. Here's how your Growth Agent starts working for you:</p>
      <p style="${P_STYLE}"><strong>1. Connect your site</strong> — link your GitHub repo or your Shopify store in the onboarding wizard.</p>
      <p style="${P_STYLE}"><strong>2. Link Telegram</strong> — every change the agent proposes waits for your explicit YES before anything ships.</p>
      <p style="${P_STYLE}"><strong>3. Lean back</strong> — each Monday the agent analyzes your site and proposes the single highest-impact conversion fix it can find, with a full receipt of what it inspected.</p>
      <p style="margin:22px 0 8px;"><a href="${onboardingUrl}" style="${CTA_STYLE}">Finish setup →</a></p>
      <p style="${MUTED}">Setup takes about 5 minutes. Nothing runs until you've connected a site.</p>`
  const text = [
    'Welcome to Velyr',
    '',
    'Your account is ready. Here\'s how your Growth Agent starts working for you:',
    '1. Connect your site — link your GitHub repo or your Shopify store in the onboarding wizard.',
    '2. Link Telegram — every change waits for your explicit YES before anything ships.',
    '3. Lean back — each Monday the agent proposes the single highest-impact conversion fix it can find.',
    '',
    `Finish setup: ${onboardingUrl}`,
    '',
    textFooter(unsubscribeUrl),
  ].join('\n')
  return {
    subject: 'Welcome to Velyr — your Growth Agent is almost ready',
    html: renderLayout({ bodyHtml, unsubscribeUrl }),
    text,
  }
}

export function setupReminderEmail({ unsubscribeUrl }) {
  const onboardingUrl = `${SITE_URL}/agent/onboarding`
  const bodyHtml = `
      <h1 style="${H_STYLE}">Your Growth Agent isn't running yet</h1>
      <p style="${P_STYLE}">You created your Velyr account, but the setup isn't finished — so the agent has nothing to work on. It only needs two things:</p>
      <p style="${P_STYLE}">• A connected site (GitHub repo or Shopify store)<br/>• Your Telegram, so you can approve or reject every proposed change</p>
      <p style="margin:22px 0 8px;"><a href="${onboardingUrl}" style="${CTA_STYLE}">Continue setup →</a></p>
      <p style="${MUTED}">It picks up exactly where you left off. Questions? Just reply to this email.</p>`
  const text = [
    'Your Growth Agent isn\'t running yet',
    '',
    'You created your Velyr account, but the setup isn\'t finished — so the agent has nothing to work on. It only needs two things:',
    '• A connected site (GitHub repo or Shopify store)',
    '• Your Telegram, so you can approve or reject every proposed change',
    '',
    `Continue setup: ${onboardingUrl}`,
    '',
    textFooter(unsubscribeUrl),
  ].join('\n')
  return {
    subject: 'Your Velyr setup isn\'t finished yet',
    html: renderLayout({ bodyHtml, unsubscribeUrl }),
    text,
  }
}

export function tipsEmail({ unsubscribeUrl }) {
  const dashboardUrl = `${SITE_URL}/agent/dashboard`
  const bodyHtml = `
      <h1 style="${H_STYLE}">Get more out of your Growth Agent</h1>
      <p style="${P_STYLE}">A week in — four features of your subscription that make the agent measurably better:</p>
      <p style="${P_STYLE}"><strong>Pin a focus page.</strong> In the dashboard's Funnel tab, "Fix in next run" points the next analysis at the page that worries you most.</p>
      <p style="${P_STYLE}"><strong>Set your conversion goal.</strong> Tell the agent what a conversion means on your site (Settings) — it measures every change against it.</p>
      <p style="${P_STYLE}"><strong>Track competitors.</strong> In Telegram, <code>competitor add &lt;url&gt;</code> keeps an eye on up to two competitor sites.</p>
      <p style="${P_STYLE}"><strong>Teach it your business.</strong> Reply <code>dna</code> in Telegram to see what the agent has learned — confirm or reject entries in the dashboard's DNA tab.</p>
      <p style="margin:22px 0 8px;"><a href="${dashboardUrl}" style="${CTA_STYLE}">Open dashboard →</a></p>`
  const text = [
    'Get more out of your Growth Agent',
    '',
    'A week in — four features of your subscription that make the agent measurably better:',
    '• Pin a focus page: the Funnel tab\'s "Fix in next run" points the next analysis at the page that worries you most.',
    '• Set your conversion goal in Settings — the agent measures every change against it.',
    '• Track competitors: in Telegram, "competitor add <url>" (up to two).',
    '• Teach it your business: reply "dna" in Telegram, confirm or reject learnings in the dashboard.',
    '',
    `Open dashboard: ${dashboardUrl}`,
    '',
    textFooter(unsubscribeUrl),
  ].join('\n')
  return {
    subject: 'Four ways to get more out of your Growth Agent',
    html: renderLayout({ bodyHtml, unsubscribeUrl }),
    text,
  }
}

// stats: { weekLabel, visitors, pageviews, trendText, bounceText, deployed,
//          rolledBack, rejected, pending, deployedTitles[], bestMetricLine,
//          mehLine } — all plain text, computed by handleWeeklySummary from
// the same structured data as the Telegram summary. Interpolated values are
// escaped here (deployedTitles originate from LLM analysis_result).
export function digestEmail(stats, { unsubscribeUrl }) {
  const dashboardUrl = `${SITE_URL}/agent/dashboard`
  const s = stats || {}
  const titles = (s.deployedTitles || []).slice(0, 5)
  const deployedList = titles.length
    ? `<p style="${P_STYLE}"><strong>Shipped this week:</strong><br/>${titles.map(t => `&#10003; ${escapeHtml(t)}`).join('<br/>')}</p>`
    : ''
  const metricLines = [s.bestMetricLine, s.mehLine].filter(Boolean)
    .map(l => `<p style="${P_STYLE}">${escapeHtml(l)}</p>`).join('')
  const bodyHtml = `
      <h1 style="${H_STYLE}">Your week with Velyr</h1>
      <p style="${MUTED}">Week of ${escapeHtml(s.weekLabel || '')}</p>
      <p style="${P_STYLE}"><strong>Traffic:</strong> ${s.visitors != null ? `${escapeHtml(String(s.visitors))} visitors &middot; ${escapeHtml(String(s.pageviews))} pageviews` : 'No data'}<br/>
      ${escapeHtml(s.trendText || '')}<br/>
      <strong>Bounce rate:</strong> ${escapeHtml(s.bounceText || '—')}</p>
      ${metricLines}
      <p style="${P_STYLE}"><strong>Agent activity:</strong><br/>
      Deployed: ${Number(s.deployed) || 0} &middot; Rolled back: ${Number(s.rolledBack) || 0} &middot; Rejected: ${Number(s.rejected) || 0} &middot; Awaiting approval: ${Number(s.pending) || 0}</p>
      ${deployedList}
      <p style="margin:22px 0 8px;"><a href="${dashboardUrl}" style="${CTA_STYLE}">View details →</a></p>
      <p style="${MUTED}">Next run: Monday. Approvals still happen in Telegram.</p>`
  const text = [
    'Your week with Velyr',
    `Week of ${s.weekLabel || ''}`,
    '',
    `Traffic: ${s.visitors != null ? `${s.visitors} visitors · ${s.pageviews} pageviews` : 'No data'}`,
    s.trendText || '',
    `Bounce rate: ${s.bounceText || '—'}`,
    ...(s.bestMetricLine ? [s.bestMetricLine] : []),
    ...(s.mehLine ? [s.mehLine] : []),
    '',
    `Agent activity: deployed ${Number(s.deployed) || 0} · rolled back ${Number(s.rolledBack) || 0} · rejected ${Number(s.rejected) || 0} · awaiting approval ${Number(s.pending) || 0}`,
    ...(titles.length ? ['Shipped this week:', ...titles.map(t => `✓ ${t}`)] : []),
    '',
    `View details: ${dashboardUrl}`,
    '',
    textFooter(unsubscribeUrl),
  ].join('\n')
  const deployed = Number(s.deployed) || 0
  return {
    subject: deployed > 0
      ? `Your week with Velyr — ${deployed} change${deployed !== 1 ? 's' : ''} shipped`
      : 'Your week with Velyr',
    html: renderLayout({ bodyHtml, unsubscribeUrl }),
    text,
  }
}

// ─── Send ────────────────────────────────────────────────────────────────────
// Mailjet Send API v3.1. Tracking is force-disabled (TDDDG: no consent for
// pixels). List-Unsubscribe + List-Unsubscribe-Post implement RFC 8058
// one-click unsubscribe on top of the visible footer link (the ?action=
// email_opt_out handler accepts GET and POST). Never throws.
export async function sendEmail({ to, subject, html, text, unsubscribeUrl }) {
  if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
    return { ok: false, reason: 'not_configured' }
  }
  const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString('base64')
  const message = {
    From: { Email: FROM_EMAIL, Name: FROM_NAME },
    To: [{ Email: to }],
    Subject: subject,
    HTMLPart: html,
    TextPart: text,
    TrackOpens: 'disabled',
    TrackClicks: 'disabled',
  }
  if (unsubscribeUrl) {
    message.Headers = {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }
  }
  try {
    const resp = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Messages: [message] }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.error(`[email] Mailjet send failed (${resp.status}):`, body.slice(0, 500))
      return { ok: false, reason: `http_${resp.status}` }
    }
    const data = await resp.json().catch(() => null)
    const status = data?.Messages?.[0]?.Status
    if (status !== 'success') {
      console.error('[email] Mailjet message not accepted:', JSON.stringify(data?.Messages?.[0]?.Errors || data).slice(0, 500))
      return { ok: false, reason: 'rejected' }
    }
    return { ok: true }
  } catch (err) {
    console.error('[email] Mailjet send error:', err?.message || String(err))
    return { ok: false, reason: 'network' }
  }
}

// ─── Idempotent send ─────────────────────────────────────────────────────────
// Claim first (unique constraint), send second, release the claim on failure so
// the next daily cron retries. `buildMail({ unsubscribeUrl })` is one of the
// template functions above (they need the per-subscription unsubscribe URL to
// render the footer, and only this function knows it). Returns { sent, reason? }.
// Never throws.
export async function logAndSend(supabase, { subscriptionId, to, emailType, periodKey = 'once', buildMail }) {
  if (!emailConfigured()) return { sent: false, reason: 'not_configured' }
  if (!to) return { sent: false, reason: 'no_address' }

  const { error: claimErr } = await supabase
    .from('email_log')
    .insert({ subscription_id: subscriptionId, email_type: emailType, period_key: periodKey })
  if (claimErr) {
    if (claimErr.code === '23505') return { sent: false, reason: 'already_sent' }
    console.error(`[email] claim insert failed (${emailType}, sub=${subscriptionId}):`, claimErr.message)
    return { sent: false, reason: 'claim_failed' }
  }

  const unsubscribeUrl = buildUnsubscribeUrl(subscriptionId)
  const mail = buildMail({ unsubscribeUrl })
  const result = await sendEmail({ ...mail, to, unsubscribeUrl })
  if (!result.ok) {
    // Release the claim so tomorrow's cron retries a transient provider failure.
    const { error: releaseErr } = await supabase
      .from('email_log')
      .delete()
      .match({ subscription_id: subscriptionId, email_type: emailType, period_key: periodKey })
    if (releaseErr) console.error(`[email] claim release failed (${emailType}, sub=${subscriptionId}):`, releaseErr.message)
    return { sent: false, reason: result.reason }
  }
  return { sent: true }
}
