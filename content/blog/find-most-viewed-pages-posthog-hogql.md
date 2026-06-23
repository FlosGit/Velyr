---
title: "How to Find Your Most-Viewed Pages in PostHog with HogQL"
slug: "find-most-viewed-pages-posthog-hogql"
description: "Find your most-viewed pages in PostHog with one HogQL query: group $pageview events by $pathname, count views and unique visitors, and order by traffic. Includes the native path."
tldr: "One HogQL query gives you your most-viewed pages: select properties.$pathname from $pageview events, count views and unique visitors, group by path, and order by views. It surfaces where your traffic actually goes — which is where conversion work has the most leverage. PostHog's web analytics shows the same thing without a query."
cluster: "posthog-recipes"
tags: ["posthog", "hogql", "pageviews", "analytics", "traffic"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "use-posthog-paths-see-where-users-go-after-homepage"
  - "measure-scroll-depth-posthog"
  - "good-conversion-rate-saas-landing-page"
  - "posthog-vs-google-analytics-4-conversion-tracking"
  - "create-cohort-high-intent-visitors-posthog"
  - "measure-time-page-posthog"
faqs:
  - q: "How do I find my most popular pages in PostHog?"
    a: "Run a HogQL query that groups $pageview events by the $pathname property, counts views and unique visitors, and orders by views descending. The top rows are your highest-traffic pages — the ones where a conversion change reaches the most people."
  - q: "Should I count pageviews or unique visitors?"
    a: "Look at both. Pageviews show total traffic including repeat views; unique visitors (countDistinct on person_id) show how many real people saw the page. A page with many views but few visitors is being refreshed or revisited heavily, which is itself worth understanding."
  - q: "Why does finding top pages matter for conversion?"
    a: "Conversion work compounds with traffic. A 1% improvement on your highest-traffic page beats a 10% improvement on a page almost nobody sees. Knowing where the traffic actually goes tells you where a fix has the most leverage."
---

Finding your most-viewed pages takes one HogQL query. **Select `properties.$pathname` from `$pageview` events, count views and unique visitors, group by path, and order by views.** The result is where your traffic actually goes — which is where conversion work has the most leverage, because a small improvement on a high-traffic page beats a big one on a page nobody sees.

## The query

```sql
SELECT
  properties.$pathname AS path,
  count() AS pageviews,
  countDistinct(person_id) AS visitors
FROM events
WHERE event = '$pageview'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY path
ORDER BY pageviews DESC
LIMIT 20
```

Illustrative sample output:

| path        | pageviews | visitors |
|-------------|----------:|---------:|
| /           | 18,400    | 12,900   |
| /pricing    | 5,210     | 4,080    |
| /blog       | 4,760     | 3,540    |
| /blog/cro   | 2,130     | 1,980    |
| /signup     | 1,640     | 1,510    |

Each piece earns its place: `properties.$pathname` is the page path, `count()` is total views, and `countDistinct(person_id)` is how many real people saw it. Ordering by `pageviews` puts your busiest pages on top.

## Read views and visitors together

The gap between the two columns is informative:

- **Views ≈ visitors** (like `/blog/cro` above) — most people view it once. Normal for content.
- **Views ≫ visitors** (like `/`) — heavy repeat viewing. Expected for a homepage people return to, but worth a second look on an app page where it might signal confusion or reloading.

For conversion prioritisation, sort by **visitors** rather than views — that's the number of distinct people a change would reach.

## The native path: web analytics

If you'd rather not write HogQL, PostHog's **Web Analytics** section lists top pages with views and visitors out of the box, and you can change the date range and filter by source. Use it for quick browsing; reach for HogQL when you need to combine the page list with another condition — say, top pages *for mobile users* — that the canned view doesn't offer.

## Turn the list into a priority order

Your most-viewed pages are your conversion priority list:

1. **Take the top three by visitors.** These are where a fix reaches the most people.
2. **Check each one's job.** Is the homepage sending people deeper? Is pricing converting? Is the top blog post leading anywhere?
3. **Fix the highest-traffic page with the clearest problem first** — that's where effort compounds.

A 1% lift on a page seen by 12,000 people is worth more than a 10% lift on one seen by 200. If you'd like your highest-leverage page found and the fix shipped as a Pull Request each week, that's what [Velyr](/agent/register) does.
