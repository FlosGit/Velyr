---
name: velyr-build-and-env
description: >-
  Recreate and operate the Velyr LOCAL environment: clean clone → npm install →
  dev server, the build-chain anatomy (npm run dev / npx vite build / npm run
  build / npm run preview), and the traps. Load when setting up the repo fresh,
  starting the dev server, running or verifying a local build, hitting "vite
  build fails" / node or npm errors / missing module errors, creating
  .env.local, or wrestling with Windows shell quirks (Git Bash vs PowerShell).
  NOT for deploying (velyr-run-and-operate), the env-var catalog
  (velyr-config-and-flags), tests (velyr-validation-and-qa), or prod failures
  (velyr-debugging-playbook).
---

# Velyr — Build & Local Environment

Velyr is a Vite 5 + React 18 SPA with Vercel serverless functions (`api/`) and a
Supabase Deno edge function (`supabase/functions/agent-run/`). **Only the SPA
runs locally.** `api/` functions execute on Vercel; the edge function executes
on Supabase. Local work = frontend + blog content + the pure Node libs in
`api/_lib/` (testable without a server).

Dev machine snapshot (as of 2026-07-11): Node **v24.15.0**, npm **11.12.1**,
Windows 11, Git Bash as primary shell.

## 1. Clean clone → running dev server

```bash
git clone https://github.com/FlosGit/Velyr.git
cd Velyr
npm install
npm run dev          # → http://localhost:5173 (Vite default; no port override in vite.config.js)
```

Env setup — copy the template and fill only what your task needs:

```bash
cp .env.example .env.local   # .env.local is gitignored (verified in .gitignore)
```

| Working on | Vars you actually need locally |
|---|---|
| Landing/blog/static pages | none — the site renders without env |
| Auth/dashboard against real Supabase | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `api/_lib/*` pure-lib tests | none — the 7 test suites are dependency-free |
| Anything in `api/` end-to-end | can't run locally; it executes on Vercel (see velyr-run-and-operate) |

The dev server also serves the blog: `scripts/vite-plugin-blog.mjs`
(`configureServer`) answers `GET /blog-index.json` and `GET /blog/<slug>.json`
by re-running `loadArticles()` per request — edit a markdown file in
`content/blog/`, reload, see it.

## 2. Build-chain anatomy

| Command | What it runs | Emits | Safe locally? |
|---|---|---|---|
| `npm run dev` | Vite dev server + blog middleware | nothing (in-memory) | YES |
| `npx vite build` | Vite build + blog plugin `generateBundle` (blog gate) | `dist/` incl. `blog-index.json`, `blog/<slug>.json` | **YES — this is THE local verification command** |
| `npm run build` | `vite build` + `scripts/prerender.mjs` + `assert-blog-parity.mjs` + `assert-hogql-safe.mjs` | `dist/*.html`, `sitemap.xml`, `llms-full.txt` | **NO — pings production** (see trap) |
| `npm run preview` | serves `dist/` at http://localhost:4173 | — | YES (needs a prior build) |

**THE TRAP: `npm run build` pings production.** `scripts/prerender.mjs:328`
calls `submitToIndexNow([ORIGIN + '/blog', ...indexNowUrls])`, which POSTs to
`api.indexnow.org` with a **hardcoded key and host `velyr.io`**
(`src/utils/indexNow.js:11-13` — no env gate). Every full build, even a local
"just checking" one, tells Bing/Yandex to recrawl the live site. **Local
verification = `npx vite build` only.** The full chain belongs to the Vercel
deploy.

`npx vite build` is still a real gate, not a smoke test: `generateBundle` runs
`loadArticles()` (`scripts/lib/blog.mjs`), which **throws** on missing required
frontmatter fields (blog.mjs:141), invalid/duplicate slugs (:145, :148),
unknown clusters (:154), unresolvable `related:` slugs (:175), and runs the
near-duplicate gate (`checkDuplicates` from `scripts/lib/dedupe.mjs`, :190-192).
Compile + content correctness in one command. A clean run ends with
`✓ built in ~2s` (a >500 kB chunk-size warning is normal — verified 2026-07-11).

## 3. What does NOT exist locally

| Missing | Consequence |
|---|---|
| Deno toolchain | Edge fn (`supabase/functions/agent-run/`) type-checks ONLY at `supabase functions deploy` — OPERATOR (ask Florian). You can `node --check`-style eyeball TS but cannot compile it locally. |
| `test` script in package.json | Run tests directly: `node --test "api/_lib/*.test.mjs"` — **the quoted glob is required**; bare `node --test api/_lib/` FAILS on this setup (verified 2026-07-11). Also `node scripts/test-liquid-blocks.mjs`. |
| Linter / type checker / CI | `npx vite build` + the test commands above are the only automated gates. No `.github/` exists. |
| Vercel CLI | Not installed (as of 2026-07-11). Deploys happen via git push (OPERATOR). |
| Working `canvas` module | `require('canvas')` currently fails (`Cannot find module '../build/Release/canvas.node'`) — no prebuilt binary for Node 24/win32 landed in `node_modules/canvas` (verified 2026-07-11). Only `scripts/generate-og-image.js` imports it; dev/build/tests are unaffected. If you must regenerate `og-image.png`, flag it — rebuilding canvas needs native toolchain work (OPERATOR decision). |

## 4. Windows specifics

- **Git Bash is the primary shell.** Forward-slash paths work
  (`C:/Users/flori/Velyr`).
- **PowerShell 5.1 pitfalls** (if you must use it): no `&&` chaining (parser
  error — use `;` or `if ($?)`), `Out-File`/`>` writes UTF-16 LE by default
  (pass `-Encoding utf8` or, better, use the dedicated file tools).
- `scripts/shoot.mjs` and `scripts/assert.mjs` drive **puppeteer-core against a
  hardcoded Chrome**: `C:\Program Files\Google\Chrome\Application\chrome.exe`
  (shoot.mjs:4, assert.mjs:2), targeting `http://localhost:4173/` — so run
  `npx vite build && npm run preview` first. `shoot.mjs` writes NEW PNGs into
  `shots/`. That directory already holds tracked reference JPEGs (`git ls-files
  shots` is non-empty) — leave those alone and **don't stage the new PNG outputs**
  you generate.

## 5. Frontend env prefix rules

`src/lib/supabase.js:15,19` reads
`import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL`
(same pattern for the anon key). **Vite only exposes `VITE_*` to the browser**,
so the `NEXT_PUBLIC_*` fallback is dead in any Vite build — it survives as
legacy from the old Next.js scaffold. Set `VITE_*`; keep `NEXT_PUBLIC_*` only
in sync if it's set at all. Full catalog and surface map: see
velyr-config-and-flags.

## 6. Known-traps checklist

- [ ] **Never `npm run build` locally** — prod IndexNow ping (§2). Use `npx vite build`.
- [ ] **Edited edge fn ≠ deployed edge fn** — `supabase/functions/*` ships via
      `supabase functions deploy`, not git push. Local edits do nothing to prod.
- [ ] **`node --test` needs the quoted glob** — `node --test "api/_lib/*.test.mjs"`.
- [ ] **Migrations never auto-apply** — files in `supabase/migrations/` are the
      record; applying is a manual SQL-Editor step (OPERATOR).
- [ ] **react-router-dom is installed but unused** — routing is manual in
      `src/App.jsx` by design. Do not wire the router up.
- [ ] **`.env.local` holds live secrets beyond the app's own** — including
      social-posting credentials (`INSTAGRAM_ACCESS_TOKEN`, `YOUTUBE_CLIENT_ID`
      — presence verified 2026-07-11, values never inspected). Never stage,
      print, or copy it.
- [ ] **`canvas` doesn't load on Node 24/win32** — only affects
      `scripts/generate-og-image.js` (§3).

## When NOT to use this skill

- Deploying, crons, migrations, prod logs → **velyr-run-and-operate**
- "Where is X configured / what's the default" → **velyr-config-and-flags**
- Test inventory, how to add tests, evidence standards → **velyr-validation-and-qa**
- Something in prod is broken → **velyr-debugging-playbook**
- Blog/content/docs specifics beyond the build gate → **velyr-docs-and-writing**

## Provenance and maintenance

All facts verified against the repo on **2026-07-11**. Re-verify before trusting:

- Build scripts unchanged: `node -e "console.log(require('./package.json').scripts)"`
- IndexNow ping still ungated: `grep -n submitToIndexNow scripts/prerender.mjs src/utils/indexNow.js`
- Dev-server blog middleware: `grep -n configureServer scripts/vite-plugin-blog.mjs`
- Supabase env fallback chain: `grep -n "import.meta.env" src/lib/supabase.js`
- Test glob still the working form: `node --test "api/_lib/*.test.mjs"`
- canvas load state (may change after reinstall/Node bump): `node -e "try{require('canvas');console.log('ok')}catch(e){console.log(e.message.split('\n')[0])}"`
- Chrome path in puppeteer scripts: `grep -n "chrome.exe" scripts/shoot.mjs scripts/assert.mjs`
- Vercel CLI still absent: `npx vercel --version` (errors if not installed)
