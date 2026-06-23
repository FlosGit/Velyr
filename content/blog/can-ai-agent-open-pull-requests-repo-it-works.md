---
title: "Can an AI Agent Open Pull Requests on Your Repo? How It Works"
slug: "can-ai-agent-open-pull-requests-repo-it-works"
description: "Yes — an AI agent can open Pull Requests via a GitHub App with scoped permissions. It proposes changes you review and merge; it can't merge on its own. Here's the mechanism."
tldr: "Yes. An AI agent opens Pull Requests through a GitHub App you install with scoped permissions — typically contents and pull-requests access on chosen repos. The agent creates a branch, commits a change, and opens a PR; it proposes, you review and merge. It cannot push to your default branch or merge anything itself unless you grant that and approve."
cluster: "automation"
tags: ["ai-agent", "github", "pull-requests", "automation", "github-app"]
publishedAt: "2026-06-07"
updatedAt: "2026-06-07"
author: "Velyr Team"
related:
  - "automate-conversion-fixes-github-pull-requests"
  - "approval-gate-pattern-ai-code-changes"
  - "what-is-conversion-rate-optimization"
  - "safely-auto-roll-back-bad-deploy-using-bounce-rate"
faqs:
  - q: "Can an AI agent open a pull request on my repository?"
    a: "Yes. It installs as a GitHub App with scoped permissions, then creates a branch, commits a change, and opens a Pull Request through the GitHub API. A PR is a proposal — it doesn't change your code until you review and merge it, so the agent can suggest without being able to ship on its own."
  - q: "Can the AI agent merge code without my approval?"
    a: "It shouldn't, and a well-designed one can't. A PR-based agent has permission to open Pull Requests, not to merge them or push to your protected default branch. Merging stays a human decision, which is the entire safety model."
  - q: "What permissions does an AI agent need to open PRs?"
    a: "Typically read/write on repository contents (to create a branch and commit) and read/write on pull requests (to open the PR), scoped to the specific repositories you select when installing the GitHub App. It doesn't need access to your whole account."
---

Yes — **an AI agent can open Pull Requests on your repo through a GitHub App you install with scoped permissions.** It creates a branch, commits a change, and opens a PR through the GitHub API. Crucially, a PR is a *proposal*: it changes nothing until you review and merge it. The agent suggests; you decide.

## The mechanism, step by step

A PR-based agent works exactly like a careful human contributor who doesn't have merge rights:

1. **You install a GitHub App** on the specific repositories you choose, granting scoped permissions — usually read/write on *contents* (to create a branch and commit) and read/write on *pull requests* (to open one). It doesn't get your whole account; it gets those repos, those scopes.
2. **The agent authenticates as the App**, requesting a short-lived installation token rather than holding a long-lived personal credential.
3. **It creates a branch, commits the change, and opens a PR** against your default branch.
4. **You review the diff and the description, then merge or close.** Nothing in your codebase changes until you click merge.

## The PR is the safety boundary

The reason "an AI opening PRs" is safe where "an AI editing your code" is scary is the Pull Request itself. A PR:

- **Shows the exact diff** before anything happens.
- **Runs your CI** — tests, type-checks, linters — on the proposed change.
- **Can carry a preview deploy** so you can click through the change before merging.
- **Requires a human merge.** The agent has no permission to push to a protected branch or merge its own PR.

So the worst case isn't "the agent broke production" — it's "the agent opened a PR you closed." That's a fundamentally different risk profile.

## What opening a PR looks like in code

Under the hood it's ordinary GitHub API usage. A minimal example with Octokit:

```ts
import { Octokit } from '@octokit/rest'

async function openPr(octokit: Octokit, owner: string, repo: string) {
  // 1. branch off the default branch, 2. commit the change to it
  //    (create blob/tree/commit, update the new branch ref) …
  // 3. open the Pull Request
  await octokit.pulls.create({
    owner,
    repo,
    head: 'velyr/improve-hero-cta',
    base: 'main',
    title: 'Move the hero CTA above the fold',
    body: 'Most visitors never scroll to the current CTA. This moves it up.',
  })
}
```

There's no magic — it's a branch and a `pulls.create`. The intelligence is in *what* change to make; the *mechanism* for proposing it is standard and reviewable.

## What it can't do

A well-designed PR agent deliberately can't:

- Push to your protected default branch.
- Merge its own Pull Request.
- Touch repositories you didn't select during install.

Those limits are the point — they keep a human in the loop on every change.

## Why this model beats a dashboard

The alternative — a tool that *tells* you what to fix and leaves you to implement it — puts all the work back on you. A PR agent does the implementation and asks for a yes/no. You keep full control (you merge) while skipping the manual edit. That's the model [Velyr](/agent/register) uses: it finds your highest-impact conversion fix each week and opens it as a Pull Request for your approval.
