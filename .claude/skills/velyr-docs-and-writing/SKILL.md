---
name: velyr-docs-and-writing
description: Maintaining Velyr's documents of record and written surfaces. Load when updating CLAUDE.md or VELYR_OVERVIEW.md, writing or editing blog articles (content/blog/*.md), changing ANY marketing copy or product claim (landing, FAQ, llms.txt, meta tags), doing SEO/internal-linking work, or when asked to "update the docs", "add an article", "change the wording", "sweep the claims". Owns the 5-surface marketing-claim sync procedure and the claim-truth rules (what copy may NEVER promise). NOT for outbound marketing runs (velyr-growth-ops), the shipping process itself (velyr-change-control), or build mechanics (velyr-build-and-env).
---

# Velyr Docs & Writing

How to keep Velyr's written surfaces true, in sync, and in voice. Core principle
(enforced by build gates and by history): **copy is a claim about the code — verify
the code before writing the claim.**

## 1. Documents of record

| Document | Role | Maintenance duty |
|---|---|---|
| `CLAUDE.md` | THE architecture contract, loaded into every Claude session | Updating it is **part of** any change that alters architecture, flags, statuses, or claims — not a follow-up. House style: dense prose, date-stamped incident parentheticals ("(fixed 2026-07-08)"), bold **gotcha** callouts, explicit twin annotations ("format-locked twin in ..."). |
| `VELYR_OVERVIEW.md` | German product-truth doc; describes the *verified* state, not the vision | Sources listed in its header; uncertain points carry an explicit `[UNSICHER]` marker — keep that convention. Dated header ("Stand: ..."), update the date when editing. |
| `README.md` | Public repo one-liner | Known-stale as of 2026-07-11: says "AI Growth Agent for React, Next.js & Vite" — omits Shopify. If you touch it, fix that. |
| `.env.example` | Env-var record | Must track new env vars. Has known drift (wrong `GITHUB_CLIENT_ID` names, unread Stripe/Plausible/Trigger vars) — details are owned by velyr-config-and-flags. |
| `supabase/migrations/*.sql` | The DB record. Files are the log of what was run manually; NOT an auto-pipeline | New DB change = new dated file, applied by the OPERATOR in the Supabase SQL Editor. |
| `.claude/skills/*/SKILL.md` | This library | When a shipped change moves a fact a skill states, updating that skill is part of the change. Each skill's "Provenance and maintenance" section lists its re-verification commands. |

## 2. The 5-surface marketing-claim sync

Marketing claims live in **five places that must say the same thing**. When product
framing changes (pricing, trial terms, platform support, feature behavior), sweep all
five in one change:

| # | Surface | Path | Notes |
|---|---|---|---|
| 1 | Landing page | `src/Home.jsx` | Hero, pillars, pricing, requirement cards |
| 2 | Static head + crawler fallback | `index.html` | `<title>`, meta description, OG/Twitter, JSON-LD, and the `display:none` crawler fallback block (~lines 225–260) |
| 3 | LLM-readable summary | `public/llms.txt` | Plain-markdown product truth; crawled by AI assistants |
| 4 | FAQ | `src/data/faqs.js` | **Must stay dependency-free (no JSX, no imports)** — `scripts/prerender.mjs:17` imports it directly in Node. Feeds the FAQ page, FAQPage JSON-LD, and the prerendered `/faq` |
| 5 | Prerender route metadata | `scripts/prerender.mjs` | The `ROUTES` array (line 85 as of 2026-07-11): per-route title/description/fallback |

Plus one asset: **`public/og-image.png` is a rendered image** — it needs a manual
re-render whenever the headline it shows changes.

**Sweep procedure:**
1. `grep -rn "<old claim text>" src/Home.jsx index.html public/llms.txt src/data/faqs.js scripts/prerender.mjs`
2. Edit every hit (and check for paraphrases of the claim, not just exact text).
3. Verify with `npx vite build` — NEVER `npm run build` locally (it pings production
   IndexNow; see velyr-build-and-env).
4. Note whether og-image.png is affected; if yes, flag the manual re-render.

### Claim-truth rules (what copy may NEVER say)

Each rule exists because the code says otherwise. Verify before relaxing any of them.

| Never write | Because the code does | Verified at |
|---|---|---|
| "Guardrails reject changes before they reach you" | Brand Guardrails are **prompt-only** — a text block in the Pass-2 prompt, no post-parse enforcement | `supabase/functions/agent-run/index.ts:3552` (`guardrailsContext`), interpolated at `:3636` |
| "Rolled back within 48 hours" | The rollback **measurement window** is deploy±2d, but the **check runs only Wednesdays 10:00 UTC** with a 10-day lookback. Say "measured over the 48h before/after; rollback proposed at the next weekly check" | `vercel.json` cron `0 10 * * 3`; `api/agent/run.js:1087` (15pp threshold), `:1106` (10d lookback), `:1205` (±2d windows) |
| "Alerts you the moment a competitor changes" | Competitor scan is **weekly** ("changed since last week") | edge `index.ts:3044` |
| Any A/B-testing implication about the product | A/B testing was fully removed; Velyr measures before/after, it does not run A/B tests | CLAUDE.md (item 8a); `agent_ab_tests` is dormant data only. (The blog *cluster* "experimentation" writes about A/B testing as a topic — that's fine; the product claim is what's forbidden) |
| "Credit card required to start" | Trial is 14-day **no-card** (`trial_period_days: 14`, missing payment method ⇒ auto-cancel) | `api/stripe.js`; stale copy was fixed in commit b854ae6 |
| Localized run times without UTC | Weekly run is Monday **09:00 UTC** (cron `0 9 * * 1`) | `vercel.json` |

## 3. Blog system runbook

Articles are markdown in `content/blog/*.md`. `scripts/lib/blog.mjs` (`loadArticles`)
is the single source of truth, consumed by the Vite plugin (dev JSON + build emit),
`scripts/prerender.mjs` (static HTML, sitemap.xml, llms-full.txt), and the parity gate.
**Honest fail by design:** any bad frontmatter, unresolved related-slug, or near-dup
**throws and breaks the build** — there is no silent skip.

### Required frontmatter (build fails if missing — `scripts/lib/blog.mjs:27`)

`title`, `slug`, `description`, `tldr`, `publishedAt`, `cluster`, `author`

Constraints (all verified in `blog.mjs` as of 2026-07-11):
- `slug` must match `^[a-z0-9][a-z0-9-]{1,70}[a-z0-9]$` (kebab-case, 3–72 chars) and be unique.
- `cluster` must be one of the 10 slugs in `src/data/blogClusters.js` (dependency-free, Node-imported — same rule as faqs.js): `framework-fixes`, `posthog-recipes`, `benchmarks`, `core-web-vitals`, `concepts`, `automation`, `experimentation`, `comparisons`, `patterns`, `playbooks`.
- `publishedAt` (YYYY-MM-DD) gates publishing: the article is live once `publishedAt <=` build date (override with `VELYR_BUILD_DATE` for deterministic tests).

Optional fields: `updatedAt`, `tags[]`, `faqs: [{q, a}]` (rendered + emitted as FAQPage
JSON-LD), `related[]` (slugs — **every entry must resolve to an existing article or the
build throws**; only published targets render), `schemaType` (overrides the cluster's
default `Article`/`TechArticle`).

### The gates (run on every `npx vite build`)

| Gate | Mechanism | Threshold |
|---|---|---|
| Required fields / slug / cluster / related resolution | `loadArticles()` throws | — |
| Near-duplicate content | 8-word shingles, pairwise Jaccard (`scripts/lib/dedupe.mjs`) | ≥0.35 warns, **≥0.55 fails the build** |
| Crawler-fallback parity | `scripts/assert-blog-parity.mjs` proves the prerendered fallback is byte-identical to the JSON `contentHtml` (cloaking guard) | runs in `npm run build` only (needs dist/) |
| HogQL honesty | `scripts/assert-hogql-safe.mjs`: every ` ```sql`/` ```hogql` block may only use functions and `$`-properties on the allowlist (`scripts/lib/hogql-allowlist.mjs`) | unknown token fails the build |

### Internal-linking discipline (the GSC lesson)

Google Search Console flagged the blog "Discovered, currently not indexed"; the root
cause was thin **contextual** article→article linking (hub links from index/category
pages don't count). Rule: **every article keeps ≥3 contextual inbound links** from
`related:` arrays or in-body `](/blog/<slug>)` links, same-cluster and genuinely
topical. To measure: load `loadArticles()` in a Node one-liner and count distinct
inbound sources per slug from `fm.related` plus body matches of `](/blog/<slug>)`.

### Add an article, start to finish

1. Create `content/blog/<slug>.md` with the required frontmatter above (copy the skeleton in §5).
2. Add 2–4 `related:` slugs (same cluster, topical) — and add this article to the `related:` of 3+ existing articles so it isn't orphaned.
3. Any SQL/HogQL code blocks: use only allowlisted functions/properties, or extend `scripts/lib/hogql-allowlist.mjs` with a *verified-real* addition.
4. Verify: `npx vite build` (runs field gate + dedupe; NOT the parity/HogQL asserts — those run in the full chain on Vercel's deploy build).
5. Ship via velyr-change-control (individual staging; commit only when told).

### Bulk generation (local-only tooling)

`node scripts/generate-articles.mjs --dry-run` — reads `content/blog-topics.json` +
`scripts/generation-prompt.txt`, writes drafts via OpenRouter. Model:
`GEN_MODEL` env, default `anthropic/claude-sonnet-4.6` (`generate-articles.mjs:47`) —
its own knob, separate from the agent's `AGENT_LLM_MODEL`. Safe by design: idempotent
(skips existing files), `--limit N`, `--cluster <slug>`, refuses a placeholder prompt
without `--force`. Drafts carry `publishedAt: "PUBLISH_DATE"` and stay unpublished
until `scripts/assign-publish-dates.mjs` stamps real dates. Needs `OPENROUTER_API_KEY`;
making API calls costs money — treat a non-dry run as OPERATOR-approved work.

## 4. House voice

Derived from `src/Home.jsx`, `public/llms.txt`, `src/data/faqs.js` (verified 2026-07-11):

- **Product-as-actor**: the grammatical subject is "Velyr" / "the agent" / "it" — never company-"we/our". ("Velyr finds your site's biggest conversion leak…")
- **Second person** for the customer: "your code, your approval", "nothing ships without your YES".
- Calm, honest, understated. No hype words, no unverifiable superlatives. Trade-offs stated plainly (see the `/code-vs-overlay` fallback in `prerender.mjs` for the model tone: it names when a competitor category is the better fit).
- Brand-term glossary (use these exact names): **Growth Agent** / **AI Growth Agent** (the product; never "co-pilot"/"assistant"), **the agent** (generic reference), **one fix a week** / **weekly conversion fix**, **Business DNA**, **Brand Guardrails**, **Competitor watch**, **Public impact timeline**, **"next up" roadmap**, **one-tap approval**, the landing's mental model **Detect → Fix → Approve → Ship → Measure**, and the tagline family **"Your code, your approval."**
- Typography note: the brand serif is **Cormorant Garamond**. A historical typo ("Cormorant Garant" — a non-existent font) is fixed in all `src/` files but still present in the crawler-fallback inline styles of `index.html` (lines ~231–258) and `scripts/prerender.mjs` (lines 39/46/59/342) as of 2026-07-11 — harmless there (Georgia fallback) but fix on touch, and never introduce it anew. The dashboard surfaces deliberately use **Instrument Serif** — do not "correct" them to Cormorant.

## 5. Templates

**Truth-pass row** (use one per claim when auditing copy against code):

```
| Claim (verbatim) | Surface(s) | What the code does (file:line) | Verdict (true / overclaim / stale) | Fix |
```

**CLAUDE.md update checklist** (run whenever a shipped change alters behavior):
- [ ] Does the change add/remove/rename an env var or flag? → env section + `.env.example`
- [ ] New/changed twin? → twin list in "Cross-runtime twin pattern"
- [ ] New run status? → status lifecycle text + migration reference
- [ ] Changed cadence/threshold? → check the five claim surfaces too (§2)
- [ ] Date-stamp the edit inline ("(as of YYYY-MM-DD)" or "(fixed YYYY-MM-DD)")
- [ ] Does any skill in `.claude/skills/` state the old fact? → update it in the same change

**Article frontmatter skeleton:**

```yaml
---
title: ""            # required
slug: ""             # required; ^[a-z0-9][a-z0-9-]{1,70}[a-z0-9]$, unique
description: ""      # required; used for meta description + listings
tldr: ""             # required; rendered as the TL;DR box
publishedAt: "2026-07-14"  # required; article is live once <= build date
cluster: "concepts"  # required; one of the 10 slugs in src/data/blogClusters.js
author: "Velyr Team" # required
# optional:
# updatedAt: "2026-07-20"
# tags: []
# related: ["existing-slug-1", "existing-slug-2"]   # must resolve or build fails
# faqs:
#   - q: ""
#     a: ""
# schemaType: "TechArticle"   # overrides the cluster default
---
```

## When NOT to use this skill

- Outbound marketing execution (leadscan runs, social posts, Product Hunt) → **velyr-growth-ops**
- The staging/commit/deploy process for the edit you're making → **velyr-change-control**
- Build failures or local-env problems while verifying → **velyr-build-and-env** / **velyr-debugging-playbook**
- Env-var/.env.example drift details → **velyr-config-and-flags**

## Provenance and maintenance

All facts verified against the repo on 2026-07-11. Re-verify before relying on:

- Required frontmatter set + slug rule: `grep -n "REQUIRED_FIELDS\|SLUG_RE" scripts/lib/blog.mjs`
- Cluster slugs: `grep -n "slug:" src/data/blogClusters.js`
- Dedupe thresholds: `grep -n "THRESHOLD\|SHINGLE_SIZE" scripts/lib/dedupe.mjs`
- faqs.js/blogClusters.js Node-import requirement: `grep -n "faqs.js\|blogClusters.js" scripts/prerender.mjs scripts/lib/blog.mjs`
- ROUTES array position: `grep -n "^const ROUTES" scripts/prerender.mjs`
- IndexNow ping (the reason `npm run build` is forbidden locally): `grep -n "submitToIndexNow" scripts/prerender.mjs src/utils/indexNow.js`
- Guardrails still prompt-only: `grep -n "guardrailsContext" supabase/functions/agent-run/index.ts`
- Rollback cadence/windows: `grep -n "rollback_check" vercel.json` and `grep -n "ROLLBACK_BOUNCE_PP_THRESHOLD\|ROLLBACK_LOOKBACK_MS" api/agent/run.js`
- Competitor cadence: `grep -n "changed since last week" supabase/functions/agent-run/index.ts`
- Generator model default: `grep -n "GEN_MODEL" scripts/generate-articles.mjs`
- "Cormorant Garant" remnants: `grep -rn "Cormorant Garant[^a]" index.html scripts/ src/`
