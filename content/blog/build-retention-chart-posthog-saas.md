---
title: "How to Build a Retention Chart in PostHog for a SaaS"
slug: "build-retention-chart-posthog-saas"
description: "Build a retention chart in PostHog: use the native Retention insight to see what share of new users come back each week, and track weekly active users in HogQL as a supporting signal."
tldr: "Use PostHog's native Retention insight to build the chart — pick the event that marks a new user and the event that marks a return, and it produces the cohort retention grid automatically. For a supporting trend, compute weekly active users in HogQL with toStartOfWeek and uniq. Retention is the truest measure of whether your product sticks."
cluster: "posthog-recipes"
tags: ["posthog", "retention", "saas", "hogql", "weekly-active-users"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "create-cohort-high-intent-visitors-posthog"
  - "build-signup-funnel-posthog"
  - "good-trial-to-paid-conversion-rate-saas"
  - "posthog-vs-mixpanel-product-analytics"
faqs:
  - q: "How do I build a retention chart in PostHog?"
    a: "Use the native Retention insight. Choose the event that defines the cohort (for example signup_completed) and the event that counts as returning (for example any pageview or a core action), and PostHog produces the weekly cohort grid showing what share of each cohort came back, no query required."
  - q: "What's a good retention curve for SaaS?"
    a: "A healthy retention curve flattens rather than dropping to zero — meaning a stable core of users keeps coming back. The absolute level varies enormously by product type, so compare your curve to your own past cohorts rather than to a borrowed benchmark."
  - q: "Can I compute retention with HogQL?"
    a: "The full cohort grid is best done with the native Retention insight. HogQL is well suited to supporting signals like weekly active users or how many of last month's signups were active this week, using toStartOfWeek and uniq."
---

To build a retention chart in PostHog, **use the native Retention insight: pick the event that marks a new user and the event that marks a return, and it produces the cohort grid automatically.** For a supporting trend, compute weekly active users in HogQL. Retention is the truest measure of whether your product actually sticks — conversion gets people in; retention is whether they stay.

## Build the chart with the native Retention insight

Retention curves are a cohort calculation that the native insight is built for, so start there:

1. In PostHog, open **Insights → Retention**.
2. Set the **cohortising event** to what makes someone a new user — `signup_completed`.
3. Set the **returning event** to what counts as coming back — any `$pageview`, or better, a core action like `project_created`.
4. Choose a **weekly** granularity for a SaaS product.

PostHog produces a grid: each row is a weekly cohort, each column is weeks-since-signup, and each cell is the share of that cohort still active. Reading it is simple — you want the numbers to **flatten** across columns rather than fall to zero, which means a stable core keeps returning.

Picking the right returning event matters. "Any pageview" overstates retention (people who log in but get no value still count); a genuine core action gives you the honest curve.

## A supporting signal: weekly active users in HogQL

The retention grid shows cohort behaviour; a weekly-active-users trend shows the overall trajectory. This HogQL counts unique active users per week:

```sql
SELECT
  toStartOfWeek(timestamp) AS week,
  uniq(person_id) AS weekly_active_users
FROM events
WHERE timestamp > now() - INTERVAL 12 WEEK
GROUP BY week
ORDER BY week
```

Illustrative sample output:

| week       | weekly_active_users |
|------------|--------------------:|
| 2026-04-06 | 1,240               |
| 2026-04-13 | 1,310               |
| 2026-04-20 | 1,395               |

Rising WAU with a flattening retention curve is the healthy combination: you're adding users *and* keeping them. Rising WAU with a retention curve that still drops to zero means you're filling a leaky bucket — growth that masks a retention problem.

## How to read retention for a SaaS

- **Flattening beats high.** A curve that settles at 30% and stays there is healthier than one that starts at 60% and slides toward zero.
- **Compare to your own cohorts.** Retention varies enormously by product; last quarter's cohorts are your real benchmark, not an industry number.
- **Tie drop-off to onboarding.** Most retention is won or lost in the first session — if week-1 retention is weak, your activation step is the place to work.

## From measurement to action

Retention tells you whether the product delivers value; if it doesn't flatten, no amount of top-of-funnel conversion will save the numbers. Once your curve is stable, conversion work compounds. If you'd like the conversion side handled for you — the highest-impact fix found and shipped as a Pull Request weekly — that's what [Velyr](/agent/register) does.
