# VELYR — Produktüberblick (Stand: 2026-07-09)

> Dieses Dokument beschreibt den **echten, im Code verifizierten Stand** von Velyr — nicht die Vision.
> Quellen: `package.json`, `src/Home.jsx`, `index.html`, `public/llms.txt`, `src/data/faqs.js`,
> `api/stripe.js`, `api/onboarding.js`, `api/agent/run.js`, `supabase/functions/agent-run/*`,
> `supabase/migrations/*`, `shopify.app.toml`, `vercel.json`, `CLAUDE.md`.
> Unsichere Punkte sind mit **[UNSICHER]** markiert.

---

## 1. Was Velyr HEUTE ist

### One-Liner
Velyr ist ein **autonomer "AI Growth Agent"** (Einzelprodukt, €49/Monat): Er findet jede Woche
das größte Conversion-Leck einer Website, **schreibt den Code-Fix selbst**, zeigt dem Betreiber
eine Vorschau und deployt ihn nach **One-Tap-Freigabe über Telegram**. Auf einem GitHub-Repo landet
der Fix als **Pull Request**, auf einem Shopify-Store als **direkte (freigabe-gated) Theme-Änderung**.

Marketing-Wortlaut (verifiziert):
- `public/llms.txt`: *"Velyr is an AI growth agent that ships one weekly conversion fix: a GitHub Pull Request on your repo, or a direct theme change on your Shopify store. Your code, your approval."*
- `index.html` `<title>`: *"Velyr — Ship a Conversion Fix Every Week"*
- Hero (`src/Home.jsx`): H1 *"Ship a conversion fix **every week**."*

### ICP (Zielkunde)
**Nicht Shopify-only.** Zwei Zielgruppen, die als gleichwertig vermarktet werden:
- **Entwickler/Founder** mit einem GitHub-Repo auf einem JS-Stack (React, Next.js, Vite), das
  auto-deployt.
- **Shopify-Store-Betreiber** (mit oder ohne GitHub).

Wörtlich (`llms.txt`): *"Indie hackers, solo founders, small SaaS teams, and store owners who want
continuous conversion optimization without hiring a CRO agency or running it manually."*

**Primärer Use-Case:** kontinuierliche Conversion-Optimierung ohne CRO-Agentur (€2–5k/Monat) und
ohne selbst A/B-Tests zu bauen — der Agent liefert **fertigen, review-baren Code**, keine Slide-Deck-
Empfehlungen.

**Explizit NICHT unterstützt:** Wix, Squarespace, Webflow ("expose no source code the agent can
edit"). Reines HTML / No-Code-Builder ebenfalls nicht.

### Integrations-Pfade (3 reale Pfade)
Der Diskriminator ist `agent_connections.connection_source` (CHECK: `'github'` | `'shopify_direct'`,
Default `'github'`; Migration `20260630_connection_source.sql`).

1. **GitHub (`connection_source='github'`, `github_repo_name` gesetzt)** — Velyr-GitHub-App via OAuth,
   Fix = Pull Request, Merge → Host deployt.
2. **Shopify-via-GitHub (`connection_source='github'`, Theme-Repo)** — Merchant hat sein Theme über
   Shopifys offizielle GitHub-Integration in ein Repo gespiegelt. Für Velyr ein **normaler GitHub-
   Connect** (kein `write_themes` nötig): Fix = PR gegen das Theme-Repo (Liquid/JSON), Shopify
   synct nach Merge live. Optionaler Branch-Override (`shopify_connected_branch`).
3. **Shopify-direct (`connection_source='shopify_direct'`, `shopify_shop_domain` gesetzt)** — Kein
   GitHub. Velyr liest/schreibt das Live-Theme direkt über die **Shopify Admin GraphQL API**
   (`read_themes,write_themes`). Fix = staged Theme-Write, live nach YES.

### Tatsächlich unterstützte Plattformen
- **GitHub-Pfad:** Der Framework-Klassifikator (`repo-mapper.ts`) kennt formal:
  `vite-react`, `cra`, `nextjs-app`, `nextjs-pages`, `remix`, `astro`, `sveltekit`, `vue-vite`,
  `nuxt`, `plain-html`, `shopify-liquid`, sonst `unsupported` (→ Run wird übersprungen).
  **Vermarktet und edit-tauglich sind aber nur React / Next.js (Pages- **und** App-Router) / Vite**
  — die Requirements-Sektion sagt explizit *"React/JSX in repos, Liquid in Shopify themes"*.
  **[UNSICHER]** ob remix/astro/sveltekit/vue/nuxt über die reine Erkennung hinaus produktiv
  gefixt werden (Pass-2-Prompt und Editier-Guards sind auf JSX/Liquid ausgelegt); praktisch =
  React-basiert + Liquid.
- **Deploy-Hosts (GitHub-Pfad):** Vercel, Netlify, Render, Railway, Cloudflare Pages (Auto-Deploy
  on Merge). `hosting_provider`-CHECK erlaubt zusätzlich `'shopify'`.
- **Shopify:** MAIN- + unveröffentlichte Themes (Liquid/JSON).

---

## 2. Was der Agent tatsächlich tut

### End-to-End-Flow (Connect → Deploy)
**Onboarding:** Supabase-Auth → `AgentOnboarding.jsx` verzweigt bei `ConnectionTypeChoice`:
GitHub-Flow (6 Schritte) **oder** Shopify-direct-Flow (4 Schritte: Storefront-URL → OAuth →
Theme-Picker → Telegram). Der **erste Run startet sofort nach Onboarding-Abschluss** (nicht erst
Montag).

**Wöchentliche Discovery-Pipeline (RA1–RA7, in der Supabase Edge Function `agent-run`):**
1. **RA1 `repo-mapper.ts`** — Repo-Struktur (Framework, Entry Points, CSS-Approach) via ein
   rekursives `git.getTree`. Unbekannte Form → `unsupported` → Skip.
2. **RA2 `import-graph.ts`** — BFS über lokale Imports (Blobs, Concurrency 8).
3. **RA3 `component-ranker.ts`** — **LLM Pass 1**: rankt Komponenten nach Conversion-Impact.
4. **RA4 `deep-reader.ts`** — liest Volltext der Top-Komponenten (Byte-Budget).
5. **RA5 `callAIForFix` (index.ts)** — **LLM Pass 2**: liefert **einen** `file_to_edit` +
   `code_change` (Find/Replace-Edit) + Ehrlichkeits-Felder (`confidence`, `blind_spots`,
   `rollback_signal`, optional `question_for_owner`, `backlog`, `problem_title`, `hypothesis`).
   Optional bis zu 2 `additional_edits` für zwingend nötige Begleit-Dateien. **Bekommt Screenshots
   der Live-Zielseite** (Desktop 1280×800, Mobile 390×844, Small-Mobile 360×640) als `image_url`.
   Alternativ `{ skip }`.
6. **createPR / staged write** — Forbidden-Path-Allowlist → Find-Guard → Babel-Syntax-Check
   (JSX) bzw. Liquid-Delimiter-/Block-Validierung (Theme) je Datei **vor** dem Commit.
7. **RA7 `receipt-builder.ts`** — PR-Body als "Receipt": was inspiziert wurde, welche Screenshots
   Pass 2 erreichten.

**Pfad-Unterschiede beim Deploy:**
- GitHub: PR wird nach YES gemergt → Host deployt.
- Shopify-via-GitHub: PR gegen Theme-Repo → Shopify synct.
- Shopify-direct: `applyShopifyDirectWrite` — Re-Check der Checksummen (optimistic concurrency,
  sonst `shopify_concurrency_abort`), dann Upsert ins Live-Theme (`themeFilesUpsert`).

### Datenquellen
- **PostHog** (Kern-Analytics): Traffic, Bounce Rate, Scroll-Tiefe, Click-Verhalten, **Rage-Clicks**
  (`$rageclick`), **Dead-Clicks** (`$dead_click`) — device-gesplittet (Mobile/Desktop). **Ein
  geteiltes PostHog-Projekt** für alle Kunden, partitioniert über `properties.$host` (Kundendomain).
  Ist `posthog_host_filter` null → Analytics übersprungen, nur Funnel-Discovery.
- **Google PageSpeed** (`GOOGLE_PAGESPEED_API_KEY`) — Core Web Vitals.
- **ScreenshotOne** (`SCREENSHOTONE_API_KEY`, optional) — Live-Screenshots (3 Viewports) für Pass 2
  + Before/After für die 48h-Visual-Verification.
- **Competitor-Snapshots** — bis zu 2 getrackte Wettbewerber (Hero, CTA, Pricing).

### Konkrete Fixes (aus dem Code)
Pass 2 liefert **eine** minimale Find/Replace-Code-Änderung an einer React/JSX-Datei bzw. Liquid-
Datei, begründet mit einer datengestützten `hypothesis`. **Visual-Claim-Regel:** ein Fix mit
visueller Prämisse (Overlap, Fold, fixe Banner über CTA, Mobile-Rendering) muss in den Screenshots
bestätigt und in `hypothesis` zitiert sein — sonst anderes Problem oder Skip. Beispielhafte
Fix-Klassen: CTA unter dem Fold / schwacher CTA-Text, Mobile-Layout-Probleme, Above-the-fold-
Klarheit. Ausgeliefert **immer** als echter Code (PR-Diff oder Theme-Write), nie als "Dashboard von
Vorschlägen".

### Approval (Telegram-Gate) — **weiterhin aktiv und zentral**
- Telegram-Bot: `YES`/`NO` (neuester pending Run), Inline-Buttons ✅/❌ (`approve:<runId>` /
  `reject:<runId>`) + `🔍 Preview`-Button (CI-Preview-Deploy bzw. Shopify-Wegwerf-Theme).
- Weitere Bot-Kommandos: `status`, `dna`, `note <reason>`, `competitor add/remove`, `set/unset branch`,
  `approve/reject <run-id>`, `/start`.
- **Dashboard-Zwillinge:** `approve_run` / `reject_run` (gleiche Reconcile-Logik) — man kann auch
  im Dashboard freigeben.
- **Nichts geht ohne explizites YES live.** Trust-Strip: *"You approve every change before it ships"*.

### Rollback-Safety
48h nach Deploy: `rollback_check` prüft Bounce Rate via PostHog; steigt sie um ≥15 Prozentpunkte,
schlägt der Agent einen Rollback vor (Revert-PR bzw. Restore der Theme-Dateien) — ebenfalls
freigabe-gated. Route-scoped wenn möglich, sonst site-wide.

### "Scan"/Audit vs. Agent
**Der alte Free-Scan / €9-Report ist vollständig entfernt** (Removal S0a; Migration
`20260523_drop_scan_product_leftovers.sql`). Es gibt **kein** Scan-, Report- oder `/premium`-Surface
mehr. Heute existiert **nur** das eine Agent-Abo. Ebenso: **A/B-Testing wurde entfernt** (Item 8a);
`agent_ab_tests` ist nur noch Alt-Daten.

### Run-Kadenz (`vercel.json`, 5 Crons)
| Zeit (UTC) | Modus | Wo |
|---|---|---|
| Mo 09:00 | Full Run (kein mode) | feuert Edge Function, kehrt sofort zurück |
| Mi 09:00 | `midweek` | inline in Vercel |
| Mi 10:00 | `rollback_check` | inline |
| Mo 08:00 | `weekly_summary` | inline (Telegram) |
| täglich 00:00 | `enforce_subscriptions` | GC, Kündigungen, 48h-Visual-Verification |

Plus: **On-Demand-Run** ("Run now" im Dashboard, max. 1×/Tag) und der **Sofort-Run nach Onboarding**.

---

## 3. Alleinstellungsmerkmale

- **Ships real code, not suggestions.** Der Fix ist ein echter PR-Diff bzw. Live-Theme-Write im
  bestehenden Workflow des Kunden — keine neue Plattform, kein Migrationsaufwand. Das ist die
  Kern-Differenzierung ggü. CRO-Agenturen (Slide-Decks) und A/B-Tools (Dashboards).
- **Human-in-the-loop by design:** jede Änderung Telegram-gated, mit Preview vor dem Live-Gang.
- **Messbarer Safety-Net:** automatischer 48h-Rollback-Check bei Bounce-Anstieg — "a measured
  revert, not just a promise". Zusätzlich 48h-**Visual-Verification** (Vision-LLM prüft, ob die
  Änderung wirklich gerendert wurde).
- **Shopify Protected-Scope-Exemption (`write_themes`):** **aktiv/gewährt.** `shopify.app.toml`
  fordert `scopes = "read_themes,write_themes"`. Genutzt auf dem **Shopify-direct-Pfad**, um nach
  YES direkt ins Live-Theme zu schreiben (Admin GraphQL API, API-Version file-level 2026-04,
  theme-level 2026-07). Ticket 68049335 — Exemption erteilt. Wenige Drittanbieter erhalten diesen
  Scope; das ist ein echtes Trust-/Moat-Signal.
- **Technische Trust-Signale (Architektur):**
  - Cross-Tenant-Defense-in-Depth beim Onboarding (State-HMAC → Single-use-Nonce → Cookie-HMAC →
    JWT-Match → Installation-/Repo-Scoping → SECURITY-DEFINER-RPC).
  - Secrets (GitHub/Shopify-Tokens) **verschlüsselt at rest** (`enc:v1:` AES-256-GCM), format-locked
    Twins Node ↔ Deno.
  - Optimistic Concurrency auf Shopify-Writes (Checksum-Re-Check → Abort statt Überschreiben).
  - "Honest fail"-Prinzip: unbekanntes Framework → Skip statt Raten; ehrliche Skip-Status statt
    Pseudo-Fixes.
  - Anti-Abuse-Ledger (`trial_fingerprints`), das Account-Löschung überlebt.
  - Betrieben von **Claude** (OpenRouter, produktiv `anthropic/claude-opus-4.8` seit 2026-07,
    Code-Default `anthropic/claude-sonnet-4.6`); pro-Subscription Monats-Wallet-Cap gegen
    Kostenausreißer.

---

## 4. Pricing & Trial

- **Modell:** Ein Abo, **€49/Monat** (Stripe-Price `STRIPE_PRICE_GROWTH`), Währung EUR, monatlich,
  jederzeit kündbar. Kein Tier-Modell, kein Add-on. **Preiserhöhung 2026-07-15** (€29 → €49, Opus-4.8-
  Upgrade): zahlende Bestandskunden bleiben auf dem alten €29-Price-Objekt grandfathered; laufende
  Trials konvertieren über den Conversion-Checkout zum neuen Preis.
- **Trial:** **14 Tage, kostenlos, OHNE Kreditkarte** (`api/stripe.js`: `trial_period_days: 14`,
  `trial_settings.end_behavior.missing_payment_method: 'cancel'`). Läuft die Trial ohne hinterlegte
  Karte aus, **cancelt Stripe automatisch** → Zugang wird gated. Für die Weiternutzung ist dann ein
  regulärer €49-Checkout (mit Karte) nötig.
  - **[ERLEDIGT 2026-07-10]** Die veraltete *"credit card is required to start"*-Copy wurde in allen
    drei betroffenen Flächen korrigiert (`src/data/faqs.js` inkl. Trial-Ende-Antwort, `index.html`,
    `public/llms.txt`) — Marketing-Copy und Code sind wieder konsistent (No-Card-Trial).
- **Wann startet die Trial-Uhr:** **erst nach Onboarding-Abschluss**, nicht bei Signup. Ablauf:
  `init_subscription` (Onboarding-Mount, `subscription_status = NULL`) → nach Abschluss
  `api/stripe.js?action=start_trial` flippt auf `'trialing'`. Erst dann darf der Agent laufen
  (Cron-/Manual-Gates verlangen `subscription_status ∈ {active, trialing}`).
- **Manuelle Runs im Trial gedrosselt (2026-07-15):** `trigger_run` erlaubt Trials nur **einen
  manuellen Run pro 72h** (`TRIAL_MANUAL_RUN_COOLDOWN_MS`, zahlende Kunden: 24h) — LLM-Kostenschutz
  fürs Opus-Modell. Der automatische Montags-Run läuft für Trials unverändert.
- **Wallet-Cap:** **Ja, aber intern** — `MONTHLY_SPEND_CAP_EUR` Code-Default **€20,00/Monat pro
  Subscription**; **produktiv seit 2026-07 auf €35 gesetzt** (`AGENT_MONTHLY_SPEND_CAP_EUR`, wegen
  Opus 4.8: ~1,67× Sonnet-Kosten, Full-Run ~€0,33–0,67). Das ist ein **Kostenschutz für
  Velyr** (OpenRouter-Wallet), **kein kundenseitiges Feature**. Fehlende `agent_llm_usage`-Tabelle sperrt den Agent NICHT (no-op +
  warn).
- **Freemium:** **Nein.** Nur das €49-Abo mit 14-Tage-Trial. Kein Free-Scan mehr.
- **Anti-Abuse:** `trial_fingerprints`-Ledger — eine Gratis-Trial pro Site-Identität; überlebt
  Account-Löschung (verhindert Delete-and-Retrial). Failt OPEN bei Infra-Fehlern.
- **Dunning:** Bei Zahlungsfehler pausiert der Agent, 7 Tage zum Aktualisieren, dann Kündigung.
  `enforce_subscriptions`-Cron cancelt Subs nach `current_period_end`.

---

## 5. Aktueller Stand / Reifegrad

### Live & funktionsfähig
- €49-Abo + 14-Tage-No-Card-Trial (Stripe), Anti-Abuse-Ledger.
- **Alle drei Connect-Pfade live:** GitHub, Shopify-via-GitHub (SG1–SG4), Shopify-direct (Stages 1–4).
- Vollständige Wochen-Pipeline (RA1–RA7), zwei LLM-Pässe, Screenshots (3 Viewports), PostHog-
  Heatmap-Signale inkl. Rage-/Dead-Clicks (Dead-Clicks-Toggle seit 2026-07-07 aktiv).
- Telegram-Approval (YES/NO + Inline-Buttons + Preview) **und** Dashboard-Approval.
- 48h-Rollback-Check (route-scoped/site-wide) + 48h-Visual-Verification.
- Business-DNA-Lernschleife, Focus-Pin ("Fix in next run"), Conversion-Goal (+ Messung),
  Brand Guardrails, Competitor-Watch, Public Impact Timeline + Win-Badge.
- Next.js App-Router-Support (Stage 2).

### Flag-gated / bedingt
- **`AGENT_SHOPIFY_PREVIEW_THEMES`** (C3, Shopify-Preview auf Wegwerf-Theme): dev-store-verifiziert
  + auf Supabase aktiviert (2026-07-07). **Vercel-Env-Var setzen = offener User-Schritt** [UNSICHER
  ob inzwischen gesetzt].
- **Visual-Verification** braucht `OPENROUTER_API_KEY` auf Vercel — ohne skippt sie still.
- **`AGENT_FULLRUN_FANOUT`** (B3-Fan-out, eine `single_run`-Invocation pro Subscription): default on.
- PostHog-Analytics nur mit gesetztem `posthog_host_filter` (sonst nur Funnel-Discovery).

### Bekannte Schulden / geplant (nicht gebaut)
- `subscription_id` text-vs-uuid-Schema-Uneinheitlichkeit (Stripe-Webhook keyt auf `user_id`,
  Agent auf `auth_user_id`) — vorbestehend, nicht Shopify-spezifisch.
- OAuth-Routing-Race in `App.jsx` (Hash-Sniffing) — vor 2. OAuth-Provider auf `onAuthStateChange`
  migrieren.
- `finalize` lässt Legacy-`auth_user_id IS NULL`-Codes einmalig passieren (24h-Follow-up).
- README (`README.md`) nennt nur *"AI Growth Agent for React, Next.js & Vite"* — **erwähnt Shopify
  nicht**, also leicht veraltet.

### Reifegrad / Nutzerzahl
- **[UNSICHER]** — Keine belastbare User-Zahl im Code. Signale für **frühe Live-/Trial-Onboarding-
  Phase eines echten Solo-Produkts**: No-Card-Trial + Anti-Abuse-Ledger (echte Signups erwartet),
  live Shopify-App mit gewährter `write_themes`-Exemption, deutsche Rechtsentität (AGB/Impressum,
  EUR), Vercel-Hobby-Limit (12 Serverless-Functions) als aktive Design-Constraint (→ deutet auf
  kleines/Solo-Setup, nicht Enterprise-Scale). `package.json` version `0.1.0`.

---

## 6. Positionierung & Sprache

### Außendarstellung
- **Tagline:** *"Ship a conversion fix every week."* (Hero) / *"Ship a Conversion Fix Every Week"*
  (Title-Tag).
- **Eyebrow/Kategorie:** *"AI Growth Agent"*.
- **Kern-Pitch (Hero-Sub):** *"Velyr finds your site's biggest conversion leak, writes the fix, and
  shows you a preview of your site with the change. One tap and it's live. Works with your GitHub
  repo or your Shopify store."*
- **Wertversprechen-Säulen:** "one fix a week", "shipped with your YES", "you approve every change",
  "rolled back if it hurts your numbers", "Your code, your approval".
- **Preis-Framing:** *"14-day free trial · You approve every change · Cancel anytime"*.

### Voice
- **Produkt-als-Akteur**, nicht Firmen-"we/our". Grammatikalisches Subjekt ist durchgängig
  **"Velyr" / "the agent" / "it"** (*"the agent reads your analytics"*, *"it proposes a rollback"*).
- **Zweite Person** adressiert den Kunden direkt: **"you / your"** (*"nothing ships without your OK"*).
- **Kein** erkennbares "we/our"-Firmennarrativ in Landing/llms.txt/FAQ. (Nur JSON-LD-Metadaten nennen
  Organisation *"Velyr"* / Autor *"Velyr Team"*.)
- Ton: ruhig, ehrlich, understatement-lastig (kein Hype). Editorial-Serifen-Ästhetik (Cormorant
  Garamond), gedämpfte Cream/Grün-Palette.

### Konsistente Begriffe
- **"Growth Agent" / "AI Growth Agent"** = das Produkt (Nav-Button heißt "Growth Agent").
  **Nicht** "co-pilot", **nicht** "assistant".
- **"the agent"** als generische Referenz.
- **"weekly conversion fix" / "one fix a week"**, **"Every Monday"**.
- Feature-Eigennamen: **"Brand Guardrails"**, **"Business DNA"**, **"Full Funnel analysis"**,
  **"Competitor watch"**, **"Monthly roast report"**, **"Public impact timeline"**, **"next up"
  roadmap**, **"one-tap approval"**, **"rollback"**.
- 5-stufiges Mentales Modell auf der Landing: **Detect → Fix → Approve → Ship → Measure**.

---

### Anhang: Tech-Stack (Kurz)
React 18 SPA (manuelles Client-Routing, **kein** React Router trotz Dependency) · Vite 5 · Vercel
(Serverless Functions, 12-Function-Limit) · Supabase (Postgres + Auth + Edge Functions/Deno) ·
Stripe (Abo) · Telegram Bot API (Approvals) · GitHub App / Octokit (PRs) · Shopify Admin GraphQL API
(Theme-I/O) · PostHog (Analytics, shared project) · Claude via OpenRouter (produktiv `anthropic/claude-opus-4.8`).
Migrationen werden **manuell** über den Supabase-SQL-Editor angewandt (Dateien in
`supabase/migrations/` sind das Repo-Protokoll, keine Auto-Pipeline).
