---
title: "How to Calculate Sample Size for an A/B Test"
slug: "calculate-sample-size-ab-test"
description: "Calculate A/B test sample size with n = 16 × p × (1−p) / δ² per variant, where p is the baseline rate and δ the absolute lift to detect. Includes a runnable function and worked example."
tldr: "Calculate the sample size per variant with n = 16 × p × (1−p) / δ², where p is your baseline conversion rate and δ is the absolute lift you want to detect. The 16 bakes in 95% confidence and ~80% power. For a 3% baseline detecting a 1-point lift, that's about 4,700 visitors per variant. Always set this before the test starts, not after."
cluster: "experimentation"
tags: ["ab-testing", "sample-size", "experimentation", "statistics", "power"]
publishedAt: "2026-06-08"
updatedAt: "2026-06-08"
author: "Velyr Team"
related:
  - "many-visitors-you-need-ab-test"
  - "my-ab-test-result-statistically-significant"
  - "ab-test-landing-page-without-testing-platform"
faqs:
  - q: "How do you calculate sample size for an A/B test?"
    a: "Use n = 16 × p × (1−p) / δ² per variant, where p is the baseline conversion rate and δ is the absolute minimum lift you want to detect. The constant 16 encodes 95% confidence and roughly 80% power. Compute it before the test so you have a fixed, honest stopping point."
  - q: "What is power in an A/B test?"
    a: "Power is the probability of detecting a real effect of the size you care about. The standard target is 80%, meaning if the true lift is at least your minimum detectable effect, you'll catch it 80% of the time. Higher power needs a larger sample; the 16 in the formula assumes ~80%."
  - q: "Should I calculate sample size before or after the test?"
    a: "Before — always. The sample size defines when you stop and evaluate, which is what protects you from peeking and false positives. Calculating it afterward to justify a result you already saw defeats the purpose and invites self-deception."
---

To calculate the sample size for an A/B test, use **n = 16 × p × (1 − p) / δ² per variant**, where p is your baseline conversion rate and δ is the absolute lift you want to detect. The constant 16 bakes in 95% confidence and roughly 80% power. Compute it **before** the test starts — the sample size is your honest stopping point.

## Where the formula comes from

The full sample-size formula for comparing two proportions is:

```text
n per group = (z_α/2 + z_β)² × [ p₁(1−p₁) + p₂(1−p₂) ] / (p₂ − p₁)²
```

For the usual choices — 95% confidence (`z_α/2 = 1.96`) and 80% power (`z_β = 0.84`) — `(1.96 + 0.84)² ≈ 7.84`. Approximating `p₁ ≈ p₂ ≈ p`, the bracket becomes `2p(1−p)`, so:

```text
n ≈ 2 × 7.84 × p(1−p) / δ²  ≈  16 × p(1−p) / δ²
```

That's the rule of thumb: the 16 is `2 × (1.96 + 0.84)²`, rounded. It's accurate enough for planning and easy to remember.

## A runnable function

```js
// Visitors per variant for 95% confidence, ~80% power.
// baseline: conversion rate (e.g. 0.03). mde: absolute lift to detect (e.g. 0.01).
function sampleSizePerGroup(baseline, mde) {
  const p = baseline
  return Math.ceil((16 * p * (1 - p)) / (mde * mde))
}

sampleSizePerGroup(0.03, 0.01) // 4656  → ~4,700 per variant
sampleSizePerGroup(0.05, 0.01) // 7600  → ~7,600 per variant
sampleSizePerGroup(0.03, 0.005) // 18624 → ~18,600 per variant
```

## Worked example

Say your landing page converts at **3%** and you only care about a lift if it's at least **1 percentage point** (to 4%). Then `p = 0.03`, `δ = 0.01`:

```text
n = 16 × 0.03 × 0.97 / (0.01)²
  = 16 × 0.0291 / 0.0001
  = 0.4656 / 0.0001
  = 4,656  ≈ 4,700 per variant
```

So you need about **4,700 visitors per variant — roughly 9,400 total** — before you evaluate. At 2,000 visitors a week split across two variants, that's about nine to ten weeks. Now you know the commitment *before* you start, not after.

## Two parameters worth understanding

- **Confidence (95%)** controls false positives — declaring a winner that isn't real. Raising it raises the sample.
- **Power (80%)** controls false negatives — missing a real winner. The 16 assumes 80%; if you want 90% power, the constant rises to about 21.

The defaults (95% / 80%) are standard for a reason; only change them deliberately.

## Calculate first, evaluate once

The single most important rule: **compute the sample size before the test and treat it as a fixed stopping point.** That's what stops you from peeking and calling a noisy early result a win. Calculating the number afterward to rationalise a result you already saw is just dressing up a guess. For why small lifts are so expensive to detect, see [how many visitors you need](/blog/many-visitors-you-need-ab-test); for checking the result, see [is it significant](/blog/my-ab-test-result-statistically-significant).

If you'd rather not run the traffic maths at all and have high-impact fixes found and shipped as Pull Requests, that's what [Velyr](/agent/register) does.
