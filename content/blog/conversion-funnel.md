---
title: "What Is a Conversion Funnel?"
slug: "conversion-funnel"
description: "A conversion funnel is the ordered set of steps a visitor takes toward a goal, with people dropping off at each one. Here's a clear definition, a worked example, and how to read it."
tldr: "A conversion funnel is the ordered sequence of steps a visitor passes through on the way to a goal — like visit, signup, activate — where some people drop off at every step. Mapping it shows you exactly where you lose the most people, so you fix the steepest drop instead of guessing."
cluster: "concepts"
tags: ["conversion-funnel", "definition", "funnel", "saas", "analytics"]
publishedAt: "2026-06-07"
updatedAt: "2026-06-07"
author: "Velyr Team"
related:
  - "what-is-conversion-rate-optimization"
  - "what-is-a-micro-conversion"
  - "build-signup-funnel-posthog"
faqs:
  - q: "What is a conversion funnel in simple terms?"
    a: "It's the path a visitor takes toward a goal, broken into ordered steps, where fewer people remain at each step. Picture a funnel shape: wide at the top where everyone enters, narrow at the bottom where only converters come out. The narrowing between two steps is where you're losing people."
  - q: "What are the stages of a conversion funnel?"
    a: "Loosely: top of funnel (awareness — a visitor lands), middle of funnel (consideration — they engage, view pricing, start signing up), and bottom of funnel (action — they convert and activate). The exact steps depend on your product; what matters is that they're ordered and measurable."
  - q: "What's the difference between a conversion funnel and a conversion rate?"
    a: "A conversion rate is one number — converters divided by visitors. A conversion funnel breaks that single number into the steps in between, so instead of just knowing '3% convert' you can see which step loses the most people and fix it specifically."
---

A conversion funnel is the **ordered sequence of steps a visitor passes through on the way to a goal — such as visit → signup → activate — where some share of people drop off at every step.** The name comes from the shape: wide at the top where everyone enters, narrow at the bottom where only the people who completed the goal come out.

## Why "funnel" and not just "conversion rate"

A conversion rate collapses the whole journey into one number: converters ÷ visitors. That tells you *how many* convert but not *where* you lose everyone else. A funnel keeps the steps separate, so a single 3% rate becomes a sequence you can actually act on. The value is entirely in the **drop-off between steps** — the narrowing — because that's the map of where your effort pays off.

## A worked example

Take a typical self-serve SaaS funnel over a month:

| Step | People | Conversion to next step |
|------|-------:|------------------------:|
| Visited landing page | 10,000 | — |
| Started signup | 1,500 | 15% |
| Completed signup | 950 | 63% |
| Activated (did the core action) | 520 | 55% |

Read it as the *steps between* the rows. The worst drop is the first one: only 15% of visitors even start the signup. That single number tells you where to work — the landing page and its CTA — and tells you *not* to spend the week polishing the signup form, which already converts a healthy 63%.

This is the whole point of a funnel: it turns "our conversion is low" (unactionable) into "85% of visitors never start signup" (a specific, fixable problem).

## A simple taxonomy: top, middle, bottom

Funnel steps group into three stages, which helps you reason about *why* a drop happens:

1. **Top of funnel (awareness)** — the visitor arrives. Drop-off here is usually a *relevance or clarity* problem: the message doesn't match what they expected, or the value isn't obvious above the fold.
2. **Middle of funnel (consideration)** — they engage: read features, view pricing, start the signup. Drop-off here is usually a *friction or objection* problem: too many form fields, a pricing surprise, a missing answer.
3. **Bottom of funnel (action)** — they convert and reach first value. Drop-off here is usually an *activation* problem: they signed up but never got to the moment the product pays off.

Naming the stage that's leaking points you at the *kind* of fix, before you've looked at a single line of code.

## How to read a funnel correctly

- **Compare relative drops, not absolute counts.** The step that loses the largest *percentage* is the priority, even if a later step loses more raw people.
- **Fix the steepest drop first.** Improving a step that already converts well has little headroom; the steep step is where a fix compounds.
- **Use a sensible time window.** Give users enough time to complete all steps (a few days for a trial product), or you'll undercount conversions that legitimately take time.
- **Keep the steps stable.** Redefining a step mid-stream breaks the comparison with last month.

## From concept to your own data

A funnel is only useful once it's built on *your* events. In practice you capture one event per step (`signup_started`, `signup_completed`, `activated`) and chart them in order — see [how to build a signup funnel in PostHog](/blog/build-signup-funnel-posthog) for the concrete steps. Then the steepest drop is your roadmap.

If you'd rather have that drop found and the fix shipped as a Pull Request each week, that's what [Velyr](/agent/register) does — it reads your funnel and writes the code change for the step that's leaking.
