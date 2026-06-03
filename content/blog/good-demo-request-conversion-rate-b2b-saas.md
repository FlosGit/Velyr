---
title: "What Is a Good Demo-Request Conversion Rate for B2B SaaS?"
slug: "good-demo-request-conversion-rate-b2b-saas"
description: "As a rough guide a B2B SaaS demo-request page converts 1–3% of visitors, lower than a free trial because the ask is bigger. Here's why, and how to measure your own in PostHog."
tldr: "As a general estimate, a B2B SaaS demo-request page converts roughly 1–3% of visitors, lower than a self-serve free trial because asking to book a call is a much bigger commitment. That's the article's own rough guide, not a published figure. Measure your own, and judge it against trial conversion only if the asks are comparable — which they aren't."
cluster: "benchmarks"
tags: ["benchmarks", "demo-request", "b2b-saas", "lead-generation", "posthog"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "good-conversion-rate-saas-landing-page"
  - "good-trial-to-paid-conversion-rate-saas"
  - "good-signup-conversion-rate-developer-tool"
faqs:
  - q: "What is a good demo-request conversion rate for B2B SaaS?"
    a: "As a rough, unattributed guide, 1–3% of visitors requesting a demo is a reasonable range, lower than a free-trial signup because booking a call is a bigger commitment. That's a general estimate, not a published standard — your own rate depends on traffic quality and how much the page de-risks the call."
  - q: "Why is a demo request rate lower than a free trial signup rate?"
    a: "Because the ask is heavier. A free trial is private and instant; a demo means scheduling time, talking to sales, and revealing you're a buyer. That higher commitment naturally converts a smaller share of visitors, so the two rates aren't comparable."
  - q: "How do I increase demo requests without lowering quality?"
    a: "Reduce the perceived cost of the call: short form, clear agenda, a real time estimate, and reassurance it isn't a hard sell. Adding a self-serve option alongside the demo also captures the visitors who'd never book a call but would try the product."
---

There's no authoritative figure, but as a rough guide, **a B2B SaaS demo-request page converts somewhere around 1–3% of visitors — lower than a self-serve free trial, because booking a call is a much bigger commitment.** That's this article's own estimate, not a published benchmark. Measure your own, and don't compare it to a trial signup rate: the asks aren't the same.

## Why demo requests convert lower

A free trial is private, instant, and reversible — you click a button and you're in. A demo request is none of those: it means scheduling time, talking to a salesperson, and signalling that you're a buyer. That's a heavier commitment, so a smaller share of visitors take it. A 2% demo rate and a 5% trial rate aren't "worse" and "better" — they're two different commitments, and comparing them directly is a category error.

So judge a demo rate against your own history and your own traffic, not against a lighter conversion.

## What moves the demo rate

1. **Perceived cost of the call.** A long form, no agenda, and no time estimate make the call feel risky. A short form, a clear "30 minutes, no hard sell," and a named outcome lower that cost.
2. **Traffic intent.** Demo pages convert far better for high-intent traffic (branded search, a pricing-page referral) than for cold clicks.
3. **A self-serve escape hatch.** Offering "or start a free trial" alongside the demo captures the visitors who'd never book a call but would try the product — often lifting total conversion even if demo requests stay flat.

## Measure your own demo-request rate in PostHog

Fire a `demo_requested` event on form submission, then:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/demo') AS visitors,
  countDistinctIf(person_id, event = 'demo_requested') AS requests,
  round(
    countDistinctIf(person_id, event = 'demo_requested')
    / countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/demo') * 100,
  2) AS demo_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| visitors | requests | demo_rate_pct |
|---------:|---------:|--------------:|
| 3,200    | 58       | 1.81          |

A 1.8% rate sits in the rough range. The actionable move is to fire a `demo_form_started` event too: if many start the form but few finish, the form is too long or asks for too much before there's any value exchange.

## Improve your own rate

De-risk the call, segment by traffic source so a cold-traffic average doesn't hide a strong branded rate, and consider a self-serve option for the visitors who'll never book. Compare against your own history, not a borrowed number. If you'd like the biggest leak on your demo page found and shipped as a Pull Request, that's what [Velyr](/agent/register) does.
