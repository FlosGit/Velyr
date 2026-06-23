---
title: "How to Track a Button Click as a Custom Event in PostHog"
slug: "track-button-click-as-custom-event-posthog"
description: "Track a button click as a custom event in PostHog with posthog.capture, add properties for context, then count and segment the clicks in HogQL — with a runnable query."
tldr: "Call posthog.capture('your_event_name', { ...properties }) in the button's click handler to record a custom event. Custom events are stable across copy and layout changes — unlike autocapture, which keys on element text — so they're what you put in funnels and dashboards. Add properties like location so you can segment the clicks later."
cluster: "posthog-recipes"
tags: ["posthog", "custom-event", "click-tracking", "hogql", "analytics"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "track-cta-clicks-posthog"
  - "build-signup-funnel-posthog"
  - "measure-scroll-depth-posthog"
  - "create-conversion-goal-posthog"
  - "track-outbound-link-clicks-posthog"
faqs:
  - q: "What's the difference between a custom event and autocapture in PostHog?"
    a: "Autocapture records clicks automatically and keys them on the element's text, so the history splits when you rename a button. A custom event is one you fire deliberately with posthog.capture under a stable name, so it survives copy and DOM changes. Use autocapture for discovery and custom events for metrics you rely on."
  - q: "How do I add context to a PostHog custom event?"
    a: "Pass a properties object as the second argument to posthog.capture, e.g. posthog.capture('cta_clicked', { location: 'hero', plan: 'growth' }). Those properties become filterable and groupable columns you can use in HogQL and insights."
  - q: "Will a custom event fire if the click navigates away immediately?"
    a: "Usually yes — posthog-js sends events with the browser's sendBeacon or keepalive fetch, which survive a navigation. If you're seeing drops, capture the event before the navigation or use a short delay; for normal links it's reliable out of the box."
---

To track a button click as a custom event in PostHog, **call `posthog.capture('your_event_name', { ...properties })` inside the button's click handler.** That records a named event you control, with whatever context you attach. Unlike autocapture — which keys clicks on element text and breaks when you rename a button — a custom event is stable, so it's the one you put in funnels and dashboards.

## Fire the event in the click handler

The event name should be a stable, lowercase, verb-style string. Attach properties that you'll want to segment by later:

```jsx
<button
  onClick={() =>
    posthog.capture('cta_clicked', { location: 'hero', plan: 'growth' })
  }
>
  Start free trial
</button>
```

That's the whole mechanism. `cta_clicked` now appears in PostHog within seconds, and `location` and `plan` are filterable properties on it.

A few rules that keep the data clean:

1. **Name it for the action, not the label.** `cta_clicked` survives a copy change from "Start free trial" to "Get started"; an autocaptured event keyed on the text would split into two.
2. **Add properties, not new event names.** Prefer `cta_clicked` with `{ location: 'hero' }` and `{ location: 'footer' }` over two separate events `hero_cta_clicked` and `footer_cta_clicked`. One event with a property is far easier to compare.
3. **Keep names consistent forever.** Renaming an event later orphans its history.

## Count and segment the clicks in HogQL

Once the event is flowing, this HogQL counts the clicks and breaks them down by the `location` property over the last 30 days:

```sql
SELECT
  properties.location AS location,
  count() AS clicks,
  countDistinct(person_id) AS people
FROM events
WHERE event = 'cta_clicked'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY location
ORDER BY clicks DESC
```

Illustrative sample output:

| location | clicks | people |
|----------|-------:|-------:|
| hero     | 1,180  | 1,040  |
| footer   | 310    | 290    |
| pricing  | 240    | 220    |

The gap between `clicks` and `people` tells you how many users click more than once — useful for spotting a confusing or unresponsive button. If the hero dwarfs the others, your above-the-fold CTA is doing the work and the others are mostly redundant.

## The no-code path: the native PostHog insight

You don't have to write HogQL. In PostHog, go to **Insights → Trends**, set the series to your `cta_clicked` event, choose the **Unique users** measurement, and add a **breakdown** by the `location` property. That reproduces the table above as a chart, and you can save it to a dashboard. Use the native insight for ongoing monitoring; reach for HogQL when you need a calculation the UI doesn't express, like dividing clicks by pageviews for a click-through rate.

## When to use a custom event vs autocapture

Autocapture is excellent for discovery — it shows you what people click without any instrumentation. But the moment a click matters to a metric you report on, give it a named custom event so it can't be silently broken by a redesign. The two coexist happily: autocapture watches everything, and your handful of custom events carry the numbers you trust.

If you want those signals turned into a weekly conversion fix — read from PostHog, written as a Pull Request — that's what [Velyr](/agent/register) does.
