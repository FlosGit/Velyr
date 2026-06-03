---
title: "How to Measure Time on Page in PostHog"
slug: "measure-time-page-posthog"
description: "Measure time on page in PostHog: use the native session duration, or compute a session-duration proxy in HogQL with dateDiff between the first and last event in each session."
tldr: "PostHog doesn't expose a single clean 'time on page' number, because true per-page time needs the gap between consecutive pageviews. The practical measures are session duration — the spread between a session's first and last event, which you can compute in HogQL with dateDiff — and PostHog's native web analytics. Both are honest proxies for engagement."
cluster: "posthog-recipes"
tags: ["posthog", "time-on-page", "session-duration", "hogql", "engagement"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "measure-scroll-depth-posthog"
  - "average-time-page-saas-landing-page"
  - "find-most-viewed-pages-posthog-hogql"
faqs:
  - q: "Does PostHog measure time on page directly?"
    a: "Not as a single tidy metric. True per-page time needs the interval between consecutive pageviews, which the last page of a session can't provide. The honest, available measures are session duration and the engagement signals in PostHog's web analytics. Scroll depth is often a better proxy for how engaged a single page is."
  - q: "How do I calculate session duration in PostHog with HogQL?"
    a: "Group events by session, take the difference between the earliest and latest timestamp in each session with dateDiff, then average across sessions. It's the spread of activity within a session — a reasonable proxy for engagement, especially on single-page-heavy sites."
  - q: "Is time on page a good engagement metric?"
    a: "It's a weak one on its own. A high time on page can mean deep engagement or a confused visitor who can't find what they need. Pair it with scroll depth and conversion to interpret it, rather than treating more time as automatically better."
---

PostHog doesn't give you a single, clean "time on page" number — and neither does any analytics tool, honestly, because true per-page time depends on the gap to the *next* pageview, which the last page of a visit never has. **The practical measures are session duration — the spread between a session's first and last event, computable in HogQL with `dateDiff` — and PostHog's native web analytics.** Both are honest proxies for engagement.

## Why "time on page" is slippery

To know how long someone spent on page A, you need the timestamp of their move to page B. For the last page they view — which includes every bounced single-page session — there's no "next" event, so the time is unknown. Tools paper over this with estimates. Rather than trust a fuzzy per-page number, measure **session duration** (how long the whole visit lasted) and lean on **scroll depth** for how engaged a single page was.

## Compute session duration in HogQL

Group events into sessions, take the spread between the first and last event with `dateDiff`, and average it:

```sql
SELECT
  round(avg(duration_seconds), 1) AS avg_session_seconds,
  count() AS sessions
FROM (
  SELECT
    properties.$session_id AS session,
    dateDiff('second', min(timestamp), max(timestamp)) AS duration_seconds
  FROM events
  WHERE timestamp > now() - INTERVAL 30 DAY
    AND properties.$session_id != ''
  GROUP BY session
)
```

Illustrative sample output:

| avg_session_seconds | sessions |
|--------------------:|---------:|
| 96.4                | 8,120    |

This is honest: it's the average spread of activity within a session, not a per-page figure. On a landing-page-heavy site where most sessions are a single page, it's a decent stand-in for time on that page. Single-event sessions naturally show a duration of zero, which keeps bounces from inflating the average.

## The native path: PostHog web analytics

If you don't want to write HogQL, PostHog's **Web Analytics** section reports session duration and engagement out of the box, and **session replays** let you watch how long real users actually linger and where they stall. Use web analytics for the aggregate number and replays to understand *why* it's high or low.

## A better single-page engagement signal

For one page, scroll depth usually beats time. PostHog records the max scroll of a pageview on the `$pageleave` event, so you can ask "did people actually read this?" directly:

```sql
SELECT
  round(avg(properties.$prev_pageview_max_scroll_percentage) * 100, 1) AS avg_max_scroll_pct,
  count() AS pageleaves
FROM events
WHERE event = '$pageleave'
  AND properties.$pathname = '/'
  AND timestamp > now() - INTERVAL 30 DAY
```

A long time on page with shallow scroll often means confusion, not engagement — which is exactly the nuance a raw time number hides.

## Use it as a proxy, not a target

Don't optimise for time on page directly; a confused visitor stays a long time too. Read session duration and scroll depth together, against conversion, to judge whether engagement is healthy. If you'd like those signals turned into a weekly conversion fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
