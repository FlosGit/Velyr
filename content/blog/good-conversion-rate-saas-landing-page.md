---
title: "What Is a Good Conversion Rate for a SaaS Landing Page?"
slug: "good-conversion-rate-saas-landing-page"
description: "A good SaaS landing page converts 2–5% of visitors to signup, with the best pages hitting 6%+. Here are honest, sourced benchmarks and how to measure your own in PostHog."
tldr: "Most SaaS landing pages convert 2–5% of visitors into signups or leads, and top performers exceed 6%. But the median you read in any report depends heavily on traffic source, offer, and what counts as a conversion — so your own measured baseline matters far more than any benchmark."
cluster: "benchmarks"
tags: ["conversion-rate", "saas", "benchmarks", "landing-page"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "what-is-conversion-rate-optimization"
  - "average-bounce-rate-developer-tools"
  - "improve-conversion-nextjs-landing-page"
faqs:
  - q: "What counts as a conversion on a SaaS landing page?"
    a: "Whatever you defined as the page's primary goal — usually a signup, a free-trial start, a demo request, or a waitlist join. Pick one primary conversion per page and measure it consistently, or your rate is meaningless."
  - q: "Is a 2% conversion rate good or bad for SaaS?"
    a: "2% is roughly the median for a cold-traffic SaaS landing page, so it's neither great nor alarming. Whether it's 'good' depends on your traffic quality and price point — a 2% rate on high-intent search traffic to a $99/mo product is healthier than 5% on a free tool from paid social."
  - q: "How is landing page conversion rate calculated?"
    a: "Conversions divided by unique visitors to the page, over the same time window. If 1,000 unique visitors produce 30 signups, that's a 3% conversion rate. Use unique visitors, not pageviews, so refreshes and repeat visits don't deflate the number."
---

If you're optimizing a SaaS landing page, the first question is usually "what should I even be aiming for?" The honest answer: **a good SaaS landing page converts roughly 2–5% of visitors, and the best convert 6% or more** — but that range hides enormous variation, and the only number that should drive your decisions is your own measured baseline.

## What the public benchmarks actually say

Conversion benchmarks vary by source because each report samples different industries, traffic mixes, and definitions of "conversion." Treat these as rough reference points, not targets:

- **Unbounce's Conversion Benchmark Report** found a *median* landing page conversion rate of about 6.6% across roughly 41,000 pages — but that median spans all industries, and high-converting categories (such as events and ecommerce) pull it up, so software/SaaS landing pages typically sit below it. ([unbounce.com](https://unbounce.com/conversion-benchmark-report/))
- **WordStream's analysis of Google Ads landing pages** found an average conversion rate around 2.35%, with the top 25% of advertisers above ~5.3% and the top 10% above ~11%. ([wordstream.com](https://www.wordstream.com/blog/ws/2014/03/17/what-is-a-good-conversion-rate))
- Vendor benchmark roundups for B2B SaaS commonly cite **3–5%** as a healthy landing-page-to-lead range, with free-trial signup pages often higher than demo-request pages because the ask is smaller.

The takeaway isn't a magic number. It's that **"good" is a distribution, not a point.** A 3% rate sits near the middle; clearing ~6% puts you in the top quartile of most datasets.

## Why the benchmark matters less than your baseline

Three variables move your conversion rate more than your industry does:

1. **Traffic intent.** Someone arriving from a "best invoicing tool for freelancers" search is far warmer than someone tapping a social ad. The same page can convert 8% on search and 1.5% on paid social.
2. **What you're asking for.** "Start free trial" (credit card) converts lower than "Get the free guide," which converts lower than "Join the waitlist." Comparing your trial page to someone else's email-capture page is meaningless.
3. **Price and commitment.** A $9/mo tool and a $2,000/mo platform should not expect the same landing-page conversion rate.

This is why a benchmark can mislead you into "fixing" a page that's already healthy — or into complacency about one that isn't.

## Measure your own baseline in PostHog (the unique part)

Here's a runnable **HogQL** query you can paste into PostHog → *SQL insights* to compute your real landing-page conversion rate. It counts unique visitors who landed on `/` and the unique subset who fired a `signup_completed` event, over the last 30 days:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview'
    AND properties.$pathname = '/') AS visitors,
  countDistinctIf(person_id, event = 'signup_completed') AS conversions,
  round(
    countDistinctIf(person_id, event = 'signup_completed')
    / countDistinctIf(person_id, event = '$pageview'
        AND properties.$pathname = '/') * 100,
  2) AS conversion_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| visitors | conversions | conversion_rate_pct |
|---------:|------------:|--------------------:|
| 4,120    | 142         | 3.45                |

A 3.45% result here is right around the median — so the next move isn't panic, it's finding *where* the other 96.55% drop off. (For that, build a funnel; see how to find drop-off in your analytics rather than guessing.)

> **Methodology note:** use `countDistinct` on `person_id`, not raw event counts, or repeat visits and refreshes will distort both numerator and denominator. Filter the denominator to the specific landing path so site-wide traffic doesn't dilute it.

## A simple rule of thumb

- **Under ~2%** on warm traffic: something on the page is leaking — usually clarity of the offer, a slow or shifting hero, or a CTA below the fold.
- **2–5%:** healthy and normal; improvements come from incremental testing, not a rebuild.
- **6%+:** strong; protect it, and focus effort on the next step of the funnel (activation, trial-to-paid).

Don't chase someone else's number. Establish your baseline, then improve *it* — week over week, against your own traffic.
