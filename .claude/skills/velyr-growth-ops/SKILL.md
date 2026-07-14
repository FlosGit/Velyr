---
name: velyr-growth-ops
description: "Runbooks for Velyr's outbound growth work: the weekly leadscan (Reddit/HN/IH/X lead hunting), Instagram/YouTube social posting, and the Product Hunt launch. Load when asked to 'run the leadscan', 'find leads', draft outreach, 'post the carousel', publish to Instagram or YouTube, prepare or execute the Product Hunt launch, or do any distribution/marketing task that leaves the repo. Often requested in German ('Leadscan laufen lassen', 'Leads finden', 'den Post veröffentlichen'). NOT for on-site copy, blog, or claim sweeps (velyr-docs-and-writing) and not for shipping code (velyr-change-control)."
---

# Velyr Growth Ops

Runbooks for the three recurring outbound tracks: **leadscan**, **social posting**, **Product Hunt launch**. All three are Claude-session tasks in this repo; all three end in an outward-facing action.

> **OPERATOR GATE (non-negotiable):** Everything that leaves the machine — posting to Reddit/Instagram/YouTube/Product Hunt, sending outreach, uploading assets to a public host (litterbox), even a "harmless" test publish — is **OPERATOR (ask Florian)**. Never post autonomously. *Reading* public sites for lead research is normal session work. The leadscan explicitly "collects links for manual review — writes no replies, sends no DMs, follows nobody" (`velyr-leadscan/run.md`).

Terms used once: **leadscan** = the weekly manual lead-hunting run defined in `velyr-leadscan/`; **ICP** = ideal customer profile; **litterbox** = litterbox.catbox.moe, a temporary file host (uploads expire).

---

## 1. Leadscan runbook

### Files (all in `velyr-leadscan/`, verified 2026-07-11)

| File | Role |
|---|---|
| `INSTRUCTIONS.md` | The authoritative run spec: goal, segments, relevance criteria, mandatory filters, per-platform workflow, output format. Read it in full at the start of every run. (Currently carries uncommitted local edits — `git status` shows ` M`.) |
| `queries.md` | Search queries, grouped in clusters (PostHog/analytics pain, conversion drop-off, …). Apply across all platforms. |
| `communities.md` | Community map (Stand 2026-07-09): tiered ranking of where paying users sit, with per-community promo rules. ✅ = empirically verified productive, ⚠️ = check posting rules before first use. |
| `run.md` | The one-paragraph start prompt + troubleshooting (Reddit 429 → pause/retry; X login-wall → manual login once; IH → Google `site:` fallback). |
| `leads-YYYY-MM-DD.md` / `outreach-YYYY-MM-DD.md` | Dated outputs. Never overwrite old runs — the date series shows drift over time. Existing runs: 2026-06-19, 06-23, 06-27, 07-09. |

### What counts as a lead (summary of `INSTRUCTIONS.md` — the file is authoritative)

Two segments, both always searched:
1. **SaaS / own web product with a GitHub repo** (React/Next/Vue etc., has analytics, no time to turn insights into fixes).
2. **Shopify stores** with conversion/theme pain (product page, add-to-cart, cart/checkout-near sections, forms).

Relevant if ≥1 criterion hits: analytics-but-no-time-to-act pain; described conversion drop-off seeking a fix; solo founder "no time for frontend/CRO"; asks for tools that turn analytics into code fixes; Shopify merchant with theme-conversion pain. **Not** relevant: pure marketing/copy questions, traffic/ads/dropshipping posts without an on-site lever, generic "how do I set up PostHog".

> Note (2026-07-11): `INSTRUCTIONS.md` pitches the Shopify onboarding bridge as the free GitHub theme-sync ("no write_themes, no app install"). CLAUDE.md says the Shopify-**direct** Admin-API path is also live and marketed as an equal. Treat the GitHub-sync framing as the *outreach-safe default*, and flag the discrepancy to the operator before rewriting the spec.

### Mandatory filters (both are in `INSTRUCTIONS.md` — never skip)

1. **Freshness:** posts ≤1 month old only; newer beats older; sort each segment newest-first.
2. **Owner-contact check:** before output, fetch each candidate's permalink `.json` and recursively scan all comment authors for **`Difficult_Celery3458`** (the operator's Reddit account). Any hit = already contacted = drop the lead. A past run found 3/10 stale leads this way (project notes, 2026-07-09).

### Channel effectiveness (project notes from the 2026-07-09 run — start here, don't rediscover)

| Channel | Verdict |
|---|---|
| **Review subreddits** (r/reviewmyshopify, r/roastmystartup, r/design_critiques, r/website) | **Richest channel.** Critique is invited there; audit-style replies are contribution, not spam. The query "CRO agency" surfaces anti-agency-narrative leads. |
| r/shopify, r/SaaS, r/buildinpublic | Productive; obey per-community promo rules in `communities.md` (r/shopify is strictly anti-promo). |
| **Hacker News** | **Dead for this pain profile** — 33 queries × both Algolia endpoints, ≤1 month → 0 relevant leads. Skip it; note the skip in the output summary. |
| IndieHackers / X via web search | Empty. X needs a logged-in browser session. |

### Technique notes (project notes, 2026-07-09 — the parts that were painful to learn)

- **Reddit JSON blocks server-side clients hard (HTTP 403)** — curl/WebFetch/web-search get nothing (also documented in `INSTRUCTIONS.md`). Working path: drive real Chrome (Playwright / browser tools), navigate to `https://www.reddit.com/` once (JS challenge solves itself), then call the search API **same-origin from the page context** via `page.evaluate(fetch(...))`. ~1.8 s delay between requests; ~30 requests/batch ran with ~0 errors. Constrain freshness with `t=month&sort=new`.
- **Oversized tool results** land as files in the session's tool-results directory — parse them with a small Node script instead of re-fetching.
- Browser sessions must look like slow human browsing; no mass interaction of any kind (also a hard rule in `INSTRUCTIONS.md`).

### Output contract

Write `leads-<today>.md` in `velyr-leadscan/` — grouped by platform; per entry: link, author, one-line "why relevant" (which criterion), date. End with a summary: hits per platform + whether IH/X were constrained (login-wall, rate limit). Outreach drafts go to `outreach-<today>.md`; **sending them is OPERATOR**.

---

## 2. Social posting runbook

State as of 2026-07-10 (project notes + repo verification). Working artifact set: `social/leaks-carousel-2026-07-10/` — use it as the template for the next post.

### Credentials — handle with care

- Live in `.env.local` at the repo root (gitignored). `INSTAGRAM_ACCESS_TOKEN` (Instagram Login API, `graph.instagram.com`; account **@velyr.io**) and `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN` (scope `youtube.upload` **only** — can upload, cannot list/verify existing videos).
- **Never print, stage, or commit these values.** The publish script reads the token itself.
- Known incident: the IG token was blocked 2026-07-10 (`OAuthException code 200 "API access blocked"`) and fixed operator-side the same day. If publish fails at the token sanity check, that's an OPERATOR (Meta dashboard) problem, not a script bug.

### Asset pipeline (verified against `social/leaks-carousel-2026-07-10/`)

1. **Slides:** `build-slides.py` generates 7 HTML slides at 1080×1350 (IG 4:5) into `slides/` — dark editorial look, Cormorant Garamond wordmark, value-first content.
2. **Render:** headless Chrome — `chrome --headless --screenshot --window-size=1080,1350 --virtual-time-budget=12000 <file>` (command is in the script header) → PNGs in `png/`.
3. **Convert:** ffmpeg PNG→JPEG into `jpg/` — **Instagram requires JPEG**.
4. **Stage:** upload JPEGs to litterbox with `time=1h`. **Links expire after 1 hour** — always re-stage immediately before publishing (`litterbox-urls.txt` in the folder is stale by definition).
5. **Publish (OPERATOR):** `bash publish-instagram.sh` from inside the folder does everything standalone: token sanity check (`/me`) → re-stages all 7 JPEGs → per-slide item containers (`is_carousel_item=true`) → CAROUSEL container with `caption.txt` → polls `status_code` to `FINISHED` → `media_publish` → prints the permalink. API pinned at `graph.instagram.com/v23.0` (as of 2026-07-11).

### YouTube

- **No carousel/community-post API exists** — the only API surface is video upload. Carousels get repurposed as ~19 s **Shorts**: 1080×1920, ffmpeg zoompan over the slides (see `video/` in the artifact folder: 7 clips + `velyr-leaks-short.mp4` + `yt-meta.json` with the ready title/description/tags, `categoryId: 28`, `privacyStatus: public`).
- Prior Short published: video ID `U5yhvolUQbc` (project notes, 2026-07-10).

### Content strategy (project notes, 2026-07-10)

Product-explainer posts got 0 views. Current direction: **value-first educational carousels** (e.g. "5 conversion leaks"), dark bold editorial look, product mention only on the last slide / end of caption.

---

## 3. Product Hunt launch (scheduled: Sunday 2026-07-19, 12:01 AM PT)

Strategy: quiet-day launch → aim for a Top-3 badge instead of fighting Tuesday traffic; solo maker without an audience (project notes, 2026-07-10).

### Assets (verified on disk 2026-07-11)

| Asset | State |
|---|---|
| `product-hunt/ph-{1-hook,2-how,3-receipt,4-rollback,5-closer}.png` | 5 gallery images, **2540×1520 each** (verified via `file`), with their source HTMLs alongside — gallery images CAN be re-rendered from the HTMLs. |
| `product-hunt/video/velyr-launch.mp4` | Launch video, **71.1 s** (ffprobe-verified), 1080p30, audio mixed −13.9 LUFS (notes). |
| Video production pipeline | **Deliberately deleted 2026-07-10.** Rebuilding it means: frame-by-frame HTML via `window.__seek` + puppeteer-core + ffmpeg; music was Pixabay "Calm Digital Technology Background" by lvymusic (project notes). Only rebuild if the video itself must change. |

### Copy decisions that BIND all launch/social/outreach copy

- Tagline (56 chars): **"The AI growth agent that ships the fix, not a to-do list"**.
- **No** "one of the few apps with write_themes" claim — not provable.
- **No** A/B-testing implication anywhere — Velyr measures before/after; it never runs A/B tests.
- Everything else follows the claim-truth rules in **velyr-docs-and-writing** (guardrails are prompt-only, rollback timing wording, competitor cadence, no-card trial).

### Launch-day + after

Submitting, scheduling, commenting, and replying on PH = **OPERATOR**. Sessions prepare copy/assets and monitor. After launch day, `product-hunt/` can be deleted entirely (operator decision — it is untracked, so deletion is a plain `rm -rf`).

---

## 4. Outreach voice

Outreach obeys the same claim-truth rules as on-site copy (**velyr-docs-and-writing** owns them). Value-first: lead with a concrete, checkable observation about *their* site/store (audit-style), not a pitch. Disclosure when mentioning Velyr. Never copy-paste the same comment across threads (`communities.md` ground rule). Review subreddits are the one place where critique posts are the expected contribution — use that.

---

## When NOT to use this skill

- On-site copy, blog articles, FAQ, llms.txt, claim sweeps → **velyr-docs-and-writing** (its claim-truth rules bind this skill's copy too).
- Shipping code changes of any kind → **velyr-change-control**.
- Measuring whether growth work moved product numbers → **velyr-diagnostics-and-tooling**.

## Provenance and maintenance

Facts verified 2026-07-11 unless noted. Notes-attributed facts came from project run logs (leadscan 2026-07-09, social/PH 2026-07-10) and are dated inline.

| Volatile fact | Re-verify with |
|---|---|
| Leadscan spec & mandatory filters | `cat velyr-leadscan/INSTRUCTIONS.md` (check `git status velyr-leadscan/` for uncommitted edits) |
| Community map & promo rules | `cat velyr-leadscan/communities.md` |
| Publish script & API version | `head -30 social/leaks-carousel-2026-07-10/publish-instagram.sh` |
| PH assets present & dimensions | `file product-hunt/*.png && ls product-hunt/video/` |
| Launch video duration | `ffprobe -v error -show_entries format=duration -of csv=p=0 product-hunt/video/velyr-launch.mp4` |
| IG/YT credential var names (values: never print) | `grep -oE '^(INSTAGRAM|YOUTUBE)[A-Z_]*' .env.local` |
| Channel effectiveness / HN-dead verdict | Re-test only in a real leadscan run; update this skill + the dated leads file together |
| PH launch date/scheduling state | OPERATOR (ask Florian) — not derivable from the repo |
