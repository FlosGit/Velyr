---
title: "What Is Conversion Rate Optimization (CRO)?"
slug: "what-is-conversion-rate-optimization"
description: "Conversion rate optimization (CRO) is the practice of systematically increasing the share of visitors who take a desired action. Here's a plain-language definition, a worked example, and a repeatable CRO loop."
tldr: "Conversion rate optimization (CRO) is the practice of systematically raising the percentage of visitors who complete a desired action — a signup, purchase, or lead — by analyzing behavior, forming a hypothesis, changing the page, and measuring the result. It's a repeatable loop, not a one-time redesign."
cluster: "concepts"
tags: ["cro", "conversion-rate", "definition", "growth"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "good-conversion-rate-saas-landing-page"
  - "what-is-a-micro-conversion"
  - "measure-scroll-depth-posthog"
  - "conversion-funnel"
  - "what-is-answer-engine-optimization-aeo"
faqs:
  - q: "What does CRO stand for?"
    a: "CRO stands for Conversion Rate Optimization — the systematic practice of increasing the percentage of visitors who complete a desired action on your site."
  - q: "Is CRO the same as A/B testing?"
    a: "No. A/B testing is one tool used within CRO to validate a change. CRO is the whole loop: analyzing behavior, forming a hypothesis, making the change, and measuring the outcome — which may or may not involve a formal A/B test."
  - q: "How is CRO different from SEO?"
    a: "SEO brings more visitors to your site; CRO increases the share of those visitors who convert. They're complementary — SEO grows the top of the funnel, CRO improves what happens after people arrive."
  - q: "Do I need a lot of traffic to do CRO?"
    a: "Low-traffic sites can still do qualitative CRO — fixing obvious clarity, layout, and friction issues based on behavior signals like scroll depth and click maps. You only need high traffic for statistically valid A/B testing, which is just one CRO technique."
---

**Conversion rate optimization (CRO) is the practice of systematically increasing the percentage of visitors who take a desired action** — signing up, starting a trial, purchasing, or submitting a lead. The key word is *systematically*: CRO is a repeatable loop grounded in behavioral data, not a one-off redesign or a designer's taste.

## The definition, unpacked

A **conversion** is any action you've defined as valuable: a trial start, a purchase, a demo booking, a newsletter signup. Your **conversion rate** is conversions divided by unique visitors over a window. CRO is everything you do to move that rate up *on purpose* and *measurably*.

That distinguishes it from two things it's often confused with:

- It's **not just A/B testing.** Testing is one technique inside CRO used to validate a change. Plenty of high-value CRO is fixing things that are obviously broken — a CTA below the fold, a confusing headline — where a test would only slow you down.
- It's **not a redesign.** A redesign changes everything at once, so you learn nothing about *why* the number moved. CRO changes things deliberately and attributes the result.

## The CRO loop (a methodology you can run weekly)

The whole practice reduces to a four-step loop you repeat:

1. **Observe.** Look at how visitors actually behave — where they land, how far they scroll, what they click, and where they leave. This is the step most teams skip, and it's where the leverage is.
2. **Hypothesize.** Turn an observation into a falsifiable statement: *"Most visitors never reach the pricing section because the hero is too tall, so moving the CTA above the fold will raise signups."*
3. **Change.** Ship the smallest change that tests the hypothesis. One change at a time, so the result is attributable.
4. **Measure.** Compare the conversion rate before and after (or run an A/B test if you have the traffic). Keep the win, revert the loss, and feed what you learned back into step 1.

The discipline is in doing this *continuously* against your own baseline — not in any single clever idea.

One thing worth checking in step 1 is where the visitor came from, because arrival channel changes how much convincing the page still has to do. Traffic referred by an AI assistant behaves differently from a cold search click, which is the conversion side of [answer engine optimization](/blog/what-is-answer-engine-optimization-aeo).

## A worked example

Say your signup page converts 2.1%. You observe in your analytics that the median visitor scrolls only 40% of the page, and your primary CTA sits at 70% depth. That's an observation (step 1).

**Hypothesis:** the CTA is below where most people ever look, so a duplicate CTA at 30% depth will lift conversions (step 2). You add one button (step 3). Two weeks later the page converts 2.9% on comparable traffic (step 4). You keep it, and your new baseline is 2.9% — then you go looking for the next leak.

That's CRO. Not a guess that the button should be green; a behavior signal, a hypothesis, a change, and a measured outcome.

## Grounding step 1 in real behavior (HogQL)

The "observe" step is concrete if you have analytics. Here's a PostHog **HogQL** query that surfaces the average maximum scroll depth on your signup page over 30 days — the exact signal from the example above:

```sql
SELECT
  round(avg(properties.$prev_pageview_max_scroll_percentage) * 100, 1)
    AS avg_max_scroll_pct,
  count() AS sessions
FROM events
WHERE event = '$pageleave'
  AND properties.$pathname = '/signup'
  AND timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| avg_max_scroll_pct | sessions |
|-------------------:|---------:|
| 41.3               | 2,880    |

Using `$pageleave` (not `$pageview`) counts bounced single-page sessions too, so the number reflects reality rather than only your most engaged visitors. An average max scroll of ~41% tells you anything below the fold is being seen by a minority — a textbook CRO opportunity.

## Where CRO fits

SEO and ads grow the *top* of your funnel; CRO improves the *rate* at which that traffic converts. The two compound: doubling traffic and doubling conversion rate quadruples results. For solo founders especially, CRO is often the cheaper lever — you already paid to acquire the visitors; CRO is about not wasting them.

If you want a reference point for where your rate stands, see [what counts as a good SaaS landing page conversion rate](/blog/good-conversion-rate-saas-landing-page). Then run the loop.
