---
title: "What Is a Micro-Conversion? Examples for SaaS"
slug: "what-is-a-micro-conversion"
description: "A micro-conversion is a small, measurable step a visitor takes toward your main goal — like starting a signup form or viewing pricing. Here's a clear definition, SaaS examples, and how to track one in PostHog."
tldr: "A micro-conversion is a small, trackable action that signals progress toward your primary (macro) conversion — for example viewing pricing, starting the signup form, or connecting an integration. Micro-conversions let low-traffic sites optimize the funnel step by step instead of waiting on the rare final conversion."
cluster: "concepts"
tags: ["micro-conversion", "saas", "definition", "funnel", "posthog"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "what-is-conversion-rate-optimization"
  - "track-cta-clicks-posthog"
  - "build-signup-funnel-posthog"
faqs:
  - q: "What is the difference between a micro-conversion and a macro-conversion?"
    a: "A macro-conversion is your primary goal — a purchase, a paid signup, a booked demo. A micro-conversion is a smaller step toward it, like viewing pricing or starting the signup form. Macro-conversions prove value; micro-conversions show you where in the journey people advance or stall."
  - q: "Why do micro-conversions matter for low-traffic sites?"
    a: "Macro-conversions are rare, so on low traffic you can wait weeks for enough of them to learn anything. Micro-conversions happen far more often, giving you a faster, statistically usable signal about which part of the funnel to fix."
  - q: "What are examples of micro-conversions for SaaS?"
    a: "Viewing the pricing page, starting the signup form, completing account creation, connecting an integration, inviting a teammate, or reaching a key feature for the first time. Each is a measurable step that precedes or follows the paid conversion."
---

A **micro-conversion is a small, measurable action a visitor takes that signals progress toward your primary goal.** If your macro-conversion is a paid signup, micro-conversions are the steps along the way — viewing pricing, opening the signup form, creating an account, connecting an integration.

## Micro vs. macro, precisely

- **Macro-conversion:** the outcome that matters to the business — a purchase, a paid subscription, a booked demo. Usually one per visitor, and relatively rare.
- **Micro-conversion:** a smaller step that *precedes or supports* the macro one. Frequent, and therefore a faster signal.

Think of the macro-conversion as proof of value and micro-conversions as the **instrumentation of the journey** toward it.

## Why they matter (especially on low traffic)

Macro-conversions are rare by design, so on a young or low-traffic site you might get only a handful a week — not enough to tell whether a change helped. Micro-conversions happen far more often, so they give you a **usable signal much sooner.** Instead of waiting weeks to see if paid signups moved, you can see this week whether more people are reaching the signup form.

## SaaS examples

Two useful categories:

1. **Process micro-conversions** — steps directly on the path to the macro goal: viewed pricing → started signup → completed signup → connected first integration → activated.
2. **Secondary micro-conversions** — smaller signals of intent that aren't on the critical path: reading docs, watching a demo video, subscribing to the newsletter, starring the repo.

For a developer-tool SaaS, a strong process micro-conversion is the first integration connected — it's the moment the product starts delivering value.

## Track one in PostHog (the unique part)

Pick a micro-conversion and capture it as a named event, then measure how often it fires relative to the page it depends on. Say the micro-conversion is "viewed pricing":

```js
// fire on the pricing route
posthog.capture('viewed_pricing')
```

Then measure what share of homepage visitors reach pricing — a micro-conversion rate — in HogQL:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview'
    AND properties.$pathname = '/') AS home_visitors,
  countDistinctIf(person_id, event = 'viewed_pricing') AS reached_pricing,
  round(
    countDistinctIf(person_id, event = 'viewed_pricing')
    / countDistinctIf(person_id, event = '$pageview'
      AND properties.$pathname = '/') * 100,
  1) AS micro_conversion_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| home_visitors | reached_pricing | micro_conversion_pct |
|--------------:|----------------:|---------------------:|
| 6,180         | 1,360           | 22.0                 |

If only 22% of homepage visitors ever reach pricing, that's a concrete, frequent number you can try to improve this week — long before you'd have enough paid signups to A/B test.

## How to use them

Define the 3–5 micro-conversions that map your real funnel, capture each as a stable event, and watch the rate between consecutive steps. The step with the worst rate is where to focus — and because micro-conversions are frequent, you'll know whether your fix worked in days, not months.
