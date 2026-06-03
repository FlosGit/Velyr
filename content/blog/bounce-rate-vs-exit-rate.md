---
title: "What Is Bounce Rate vs Exit Rate?"
slug: "bounce-rate-vs-exit-rate"
description: "Bounce rate is the share of single-page visits; exit rate is the share of visits to a page that ended there. They sound alike but answer different questions. Here's a worked example."
tldr: "Bounce rate is the percentage of sessions that viewed only one page before leaving. Exit rate is the percentage of views of a specific page that were the last page in the session. Bounce is about whole single-page sessions; exit is about a page being the final step of a longer journey. The same page can have a high exit rate but contribute little to bounce."
cluster: "concepts"
tags: ["bounce-rate", "exit-rate", "definition", "analytics", "metrics"]
publishedAt: "2026-06-07"
updatedAt: "2026-06-07"
author: "Velyr Team"
related:
  - "good-bounce-rate-saas-marketing-site"
  - "average-bounce-rate-developer-tools"
  - "conversion-funnel"
faqs:
  - q: "What is the difference between bounce rate and exit rate?"
    a: "Bounce rate is the share of sessions that viewed exactly one page and left. Exit rate is the share of views of a particular page that were the last page in the session, regardless of how many pages came before. Every bounce is an exit, but most exits are not bounces."
  - q: "Is a high exit rate bad?"
    a: "Not necessarily. Some pages are natural endpoints — an order-confirmation page, a thank-you page, or a docs answer. A high exit rate there is fine. A high exit rate on a step that's supposed to lead somewhere, like a pricing page before checkout, is the one to investigate."
  - q: "Which should I use, bounce rate or exit rate?"
    a: "Use bounce rate to judge landing pages and single-page sessions, and exit rate to find where people leave a multi-step journey. They answer different questions, so the right one depends on whether you're asking about entry pages or drop-off points."
---

**Bounce rate is the percentage of sessions that viewed only one page before leaving. Exit rate is the percentage of views of a specific page that were the last page in the session.** They sound interchangeable but answer different questions — bounce is about whole single-page visits; exit is about a page being the final step of a longer journey.

## The precise definitions

- **Bounce rate** is a property of *sessions*. A bounce is a session with a single pageview and no further interaction. Bounce rate is bounces ÷ total sessions. It's usually quoted for an entry page: "of everyone who landed here, what share left without going anywhere?"
- **Exit rate** is a property of a *page*. For a given page, it's the number of sessions that *ended* on that page ÷ the total number of sessions that *viewed* that page — no matter how many pages they saw first.

The key relationship: **every bounce is also an exit, but most exits are not bounces.** A bounce is the special case where the exit page was also the only page.

## A worked example

Imagine a pricing page viewed in three sessions:

| Session | Path | Pricing page role |
|---------|------|-------------------|
| A | landed on `/pricing`, left | bounce (and an exit) |
| B | `/` → `/pricing`, left | exit, not a bounce |
| C | `/` → `/pricing` → `/signup` | neither — they continued |

For the pricing page:

- **Exit rate** = sessions that ended on `/pricing` ÷ sessions that viewed it = 2 (A, B) ÷ 3 = **67%**.
- **Bounce contribution** = only session A was a single-page bounce.

So `/pricing` has a high *exit* rate (people often leave there) but only one of those was a *bounce*. If you only looked at bounce rate, you'd miss that two of three visitors are leaving at pricing — a clear drop-off worth investigating.

## When to use which

- **Bounce rate → entry pages.** It tells you whether a landing page gives people a reason to go deeper. High bounce on a homepage that's meant to start a journey is a problem; high bounce on a glossary post that answers one question is fine.
- **Exit rate → journey steps.** It tells you where people leave a multi-step flow. High exit on a "thank you" page is expected; high exit on the pricing page *before* checkout is a leak.

Using the wrong one leads to wrong conclusions: judging your checkout-flow pages by bounce rate (most aren't entry pages) tells you almost nothing.

## Measuring exit-prone pages

A simple way to find pages people leave from is to look at where sessions end. In PostHog you can capture the picture with the native web analytics, or reason about it from `$pageview` and `$pageleave` events. The conceptual move is the same: bounce isolates single-page sessions; exit isolates the last page of any session.

## The takeaway

Bounce rate and exit rate aren't competing metrics — they're answers to different questions. Reach for bounce when you're judging an entry page, and exit when you're hunting for the step where a journey breaks. For where that journey-level drop-off fits, see [what a conversion funnel is](/blog/conversion-funnel). And if you'd like the leak found and the fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
