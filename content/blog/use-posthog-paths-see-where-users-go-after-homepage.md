---
title: "How to Use PostHog Paths to See Where Users Go After the Homepage"
slug: "use-posthog-paths-see-where-users-go-after-homepage"
description: "Use PostHog's Paths insight to see the routes visitors take after the homepage, then confirm the most common destinations with a supporting HogQL pageview query."
tldr: "PostHog's native Paths insight visualises the actual journeys visitors take, so set the starting point to your homepage and it shows where they go next and where they drop off. Paths is the right tool because it understands event sequence; a HogQL query of pageviews is a useful supporting check on which destinations get the most traffic."
cluster: "posthog-recipes"
tags: ["posthog", "paths", "user-journey", "hogql", "navigation"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "find-most-viewed-pages-posthog-hogql"
  - "build-signup-funnel-posthog"
  - "measure-scroll-depth-posthog"
faqs:
  - q: "What does the PostHog Paths insight show?"
    a: "It visualises the sequences of pages and events users move through, branching at each step. Set a start point — like your homepage — and it shows the most common next steps, how traffic splits, and where people exit. It's built to understand event order, which a raw query can't easily do."
  - q: "Can I see user journeys with HogQL instead of Paths?"
    a: "Reconstructing true ordered journeys in HogQL is hard, because it needs per-session sequencing. HogQL is better for supporting questions like which pages get the most traffic. For the actual flow and branching, use the native Paths insight."
  - q: "How do I find where users drop off after the homepage?"
    a: "In the Paths insight, set the homepage as the start and look at the exit points — branches where a large share of traffic leaves rather than continuing. Those exits are where the journey breaks, and they're your first place to investigate."
---

To see where visitors go after your homepage, **use PostHog's native Paths insight: set the starting point to the homepage and it visualises the actual routes people take, how the traffic branches, and where they exit.** A HogQL pageview query is a useful supporting check on which destinations get the most traffic, but Paths is the right tool because it understands the *order* of events, which a raw query doesn't.

## Why Paths and not a query

The question "where do users go *after* the homepage" is fundamentally about sequence — the page they viewed next, in order, within a session. That ordering is exactly what the **Paths insight** is built for and what's awkward to express in plain HogQL (it needs per-session sequencing). So lead with the native insight here, and use HogQL for the supporting numbers.

## Build the Paths insight

1. In PostHog, open **Insights → Paths**.
2. Set the **start point** to your homepage pageview (path `/`).
3. Choose **pageviews** as the path type (you can include custom events too).
4. Optionally cap the number of steps so the diagram stays readable.

PostHog draws the flow: from `/`, what share went to `/pricing`, what share to `/blog`, what share to the signup, and crucially, what share **exited** without going anywhere. The wide exit branches are the story — they're where the journey you intended breaks down.

Reading it, ask two things: are people reaching the pages that lead to conversion (pricing, signup), and where does the largest branch leave the site entirely?

## A supporting check in HogQL

Paths shows the flow; this HogQL confirms which destinations actually pull the most traffic, as a sanity check on what the diagram implies:

```sql
SELECT
  properties.$pathname AS path,
  count() AS pageviews,
  countDistinct(person_id) AS visitors
FROM events
WHERE event = '$pageview'
  AND properties.$pathname != '/'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY path
ORDER BY pageviews DESC
LIMIT 12
```

Illustrative sample output:

| path      | pageviews | visitors |
|-----------|----------:|---------:|
| /pricing  | 4,120     | 3,010    |
| /blog     | 3,480     | 2,640    |
| /signup   | 1,260     | 1,150    |

This doesn't prove these are the *next* pages after the homepage — only Paths shows order — but if `/pricing` is both a top destination and a top next-step in the diagram, you can trust it as a key route to protect.

## Turn the flow into a decision

If the Paths diagram shows most homepage visitors exiting rather than reaching pricing or signup, your homepage isn't pointing people anywhere — the next-step links or CTAs aren't doing their job. If they reach pricing but drop there, the problem moved downstream. Either way, the biggest exit branch is your first place to work. If you'd like that drop found and the fix shipped as a Pull Request each week, that's what [Velyr](/agent/register) does.
