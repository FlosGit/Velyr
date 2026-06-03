---
title: "How Many Visitors Do You Need for an A/B Test?"
slug: "many-visitors-you-need-ab-test"
description: "How many visitors an A/B test needs depends on your baseline rate and the smallest lift you want to detect. Small lifts need huge samples. Here's a quick reference table."
tldr: "An A/B test needs roughly 16 × p × (1−p) / (lift)² visitors per variant, where p is your baseline conversion rate and the lift is the absolute change you want to detect. The practical consequence: small lifts need enormous samples. Detecting a 3% → 4% change takes about 4,700 visitors per variant; halving the lift quadruples the sample."
cluster: "experimentation"
tags: ["ab-testing", "sample-size", "experimentation", "traffic", "statistics"]
publishedAt: "2026-06-08"
updatedAt: "2026-06-08"
author: "Velyr Team"
related:
  - "calculate-sample-size-ab-test"
  - "my-ab-test-result-statistically-significant"
  - "ab-test-landing-page-without-testing-platform"
faqs:
  - q: "How many visitors do I need for an A/B test?"
    a: "It depends on your baseline conversion rate and the smallest lift you want to detect. As a rough rule, you need about 16 × p × (1−p) / (lift)² visitors per variant. Detecting a 3% to 4% change takes roughly 4,700 per variant; smaller lifts need far more, because the required sample grows with the square of how small the change is."
  - q: "Why do small improvements need so much traffic to test?"
    a: "Because the sample size scales with the inverse square of the lift. Halving the change you want to detect quadruples the visitors you need. A 1-point lift on a 3% baseline needs thousands per variant; a half-point lift needs tens of thousands. Small effects are simply hard to distinguish from noise."
  - q: "What if I don't have enough traffic to A/B test?"
    a: "Test bigger changes, which need smaller samples, or skip formal A/B testing and ship well-reasoned fixes you can measure against your own baseline over time. On low traffic, a button-colour test will never reach significance, but a structural change with a large effect might."
---

How many visitors an A/B test needs comes down to two numbers: **your baseline conversion rate and the smallest lift you want to detect.** As a rough rule, you need about **16 × p × (1 − p) / (lift)² visitors per variant**, where p is the baseline rate and the lift is the absolute change. The painful consequence: small lifts need enormous samples.

## The intuition

You're trying to tell a real difference apart from random noise. The smaller the difference, the more data you need to be sure it isn't luck — and the relationship is *quadratic*. Halve the lift you want to catch, and you **quadruple** the visitors required. That single fact explains why "let's test the button colour" is usually a waste on a small site: the effect is tiny, so the sample needed is gigantic.

## A quick reference table

Visitors needed **per variant** (so double it for the whole test), at 95% confidence and ~80% power:

| Baseline rate | Detect lift | ≈ Visitors per variant |
|---------------|-------------|-----------------------:|
| 3%            | +2 pp (→5%) | ~1,200                 |
| 3%            | +1 pp (→4%) | ~4,700                 |
| 3%            | +0.5 pp     | ~18,600                |
| 5%            | +1 pp (→6%) | ~7,600                 |
| 10%           | +2 pp (→12%)| ~3,600                 |
| 10%           | +1 pp (→11%)| ~14,400                |

Read it as a reality check. If you get 2,000 visitors a week to a page converting at 3%, detecting a 1-point lift (~4,700 per variant, ~9,400 total) takes about five weeks. Detecting a half-point lift takes most of a year — almost never worth it.

## The lever you actually control

You can't easily change your baseline rate or your traffic, but you *can* change the lift you aim to detect by **testing bigger things**:

- A whole new hero versus a tweaked one.
- A removed form field versus reworded microcopy.
- A restructured page versus a recoloured button.

Bigger changes produce bigger effects, and bigger effects need smaller samples. On limited traffic, the winning strategy is fewer, bolder tests — not many timid ones.

## When you can't reach the numbers

If the table says you need more traffic than you'll get in a reasonable time, you have two honest options:

1. **Don't A/B test that change.** Ship a well-reasoned fix and measure it against your own baseline over time. Not every decision needs an experiment.
2. **Test only high-impact changes** where the expected lift is large enough to detect with the traffic you have.

Pretending a tiny, under-powered test is conclusive is worse than not testing — it gives you false confidence.

## From "how many" to "is it real"

Once you've collected the planned sample, check the result properly with a two-proportion z-test — see [is my result significant](/blog/my-ab-test-result-statistically-significant) — and for the exact formula behind the table, see [how to calculate sample size](/blog/calculate-sample-size-ab-test). If you'd rather skip the traffic maths entirely and have high-impact fixes found and shipped as Pull Requests, that's what [Velyr](/agent/register) does.
