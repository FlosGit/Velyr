---
title: "What Is a Good Scroll Depth for a Landing Page?"
slug: "good-scroll-depth-landing-page"
description: "As a rough guide a landing page averages 40–60% max scroll, but the number matters less than whether your CTA sits above or below where most people stop. Measure your own in PostHog."
tldr: "As a general estimate, landing pages see an average maximum scroll depth around 40–60%, though it depends heavily on page length. That's the article's own rough guide, not a published figure. The useful question isn't whether your number is 'good' — it's whether your primary CTA sits above or below the depth most visitors actually reach."
cluster: "benchmarks"
tags: ["benchmarks", "scroll-depth", "landing-page", "engagement", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "measure-scroll-depth-posthog"
  - "good-click-through-rate-hero-cta"
  - "fix-low-converting-react-hero-section"
faqs:
  - q: "What is a good average scroll depth for a landing page?"
    a: "As a rough, unattributed guide, an average maximum scroll around 40–60% is common, but it depends on page length — a short page is read more fully than a long one. That's a general estimate, not a published standard. What matters is whether your CTA sits above the depth most visitors reach."
  - q: "Is higher scroll depth always better?"
    a: "No. High scroll can mean engagement, or it can mean people are hunting for something they can't find. And if your CTA is near the top, you don't need deep scrolling to convert. Read scroll depth alongside conversion, not as a goal in itself."
  - q: "How do I measure scroll depth on a landing page?"
    a: "PostHog records the maximum scroll percentage of a pageview on the $pageleave event. Average that property for the page, querying $pageleave (not $pageview) so bounced single-page sessions are included in the figure."
---

There's no authoritative figure, but as a rough guide, **landing pages see an average maximum scroll depth around 40–60%, though it swings with page length.** That's this article's own estimate, not a published benchmark. And the genuinely useful question isn't whether your number is "good" — it's whether your primary CTA sits above or below the depth most visitors actually reach.

## Why the absolute number barely matters

A 45% average scroll is meaningless without context. On a short page, 45% might mean people skimmed and left; on a long page, 45% might be deep engagement. And critically: if your CTA is in the first viewport, you don't *need* people to scroll deep to convert. Scroll depth only becomes actionable when you compare it to **where your CTA actually sits.**

So treat the 40–60% range as orientation, then ask the real question.

## Measure your own scroll depth in PostHog

PostHog stores the max scroll of a pageview on the `$pageleave` event. Average it for your landing page, using `$pageleave` so bounced sessions count:

```sql
SELECT
  round(avg(properties.$prev_pageview_max_scroll_percentage) * 100, 1) AS avg_max_scroll_pct,
  count() AS pageleaves
FROM events
WHERE event = '$pageleave'
  AND properties.$pathname = '/'
  AND timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| avg_max_scroll_pct | pageleaves |
|-------------------:|-----------:|
| 47.3               | 4,920      |

A 47% average means **the typical visitor never sees the bottom half of the page.** That's the actionable fact: anything below ~50% depth — including a CTA, a key proof point, or your pricing — is invisible to most people.

## Turn scroll depth into a CTA decision

Line up your scroll number against your layout:

1. **Find your CTA's depth.** Where does the primary button sit as a percentage of page height?
2. **Compare it to the average max scroll.** If the CTA is at 70% and the average scroll is 47%, most visitors never reach it.
3. **Act on the gap.** Move the CTA up, shorten the hero, or add a sticky CTA so the action follows the visitor down.

A page where the CTA sits above the average scroll depth doesn't need a higher scroll number — it's already in front of people.

## Don't optimise scroll for its own sake

More scrolling isn't the goal; conversion is. A page can convert brilliantly with shallow scroll if the offer and CTA are up top. Measure your own depth, compare it to your CTA position, and fix the mismatch. If you'd like that mismatch found and the fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
