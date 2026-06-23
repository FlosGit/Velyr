---
title: "What Is a Good Bounce Rate for a SaaS Marketing Site?"
slug: "good-bounce-rate-saas-marketing-site"
description: "As a rough guide a SaaS marketing site bounces around 40–60%, but 'bounce' is defined differently across tools and traffic sources. Here's how to measure your own in PostHog."
tldr: "As a general guide, most SaaS marketing sites see a bounce rate somewhere around 40–60%, but there's no single authoritative figure — bounce is defined differently across analytics tools and swings hard with traffic source. Treat any benchmark as a loose reference and measure your own bounce rate consistently instead."
cluster: "benchmarks"
tags: ["bounce-rate", "saas", "marketing-site", "benchmarks", "posthog"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "average-bounce-rate-developer-tools"
  - "good-conversion-rate-saas-landing-page"
  - "measure-scroll-depth-posthog"
  - "bounce-rate-vs-exit-rate"
  - "average-time-page-saas-landing-page"
faqs:
  - q: "What is a good bounce rate for a SaaS marketing site?"
    a: "There's no single authoritative number, but as a rough guide many SaaS marketing sites land somewhere around 40–60%. That's a general estimate, not a published standard — your own consistently-measured rate matters far more, because bounce swings with traffic source and how each tool defines it."
  - q: "Why isn't there one official bounce rate benchmark?"
    a: "Because 'bounce' isn't defined the same way everywhere. Universal Analytics counted a single-page session as a bounce; GA4 measures the inverse of 'engaged sessions' instead; and PostHog gives you raw events to define it yourself. A number quoted under one definition isn't comparable to another."
  - q: "Is a high bounce rate always bad?"
    a: "No. A high bounce rate on a page meant to start a journey — a homepage or signup landing — is worth investigating. But on a single-answer page like a glossary post or a docs page, a high bounce can mean the visitor got exactly what they came for and left satisfied."
---

There's no single authoritative bounce-rate benchmark for SaaS marketing sites. **As a rough, unattributed guide, many land somewhere around 40–60% — but that's a general estimate, not a published standard, and the figure swings hard with traffic source and with how each analytics tool defines a "bounce."** The number worth acting on is your own, measured consistently.

## Why a single benchmark doesn't exist

The metric isn't comparable across tools because the definition itself changed:

- **Universal Analytics** counted a bounce as a single-page session with no second interaction.
- **GA4** dropped that and reports the inverse of an *engaged session* — a session that lasts 10+ seconds, fires a conversion, or has 2+ pageviews. A GA4 "bounce rate" and a UA "bounce rate" are different metrics with the same name.
- **PostHog** doesn't ship one fixed definition; you compute it from raw events, so *you* decide what counts as engaged.

Quote a bounce rate without stating the definition and it means nothing. That's why any "industry average" you read — including the 40–60% guide above — is a starting point, not a target.

## Traffic source moves it more than your industry does

A SaaS marketing site rarely has one bounce rate; it has several, hidden inside an average:

- **Branded and organic search** tends to bounce lower — those visitors arrived with intent.
- **Cold paid social** tends to bounce high — curiosity clicks that leave fast.
- **Referral from a relevant article** sits somewhere in between.

If your blended bounce rate looks alarming, segment by source before changing anything. A 65% blended rate that's really 35% on search and 80% on paid social is two different stories, and only one is a problem.

## Measure your own bounce rate in PostHog

Here's a defensible definition — a session with only one pageview — expressed in HogQL over the last 30 days. It groups events into sessions, then counts the single-pageview ones:

```sql
SELECT
  count() AS sessions,
  countIf(pageviews = 1) AS single_page_sessions,
  round(countIf(pageviews = 1) / count() * 100, 1) AS bounce_rate_pct
FROM (
  SELECT
    properties.$session_id AS session,
    countIf(event = '$pageview') AS pageviews
  FROM events
  WHERE timestamp > now() - INTERVAL 30 DAY
    AND properties.$session_id != ''
  GROUP BY session
)
```

Illustrative sample output:

| sessions | single_page_sessions | bounce_rate_pct |
|---------:|---------------------:|----------------:|
| 7,300    | 3,580                | 49.0            |

A 49% result sits inside the rough guide — neither a red flag nor a reason for complacency. If you'd rather not treat a quick, satisfied visit as a bounce, tighten the inner query to also require no scroll past, say, 50% using `properties.$prev_pageview_max_scroll_percentage`. The point is that you own the definition, so state it whenever you report the number.

## What to do with the number

Don't chase a lower bounce rate for its own sake. Establish your own baseline, segment it by traffic source and by landing page, and act only where a high bounce contradicts the page's purpose — a homepage that's meant to pull people deeper, a signup page that's meant to convert. Compare each page to its own history week over week, not to a borrowed benchmark.

If you'd like that analysis done for you — your funnel read from PostHog and the highest-impact fix shipped as a Pull Request — that's what [Velyr](/agent/register) does.
