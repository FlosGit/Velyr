---
title: "How to Track CTA Clicks in PostHog with Autocapture"
slug: "track-cta-clicks-posthog"
description: "Track CTA clicks in PostHog two ways: read them from $autocapture by element text, or fire a named custom event for reliability. Runnable HogQL to rank your most-clicked buttons and compute click-through."
tldr: "PostHog's autocapture already records button and link clicks as $autocapture events with the element text in $el_text, so you can rank your most-clicked CTAs with no code. For a CTA you care about, also fire a named custom event — it survives copy changes and is unambiguous. Use both: autocapture for discovery, custom events for the metrics that matter."
cluster: "posthog-recipes"
tags: ["posthog", "autocapture", "cta", "hogql", "click-tracking"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "measure-scroll-depth-posthog"
  - "build-signup-funnel-posthog"
  - "fix-low-converting-react-hero-section"
  - "create-conversion-goal-posthog"
  - "track-outbound-link-clicks-posthog"
  - "improve-conversion-shopify-product-page-without-app"
  - "find-rage-clicks-dead-clicks-posthog"
faqs:
  - q: "Does PostHog track button clicks automatically?"
    a: "Yes. With autocapture enabled, PostHog records clicks as $autocapture events and stores the clicked element's visible text in the $el_text property, so you can analyze CTA clicks without adding any code."
  - q: "Should I use autocapture or a custom event for CTA clicks?"
    a: "Both. Autocapture is great for discovery and ranking clicks with zero instrumentation, but it's tied to element text and DOM structure, so it breaks when you change copy. For the CTA your business depends on, also fire a named custom event that stays stable."
  - q: "How do I calculate CTA click-through rate in PostHog?"
    a: "Divide unique users who clicked the CTA by unique users who viewed the page it's on, over the same window. With autocapture you can get both from the events table in a single HogQL query."
---

PostHog gives you two ways to track CTA clicks: **autocapture**, which records every click automatically with the element's text, and **named custom events**, which are stable and unambiguous. Use autocapture to discover what people click, and custom events to measure the CTAs you actually care about.

## Option A: Read clicks straight from autocapture

With autocapture on, every click is an `$autocapture` event and the button's visible text lands in `$el_text`. This HogQL ranks your most-clicked elements over 30 days — no instrumentation required:

```sql
SELECT
  properties.$el_text AS label,
  count() AS clicks,
  countDistinct(person_id) AS people
FROM events
WHERE event = '$autocapture'
  AND properties.$event_type = 'click'
  AND properties.$el_text != ''
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY label
ORDER BY clicks DESC
LIMIT 15
```

Illustrative sample output:

| label | clicks | people |
|-------|-------:|-------:|
| Start free trial | 1,240 | 1,090 |
| See how it works | 510 | 470 |
| Pricing | 360 | 330 |

Instantly you can see which CTA wins attention. The catch: this is keyed on the literal text, so the day you rename "Start free trial" to "Get started," the history splits.

## Option B: Fire a named custom event for the CTAs that matter

For your primary CTA, add a stable event that survives copy changes:

```jsx
<a
  href="/signup"
  onClick={() => posthog.capture('cta_clicked', { location: 'hero', label: 'start_trial' })}
>
  Start free trial
</a>
```

Now `cta_clicked` with `location: 'hero'` is unambiguous and independent of the button text. This is the event you put in funnels and dashboards.

## Compute click-through rate

Combine the click event with the pageview to get a real CTR for the homepage hero CTA:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview'
    AND properties.$pathname = '/') AS viewers,
  countDistinctIf(person_id, event = 'cta_clicked'
    AND properties.location = 'hero') AS clickers,
  round(
    countDistinctIf(person_id, event = 'cta_clicked'
      AND properties.location = 'hero')
    / countDistinctIf(person_id, event = '$pageview'
      AND properties.$pathname = '/') * 100,
  2) AS ctr_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| viewers | clickers | ctr_pct |
|--------:|---------:|--------:|
| 6,180   | 412      | 6.67    |

## Use them together

Autocapture is your zero-effort discovery layer — run Option A periodically to see what's pulling clicks you didn't expect. Custom events are your measurement layer — stable names you can trust in funnels and over time. Pair CTA clicks with a `cta_seen` event (from an IntersectionObserver) and you can tell apart "nobody sees it" from "they see it but don't click."
