// HogQL safety allowlist. The blog ships runnable HogQL that readers paste into
// their own PostHog. assert-hogql-safe.mjs extracts every ```sql / ```hogql block
// and FAILS the build on any function call or $-property not listed here, so we
// can never publish an invented function or a hallucinated $-property.
//
// Source of truth: the allowlist from the article generation prompt. See the
// EXTENSIONS section for two real PostHog properties added beyond that list.

// Aggregations (ClickHouse/HogQL — case-sensitive).
export const AGGREGATIONS = new Set([
  'count', 'countIf', 'countDistinct', 'countDistinctIf',
  'sum', 'sumIf', 'avg', 'avgIf',
  'min', 'minIf', 'max', 'maxIf',
  'any', 'anyIf', 'uniq', 'uniqIf', 'uniqExact',
  'quantile', 'windowFunnel',
])

// Scalar functions / function-like keywords that appear as `name(`.
export const FUNCTIONS = new Set([
  'now', 'toStartOfWeek', 'toStartOfDay', 'toStartOfMonth', 'dateDiff',
  'round', 'if', 'multiIf', 'concat', 'toInt', 'toFloat', 'lower',
])

// Anything matched as `identifier(` that is one of these SQL structural keywords
// is ignored (it is syntax, not a function call). Compared case-insensitively.
export const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'group', 'by', 'order', 'having', 'as',
  'and', 'or', 'not', 'in', 'on', 'join', 'left', 'right', 'inner', 'outer',
  'full', 'union', 'all', 'distinct', 'case', 'when', 'then', 'else', 'end',
  'interval', 'limit', 'offset', 'asc', 'desc', 'over', 'partition',
  'between', 'like', 'is', 'null', 'exists', 'with', 'using', 'cross',
])

// Real PostHog $-properties/event-names the blog may reference.
const ALLOWED_PROPERTIES_BASE = [
  '$pageview', '$pageleave', '$autocapture',
  '$pathname', '$current_url', '$el_text',
  '$prev_pageview_max_scroll_percentage',
]

// ── EXTENSIONS (beyond the generation-prompt's initial list) ─────────────────
// These are REAL PostHog properties required by already-approved seed articles:
//   - $event_type   — on $autocapture events ('click', 'submit', …); used by
//                     track-cta-clicks-posthog + average-bounce-rate-developer-tools.
//   - $session_id   — session identifier; used by average-bounce-rate-developer-tools
//                     to group events into sessions.
//   - $referring_domain — referring site's domain (e.g. 'www.google.com'), a
//                     PostHog client-side default property; used by
//                     what-is-answer-engine-optimization-aeo to split AI-assistant
//                     referrals from classic search. Verified against
//                     https://posthog.com/docs/data/events (2026-07-31).
// Remove these lines to enforce the literal prompt list (the seeds above
// would then need rewriting). Flagged for review.
const ALLOWED_PROPERTIES_EXTENSIONS = [
  '$event_type',
  '$session_id',
  '$referring_domain',
]

export const ALLOWED_PROPERTIES = new Set([
  ...ALLOWED_PROPERTIES_BASE,
  ...ALLOWED_PROPERTIES_EXTENSIONS,
])

export const ALLOWED_FUNCTIONS = new Set([...AGGREGATIONS, ...FUNCTIONS])
