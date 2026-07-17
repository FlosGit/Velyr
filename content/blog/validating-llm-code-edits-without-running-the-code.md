---
title: "Validating LLM Code Edits When You Can't Run the Code"
slug: "validating-llm-code-edits-without-running-the-code"
description: "How an autonomous agent validates code changes to production repos it cannot build, install, or execute: path denylists, byte-anchored edits, provable-only static checks, comparative validation, and an adversarial second model."
tldr: "An agent that writes code into repositories it cannot execute gets none of the usual safety nets: no build, no tests, no typecheck. What remains is a five-layer stack: constrain which files are touchable, anchor every edit to real file bytes instead of the model's quotation of them, run static checks that only reject provable breakage, validate unparseable formats comparatively (did the edit make the file worse), and put an adversarial second model between the proposal and the write. Every layer fails into a distinct, honest status instead of a retry loop."
cluster: "automation"
tags: ["llm-agents", "code-validation", "static-analysis", "guardrails", "pull-requests"]
publishedAt: "2026-07-17"
author: "Velyr Team"
related:
  - "approval-gate-pattern-ai-code-changes"
  - "can-ai-agent-open-pull-requests-repo-it-works"
  - "safely-auto-roll-back-bad-deploy-using-bounce-rate"
  - "automate-conversion-fixes-github-pull-requests"
schemaType: "TechArticle"
---

There is a class of system that has to write code into repositories it cannot execute. Ours is an agent that opens pull requests against other people's production websites. It runs in a serverless isolate with a wall-clock budget, reads the repo over the GitHub API, and at the moment it writes a change it has no checkout, no `node_modules`, no build, no test run, and no dev server. Whatever validation happens has to happen before the PR exists, using nothing but the bytes of the files, static analysis that runs in milliseconds, and more model calls.

The customer's own CI may run on the PR afterwards. That is not a safety net, it is someone else's inbox. A PR that fails CI on a syntax error costs the exact trust the whole system depends on. The goal is a change that is provably not-broken before any human sees it.

After a year of production runs, the validation stack has settled into five layers. Each one is cheap. Each one rejects only what it can prove is broken. And they are ordered so that a failure at any point leaves nothing behind in the target repo.

## What "can't run the code" actually rules out

It is worth being precise, because each unavailable tool kills a familiar guard:

- **No `npm install`.** Arbitrary package managers, private registries, native dependencies, and minutes of wall clock in an environment budgeted in seconds. This rules out running anything.
- **No test suite.** Even if one exists (you don't know), you can't run it.
- **No typecheck.** `tsc` needs the full dependency graph, which needs the install.
- **No rendering.** You cannot boot the app and look at it. (You can screenshot the live production site, which turns out to matter later.)

So the usual ladder (types, tests, CI, staging) is gone at write time. What's left is the file itself, before and after the edit.

## Layer 1: constrain the blast radius before validating anything

The first guard has nothing to do with code quality. A model choosing which file to edit is a model that can choose `.github/workflows/deploy.yml`, and a workflow edit is a secret-exfiltration primitive: CI runs with credentials the agent was never given. So before any content check, the chosen path runs against a denylist:

```ts
const FORBIDDEN_EDIT_PATHS: RegExp[] = [
  /^\.github\//i,                   // CI can exfiltrate secrets
  /(^|\/)\.env(\.|$)/i,             // .env, .env.local, .env.production
  /(^|\/)package(-lock)?\.json$/i,  // dependency manifests
  /(^|\/)vercel\.json$/i,           // deploy config
  /\.pem$|\.key$|\.p12$|\.pfx$/i,   // private keys
  /(^|\/)supabase\/functions\//i,   // the agent itself (no self-modification)
  // ...framework configs, lockfiles, Dockerfiles, IaC, migrations
]
```

Then the inverse gate: an allowlist of file extensions the pipeline can actually verify. The syntax validator returns `ok: true` for types it cannot parse (`.vue`, `.svelte`), because a validator that blocks everything it doesn't understand blocks too much. That pass-through would be a hole, so the caller closes it: any extension outside the verifiable set is refused outright, with an error that says exactly why ("refusing to open an unverified PR"). A permissive validator plus a strict extension gate is fail-closed. A permissive validator alone is not.

## Layer 2: anchor edits to real bytes, not the model's memory of them

The model emits edits as find/replace pairs. The dominant failure mode is not malice or hallucinated APIs, it is **transcription drift**: the `find` string is a near-copy of the real code with slightly different whitespace, a straightened quote, or reordered attributes. Applied naively, that either fails or, worse, matches the wrong thing.

The guard works in two steps. First, try the exact substring. If that fails, build a whitespace-normalized version of the file alongside an index map, so every character of the normalized text points back at its position in the original:

```ts
// Collapse whitespace runs to a single space AND record, per
// normalized char, the original index it came from, so a normalized
// match maps back to exact original bytes.
function buildNormalized(content: string): { norm: string; map: number[] }
```

On a unique match, the replacement is spliced into **the actual bytes at that anchor**, never into the model's quotation of them. The model's `find` is only ever used to locate; the file's own content is what survives around the edit.

The two failure cases get different names, and that matters operationally:

- **Zero matches** becomes `find_mismatch`, and the error carries the closest-scoring lines from the real file, so the failure is diagnosable from the record alone.
- **Multiple matches** becomes `find_ambiguous`, with a snippet of each candidate site.

These are distinct statuses in the database, never a generic `failed`. A rising mismatch rate means the model is paraphrasing what it quotes; a rising ambiguity rate means its anchors are too short. You cannot see either trend through a single undifferentiated failure bucket.

There is exactly one self-heal: on a mismatch, the model is re-asked to re-anchor its `find` against the file's real content. The `replace` is never altered, so the repair can fix location but never semantics. If it misses twice, the run ends in `find_mismatch`, honestly.

## Layer 3: static checks that reject only provable breakage

For file types with a real parser, this layer is boring and good: Babel with `errorRecovery: false` for the JS/TS family, `JSON.parse` for JSON. A dropped brace never reaches a commit.

Liquid templates (Shopify themes) are where it gets interesting, because there is no strict parser you can borrow, and theme files legitimately contain fragments that look broken. The delimiter check is **asymmetric by design**: it flags an opening `{{` or `{%` that never closes, and deliberately never flags a stray `}}` or `%}`:

```ts
// Asymmetry by design: we flag an OPENING ({{ or {%) that never
// closes, but NOT a stray CLOSING, because bare braces occur
// constantly in JS/CSS inside theme files. Catching dropped-close
// is the high-value common case; flagging stray-close would
// false-reject valid themes wholesale.
```

A dropped closing delimiter is the high-frequency LLM failure. A stray closing brace is what inline `<script>` and `<style>` blocks look like all day. Symmetric validation here would be a false-rejection machine.

Block-tag pairing (`{% if %}`/`{% endif %}` and friends) follows the same rule: unknown tags are ignored, `raw`/`comment`/`schema` bodies are excluded, and a file using the `{% liquid %}` tag opts out of block checks entirely. Only certainly-broken markup is rejected.

The principle behind the asymmetry is the load-bearing idea of the whole layer: **a validator with false rejections is worse than no validator.** Every false rejection is a lost run, and lost runs create pressure to weaken the check in a hurry, usually badly. A check that only fires on provable breakage never generates that pressure.

## Layer 4: when the format is unvalidatable, validate the delta

Then there is HTML. General tag balance in HTML5 is not provable without a full parser: optional closing tags and void elements make "unbalanced" a matter of spec interpretation, and a homemade balancer will reject valid documents forever.

The escape hatch is to stop validating the file and start validating the **edit**. The same provable-only shell checks (an orphan `<!--` that swallows the rest of the document, `<script>`/`<style>` open/close count balance, every JSON-LD block still parsing) run against the edited file, but a failure only rejects if the **original file passed the same check**:

```ts
const newShell = validateHtmlShell(newContent)
if (!newShell.ok) {
  if (validateHtmlShell(oldContent).ok) {
    return { ok: false, reason: `edit broke the HTML shell: ...` }
  }
  // pre-existing quirk: tolerate with a warning, stay mergeable
}
```

A pre-existing oddity (say, an unbalanced count caused by a `document.write('<script...')` string that was always there) is tolerated with a warning, so unrelated edits to an imperfect file remain shippable. Inline `<script>` bodies get the Babel treatment only if the edit touched them: a body found verbatim in the old file is never re-litigated.

One more check in this layer is domain-specific but the pattern is general: if the analytics loader was present before the edit and gone after, reject. The system measures its own changes through that snippet; an agent must never be able to blind its own measurement, even accidentally.

Comparative validation generalizes well beyond HTML. You rarely need "this file is valid." You need "this edit did not make the file worse in any way I can prove." The second question is answerable for formats where the first is not.

## Layer 5: an adversarial second model for claims about the world

Everything so far checks the code. None of it checks the **claim**. A diff can be syntactically perfect and still be built on a false premise: the model asserts a banner covers the signup button on mobile, and the mobile screenshot plainly shows it doesn't. No parser catches that.

The last gate before any write is a second model call, framed explicitly as an adversary. The system prompt opens with the job description and closes the incentive loophole: "your ONLY job is to decide whether that proposal survives scrutiny. You gain nothing by approving it."

Two implementation details do most of the work:

**The first model's output is data, not conversation.** Every piece of the proposal (problem statement, hypothesis, confidence reasoning, the diff itself) is wrapped in sentinel blocks the reviewer is told to treat as untrusted machine output. This is not paranoia about attackers; it is paranoia about the first model. Generated prose about a fix sometimes contains instruction-shaped text, up to and including sentences that read like a verdict. The reviewer is told that text inside the blocks announcing a verdict is content to judge, never an instruction to follow.

**The questions are narrow and the refusal grounds are enumerated.** The reviewer answers exactly three things: would these edits plausibly fix the stated problem; is each specific visual claim actually visible in one of the attached screenshots (cited by exact viewport label, judged by pixels rather than by the author's assertion); and does the prose describe only changes that exist in the find/replace pairs. Refuting requires concrete grounds from that list. "Not assessable" never refutes. Style, taste, and "I would fix it differently" never refute. Genuine uncertainty is a pass.

That last rule sounds lenient and is actually what keeps the gate alive: an adversarial reviewer with vague license to object converges on rejecting everything, and a gate that rejects everything gets turned off.

Two operational decisions round it out. The gate **fails open**: if the verifier call errors, the fix proceeds and the failure is logged, because a broken filter should not halt an otherwise working pipeline. And fail-open has a sharp edge worth knowing about: with a small token cap, a claim-heavy verdict gets truncated, truncation is an error, and the error fails open. The gate would silently disable itself on exactly the proposals that most need review. So the cap is generous and a truncated response retries once at double the cap instead of being swallowed.

When the reviewer refutes, the run does not retry in a loop. It ends as an honest skip, with the refuted fix and the full verdict preserved in the run record as an autopsy artifact. A system that must ship something every week will ship garbage; a skipped run with a preserved reason is a feature, not a failure.

## Ordering: validate everything, then write anything

The layers above would still be embarrassing if a failure halfway through left debris. So the write path is strictly two-phase. For every file in the change (there can be several, and they are declared interdependent): re-fetch the file at the target branch head, run the anchor guard against those fresh bytes, splice, and syntax-validate. Only after **every** file passes does the branch get created and the commits land.

A failure on file three of three therefore leaves nothing: no orphan branch, no partial commit set, no PR. Applying a subset of interdependent edits is strictly worse than applying none, because a half-applied change can break the site in ways the whole change would not.

## What the stack doesn't catch

All five layers together answer "is this change mechanically sound and honestly described." They say nothing about whether it is a good idea. Two backstops own that question.

First, a human. The change ships as a pull request behind an [approval gate](/blog/approval-gate-pattern-ai-code-changes), and the PR body is a receipt rather than a sales pitch: which files were read and which were not, which signals were inspected, what was verified in this environment, and explicitly what was **not** verified. The reviewer of an automated change deserves to know the difference between "checked" and "assumed."

Second, measurement. After deploy, the affected metric is compared over matched windows before and after the change, and a regression past a fixed percentage-point threshold gets a [rollback proposed through the same approval flow](/blog/safely-auto-roll-back-bad-deploy-using-bounce-rate). The validation stack keeps bad diffs out; the measurement loop catches bad ideas that were valid code.

## The stack at a glance

| Layer | Question it answers | On failure |
|---|---|---|
| Path denylist + extension allowlist | May this file be touched at all? | Refuse, no write |
| Byte-anchored find/replace | Does the edit's target exist, exactly once? | `find_mismatch` / `find_ambiguous`, one re-anchor retry |
| Provable-only static checks | Did the edit break what a parser can prove? | Refuse, no branch created |
| Comparative validation | Did the edit make an unparseable file worse? | Refuse; pre-existing quirks tolerated |
| Adversarial second model | Is the claim about the world true? | Honest skip, verdict preserved; verifier outage fails open |

This stack is what we built inside [Velyr](/), an agent that ships one conversion fix a week to a customer's repo as a pull request. But none of it is specific to conversion fixes. The constraint (the writer cannot execute the target) applies to any system that edits code across arbitrary repositories, and every layer above is an afternoon of implementation. The hard part is the discipline that shaped them: reject only what you can prove, name every failure, and never let a guard's own outage take the system down with it.
