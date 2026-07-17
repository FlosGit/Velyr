---
title: "What Is the Approval-Gate Pattern for AI Code Changes?"
slug: "approval-gate-pattern-ai-code-changes"
description: "The approval-gate pattern keeps a human decision between an AI's proposed change and your live code: the agent opens a Pull Request, a person reviews and merges. Here's how and why."
tldr: "The approval-gate pattern is a simple safety rule: an AI agent may propose a change but never apply it — a human approves every change before it ships. In practice that means the agent opens a Pull Request and a person merges it. The gate gives you AI speed on the work and human judgement on the decision, which is what makes automated code changes trustworthy."
cluster: "automation"
tags: ["approval-gate", "ai-agent", "automation", "safety", "pull-requests"]
publishedAt: "2026-06-07"
updatedAt: "2026-06-07"
author: "Velyr Team"
related:
  - "can-ai-agent-open-pull-requests-repo-it-works"
  - "automate-conversion-fixes-github-pull-requests"
  - "safely-auto-roll-back-bad-deploy-using-bounce-rate"
  - "validating-llm-code-edits-without-running-the-code"
faqs:
  - q: "What is the approval-gate pattern?"
    a: "It's a safety pattern where an AI agent can propose a change but a human must approve it before it takes effect. The agent opens a Pull Request; a person reviews and merges. The gate separates doing the work (automated) from making the decision (human), so nothing reaches production without a human yes."
  - q: "Why not let the AI merge automatically?"
    a: "Because the agent can be confidently wrong, and the cost of a bad change to a live revenue surface is high. The approval gate makes the worst case 'a PR you closed' instead of 'an outage you discovered later'. It keeps human judgement on the irreversible step."
  - q: "How is an approval gate enforced technically?"
    a: "With permissions and branch protection. The agent's GitHub App can open PRs but lacks rights to merge or push to the protected default branch, so the gate isn't a policy you trust the agent to follow — it's enforced by GitHub itself."
---

The approval-gate pattern is a simple safety rule: **an AI agent may *propose* a change but never *apply* it — a human approves every change before it ships.** In practice the agent opens a Pull Request and a person merges it. You get AI speed on the work and human judgement on the decision, which is exactly what makes automated code changes trustworthy.

## The core idea: separate doing from deciding

Two things happen when code changes: someone *does the work* (writes the diff) and someone *makes the decision* (ships it). The approval gate splits these:

- **Doing** is automated — the agent analyses, writes the change, opens the PR.
- **Deciding** stays human — a person reviews and merges.

This matters because the two have very different risk profiles. Generating a change is cheap and reversible (close the PR). Shipping a change to a live surface is not. Keeping the human on the *deciding* side puts judgement exactly where the irreversible cost is.

## Why an AI shouldn't self-merge

AI agents can be **confidently wrong**. A change can look reasonable in the diff and still drop a trust signal, break an edge case the tests don't cover, or violate a brand rule. The approval gate makes the worst case survivable:

- **Without a gate:** a bad change ships, and you find out from your metrics later.
- **With a gate:** a bad change is a Pull Request you read and closed in thirty seconds.

The gate doesn't slow you down meaningfully — reviewing a scoped diff is fast — but it removes the entire category of "the AI shipped something bad while I wasn't looking."

## Enforced by permissions, not trust

A robust approval gate isn't a policy you *hope* the agent follows — it's enforced by the platform:

- The agent's **GitHub App has scoped permissions**: open Pull Requests, yes; merge or push to the protected default branch, no.
- **Branch protection** on `main` requires a review/merge the agent can't perform itself.

So even a misbehaving or compromised agent physically cannot bypass the gate. That's the difference between a safety *feature* and a safety *guarantee*.

## A second gate: notification and one-tap approval

The pattern often extends past the merge button. A good agent doesn't just open a PR and go quiet — it tells you, with the problem, the data, and the fix, and lets you approve or skip with a single reply. That keeps the human informed *and* in control without making review a chore. The PR remains the source of truth; the notification is just a faster front door to it.

## Where the gate sits in the bigger picture

The approval gate pairs naturally with two other safety ideas: scoped changes (so each PR is easy to judge) and automated rollback (so even an approved change that backfires gets caught). Together they form a system where automation does the labour and humans — plus measured safety nets — hold the decisions.

That's the model [Velyr](/agent/register) is built on: it proposes each weekly conversion fix as a Pull Request and waits for your approval. Nothing merges without your yes.
