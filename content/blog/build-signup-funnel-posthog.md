---
title: "How to Build a Signup Funnel in PostHog for a SaaS Site"
slug: "build-signup-funnel-posthog"
description: "Build a signup funnel in PostHog step by step: define the events, create a Funnel insight, and reproduce it in HogQL with windowFunnel so you can see exactly which step leaks the most users."
tldr: "To build a signup funnel in PostHog, capture one event per step (landing → signup_started → signup_completed → activated), create a Funnel insight in that order, and set a conversion window. For ad-hoc analysis, reproduce it in HogQL with the windowFunnel function. The step with the steepest drop is where to focus."
cluster: "posthog-recipes"
tags: ["posthog", "funnel", "saas", "hogql", "activation"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "measure-scroll-depth-posthog"
  - "track-cta-clicks-posthog"
  - "good-trial-to-paid-conversion-rate-saas"
  - "create-conversion-goal-posthog"
  - "use-posthog-paths-see-where-users-go-after-homepage"
  - "build-retention-chart-posthog-saas"
faqs:
  - q: "What events do I need for a signup funnel?"
    a: "One event per meaningful step. A minimal SaaS funnel is: a landing $pageview, signup_started (form opened), signup_completed (account created), and activated (first key action). Capture each with a stable event name so the funnel stays consistent over time."
  - q: "What is a conversion window in a PostHog funnel?"
    a: "The time a user has to complete all steps and still count as converted — for example 7 days. Set it to match your real buying cycle: too short under-counts conversions that take days, too long lets unrelated sessions leak in."
  - q: "Can I build a funnel in HogQL instead of the UI?"
    a: "Yes. The windowFunnel aggregate function evaluates an ordered sequence of conditions within a time window and returns how many steps each user completed, which you can group into a funnel. It's ideal for ad-hoc or version-controlled analysis."
---

A signup funnel in PostHog takes three things: **the right events, a Funnel insight in step order, and a sensible conversion window.** Then the steepest drop between two steps tells you exactly where to spend your next week.

## Step 1: Capture one event per step

A minimal but honest SaaS signup funnel is four steps:

```js
// 1. landing — autocaptured as $pageview, no code needed
// 2. user opens the signup form
posthog.capture('signup_started')
// 3. account created
posthog.capture('signup_completed', { plan: 'trial' })
// 4. first meaningful action (your activation moment)
posthog.capture('activated', { feature: 'connected_repo' })
```

Use stable, lowercase event names and keep them consistent — renaming an event later breaks historical funnels. Pick an `activated` event that reflects real value (a connected integration, a first project), not just "logged in again."

## Step 2: Create the Funnel insight

In PostHog → **Insights → Funnel**, add the steps in order:

1. `$pageview` (optionally filtered to your landing path)
2. `signup_started`
3. `signup_completed`
4. `activated`

Set the **conversion window** to match your buying cycle — 7 days is a reasonable default for a trial product. PostHog shows the conversion rate between each step and the overall rate.

## Step 3: Read the steepest drop

A funnel's value is the *relative* drop between steps, not the absolute numbers:

| Step | Users | Step conversion |
|------|------:|----------------:|
| Landing | 8,000 | — |
| signup_started | 1,200 | 15% |
| signup_completed | 760 | 63% |
| activated | 410 | 54% |

Here the worst leak is landing → signup_started (only 15% even open the form). That points upstream to the page and CTA — not to the form itself. Always fix the steepest drop first; optimizing a later step with a small drop wastes effort.

## The HogQL version (the unique part)

For ad-hoc or version-controlled analysis, reproduce the funnel with `windowFunnel`, which returns how many ordered steps each user completed within a window:

```sql
SELECT
  level,
  count() AS users
FROM (
  SELECT
    person_id,
    windowFunnel(7 * 86400)(
      timestamp,
      event = '$pageview',
      event = 'signup_started',
      event = 'signup_completed',
      event = 'activated'
    ) AS level
  FROM events
  WHERE timestamp > now() - INTERVAL 30 DAY
  GROUP BY person_id
)
GROUP BY level
ORDER BY level
```

`windowFunnel(7 * 86400)(...)` evaluates the conditions in order within a 7-day window and yields each user's furthest step (0–4). Grouping by `level` rebuilds the funnel counts — now in a query you can paste into a dashboard, diff in git, or schedule.

## Keep it honest

Don't reorder events to flatter the numbers, and don't pick an `activated` definition so loose it always fires. A funnel is only useful if each step represents real progress toward value — then the steepest drop is a reliable map of where to work next.
