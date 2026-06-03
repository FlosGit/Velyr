---
title: "Does LCP Affect Conversion Rate? What the Evidence Shows"
slug: "lcp-affect-conversion-rate-evidence-shows"
description: "LCP affects conversion because a slow main paint delays when visitors can read and act. web.dev's 'good' LCP is under 2.5s. Here's the mechanism and how to measure the impact in PostHog."
tldr: "Yes — Largest Contentful Paint affects conversion, because LCP is roughly when your main content becomes visible, and a visitor can't act on a value proposition or CTA they can't see yet. Google's web.dev defines a 'good' LCP as 2.5 seconds or less. The honest way to prove it for your site is to measure LCP per session in PostHog and compare conversion across the bands."
cluster: "core-web-vitals"
tags: ["lcp", "core-web-vitals", "conversion-rate", "page-speed", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "fix-slow-lcp-nextjs-landing-page"
  - "optimise-astro-image-component-fast-hero-lcp"
  - "good-bounce-rate-saas-marketing-site"
faqs:
  - q: "Does LCP affect conversion rate?"
    a: "Yes, indirectly but reliably. LCP marks roughly when your main content paints, and visitors can't read your value proposition or click a CTA that hasn't rendered. Slower LCP also raises the chance someone leaves before the page is usable. The cleanest proof for your own site is to measure LCP per session and compare conversion across the speed bands."
  - q: "What is a good LCP score?"
    a: "Google's web.dev defines a good LCP as 2.5 seconds or less, needs-improvement between 2.5 and 4 seconds, and poor above 4 seconds, measured at the 75th percentile of real users. Aim to get most of your sessions into the under-2.5s band."
  - q: "How do I measure LCP for real users?"
    a: "Use the web-vitals JavaScript library to capture LCP in the field and send it to PostHog as an event. Lab tools like Lighthouse give you a single synthetic number; field data shows the distribution your actual visitors experience, which is what affects conversion."
---

Yes — **LCP affects conversion, because Largest Contentful Paint is roughly when your main content becomes visible, and a visitor can't act on a value proposition or a CTA they can't see yet.** Google's web.dev defines a "good" LCP as **2.5 seconds or less**. Rather than lean on someone else's headline statistic, the honest way to prove the link for *your* site is to measure LCP per session and compare conversion across the speed bands.

## The mechanism, not a borrowed stat

It's easy to quote a dramatic "every second costs X% of conversions" figure, but those numbers come from specific sites with specific traffic and don't transfer. The *mechanism*, though, is general and uncontroversial:

- LCP marks when the largest above-the-fold element — usually your hero or headline — finishes painting.
- Until then, the visitor sees a blank or partial page. They can't read your offer or click anything.
- The longer that lasts, the more visitors give up before the page is usable, and the later everyone else can engage.

So LCP doesn't "cause" conversion directly; it gates the moment conversion can begin. That's enough to make it worth fixing.

## The thresholds that matter

web.dev's Core Web Vitals bands for LCP, measured at the 75th percentile of real users:

- **Good:** ≤ 2.5 s
- **Needs improvement:** 2.5 s – 4 s
- **Poor:** > 4 s

The goal is to get most of your sessions into the good band — not to chase a perfect lab score.

## Measure LCP for real users in PostHog

Capture LCP in the field with the `web-vitals` library and send it as an event:

```js
import { onLCP } from 'web-vitals'
onLCP((metric) => {
  posthog.capture('web_vitals', { metric: 'LCP', value: metric.value })
})
```

Then bucket your real-user LCP into the web.dev bands:

```sql
SELECT
  multiIf(
    toFloat(properties.value) <= 2500, 'good',
    toFloat(properties.value) <= 4000, 'needs improvement',
    'poor'
  ) AS lcp_band,
  countDistinct(person_id) AS sessions
FROM events
WHERE event = 'web_vitals'
  AND properties.metric = 'LCP'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY lcp_band
ORDER BY lcp_band
```

Illustrative sample output:

| lcp_band          | sessions |
|-------------------|---------:|
| good              | 4,120    |
| needs improvement | 1,180    |
| poor              | 640      |

## Prove the conversion link on your own data

The distribution above tells you how fast your site is; to show LCP affects *your* conversion, compare the conversion rate of fast versus slow sessions. Capture both `web_vitals` and `signup_completed`, then look at whether the good-LCP cohort converts better than the poor-LCP cohort. If it does — and it usually does — you've measured the impact directly instead of borrowing a number.

## What to do about it

If a meaningful share of sessions land in needs-improvement or poor, the highest-leverage fixes are almost always the hero image (preload it, don't lazy-load it) and render-blocking resources. See the framework-specific guides for the exact changes. If you'd like the slowest, lowest-converting part of your page found and fixed as a Pull Request each week, that's what [Velyr](/agent/register) does.
