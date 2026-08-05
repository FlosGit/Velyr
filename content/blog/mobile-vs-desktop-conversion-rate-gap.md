---
title: "Mobile vs. Desktop Conversion Rate: How Big Should the Gap Be?"
slug: "mobile-vs-desktop-conversion-rate-gap"
description: "Desktop converts 74% higher than mobile in Contentsquare's 2026 benchmark of 99 billion sessions. A gap is normal, so here is how to work out whether yours is intent, attribution, or a layout defect you can fix."
tldr: "A mobile to desktop conversion gap is normal. Contentsquare's 2026 Digital Experience Benchmark, built on 99 billion sessions across more than 6,000 sites, reports desktop converting 74% higher than mobile. Some of that gap is buying intent and cross-device journeys you cannot fix. The part you can fix shows up as mobile traffic that arrives in volume, scrolls less than desktop, and converts several times worse than the benchmark spread predicts."
cluster: "benchmarks"
tags: ["benchmarks", "mobile", "conversion-rate", "device", "posthog", "hogql"]
publishedAt: "2026-08-04"
updatedAt: "2026-08-04"
author: "Velyr Team"
related:
  - "good-conversion-rate-saas-landing-page"
  - "above-fold-web-design"
  - "good-scroll-depth-landing-page"
  - "measure-scroll-depth-posthog"
  - "find-rage-clicks-dead-clicks-posthog"
  - "improve-conversion-shopify-product-page-without-app"
faqs:
  - q: "What is a normal mobile vs desktop conversion rate gap?"
    a: "Contentsquare's 2026 Digital Experience Benchmark, covering 99 billion sessions across more than 6,000 sites, found desktop converting 74% higher than mobile. Roughly 1.5x to 2x in desktop's favour is the range large benchmarks tend to land in, so a gap on that order is ordinary rather than a warning sign."
  - q: "Why is my mobile conversion rate so much lower than desktop?"
    a: "Three causes overlap. Phone visitors are more often researching than buying, cross-device journeys that start on a phone and finish on a laptop credit the entire conversion to desktop, and mobile layouts genuinely break more often. Only the third is a defect you can fix in code."
  - q: "Should I worry if mobile converts worse than desktop?"
    a: "Only past a point. If mobile trails desktop by more than about 2x, or mobile is the majority of your traffic and a small minority of conversions, the gap is larger than intent and attribution alone explain and is worth investigating as a layout problem."
  - q: "How do I measure conversion rate by device?"
    a: "Group your analytics by device. In PostHog every event carries a $device_type property, so you can split sessions and conversions by device in a single HogQL query and get your own rate rather than relying on a published average."
---

Desktop converts better than mobile almost everywhere, and it has for years. Contentsquare's 2026 Digital Experience Benchmark, drawn from 99 billion web and app sessions across more than 6,000 sites between Q4 2024 and Q4 2025, puts the desktop conversion rate 74% higher than mobile. The useful question is not whether you have a gap. It is whether yours is bigger than the reasons that explain it.

## The number that counts as normal

Large benchmarks cluster somewhere around 1.5x to 2x in desktop's favour, with Contentsquare's 74% sitting in the middle of that. Treat the 1.5x to 2x range as this article's synthesis rather than a published standard, because the underlying studies define sessions and conversions differently and rarely agree to the decimal.

That caveat matters more than it sounds. You will find plenty of posts quoting a precise average conversion rate for Shopify stores or SaaS landing pages, often around 1.4% for ecommerce. Unless the post names its dataset, its time period and what it counted as a conversion, the number is folklore and your own baseline is worth more than all of it. For a longer version of that argument, see [what counts as a good SaaS landing page conversion rate](/blog/good-conversion-rate-saas-landing-page).

## Why part of the gap is not yours to fix

Two of the three usual causes are structural.

Intent differs by device. Phones dominate discovery and research, and a lot of that traffic was never going to convert on that visit. Contentsquare's same benchmark shows the effect from a different angle: returning visitors convert at 2.9% against 1.7% for new visitors. Mobile skews toward the new, browsing, not-yet-decided end of that split.

Attribution hides the mobile contribution. A visitor who finds you on a phone at lunch and signs up on a laptop that evening produces one conversion, credited entirely to desktop. The mobile session that did the persuading counts only as a bounce. Device-split conversion rates systematically understate mobile for this reason, and no amount of layout work will close that part of the gap.

The third cause is the one worth your time: mobile layouts break more often. A hero that fits on a laptop pushes the call to action below the fold on a 390 pixel wide screen. A cookie banner or promo bar that is polite on desktop covers the primary button on a phone. Tap targets sized by mouse standards get missed. None of this shows up in a conversion rate on its own, which is why the number alone cannot tell you which cause you have.

## When your gap is too big

Two patterns justify an investigation.

Mobile trails desktop by more than roughly 2x. At that point intent and attribution stop being a sufficient explanation, and the residual is usually a specific broken thing.

Mobile is the majority of your traffic and a small minority of your conversions. Traffic share is the multiplier here. A site where 70% of sessions are mobile and 20% of signups are is losing far more absolute conversions to a layout defect than a desktop-heavy B2B tool with the same ratio.

## Measure your own split in PostHog

Every PostHog event carries `$device_type`, so you can answer this without new instrumentation. Start with traffic, to establish the multiplier:

```sql
SELECT
  properties.$device_type AS device,
  count() AS pageviews,
  countDistinct(properties.$session_id) AS sessions
FROM events
WHERE event = '$pageview'
  AND properties.$pathname = '/'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY device
ORDER BY sessions DESC
```

Then your actual conversion rate per device. Replace the button text with the label on your own primary call to action:

```sql
SELECT
  properties.$device_type AS device,
  countDistinct(properties.$session_id) AS sessions,
  round(
    countDistinctIf(
      properties.$session_id,
      event = '$autocapture' AND properties.$el_text = 'Start free trial'
    ) / countDistinct(properties.$session_id) * 100,
    2
  ) AS conversion_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
GROUP BY device
ORDER BY sessions DESC
```

Illustrative sample output:

| device  | sessions | conversion_pct |
|---------|---------:|---------------:|
| Mobile  | 8,140    | 0.61           |
| Desktop | 3,920    | 3.10           |

That table is the case for spending a week on mobile. Desktop converts five times better, well past what intent and cross-device attribution explain, and mobile carries two thirds of the traffic. The absolute loss is larger than the whole desktop conversion count.

## Find the cause, not just the gap

A conversion rate tells you something is wrong without saying what. Three signals narrow it down, and all three split by device.

Scroll depth by device tells you whether mobile visitors ever reach your call to action. Compare the two:

```sql
SELECT
  properties.$device_type AS device,
  round(avg(properties.$prev_pageview_max_scroll_percentage) * 100, 1) AS avg_max_scroll_pct,
  count() AS pageleaves
FROM events
WHERE event = '$pageleave'
  AND properties.$pathname = '/'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY device
ORDER BY pageleaves DESC
```

If mobile averages 30% max scroll and your call to action sits at 60% of page height, most phone visitors never see the thing you want them to click, and the fix is a layout change rather than a copy change. The method behind that query is covered in [measuring scroll depth in PostHog](/blog/measure-scroll-depth-posthog).

Rage clicks and dead clicks concentrated on mobile point at an element that is tappable in theory and not in practice. [Ranking both by page and device](/blog/find-rage-clicks-dead-clicks-posthog) usually identifies the specific element in one query.

Looking at the page at real phone width is the last step and the one people skip. Not a responsive preview at an invented size, but the widths visitors actually use. 390 pixels covers most current phones and 360 covers the narrow end, where fold problems appear first and where a banner that overlaps a button on a small screen clears it on a large one.

## Close the part you can close

Set the expectation first: desktop converting somewhere up to twice as well as mobile is ordinary, and chasing parity is chasing an artefact of intent and attribution. Then measure your own split, and if the gap is several times over rather than under two, treat it as a layout defect with a findable cause. Scroll depth says whether they get there, frustration signals say what failed when they did, and the page at 360 pixels usually shows you the rest.

Velyr runs this check as part of its weekly pass. It reads the device split of your PostHog engagement signals and looks at your live page at three widths, 1280 by 800 for desktop and 390 by 844 and 360 by 640 for phones, so a claim about mobile layout has to be visible in a screenshot before the agent will act on it. The resulting fix arrives as a Pull Request, or a staged theme write on Shopify, and ships only after you approve it.
