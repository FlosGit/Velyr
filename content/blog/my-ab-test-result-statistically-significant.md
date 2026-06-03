---
title: "Is My A/B Test Result Statistically Significant?"
slug: "my-ab-test-result-statistically-significant"
description: "Your A/B test is significant if a two-proportion z-test gives |z| above 1.96 (p < 0.05) at a pre-decided sample size. Here's how to compute it and the mistakes that fake significance."
tldr: "An A/B test result is statistically significant when a two-proportion z-test produces a z-score whose absolute value exceeds 1.96 — equivalently, a p-value below 0.05 — at a sample size you decided before starting. Significance means the difference is unlikely to be chance, not that it's large or that you should stop early. Peeking and tiny samples are how false positives sneak in."
cluster: "experimentation"
tags: ["ab-testing", "statistical-significance", "p-value", "experimentation", "z-test"]
publishedAt: "2026-06-08"
updatedAt: "2026-06-08"
author: "Velyr Team"
related:
  - "ab-test-landing-page-without-testing-platform"
  - "calculate-sample-size-ab-test"
  - "many-visitors-you-need-ab-test"
faqs:
  - q: "How do I know if my A/B test is statistically significant?"
    a: "Run a two-proportion z-test on the two conversion rates. If the absolute z-score is above 1.96 — equivalently the p-value is below 0.05 — the result is significant at 95% confidence, provided you reached the sample size you set before starting. Significance below your planned sample, reached by checking early, doesn't count."
  - q: "What does a p-value actually mean?"
    a: "The p-value is the probability of seeing a difference at least this large if there were truly no difference between the variants. A p-value of 0.04 means a 4% chance the result is a fluke. It is not the probability that your variant is better, and a small p-value doesn't mean a big effect."
  - q: "Why does peeking break A/B test significance?"
    a: "Because checking repeatedly and stopping the moment you see p < 0.05 dramatically inflates false positives — random noise will cross the line eventually if you keep looking. Decide the sample size up front and evaluate once, or use a method designed for continuous monitoring."
---

Your A/B test result is statistically significant when a **two-proportion z-test gives an absolute z-score above 1.96 — equivalently, a p-value below 0.05 — at a sample size you decided before you started.** Significance means the difference is unlikely to be chance; it does *not* mean the effect is large, or that you should stop the moment the line is crossed.

## Compute it: the z-test

With conversions and visitors for each variant, the test is one calculation. Here it is as a function you can run:

```js
function zTest(convA, nA, convB, nB) {
  const pA = convA / nA
  const pB = convB / nB
  const pPool = (convA + convB) / (nA + nB)
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB))
  return (pB - pA) / se
}

// Variant A: 100 conversions / 2500, Variant B: 130 / 2500
zTest(100, 2500, 130, 2500) // ≈ 2.03
```

Worked through: `pA = 0.040`, `pB = 0.052`, pooled `p = 0.046`, standard error ≈ `0.00593`, so `z = (0.052 − 0.040) / 0.00593 ≈ 2.03`. Because **|z| ≈ 2.03 > 1.96**, the result is significant at 95% confidence (p ≈ 0.042). Variant B is a real improvement, not noise.

## What the p-value means — and doesn't

A z of 2.03 corresponds to a p-value of about 0.042. That means: **if the two variants were truly identical, there'd be roughly a 4% chance of seeing a gap this big by luck.** Two things it is *not*:

- It is **not** "a 96% chance B is better." That's a different (Bayesian) statement.
- It is **not** a measure of how *big* the effect is. A tiny, useless difference can be highly significant with enough traffic; significance is about confidence, not size.

To judge the *size*, look at the absolute lift (here 4.0% → 5.2%, a 1.2-point gain) alongside the significance.

## The two ways false significance sneaks in

1. **Peeking.** If you check the dashboard daily and stop the instant p dips below 0.05, you'll declare winners that are pure noise — random fluctuations cross the line eventually if you keep looking. **Decide the sample size up front and evaluate once.**
2. **Tiny samples.** With a few hundred visitors per variant, a single lucky day can swing the result. Significance reached far below a sensible sample size is fragile. (See [how many visitors you need](/blog/many-visitors-you-need-ab-test).)

Both are about *discipline*, not maths: the z-test is only trustworthy if you don't game when you run it.

## A confidence interval is even more honest

Rather than a yes/no, report the difference with a confidence interval — e.g. "B lifted conversion by 1.2 points, 95% CI [0.0, 2.4]." If the interval excludes zero, it's significant; its width tells you how precise the estimate is. A significant result with an interval that *just* clears zero is weaker than one comfortably away from it.

## The bottom line

Significant means: computed a z-test, got |z| > 1.96, at a pre-planned sample size, without peeking. Hit those and you can trust the winner. If you'd rather skip running tests by hand and have the highest-impact change found and shipped as a Pull Request, that's what [Velyr](/agent/register) does.
