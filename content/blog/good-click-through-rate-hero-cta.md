---
title: "What Is a Good Click-Through Rate on a Hero CTA?"
slug: "good-click-through-rate-hero-cta"
description: "As a rough guide a hero CTA gets clicked by 5–15% of visitors, but the figure depends on traffic intent and whether the button is even seen. Here's how to measure your own in PostHog."
tldr: "As a general estimate, a hero CTA is clicked by somewhere around 5–15% of visitors who see it, though warm, high-intent traffic runs higher. That's the article's own rough guide, not a published figure. The number that matters is your own seen-to-clicked rate — and a low one usually means the button is below the fold, not that the copy is wrong."
cluster: "benchmarks"
tags: ["benchmarks", "cta", "click-through-rate", "hero-section", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "track-cta-clicks-posthog"
  - "fix-low-converting-react-hero-section"
  - "good-conversion-rate-saas-landing-page"
faqs:
  - q: "What is a good click-through rate on a hero CTA?"
    a: "As a rough, unattributed guide, 5–15% of visitors clicking the hero CTA is a reasonable range, with warm high-intent traffic higher. That's a general estimate, not a published benchmark. Measure your own seen-to-clicked rate, because the visibility of the button changes the number more than the wording does."
  - q: "Why is my hero CTA click rate low?"
    a: "Most often because a large share of visitors never see it — it sits below the fold, or a slow hero pushes it down. Before rewriting the button, measure what fraction of visitors actually reach it; if many don't, the fix is position, not copy."
  - q: "Should I measure CTA clicks against all visitors or those who saw it?"
    a: "Both are useful. Clicks over all visitors is your blended rate; clicks over visitors who actually saw the button (via an impression event) isolates whether the button itself is persuasive. A big gap between the two points to a visibility problem."
---

There's no authoritative number, but as a rough guide, **a hero CTA is clicked by somewhere around 5–15% of the visitors who see it, with warm, high-intent traffic running higher.** That's this article's own estimate, not a published figure. The rate that matters is your own — and a low one usually means the button isn't being *seen*, not that the copy is wrong.

## Seen vs clicked: the distinction that matters

A hero CTA click rate has two hidden inputs: how many visitors *saw* the button, and how many of those *clicked*. Most "low CTA rate" problems are actually visibility problems — the button is below the fold, or a slow-loading hero pushes it down on mobile. Measuring clicks against *all* visitors blends those together and hides the cause.

So measure both: clicks over all visitors (your blended rate) and, ideally, clicks over visitors who actually saw the button.

## Measure your own hero CTA rate in PostHog

Capture a `cta_clicked` event with `location: 'hero'`. This HogQL gives the click rate against everyone who landed:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/') AS visitors,
  countDistinctIf(person_id, event = 'cta_clicked' AND properties.location = 'hero') AS hero_clicks,
  round(
    countDistinctIf(person_id, event = 'cta_clicked' AND properties.location = 'hero')
    / countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/') * 100,
  2) AS hero_ctr_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| visitors | hero_clicks | hero_ctr_pct |
|---------:|------------:|-------------:|
| 5,800    | 520         | 8.97         |

A ~9% rate sits comfortably in the rough range. To split visibility from persuasion, also fire a `cta_seen` event with an IntersectionObserver when the button scrolls into view, then compare `cta_clicked` against `cta_seen` — that isolates whether the button itself converts the people who reach it.

## What the number tells you

- **Low blended rate, high seen-to-clicked rate** → the button works, but too few people see it. Fix position: move it up, shorten the hero, add a sticky CTA.
- **Low seen-to-clicked rate** → people see it and don't click. Now it's a copy or offer problem — the headline isn't landing or the CTA promises the wrong thing.
- **High rate but low downstream conversion** → the click is easy but the next step leaks; look further down the funnel.

## Improve your own, not a benchmark

Establish your hero CTA rate, separate visibility from persuasion, and fix whichever is weak — usually visibility first. Compare against your own history week over week. If you'd like the weak link found and the fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
