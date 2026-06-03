---
title: "What's a Good Free-Trial-to-Paid Conversion Rate for SaaS?"
slug: "good-trial-to-paid-conversion-rate-saas"
description: "Free-trial-to-paid conversion rates vary widely by model: opt-in (no card) trials often convert ~15–25%, opt-out (card-required) trials ~40–60%, per public benchmarks. Here's how to measure yours by cohort honestly."
tldr: "There's no single 'good' trial-to-paid rate — it depends on the model. Public benchmarks suggest opt-in (no credit card) trials convert around 15–25%, while opt-out (card-required) trials convert roughly 40–60% because they pre-qualify intent. Measure yours as a cohort: of trials that started in a period, what share became paying."
cluster: "benchmarks"
tags: ["trial-to-paid", "saas", "conversion-rate", "benchmarks", "cohort"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "good-conversion-rate-saas-landing-page"
  - "average-bounce-rate-developer-tools"
  - "build-signup-funnel-posthog"
faqs:
  - q: "What is a good free-trial-to-paid conversion rate?"
    a: "It depends on the trial model. Public benchmarks indicate opt-in trials (no credit card) commonly convert around 15–25%, while opt-out trials (credit card required up front) convert roughly 40–60% because they pre-qualify intent. Compare yourself to your model, not the global average."
  - q: "Should I require a credit card for my trial?"
    a: "It's a tradeoff. Requiring a card raises trial-to-paid conversion sharply but lowers the number of trials started; not requiring one fills the top of the funnel but converts a smaller share. The right choice depends on whether your activation needs time and hand-holding or is fast and self-evident."
  - q: "How do I calculate trial-to-paid conversion rate?"
    a: "Use a cohort: take all trials that started in a fixed window, then measure what fraction became paying customers within your trial length plus a small grace period. Calculating it on overlapping or open cohorts inflates or deflates the number misleadingly."
---

There's no universal "good" free-trial-to-paid conversion rate — **it's governed by your trial model.** Public benchmarks suggest **opt-in (no credit card) trials convert around 15–25%**, while **opt-out (credit-card-required) trials convert roughly 40–60%** because requiring a card pre-qualifies intent.

## What the public benchmarks say

- **OpenView's SaaS Benchmarks** and writing by operators like **Lenny Rachitsky** have repeatedly noted the large gap between opt-in and opt-out trials, with card-required trials converting at multiples of no-card trials. ([openviewpartners.com](https://openviewpartners.com/), [lennysnewsletter.com](https://www.lennysnewsletter.com/))
- **Recurly's subscription research** has reported median trial conversion that varies substantially by vertical and model. ([recurly.com](https://recurly.com/))
- Product-analytics writeups from **ChartMogul** and **Userpilot** cite similar ranges and stress that the *model* (opt-in vs opt-out, trial length, reverse trial) drives the number more than the industry does. ([chartmogul.com](https://chartmogul.com/), [userpilot.com](https://userpilot.com/))

As always: these sample different companies with different definitions. Use them to sanity-check, not to set a target.

## The lever: opt-in vs opt-out

The single biggest determinant is whether you ask for a card up front:

- **Opt-out (card required):** fewer trials start, but a much larger share convert (~40–60%). Best when activation is fast and the value is obvious quickly.
- **Opt-in (no card):** more trials start, smaller share convert (~15–25%). Best when activation takes time, onboarding, or a human touch.

Neither is "better" — they fill different parts of the funnel. What's wrong is comparing your opt-in rate to an opt-out benchmark and concluding you're failing.

## Measure yours as a cohort (the unique part)

Trial-to-paid is meaningless on an open or overlapping window. Compute it on a **cohort**: of the trials that *started* in a fixed period, how many converted within the trial length plus a grace period. In SQL over your subscription events:

```sql
-- Cohort: trials started 30–60 days ago (so a 14-day trial has fully resolved)
SELECT
  count(*)                                  AS trials_started,
  countIf(converted_at IS NOT NULL)         AS converted,
  round(countIf(converted_at IS NOT NULL) / count(*) * 100, 1) AS trial_to_paid_pct
FROM (
  SELECT
    s.id,
    s.trial_started_at,
    min(p.paid_at) AS converted_at
  FROM subscriptions s
  LEFT JOIN payments p
    ON p.subscription_id = s.id
   AND p.paid_at <= s.trial_started_at + INTERVAL 16 DAY   -- 14-day trial + grace
  WHERE s.trial_started_at >= now() - INTERVAL 60 DAY
    AND s.trial_started_at <  now() - INTERVAL 30 DAY
  GROUP BY s.id, s.trial_started_at
)
```

Illustrative sample output:

| trials_started | converted | trial_to_paid_pct |
|---------------:|----------:|------------------:|
| 320            | 168       | 52.5              |

The key discipline is the **closed cohort**: only trials old enough to have fully resolved, so you're not dividing by trials still in progress. Adjust the intervals to your trial length.

## What to do with the number

Track the cohort rate month over month against *your own* history. If it's falling, the leak is usually in activation (people start but never reach value) — go build a signup-and-activation funnel and find the steep step. If you're considering switching trial models, expect the rate and the trial volume to move in opposite directions, and judge the combination on revenue, not on the conversion percentage alone.
