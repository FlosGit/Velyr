---
title: "How to Measure Scroll Depth in PostHog"
slug: "measure-scroll-depth-posthog"
description: "Measure scroll depth in PostHog using the $pageleave event's $prev_pageview_max_scroll_percentage property — including bounced sessions. Runnable HogQL for per-page averages and a distribution histogram."
tldr: "PostHog captures scroll depth automatically on the $pageleave event as $prev_pageview_max_scroll_percentage. Query that property — not $pageview — so bounced single-page sessions are included. This gives you per-page average max scroll and a distribution, which tells you what share of visitors ever reach your CTA."
cluster: "posthog-recipes"
tags: ["posthog", "scroll-depth", "hogql", "analytics", "pageleave"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "build-signup-funnel-posthog"
  - "track-cta-clicks-posthog"
  - "fix-low-converting-react-hero-section"
  - "good-scroll-depth-landing-page"
  - "measure-time-page-posthog"
  - "use-posthog-paths-see-where-users-go-after-homepage"
faqs:
  - q: "Does PostHog track scroll depth automatically?"
    a: "Yes, when autocapture is enabled. PostHog records the maximum scroll percentage of a pageview and attaches it to the next $pageleave event as $prev_pageview_max_scroll_percentage. You don't need a custom event."
  - q: "Why query $pageleave instead of $pageview for scroll depth?"
    a: "Scroll depth is only known when the visitor leaves the page, so it lives on $pageleave. Using $pageleave also counts bounced single-page sessions, which is exactly the audience whose shallow scrolling you care about."
  - q: "What is a good average scroll depth?"
    a: "It varies by page length and intent, but on a typical landing page an average max scroll around 40–60% is common. The useful signal isn't the absolute number — it's whether your CTA sits above or below where most visitors stop."
---

PostHog already measures scroll depth for you. With autocapture on, it records the maximum scroll percentage of each pageview and attaches it to the **`$pageleave`** event as **`$prev_pageview_max_scroll_percentage`**. To analyze it, query `$pageleave` — not `$pageview` — so bounced sessions are included.

## The core query: average max scroll per page

This HogQL returns the average maximum scroll depth for your top pages over 30 days:

```sql
SELECT
  properties.$pathname AS path,
  round(avg(properties.$prev_pageview_max_scroll_percentage) * 100, 1) AS avg_max_scroll_pct,
  count() AS pageleaves
FROM events
WHERE event = '$pageleave'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY path
ORDER BY pageleaves DESC
LIMIT 20
```

Illustrative sample output:

| path        | avg_max_scroll_pct | pageleaves |
|-------------|-------------------:|-----------:|
| /           | 44.8               | 6,210      |
| /pricing    | 61.2               | 1,840      |
| /blog       | 71.5               | 980        |

The homepage average of ~45% means **anything below the halfway mark is seen by a minority** of visitors. If your primary CTA is at 70% depth there, most people never reach it.

## Why `$pageleave`, not `$pageview`

The maximum scroll of a pageview is only known once the visitor leaves it, so PostHog can't put it on `$pageview`. Querying `$pageleave` has a second benefit: it includes **bounced single-page sessions**, which is precisely the shallow-scrolling audience you most want to understand. Averaging scroll over `$pageview` would silently drop them.

## Going deeper: a scroll distribution

An average hides the shape. This bucketed query shows *how many* visitors reach each depth band on the homepage — far more actionable than a single mean:

```sql
SELECT
  multiIf(
    properties.$prev_pageview_max_scroll_percentage < 0.25, '0–25%',
    properties.$prev_pageview_max_scroll_percentage < 0.50, '25–50%',
    properties.$prev_pageview_max_scroll_percentage < 0.75, '50–75%',
    '75–100%'
  ) AS depth_band,
  count() AS sessions
FROM events
WHERE event = '$pageleave' AND properties.$pathname = '/'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY depth_band
ORDER BY depth_band
```

Illustrative sample output:

| depth_band | sessions |
|------------|---------:|
| 0–25%      | 2,790    |
| 25–50%     | 1,560    |
| 50–75%     | 1,020    |
| 75–100%    | 840      |

If 45% of sessions stop in the first quarter, your above-the-fold content is doing nearly all the work — so that's where your headline and CTA have to land.

## Turn the number into a decision

Scroll depth is a means, not an end. Use it to answer one question: *does my primary CTA sit above or below where most visitors stop?* If it's below, move it up (or add a sticky CTA) and re-run the query in two weeks to confirm more visitors now reach the action. From there, build a funnel to see what they do after they arrive.
