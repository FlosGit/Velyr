---
title: "How to Safely Auto-Roll-Back a Bad Deploy Using Bounce Rate"
slug: "safely-auto-roll-back-bad-deploy-using-bounce-rate"
description: "Auto-roll-back a backfiring change by comparing site-wide bounce rate before and after deploy. If it rises past a set threshold, open a revert PR. Here's the logic and the HogQL."
tldr: "A measured rollback compares bounce rate for a window before a deploy against the same length after it. If bounce rose by more than a set threshold — say 15 percentage points — the change likely backfired, so you open a revert Pull Request for approval. Using a fixed threshold and a revert PR (not an automatic revert) keeps the safety net honest and human-gated."
cluster: "automation"
tags: ["rollback", "bounce-rate", "automation", "safety", "posthog"]
publishedAt: "2026-06-07"
updatedAt: "2026-06-07"
author: "Velyr Team"
related:
  - "approval-gate-pattern-ai-code-changes"
  - "automate-conversion-fixes-github-pull-requests"
  - "good-bounce-rate-saas-marketing-site"
  - "can-ai-agent-open-pull-requests-repo-it-works"
faqs:
  - q: "How does an automatic rollback decide a change was bad?"
    a: "It compares a clear metric — site-wide bounce rate is a good choice — for a fixed window before the deploy against the same length of time after it. If the metric worsened by more than a pre-set threshold, the change is flagged as likely harmful and a revert is proposed. The threshold and window are fixed in advance so the trigger isn't subjective."
  - q: "Should a rollback happen automatically without review?"
    a: "Safer to open a revert Pull Request than to revert silently. A metric can move for reasons unrelated to your change — a traffic-source shift, a seasonal dip — so a human should confirm the revert. The automation catches the signal; the person confirms the cause."
  - q: "Why use bounce rate for rollback detection?"
    a: "Because it's site-wide, fast-moving, and sensitive to most conversion-harming changes — a worse hero, a broken layout, a slower page all tend to raise bounce quickly. It's a blunt but reliable early-warning signal you can measure within a day or two of a deploy."
---

A safe automatic rollback **compares site-wide bounce rate for a window before a deploy against the same length after it, and if bounce rose past a fixed threshold, opens a revert Pull Request for approval.** Using a pre-set threshold and a revert *PR* — not a silent revert — keeps the safety net honest and human-gated.

## The logic

The mechanism is deliberately simple, because a safety net you can't reason about isn't safe:

1. **Record the deploy time** of the change you want to watch.
2. **Wait a fixed window** — long enough for traffic to accumulate, e.g. 48 hours.
3. **Compare bounce rate** for the equal window *before* the deploy against the window *after*.
4. **If bounce rose by more than the threshold** — for example 15 percentage points — flag the change as likely harmful.
5. **Open a revert Pull Request**, not an automatic revert, so a human confirms before the rollback ships.

The threshold and window are decided in advance, so the trigger is objective: there's no fuzzy judgement about whether the change "feels" bad.

## Why bounce rate

Bounce rate makes a good rollback signal because it's:

- **Site-wide** — it catches damage anywhere, not just on the page you changed.
- **Fast-moving** — it reacts within a day or two, so you find out quickly.
- **Sensitive** — a worse hero, a broken layout, or a slower page all tend to push bounce up.

It's blunt — it won't tell you *why* — but as an early-warning trip-wire it's reliable, and "something got worse, look now" is exactly what you want from a safety net.

## The before/after comparison in HogQL

This compares single-pageview session rate (a bounce proxy) for the 48 hours before a deploy versus the 48 hours after. Adjust the timestamps to your deploy moment:

```sql
SELECT
  if(timestamp < now() - INTERVAL 48 HOUR, 'before', 'after') AS period,
  count() AS sessions,
  round(countIf(pageviews = 1) / count() * 100, 1) AS bounce_pct
FROM (
  SELECT
    properties.$session_id AS session,
    min(timestamp) AS timestamp,
    countIf(event = '$pageview') AS pageviews
  FROM events
  WHERE timestamp > now() - INTERVAL 96 HOUR
    AND properties.$session_id != ''
  GROUP BY session
)
GROUP BY period
ORDER BY period
```

Illustrative sample output:

| period | sessions | bounce_pct |
|--------|---------:|-----------:|
| after  | 3,100    | 61.4       |
| before | 3,260    | 48.2       |

Bounce jumped 13 points after the deploy — close to a 15-point threshold and worth a hard look. If it had crossed the line, the safety net would open a revert PR.

## Why a revert PR, not a silent revert

A metric can move for reasons that have nothing to do with your change — a traffic-source shift, a campaign ending, a seasonal dip. Reverting *silently* on that signal would sometimes undo a good change for the wrong reason. Opening a **revert Pull Request** keeps a human in the loop: the automation says "this looks bad, here's the data," and a person confirms the cause before the rollback merges. The signal is automated; the decision stays human.

## A complete safety system

Measured rollback pairs with the approval gate (humans merge changes) and scoped changes (each PR is easy to revert) to form a system where even an approved fix that backfires gets caught and proposed for reversal. That's how [Velyr](/agent/register) works: after a merged fix it watches site-wide bounce rate, and if it spikes past the threshold, it opens a rollback Pull Request for your approval.
