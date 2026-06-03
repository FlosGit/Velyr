---
title: "Does Cumulative Layout Shift Hurt Conversion?"
slug: "cumulative-layout-shift-hurt-conversion"
description: "Yes — layout shift causes mis-clicks and erodes trust, both of which cost conversions. web.dev's good CLS is under 0.1. Here's the mechanism and how to measure your own in PostHog."
tldr: "Yes — Cumulative Layout Shift hurts conversion, because content jumping under a visitor's finger causes mis-clicks (often on the wrong button) and signals an unstable, untrustworthy page. web.dev defines a good CLS as 0.1 or less. The usual culprits are images without dimensions, late-loading fonts, and injected banners. Measure your field CLS in PostHog and fix the top cause."
cluster: "core-web-vitals"
tags: ["cls", "core-web-vitals", "conversion-rate", "layout-shift", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "fix-cumulative-layout-shift-react"
  - "optimise-astro-image-component-fast-hero-lcp"
  - "lcp-affect-conversion-rate-evidence-shows"
faqs:
  - q: "Does layout shift hurt conversion?"
    a: "Yes. When content moves as the page loads, visitors mis-click — sometimes tapping the wrong button or an ad instead of your CTA — and a jumpy page reads as broken or untrustworthy. Both reduce the chance someone completes the action you want."
  - q: "What is a good CLS score?"
    a: "Google's web.dev defines a good Cumulative Layout Shift as 0.1 or less, needs-improvement between 0.1 and 0.25, and poor above 0.25, at the 75th percentile of real users. CLS is a unitless score of how much visible content moves unexpectedly."
  - q: "What causes layout shift?"
    a: "The common causes are images and embeds without width and height, web fonts that swap and reflow text, content injected above existing content (banners, cookie notices), and ads. Reserving space for anything that loads late is the core fix."
---

Yes — **Cumulative Layout Shift hurts conversion, because content jumping under a visitor's finger causes mis-clicks and signals an unstable page.** Someone reaches to tap your CTA, a banner loads above it, and they hit the wrong thing — or they conclude the site is broken and leave. Google's web.dev defines a **good CLS as 0.1 or less**.

## The mechanism

CLS measures how much visible content moves *unexpectedly* as the page loads. It hurts conversion two ways:

1. **Mis-clicks.** The classic failure: a visitor goes to click "Start trial," a late-loading image or banner pushes the layout down, and their tap lands on the wrong element. On mobile, where the thumb is already moving, this is common and infuriating.
2. **Eroded trust.** A page that jumps around looks unfinished and unreliable. For a tool you're asking people to connect to their codebase or card, that impression is expensive.

Neither requires a study to believe — they're direct consequences of the layout moving while someone is trying to act.

## The thresholds

web.dev's CLS bands at the 75th percentile of real users:

- **Good:** ≤ 0.1
- **Needs improvement:** 0.1 – 0.25
- **Poor:** > 0.25

CLS is unitless — it's a score of movement, not a time.

## The usual causes

- **Images and embeds without `width`/`height`** — the browser doesn't reserve space, so content below jumps when they load.
- **Web fonts that swap** — text reflows when the custom font replaces the fallback.
- **Injected content** — cookie banners, promo bars, or ads inserted *above* existing content shove everything down.
- **Late-loading components** — a section that appears after hydration with no reserved space.

The fix in every case is the same idea: reserve the space before the thing loads.

## Measure your field CLS in PostHog

Capture CLS with the web-vitals library and bucket it into the web.dev bands:

```js
import { onCLS } from 'web-vitals'
onCLS((metric) => {
  posthog.capture('web_vitals', { metric: 'CLS', value: metric.value })
})
```

```sql
SELECT
  multiIf(
    toFloat(properties.value) <= 0.1, 'good',
    toFloat(properties.value) <= 0.25, 'needs improvement',
    'poor'
  ) AS cls_band,
  countDistinct(person_id) AS sessions
FROM events
WHERE event = 'web_vitals'
  AND properties.metric = 'CLS'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY cls_band
ORDER BY cls_band
```

Illustrative sample output:

| cls_band          | sessions |
|-------------------|---------:|
| good              | 3,900    |
| needs improvement | 1,020    |
| poor              | 410      |

If a real share of sessions land in poor, you have a measurable mis-click risk — especially worrying if it's high on mobile, where conversion is already harder.

## Fix the top cause first

Add dimensions to images, set space for banners and ads, and use `font-display` carefully. The framework guides cover the exact code. If you'd like your worst layout-shift offender found and the fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
