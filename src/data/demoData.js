// Hardcoded demo dataset for the agent dashboard.
// Activated via /agent?demo=true — used for product video recordings.
// Shape mirrors the Supabase rows the dashboard fetches (agent_runs,
// agent_subscriptions, agent_funnel_pages, agent_learnings, impact_metrics).
//
// Context: a generic SaaS/app site (React/Next/Vite on Vercel) — NOT an
// e-commerce store. Fixes are conversion-flavored but app-realistic (hero CTA,
// pricing comparison, signup form length, onboarding, docs, perf).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Anchor at the most recent Monday relative to "now". This keeps "This week",
// "Last week" labels accurate whenever the video is recorded.
function lastMonday(now = new Date()) {
  const d = new Date(now)
  d.setHours(9, 12, 0, 0)
  const day = d.getDay() // 0 = Sun, 1 = Mon …
  const back = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - back)
  return d
}

const ANCHOR = lastMonday()

function isoWeeksAgo(n, hourOffset = 0, minuteOffset = 0) {
  const d = new Date(ANCHOR.getTime() - n * WEEK_MS)
  d.setHours(9 + hourOffset, 12 + minuteOffset, 0, 0)
  return d.toISOString()
}

// ── Subscription ──────────────────────────────────────────────────────────────
export const demoSubscription = {
  id: 'demo-subscription',
  auth_user_id: 'demo-user',
  status: 'active',
  plan: 'Growth',
  site_url: 'https://taskloop.app',
  github_repo: 'taskloop/web',
  is_public: true,
  public_slug: 'taskloop',
  telegram_chat_id: '1234567',
  competitors: ['https://competitor-a.com', 'https://competitor-b.com'],
  created_at: isoWeeksAgo(10),
}

// ── Runs ──────────────────────────────────────────────────────────────────────
// 10 weekly runs. 7 deployed (merged), 2 rejected (skipped by user),
// 1 rolled_back (auto-rollback after bounce-rate regression).
// week 0 = most recent Monday … week 9 = oldest.
const RUN_TEMPLATES = [
  {
    weeks: 0,
    status: 'deployed',
    pr_number: 247,
    problem: 'Signup form asks for 8 fields including optional ones',
    data_insight: 'PostHog form analytics showed 36% drop-off on the signup step, with users abandoning specifically at "company name" and "team size".',
    impact: 'Roughly 90 sign-ups/week lost to form friction.',
    solution: 'Cut the form to email + password, moved company/team-size to a post-signup optional step.',
    expected_improvement: '+0.4pp signup CVR',
    file_to_edit: 'src/components/Auth/SignupForm.jsx',
    confidence_score: 91,
    bounce_before: 43, bounce_after: 41,
    metric_label: 'Bounce −2pp',
  },
  {
    weeks: 1,
    status: 'deployed',
    pr_number: 241,
    problem: 'Onboarding step 2 has no progress indicator',
    data_insight: 'Session replays showed users abandoning at onboarding step 2 — with no progress bar, 31% assumed the flow was longer than it is.',
    impact: 'Activation rate stuck ~4pp below benchmark.',
    solution: 'Added a 3-step progress indicator and a "2 of 3" label to each onboarding screen.',
    expected_improvement: '+0.3pp activation',
    file_to_edit: 'src/components/Onboarding/Onboarding.jsx',
    confidence_score: 87,
    bounce_before: 45, bounce_after: 42,
    metric_label: 'Bounce −3pp',
  },
  {
    weeks: 2,
    status: 'rejected',
    pr_number: 235,
    problem: 'Pricing page has no plan comparison table',
    data_insight: 'Users on /pricing spent 24s on average vs 1m08s on competitor pricing pages with side-by-side comparison tables.',
    impact: 'Likely contributing to 64% pricing-page bounce.',
    solution: 'Added a 3-column plan comparison table with feature checkmarks and a "most popular" highlight.',
    expected_improvement: '+0.2pp CVR',
    file_to_edit: 'src/pages/Pricing.tsx',
    confidence_score: 72,
    skip_reason: 'Wanted to keep the simple plan cards — testing headline copy first.',
  },
  {
    weeks: 3,
    status: 'deployed',
    pr_number: 228,
    problem: 'Hero LCP image 1.2MB, loaded synchronously — LCP 3.6s',
    data_insight: 'Lighthouse + real-user metrics show the LCP element is the hero illustration. Mobile users on 4G see 3.6s LCP, well past the 2.5s "good" threshold.',
    impact: 'Every 100ms of LCP costs ~1% in conversion. Estimated 5% signup loss.',
    solution: 'Compressed the hero illustration to AVIF (190KB), added a preload hint, and switched to a responsive srcset.',
    expected_improvement: 'LCP 3.6s → 2.0s',
    file_to_edit: 'src/components/Hero/Hero.tsx',
    confidence_score: 96,
    bounce_before: 49, bounce_after: 45,
    metric_label: 'Bounce −4pp',
  },
  {
    weeks: 4,
    status: 'deployed',
    pr_number: 219,
    problem: 'Feature grid lacks social proof',
    data_insight: 'Heatmaps show users scroll past the feature grid looking for trust signals — 39% scroll to the testimonials section before any CTA interaction.',
    impact: 'Cold visitors lack a reason to trust the product on first impression.',
    solution: 'Added a thin social-proof strip below the feature grid: "Trusted by 3,200+ teams · ★ 4.8 on G2 · Featured on Product Hunt".',
    expected_improvement: '+0.25pp CVR',
    file_to_edit: 'src/components/Features/FeatureGrid.jsx',
    confidence_score: 84,
    bounce_before: 52, bounce_after: 49,
    metric_label: 'Bounce −3pp',
  },
  {
    weeks: 5,
    status: 'rolled_back',
    pr_number: 211,
    problem: 'Hero CTA copy is generic ("Get Started")',
    data_insight: 'CTA click-through on the hero was 2.1% — benchmark is 3.4% for outcome-focused copy.',
    impact: 'Roughly 1.3pp CTR delta translates to ~80 lost weekly sessions.',
    solution: 'Changed "Get Started" to "Start automating in 2 minutes →" with arrow-on-hover.',
    expected_improvement: '+0.3pp CVR',
    file_to_edit: 'src/components/Hero/Hero.tsx',
    confidence_score: 78,
    bounce_before: 54, bounce_after: 58,
    metric_label: 'Bounce +4pp · rolled back',
    rollback_note: 'Bounce rate rose 4pp 48h after deploy — rolled back per guardrail.',
  },
  {
    weeks: 6,
    status: 'deployed',
    pr_number: 203,
    problem: 'Documentation search hidden behind a hover menu',
    data_insight: 'On /docs, 8% of sessions opened the hover-only nav before bouncing — search was never discoverable on mobile per session replays.',
    impact: 'Friction in the primary self-serve support surface.',
    solution: 'Promoted docs search to a persistent top-bar input on all breakpoints, with a "/" keyboard shortcut.',
    expected_improvement: '+0.15pp CVR',
    file_to_edit: 'src/components/Docs/DocsSearch.tsx',
    confidence_score: 82,
    bounce_before: 55, bounce_after: 53,
    metric_label: 'Bounce −2pp',
  },
  {
    weeks: 7,
    status: 'deployed',
    pr_number: 196,
    problem: 'Feature screenshots not lazy-loaded — 2.1MB initial payload',
    data_insight: 'Network panel shows 14 feature screenshots loaded eagerly on /features, blocking TTI by ~850ms on mobile.',
    impact: 'Slow time-to-interactive correlates with the highest bounce segment.',
    solution: 'Added loading="lazy" + an intersection-observer fallback. Reduced initial payload by 1.7MB.',
    expected_improvement: 'LCP −0.6s',
    file_to_edit: 'src/components/Features/FeatureShot.tsx',
    confidence_score: 94,
    bounce_before: 56, bounce_after: 55,
    metric_label: 'Bounce −1pp',
  },
  {
    weeks: 8,
    status: 'rejected',
    pr_number: 188,
    problem: 'Contact form has no reason to convert',
    data_insight: 'Contact-form conversion is 0.5% — median for SaaS with a clear value prop is 3.0%.',
    impact: 'Inbound demo requests have stagnated for 6 weeks.',
    solution: 'Added a "Book a 15-min demo — see it on your own data" headline above the form and trimmed it to 3 fields.',
    expected_improvement: '+12 demos/mo',
    file_to_edit: 'src/components/Contact/ContactForm.jsx',
    confidence_score: 69,
    skip_reason: 'Sales wants to keep qualifying fields — testing the headline alone first.',
  },
  {
    weeks: 9,
    status: 'deployed',
    pr_number: 179,
    problem: 'Pricing card CTA buried below the fold on mobile',
    data_insight: 'On /pricing, 41% of mobile sessions never reached the "Start free trial" button — it sat below a long feature list.',
    impact: 'Trial-start friction at the moment of intent.',
    solution: 'Moved the primary CTA above the feature list on mobile and added a sticky "Start free trial" bar.',
    expected_improvement: '+0.4pp CVR',
    file_to_edit: 'src/components/Pricing/PricingCard.jsx',
    confidence_score: 89,
    bounce_before: 59, bounce_after: 56,
    metric_label: 'Bounce −3pp',
  },
]

export const demoRuns = RUN_TEMPLATES.map((t, idx) => {
  const created = isoWeeksAgo(t.weeks)
  const completed = isoWeeksAgo(t.weeks, 0, 18)
  const hasBounce = t.bounce_before != null && t.bounce_after != null
  return {
    id: `demo-run-${idx + 1}`,
    subscription_id: 'demo-subscription',
    status: t.status,
    pr_number: t.pr_number,
    pr_url: `https://github.com/taskloop/web/pull/${t.pr_number}`,
    current_step: 'sending_notification',
    created_at: created,
    completed_at: completed,
    bounce_rate_before: hasBounce ? t.bounce_before : null,
    bounce_rate_after: hasBounce ? t.bounce_after : null,
    ab_test_variants: null,
    competitor_changes: null,
    analysis_result: {
      problem: t.problem,
      data_insight: t.data_insight,
      impact: t.impact,
      solution: t.solution,
      expected_improvement: t.expected_improvement,
      file_to_edit: t.file_to_edit,
      confidence_score: t.confidence_score,
      competitor_insight: null,
    },
    funnel_analysis: null,
    skip_reason: t.skip_reason || null,
    rollback_note: t.rollback_note || null,
  }
})

// ── Funnel pages ──────────────────────────────────────────────────────────────
export const demoFunnelPages = [
  { id: 'fp-1', subscription_id: 'demo-subscription', page_path: '/signup', page_type: 'signup', drop_off_score: 67, views_7d: 1840, ai_insight: 'Highest exit point on the site. Signup form was shortened last week — monitoring next 7 days.', created_at: isoWeeksAgo(0) },
  { id: 'fp-2', subscription_id: 'demo-subscription', page_path: '/pricing', page_type: 'pricing', drop_off_score: 58, views_7d: 2410, ai_insight: 'Users skim the page in <25s. A plan comparison table would likely help — proposed PR was rejected.', created_at: isoWeeksAgo(0) },
  { id: 'fp-3', subscription_id: 'demo-subscription', page_path: '/onboarding', page_type: 'onboarding', drop_off_score: 44, views_7d: 3290, ai_insight: 'Step-2 drop-off dominates here. Progress indicator shipped this week — improvement expected.', created_at: isoWeeksAgo(0) },
  { id: 'fp-4', subscription_id: 'demo-subscription', page_path: '/features', page_type: 'landing', drop_off_score: 31, views_7d: 5120, ai_insight: 'Improved by 11pp after lazy-loading feature screenshots two months ago.', created_at: isoWeeksAgo(0) },
  { id: 'fp-5', subscription_id: 'demo-subscription', page_path: '/', page_type: 'landing', drop_off_score: 24, views_7d: 8740, ai_insight: 'Strong page. Hero LCP fix moved this from 41% → 24% drop-off over 6 weeks.', created_at: isoWeeksAgo(0) },
  { id: 'fp-6', subscription_id: 'demo-subscription', page_path: '/docs', page_type: 'docs', drop_off_score: 19, views_7d: 740, ai_insight: 'Healthy self-serve surface. Persistent search shipped recently.', created_at: isoWeeksAgo(0) },
  { id: 'fp-7', subscription_id: 'demo-subscription', page_path: '/changelog', page_type: 'blog', drop_off_score: 12, views_7d: 510, ai_insight: 'High-quality referral source for first-time visitors.', created_at: isoWeeksAgo(0) },
]

// ── Learnings (Business DNA strip) ────────────────────────────────────────────
export const demoLearnings = [
  { id: 'l-1', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'Shorter signup forms lift completion measurably.',                  change_type: 'form_length',   delta: 0.4,  metric_type: 'CVR',    confidence: 'high',   created_at: isoWeeksAgo(0) },
  { id: 'l-2', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'A progress indicator reduces onboarding abandonment.',             change_type: 'onboarding_ux', delta: 0.3,  metric_type: 'CVR',    confidence: 'high',   created_at: isoWeeksAgo(1) },
  { id: 'l-3', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'Compressing the hero image cuts bounce on mobile.',                  change_type: 'performance',   delta: 4,    metric_type: 'bounce', confidence: 'high',   created_at: isoWeeksAgo(3) },
  { id: 'l-4', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'Above-the-fold social proof reduces first-visit bounce.',            change_type: 'social_proof',  delta: 3,    metric_type: 'bounce', confidence: 'medium', created_at: isoWeeksAgo(4) },
  { id: 'l-5', subscription_id: 'demo-subscription', outcome: 'negative', summary: 'Over-specific hero CTA copy ("Start automating in 2 minutes") hurt bounce.', change_type: 'cta_copy', delta: 4, metric_type: 'bounce', confidence: 'high',   created_at: isoWeeksAgo(5) },
  { id: 'l-6', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'Discoverable docs search reduces support-surface bounce.',          change_type: 'docs_ux',       delta: 2,    metric_type: 'bounce', confidence: 'medium', created_at: isoWeeksAgo(6) },
  { id: 'l-7', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'Lazy-loading feature screenshots improves time-to-interactive.',    change_type: 'performance',   delta: 1,    metric_type: 'bounce', confidence: 'high',   created_at: isoWeeksAgo(7) },
  { id: 'l-8', subscription_id: 'demo-subscription', outcome: 'positive', summary: 'Above-the-fold pricing CTA reduces trial-start friction.',          change_type: 'cta_placement', delta: 3,    metric_type: 'bounce', confidence: 'high',   created_at: isoWeeksAgo(9) },
]

// ── Impact metrics (Before / After deltas; feeds the Top Insights panel on Overview) ──
// One row per deployed run that has bounce_before / bounce_after defined.
export const demoImpactMetrics = demoRuns
  .filter(r => r.status === 'deployed' && r.bounce_rate_before != null)
  .map((r, i) => ({
    id: `im-${i + 1}`,
    subscription_id: 'demo-subscription',
    run_id: r.id,
    metric_type: 'bounce_rate',
    value_before: r.bounce_rate_before,
    value_after: r.bounce_rate_after,
    measured_at: r.completed_at,
  }))

// ── Headline metrics (10-week trend, for any future component that needs them) ─
export const demoHeadlineMetrics = {
  business_name: 'taskloop.app',
  health_score_before: 52,
  health_score_now: 74,
  conversion_rate_before: 2.4,
  conversion_rate_now: 3.8,
  bounce_rate_before: 59,
  bounce_rate_now: 41,
  lcp_before_seconds: 3.6,
  lcp_now_seconds: 2.0,
  runs_total: demoRuns.length,
  runs_merged: demoRuns.filter(r => r.status === 'deployed').length,
}

// ── Weekly timeseries (10 data points, oldest → newest) ──────────────────────
export const demoConversionTrend = [2.4, 2.5, 2.7, 2.6, 2.9, 3.1, 3.0, 3.3, 3.6, 3.8]
export const demoBounceTrend     = [59,  56,  55,  53,  58,  49,  45,  42,  43,  41]

// ── Bundled export for convenient consumption in AgentDashboard ──────────────
export const demoData = {
  subscription:  demoSubscription,
  runs:          demoRuns,
  funnelPages:   demoFunnelPages,
  learnings:     demoLearnings,
  impactMetrics: demoImpactMetrics,
  headline:      demoHeadlineMetrics,
  conversionTrend: demoConversionTrend,
  bounceTrend:     demoBounceTrend,
}

export default demoData
