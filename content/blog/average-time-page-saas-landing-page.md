---
title: "What Is the Average Time on Page for a SaaS Landing Page?"
slug: "average-time-page-saas-landing-page"
description: "As a rough guide, SaaS landing page visits last around 30–90 seconds, but time on page is a weak signal on its own. Here's how to measure your own session duration in PostHog."
tldr: "As a general estimate, a SaaS landing page visit lasts somewhere around 30–90 seconds, but time on page is a weak metric — a long time can mean engagement or confusion. That's the article's own rough guide, not a published figure. Measure your own session duration in PostHog, and read it alongside scroll depth and conversion rather than alone."
cluster: "benchmarks"
tags: ["benchmarks", "time-on-page", "session-duration", "saas", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "measure-time-page-posthog"
  - "good-scroll-depth-landing-page"
  - "good-bounce-rate-saas-marketing-site"
faqs:
  - q: "What is the average time on page for a SaaS landing page?"
    a: "As a rough, unattributed guide, around 30–90 seconds is a reasonable range for a SaaS landing page, but it varies widely with page length and intent. That's a general estimate, not a published figure, and time on page is a weak signal — interpret it alongside scroll depth and conversion."
  - q: "Is a longer time on page better?"
    a: "Not necessarily. A long visit can mean someone is engaged and reading, or that they're confused and hunting for an answer they can't find. Without scroll depth and conversion to interpret it, a high time on page tells you very little."
  - q: "How do I measure time on a landing page in PostHog?"
    a: "True per-page time is hard to capture for the last page of a visit. The practical measure is session duration — the spread between the first and last event in a session — which you can compute in HogQL with dateDiff, or read from PostHog's web analytics."
---

There's no authoritative number, but as a rough guide, **a SaaS landing page visit lasts somewhere around 30–90 seconds — and time on page is a weak signal on its own.** That's this article's own estimate, not a published figure. A long visit can mean a reader is engaged or that they're lost, so the number only means something next to scroll depth and conversion.

## Why time on page is a weak metric

The metric has two problems. First, it's hard to measure honestly: true time on a page needs the timestamp of the *next* page, which the last page of a visit never has. Second, even when you have it, the direction is ambiguous — more time is good (engaged) or bad (confused) depending entirely on what the visitor was trying to do. A 3-minute visit that ends in a signup is great; a 3-minute visit that ends in an exit is a warning.

So measure it as **session duration**, and never read it alone.

## Measure your own session duration in PostHog

Group events into sessions and take the spread between the first and last event with `dateDiff`:

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
| 58.2                | 6,740    |

This is honest: it's the average spread of activity in a session, not a precise per-page figure, and single-event sessions show zero so bounces don't inflate it. On a landing-page-heavy site, it's a fair proxy for time on the page.

## Read it in context

A session-duration number is only useful with two companions:

1. **Scroll depth.** A long session with shallow scroll is a confusion smell, not engagement — people are stuck near the top.
2. **Conversion.** A short session that converts is a *win* (fast, frictionless), not a problem. Don't try to lengthen it.

Together these turn "58 seconds" from a vanity number into a diagnosis. Long-and-shallow-and-no-conversion means people can't find what they need; short-and-converting means your page is doing its job efficiently.

## Don't chase the number

Time on page is not a goal — conversion is. Use session duration plus scroll plus conversion to judge whether engagement is healthy, and ignore borrowed averages. If you'd like those signals turned into a weekly conversion fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
