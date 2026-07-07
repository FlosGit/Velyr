// ════════════════════════════════════════════════════════════════════════════
// C12: embeddable win badge + share card — pure SVG string builders.
//
// Consumed by api/agent/run.js (?action=win_badge / ?action=win_card, public,
// gated on agent_subscriptions.is_public like the public timeline). Pure and
// dependency-free so it unit-tests offline (win-card.test.mjs). Both render as
// self-contained SVG (own background) so they read correctly on any host page,
// light or dark — no external fonts, no scripts, no fetches (an SVG served for
// <img> embedding can't load any of those anyway).
//
// Every interpolated value passes through escapeXml — slugs/hosts/problem texts
// are customer-controlled. Numbers are coerced + clamped before formatting.
//
// Form: stat tile / hero number (not a chart) — one measured number + its delta.
// Palette: Velyr brand — green #2a5c45 surface / cream #f7f4ef ink on the badge
// (contrast ≈ 7.1:1), cream surface / ink #1c1917 text on the card. Values wear
// ink; green is surface/accent only.
// ════════════════════════════════════════════════════════════════════════════

export function escapeXml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const FONT = "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
const GREEN = '#2a5c45'
const GREEN_DEEP = '#234d3a'
const CREAM = '#f7f4ef'
const INK = '#1c1917'
const MUTED = '#6b6460'
const BORDER = '#e5e0d5'

// Clamp + format a percentage-point delta as a signed label, e.g. -7.2 → "−7.2pp".
// Improvement is a NEGATIVE bounce delta; callers pass value_after - value_before.
function fmtDeltaPp(deltaPp) {
  const n = Number(deltaPp)
  if (!Number.isFinite(n)) return null
  const abs = Math.min(Math.abs(n), 99).toFixed(1).replace(/\.0$/, '')
  return `${n <= 0 ? '−' : '+'}${abs}pp`
}

function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${Math.max(0, Math.min(100, n)).toFixed(1).replace(/\.0$/, '')}%`
}

// ── Badge (320×64): "Optimized weekly by Velyr — last win −Xpp bounce" ───────
// win: { deltaPp, scope } | null (no measured win yet → honest fallback line).
export function buildWinBadgeSvg({ siteHost, win }) {
  const delta = win ? fmtDeltaPp(win.deltaPp) : null
  const line2 = delta
    ? `Last measured win: ${delta} bounce${win.scope === 'route_scoped_bounce_rate' ? ' (affected pages)' : ''}`
    : 'Weekly conversion fixes, measured'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="64" viewBox="0 0 320 64" role="img" aria-label="${escapeXml(`Optimized weekly by Velyr. ${line2}`)}">
  <rect x="0.5" y="0.5" width="319" height="63" rx="14" fill="${GREEN}" stroke="${GREEN_DEEP}"/>
  <circle cx="30" cy="32" r="12" fill="${CREAM}" fill-opacity="0.14"/>
  <path d="M24 32 l4.5 4.5 L38 27" stroke="${CREAM}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="54" y="27" font-family="${FONT}" font-size="12" fill="${CREAM}" fill-opacity="0.78">Optimized weekly by <tspan font-weight="700" fill-opacity="1">Velyr</tspan></text>
  <text x="54" y="46" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${CREAM}">${escapeXml(line2)}</text>
</svg>`
}

// ── Share card (600×315, OG-ish ratio): before/after bounce + delta chip ─────
// data: { siteHost, problem, before, after, deltaPp, scope, measuredAt }
export function buildWinCardSvg({ siteHost, problem, before, after, deltaPp, scope, measuredAt }) {
  const delta = fmtDeltaPp(deltaPp)
  const scopeLabel = scope === 'route_scoped_bounce_rate' ? 'affected pages' : 'site-wide'
  const dateLabel = measuredAt ? String(measuredAt).slice(0, 10) : ''
  const problemLine = String(problem || '').length > 92 ? `${String(problem).slice(0, 89)}…` : String(problem || '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315" viewBox="0 0 600 315" role="img" aria-label="${escapeXml(`${siteHost}: bounce rate ${fmtPct(before)} before, ${fmtPct(after)} after, ${delta || 'unmeasured'}`)}">
  <rect x="0.5" y="0.5" width="599" height="314" rx="16" fill="${CREAM}" stroke="${BORDER}"/>
  <text x="36" y="44" font-family="${FONT}" font-size="14" font-weight="600" fill="${MUTED}">${escapeXml(siteHost || '')}</text>
  <text x="564" y="44" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="700" fill="${GREEN}">Velyr</text>
  ${problemLine ? `<text x="36" y="78" font-family="${FONT}" font-size="14" fill="${INK}" fill-opacity="0.85">${escapeXml(problemLine)}</text>` : ''}
  <text x="36" y="128" font-family="${FONT}" font-size="12" font-weight="600" letter-spacing="1.2" fill="${MUTED}">BOUNCE BEFORE</text>
  <text x="36" y="182" font-family="${FONT}" font-size="46" font-weight="800" fill="${INK}">${escapeXml(fmtPct(before))}</text>
  <path d="M232 164 h56 m0 0 l-9 -8 m9 8 l-9 8" stroke="${MUTED}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="330" y="128" font-family="${FONT}" font-size="12" font-weight="600" letter-spacing="1.2" fill="${MUTED}">BOUNCE AFTER</text>
  <text x="330" y="182" font-family="${FONT}" font-size="46" font-weight="800" fill="${INK}">${escapeXml(fmtPct(after))}</text>
  ${delta ? `<rect x="36" y="212" width="${44 + delta.length * 11}" height="36" rx="18" fill="${GREEN}"/>
  <text x="${36 + (44 + delta.length * 11) / 2}" y="236" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${CREAM}">${escapeXml(delta)} bounce</text>` : ''}
  <text x="36" y="286" font-family="${FONT}" font-size="12" fill="${MUTED}">Measured deploy±2d, ${escapeXml(scopeLabel)}${dateLabel ? ` · ${escapeXml(dateLabel)}` : ''} · correlation, not attribution</text>
  <text x="564" y="286" text-anchor="end" font-family="${FONT}" font-size="12" fill="${MUTED}">velyr.io</text>
</svg>`
}
