---
title: "How to Create a Conversion Goal in PostHog"
slug: "create-conversion-goal-posthog"
description: "Create a conversion goal in PostHog: capture the event that represents the goal, track it as a Trends insight, and watch the rate over time with a weekly HogQL trend."
tldr: "A conversion goal in PostHog is just the event that represents success — a signup, a purchase, a demo booking — turned into something you watch over time. Capture that event with posthog.capture, add it to a Trends insight as unique users, and pin it to a dashboard. For a rate, divide it by visitors in HogQL."
cluster: "posthog-recipes"
tags: ["posthog", "conversion-goal", "trends", "hogql", "analytics"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "track-button-click-as-custom-event-posthog"
  - "build-signup-funnel-posthog"
  - "good-conversion-rate-saas-landing-page"
  - "posthog-vs-google-analytics-4-conversion-tracking"
  - "track-outbound-link-clicks-posthog"
faqs:
  - q: "What is a conversion goal in PostHog?"
    a: "It's the event that represents the outcome you care about — a signup, purchase, or booking — that you track over time. PostHog doesn't have a separate 'goal' object; you define the goal by capturing the event and putting it in a Trends insight or funnel."
  - q: "How do I turn an event into a conversion rate in PostHog?"
    a: "Divide the unique users who fired the goal event by the unique users who reached the relevant page, over the same window. The Trends insight gives you the raw count; HogQL lets you compute the ratio directly."
  - q: "Should I use an Action or an event for a conversion goal?"
    a: "Either works. A raw custom event is simplest. An Action lets you combine several events or match autocaptured elements under one named goal, which is handy if the same conversion can happen in more than one way."
---

A conversion goal in PostHog isn't a special object — **it's the event that represents success, tracked over time.** Capture that event with `posthog.capture`, add it to a Trends insight as unique users, pin it to a dashboard, and you have a goal you can watch. For a conversion *rate*, divide it by visitors in HogQL.

## Step 1: Capture the goal event

Decide what "converted" means — a completed signup, a purchase, a booked demo — and fire one stable event for it:

```js
// when the account is created
posthog.capture('signup_completed', { plan: 'trial' })
```

Use a clear, lowercase name and keep it consistent. The properties (here `plan`) let you break the goal down later.

## Step 2: Track it in the native Trends insight

In PostHog, go to **Insights → Trends**, set the series to `signup_completed`, and choose the **Unique users** measurement so repeat events from one person don't inflate it. Group by week for a clean trend, add a **breakdown** by `plan` if you want the split, and **save it to a dashboard**. That's your goal, monitored — no query required.

## Step 3: Turn it into a rate with HogQL

A raw count rises and falls with traffic; a *rate* tells you whether the page is getting better. This HogQL computes the weekly conversion rate — goal completions over visitors:

```sql
SELECT
  toStartOfWeek(timestamp) AS week,
  countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/') AS visitors,
  countDistinctIf(person_id, event = 'signup_completed') AS conversions,
  round(
    countDistinctIf(person_id, event = 'signup_completed')
    / countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/') * 100,
  2) AS conversion_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 8 WEEK
GROUP BY week
ORDER BY week
```

Illustrative sample output:

| week       | visitors | conversions | conversion_rate_pct |
|------------|---------:|------------:|--------------------:|
| 2026-05-04 | 1,820    | 58          | 3.19                |
| 2026-05-11 | 1,910    | 71          | 3.72                |
| 2026-05-18 | 2,040    | 84          | 4.12                |

Watching the *rate* by week separates a real improvement from a traffic bump — the rate climbing while traffic is flat is a genuine win.

## When to use an Action instead of a raw event

If a conversion can happen in more than one way — say a signup that can complete from two different forms — wrap the events in a PostHog **Action**, which matches multiple events or autocaptured elements under one named goal. Then point your insight at the Action. For a single clean event, the raw event is simpler.

## Make the goal earn its place

A conversion goal is only useful if it drives a decision. Put the rate on a dashboard you actually look at, set an alert if PostHog can notify you on a drop, and when it dips, go find the funnel step that's leaking. If you'd like that leak found and the fix shipped as a Pull Request each week, that's what [Velyr](/agent/register) does.
