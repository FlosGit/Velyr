---
title: "Does INP Affect Conversion on a Landing Page?"
slug: "inp-affect-conversion-landing-page"
description: "INP measures how fast your page responds to taps and clicks. A sluggish CTA feels broken and costs conversions. web.dev's good INP is under 200ms. Here's how to measure yours in PostHog."
tldr: "Yes — Interaction to Next Paint affects conversion, because INP measures how quickly your page responds to a tap or click, and a CTA that feels laggy reads as broken. web.dev defines a good INP as 200ms or less. On a landing page the usual cause is heavy JavaScript blocking the main thread on click. Measure your field INP in PostHog and reduce the work."
cluster: "core-web-vitals"
tags: ["inp", "core-web-vitals", "conversion-rate", "responsiveness", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "fix-hydration-delayed-cta-nextjs"
  - "lcp-affect-conversion-rate-evidence-shows"
  - "good-click-through-rate-hero-cta"
faqs:
  - q: "Does INP affect conversion?"
    a: "Yes. INP measures the delay between a user interaction — a tap or click — and the page visibly responding. A CTA that lags after a click feels broken, and visitors either tap again (double-submitting) or give up. Fast response keeps the action feeling reliable."
  - q: "What is a good INP score?"
    a: "Google's web.dev defines a good INP as 200 milliseconds or less, needs-improvement between 200 and 500ms, and poor above 500ms, at the 75th percentile of real users. INP replaced First Input Delay as a Core Web Vital in 2024."
  - q: "What causes poor INP on a landing page?"
    a: "Usually heavy JavaScript running on the main thread when the user interacts — large event handlers, expensive re-renders, or third-party scripts. Reducing and deferring JavaScript, and breaking up long tasks, are the main fixes."
---

Yes — **INP affects conversion, because Interaction to Next Paint measures how quickly your page responds to a tap or click, and a CTA that feels laggy reads as broken.** A visitor clicks, nothing happens for a beat, and they either tap again or assume it's stuck. Google's web.dev defines a **good INP as 200ms or less**. INP replaced First Input Delay as a Core Web Vital in 2024.

## The mechanism

INP captures the delay between an interaction and the next visible paint — essentially, "when I clicked, how long until the page reacted?" It hurts conversion because responsiveness is how *reliable* a page feels:

- A CTA that responds instantly feels solid; the visitor trusts the click landed.
- A CTA that hangs for half a second after the click feels broken. The visitor double-taps (risking a double-submit) or gives up.

On a landing page, this most often bites at the exact worst moment — the click on the primary CTA — because that's when any heavy JavaScript fires.

## The thresholds

web.dev's INP bands at the 75th percentile of real users:

- **Good:** ≤ 200 ms
- **Needs improvement:** 200 – 500 ms
- **Poor:** > 500 ms

## What causes poor INP

The root cause is the main thread being busy when the user interacts:

- **Heavy event handlers** — a click that triggers an expensive calculation or a large re-render.
- **Too much JavaScript** — large bundles that keep the main thread busy parsing and executing.
- **Third-party scripts** — analytics, chat widgets, and tag managers competing for the main thread.

The fixes are to ship less JavaScript, defer what isn't needed for the first interaction, and break long tasks into smaller chunks.

## Measure your field INP in PostHog

Capture INP with the web-vitals library and bucket it:

```js
import { onINP } from 'web-vitals'
onINP((metric) => {
  posthog.capture('web_vitals', { metric: 'INP', value: metric.value })
})
```

```sql
SELECT
  multiIf(
    toFloat(properties.value) <= 200, 'good',
    toFloat(properties.value) <= 500, 'needs improvement',
    'poor'
  ) AS inp_band,
  countDistinct(person_id) AS sessions
FROM events
WHERE event = 'web_vitals'
  AND properties.metric = 'INP'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY inp_band
ORDER BY inp_band
```

Illustrative sample output:

| inp_band          | sessions |
|-------------------|---------:|
| good              | 4,300    |
| needs improvement | 760      |
| poor              | 220      |

If sessions are slipping into needs-improvement or poor, your CTA may feel sluggish exactly when it matters.

## Reduce the work

Defer non-critical scripts so they don't compete with the first interaction, trim your bundle, and keep click handlers light. On a landing page, most of the third-party JavaScript can load after the page is interactive. If you'd like the heaviest, most conversion-critical interaction found and fixed as a Pull Request, that's what [Velyr](/agent/register) does.
