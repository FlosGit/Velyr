---
title: "How to A/B Test a Landing Page Without a Testing Platform"
slug: "ab-test-landing-page-without-testing-platform"
description: "A/B test a landing page with no testing tool: split visitors with a cookie, tag the variant on every PostHog event, compare conversion in HogQL, and check significance by hand."
tldr: "You don't need Optimizely or VWO to A/B test a landing page. Assign each visitor a variant once with a cookie, register it as a PostHog property so it tags every event, then compare conversion per variant in HogQL and check significance with a two-proportion z-test. The whole setup is a few lines of code."
cluster: "experimentation"
tags: ["ab-testing", "experimentation", "posthog", "statistical-significance", "hogql"]
publishedAt: "2026-06-07"
updatedAt: "2026-06-07"
author: "Velyr Team"
related:
  - "track-cta-clicks-posthog"
  - "build-signup-funnel-posthog"
  - "good-conversion-rate-saas-landing-page"
  - "calculate-sample-size-ab-test"
  - "my-ab-test-result-statistically-significant"
  - "ab-testing-tools-vs-shipping-fix"
faqs:
  - q: "Can I A/B test without a tool like Optimizely or VWO?"
    a: "Yes. Assign each visitor a stable variant with a cookie, tag it onto your analytics events, and compare conversion per variant. The only thing a paid platform adds is a UI and automatic stats — both of which you can replace with a cookie, a PostHog property, and a one-line significance check."
  - q: "How do I keep a visitor in the same variant across visits?"
    a: "Store the variant in a cookie (or localStorage) on first visit and read it back on every subsequent load. Without persistence a returning visitor could flip between A and B, which pollutes the test. A 90-day cookie keeps the assignment stable."
  - q: "How do I know if my A/B test result is real?"
    a: "Run a two-proportion z-test. Compute each variant's conversion rate, pool them, and calculate a z-score; if its absolute value is above 1.96 the difference is significant at 95% confidence. Don't call a winner before you hit a pre-decided sample size."
---

You don't need a paid testing platform to A/B test a landing page. **Assign each visitor a variant once with a cookie, register that variant as a PostHog property so it tags every event, then compare conversion per variant in HogQL and check significance with a two-proportion z-test.** A platform's only real advantages — a split mechanism and automatic stats — are a few lines of code each.

## Step 1: Split visitors and remember the assignment

Pick a variant on the first visit and persist it, so a returning visitor always sees the same version. Then register it as a PostHog super property, which attaches `variant` to every event that user fires:

```js
function getVariant() {
  const existing = document.cookie.match(/(?:^|;\s*)ab_hero=([ab])/)
  if (existing) return existing[1]
  const v = Math.random() < 0.5 ? 'a' : 'b'
  document.cookie = `ab_hero=${v}; path=/; max-age=${60 * 60 * 24 * 90}`
  return v
}

const variant = getVariant()
posthog.register({ variant })   // tags every subsequent event with this variant
if (variant === 'b') applyVariantB()
```

That's the whole split. `applyVariantB()` is wherever you swap the headline, hero, or CTA. Because `variant` is registered, your existing `$pageview` and conversion events carry it automatically — no per-event wiring.

## Step 2: Decide the sample size before you start

The single biggest DIY mistake is stopping the moment the numbers look good ("peeking"). Decide up front how many visitors per variant you'll collect, and don't call a winner before then. As a rough rule, detecting a lift from ~3% to ~4% at 95% confidence needs on the order of a few thousand visitors per variant — small changes need large samples. If your traffic can't reach that in a few weeks, test a bigger change, not a button colour.

## Step 3: Compare conversion per variant in HogQL

With the variant tagged on every event, this query gives you visitors, conversions, and conversion rate for each arm over the last 14 days:

```sql
SELECT
  properties.variant AS variant,
  countDistinctIf(person_id, event = '$pageview') AS visitors,
  countDistinctIf(person_id, event = 'signup_completed') AS conversions,
  round(
    countDistinctIf(person_id, event = 'signup_completed')
    / countDistinctIf(person_id, event = '$pageview') * 100,
  2) AS cr_pct
FROM events
WHERE timestamp > now() - INTERVAL 14 DAY
GROUP BY variant
ORDER BY variant
```

Illustrative sample output:

| variant | visitors | conversions | cr_pct |
|---------|---------:|------------:|-------:|
| a       | 2,000    | 60          | 3.00   |
| b       | 2,000    | 84          | 4.20   |

## Step 4: Check significance with a two-proportion z-test

Don't eyeball "4.2% beats 3.0%." Run the test by hand — it's one formula. With conversions x and visitors n for each variant:

- p₁ = 60 / 2000 = 0.030, p₂ = 84 / 2000 = 0.042
- pooled p = (60 + 84) / (2000 + 2000) = 0.036
- standard error = √( p(1−p) · (1/n₁ + 1/n₂) ) = √( 0.036 · 0.964 · (1/2000 + 1/2000) ) ≈ 0.00589
- z = (p₂ − p₁) / SE = 0.012 / 0.00589 ≈ **2.04**

Because |z| ≈ 2.04 is above **1.96**, the difference is significant at 95% confidence — variant B is a real winner, not noise. Had z come out at, say, 1.3, you'd keep running (if you're still under your sample target) or call it inconclusive.

## When to just use PostHog feature flags instead

This DIY approach is perfect for one or two tests. If you're running many, PostHog's built-in **feature flags and experiments** handle the split and the stats for you — and they're free on the same project you already query. The honest tradeoff: the cookie method costs you a significance formula you compute yourself; the feature-flag route costs you a little setup but removes the manual maths. Neither needs a separate paid testing platform.

If you'd rather skip running experiments by hand entirely and have the highest-impact change found and shipped as a Pull Request each week, that's what [Velyr](/agent/register) does.
