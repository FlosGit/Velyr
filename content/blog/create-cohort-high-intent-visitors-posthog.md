---
title: "How to Create a Cohort of High-Intent Visitors in PostHog"
slug: "create-cohort-high-intent-visitors-posthog"
description: "Create a high-intent visitor cohort in PostHog from behaviour like viewing pricing or deep scrolling, then size and use it. Includes the native cohort builder and a HogQL check."
tldr: "Define high intent by behaviour, not guesswork: people who viewed pricing, scrolled deep, or returned more than once. Build it as a behavioural cohort in PostHog's cohort builder, then use it to segment funnels and retarget. A HogQL query sizes the group and confirms your definition catches real intent."
cluster: "posthog-recipes"
tags: ["posthog", "cohorts", "high-intent", "hogql", "segmentation"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "build-retention-chart-posthog-saas"
  - "track-button-click-as-custom-event-posthog"
  - "what-is-a-micro-conversion"
faqs:
  - q: "What is a behavioural cohort in PostHog?"
    a: "A cohort is a saved group of users defined by what they did — fired a particular event, did it a certain number of times, or within a time window. A high-intent cohort might be everyone who viewed pricing and visited more than twice in the last 30 days. PostHog updates it automatically as behaviour changes."
  - q: "How do I define high intent?"
    a: "Use behaviour that correlates with buying: viewing pricing, starting a signup, returning multiple times, or scrolling deep on a key page. Combine two or three of these so the cohort captures genuine interest rather than a single accidental click."
  - q: "What can I do with a high-intent cohort?"
    a: "Segment your funnels and insights by it to see how high-intent users convert differently, focus session-replay review on them, and use it for retargeting. It turns a vague idea of 'interested visitors' into a precise, reusable group."
---

Define high intent by behaviour, not a hunch. **The people worth grouping are those who viewed pricing, scrolled deep on a key page, or returned more than once — signals that correlate with buying.** Build them as a behavioural cohort in PostHog's cohort builder, then use it to segment funnels and focus your attention. A HogQL query sizes the group and checks the definition is catching real intent.

## What makes a good high-intent definition

A single action is noisy — anyone can land on pricing by accident. High intent shows up as a *combination* of signals:

- **Viewed pricing** — looked at what it costs.
- **Returned more than once** — came back deliberately.
- **Started the signup** — the strongest pre-purchase signal.
- **Scrolled deep on a key page** — actually read it.

Combine two or three so the cohort means something. "Viewed pricing AND visited twice" is far more intentful than either alone.

## Build it in the native cohort builder

PostHog's cohort builder is the right tool because a cohort auto-updates as people's behaviour changes:

1. Go to **People → Cohorts → New cohort** and choose a **behavioural** cohort.
2. Add a condition: completed event `viewed_pricing` in the last 30 days.
3. Add a second condition: completed `$pageview` at least 2 times in the last 30 days.
4. Save it as "High intent — last 30 days."

Now you can pick that cohort as a filter on any insight or funnel, so you can compare how high-intent visitors convert versus everyone else.

## Size and sanity-check it with HogQL

Before relying on a cohort, confirm it's neither empty nor everyone. This HogQL counts people who match the core condition:

```sql
SELECT
  countDistinct(person_id) AS high_intent_people
FROM events
WHERE event = 'viewed_pricing'
  AND timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| high_intent_people |
|-------------------:|
| 1,460              |

If that number is a sensible slice of your traffic — large enough to act on, small enough to be meaningful — your definition is in the right range. If it's almost everyone, tighten it (add the return-visit condition); if it's a handful, loosen it.

## Put the cohort to work

1. **Segment your signup funnel by the cohort** to see the high-intent conversion rate — it should be far above the site-wide rate, which validates the definition.
2. **Review session replays of the cohort** who *didn't* convert — these are your most painful, most fixable losses.
3. **Use it for retargeting** if you run ads, so spend goes to people already showing interest.

A precise high-intent cohort turns "interested visitors" from a vibe into a group you can measure and act on. If you'd like the reasons high-intent users *don't* convert found and fixed as a Pull Request, that's what [Velyr](/agent/register) does.
