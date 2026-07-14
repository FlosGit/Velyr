# Velyr Lead Scan — Anleitung für Claude Code

## Ziel
Finde öffentliche Posts/Threads auf Reddit, Hacker News, IndieHackers und X/Twitter
von Leuten, die das Problem haben, das Velyr (aktuell funktionierender Teil) löst.

**WICHTIG:** Velyr deckt jetzt ZWEI relevante Segmente ab — beide suchen:
1. **SaaS / eigenes Web-Produkt mit GitHub-Repo** (der bisherige Flow).
2. **Shopify-Stores** — Velyr fixt das Theme über Shopifys offizielle
   GitHub-Theme-Sync (Liquid-Fix als PR → Merchant merged → Shopify synct live).

Onboarding-Brücke für Shopify-Leads ist immer der GitHub-Theme-Sync (kostenlos,
vom Merchant selbst einrichtbar) — das beim Outreach mitdenken, aber NICHT als
Suchfilter verwenden: jeder Shopify-Store mit Conversion-/Theme-Schmerz zählt.

## Was Velyr macht (aktuell live, für Relevanz-Check)
Velyr verbindet PostHog-Analytics mit einem GitHub-Repo, erkennt automatisch
Conversion-Drop-offs (z.B. an Signup-Formularen, Checkout-Flows, Onboarding),
generiert automatisch einen Code-Fix, öffnet einen Pull Request auf GitHub,
und der Founder approved/rejected per Telegram-Nachricht, bevor irgendwas
gemerged wird.

**Shopify (neu, jetzt live):** Wenn ein Shopify-Store sein Theme über Shopifys
offizielle GitHub-Integration mit einem Repo synct, ist das für Velyr eine
ganz normale GitHub-Verbindung. Velyr erkennt Conversion-Schwächen im Theme
(Produktseite, Add-to-Cart, Cart-/Checkout-nahe Liquid-Sections, Formulare),
öffnet einen PR mit dem Fix, der Merchant approved per Telegram und merged —
Shopify synct die Änderung live. Kein `write_themes`, keine App-Installation.

Zielgruppe:
- **SaaS / Web-Produkt:** Solo-Founder oder kleine Teams mit eigenem Web-Produkt
  (meist React/Next/Vue o.ä.), die Analytics-Daten haben (PostHog, GA, Mixpanel,
  Amplitude, etc.) aber nicht die Zeit/Kapazität haben, die Conversion-Probleme
  die sie sehen, selbst zu debuggen und zu fixen.
- **Shopify:** Store-Besitzer / E-Commerce-Founder mit Conversion-Schmerz am
  eigenen Store, die ihr Theme verbessern wollen (gern technik-affin oder mit
  Entwickler, aber nicht zwingend — der GitHub-Theme-Sync ist merchant-seitig
  einrichtbar).

## Relevanz-Kriterien (ein Treffer ist relevant, wenn mindestens EINES zutrifft)
1. Person erwähnt explizit PostHog/Analytics + dass sie nicht weiß, was mit den
   Daten zu tun ist oder keine Zeit hat, Insights in Fixes umzusetzen
2. Person beschreibt Conversion-Drop-off / Funnel-Problem (Signup, Onboarding,
   Checkout, Landing Page) und sucht nach einer Lösung oder klagt darüber
3. Person ist Solo-Founder/kleines Team und beschreibt explizit "keine Zeit für X"
   bzgl. Frontend-Bugfixes, Conversion-Optimierung, oder A/B-Testing-Iteration
4. Person fragt nach Tools, die automatisch Code-Fixes basierend auf Analytics
   vorschlagen oder ausführen
5. Shopify-Merchant beschreibt ein Conversion-/Funnel-Problem an seinem Store
   (Produktseite, Add-to-Cart, Cart/Checkout-nahe Theme-Teile, Formulare) ODER
   sucht ein Tool/Hilfe, um sowas am Theme zu fixen

NICHT relevant: reine Marketing-/Copy-Fragen ohne technischen Bezug, reine
Traffic-/Ads-/Produkt-Sourcing-/Dropshipping-Posts ohne On-Site- bzw.
Theme-Conversion-Bezug (kein Frontend-/Theme-Hebel für Velyr), allgemeine
"wie benutze ich PostHog"-Setup-Fragen ohne Schmerzpunkt.

## Pflicht-Filter (IMMER anwenden, vor dem Output)
1. **Frische:** Nur Posts, die **maximal 1 Monat alt** sind (älteres komplett
   verwerfen, auch bei hoher Relevanz). **Neuer ist besser** — bei sonst
   gleichwertigen Treffern den jüngeren bevorzugen, und die finale Liste pro
   Segment nach Datum absteigend sortieren.
2. **Eigene Posts ausschließen:** Wenn der Reddit-User **`Difficult_Celery3458`**
   bereits unter einem Post kommentiert hat, diesen Post **NICHT** aufnehmen —
   das ist der Account des Betreibers, ein vorhandener Kommentar bedeutet, der
   Post wurde schon kontaktiert/genutzt. Für jeden Kandidaten vor dem Output die
   Kommentare prüfen (Permalink + `.json`, alle Kommentar-Autoren rekursiv
   scannen) und Treffer rausfiltern.

## Workflow

### Schritt 1: Hacker News (Algolia API, kein Browser nötig)
Nutze die offizielle HN Algolia Search API:
https://hn.algolia.com/api/v1/search?query=<QUERY>&tags=story,comment
https://hn.algolia.com/api/v1/search_by_date?query=<QUERY>&tags=story,comment

Probiere beide Endpoints (relevance + by_date) für jede Query aus queries.md.
Sammle: title/comment_text, url (oder https://news.ycombinator.com/item?id=<id>),
author, created_at.

### Schritt 2: Reddit (öffentliche JSON-Endpoints, kein Login nötig)
Nutze öffentliche Such-Endpoints, z.B.:
https://www.reddit.com/search.json?q=<QUERY>&sort=new&limit=25
https://www.reddit.com/r/SaaS/search.json?q=<QUERY>&restrict_sr=1&sort=new
https://www.reddit.com/r/indiehackers/search.json?q=<QUERY>&restrict_sr=1&sort=new
https://www.reddit.com/r/PostHog/search.json?q=<QUERY>&restrict_sr=1&sort=new
https://www.reddit.com/r/shopify/search.json?q=<QUERY>&restrict_sr=1&sort=new

Relevante Subreddits (SaaS/Web): SaaS, indiehackers, PostHog, webdev,
EntrepreneurRideAlong, microsaas, startups, SideProject.
Relevante Subreddits (Shopify): shopify, ecommerce, shopifyDev, Entrepreneur.
Setze einen User-Agent-Header (z.B.
"velyr-leadscan/1.0"), sonst blockt Reddit ggf. Rate-Limit beachten (max ca. 1
Request/2 Sekunden), bei 429 kurz pausieren und retry.

**WICHTIG (Stand 2026-06):** Die öffentlichen JSON-Endpoints blocken inzwischen
**server-seitige** Clients hart (HTTP 403, kein transientes 429) — `curl`,
WebFetch und die Web-Suche (reddit.com steht auf der Crawler-Sperrliste)
liefern nichts. Funktionierender Weg: **Playwright → echtes Chrome** auf
`https://www.reddit.com/` navigieren (JS-Challenge wird automatisch gelöst),
dann die Such-API **same-origin aus dem Seitenkontext** via `fetch(...)`
abfragen (trägt die Browser-Cookies/Headers). Frische über `t=month` +
`sort=new` einschränken (siehe Pflicht-Filter 1). Alternative für die Zukunft:
offizielle Reddit-OAuth-API mit Token.

### Schritt 3: IndieHackers (kein offizielles API → Browser-MCP-Skill nutzen)
Keine öffentliche Search-API verfügbar. Nutze den Browser-MCP-Skill:
1. Öffne https://www.indiehackers.com/search?q=<QUERY>
2. Falls das keine guten Ergebnisse liefert, alternativ: Google-Suche mit
   site:indiehackers.com <QUERY> im Browser durchführen
3. Sammle Thread-Titel, URL, kurzen Snippet/Auszug

### Schritt 4: X/Twitter (kein stabiles API → Browser-MCP-Skill nutzen)
Nutze den Browser-MCP-Skill, um wie ein normaler eingeloggter Nutzer auf
x.com zu suchen (https://x.com/search?q=<QUERY>&f=live). Falls die Suche auf
x.com selbst keine brauchbaren Ergebnisse liefert oder blockiert wird,
alternativ über eine normale Google-Suche mit site:x.com <QUERY> gehen.
Sammle Tweet-URL, Autor (Handle), Text-Auszug, Datum falls sichtbar.

**Wichtig:** Kein automatisiertes Massen-Interagieren (kein Liken, Folgen,
Antworten, DMs) — nur lesen und Links sammeln. Browser-Sessions sollen sich
wie normales, langsames menschliches Stöbern verhalten (keine hunderte
Requests in Sekunden), um Rate-Limits/Sperren zu vermeiden.

### Schritt 5: Relevanz-Filter
Für jeden gesammelten Treffer: gegen die Relevanz-Kriterien oben prüfen.
Verwirf alles, was nicht klar passt. Lieber 15 wirklich gute Treffer als
80 generische.

### Schritt 6: Output schreiben
Schreibe die finale Liste nach leads-<YYYY-MM-DD>.md im velyr-leadscan-Ordner
(heutiges Datum), sortiert nach Plattform, mit folgendem Format pro Eintrag:

## [Plattform]

### <Titel/Kurzbeschreibung>
- **Link:** <URL>
- **Autor:** <Name/Handle, falls erkennbar>
- **Warum relevant:** <1 Satz, welches Kriterium erfüllt ist>
- **Datum:** <falls erkennbar>

Am Ende der Datei eine kurze Zusammenfassung: Anzahl Treffer pro Plattform,
und ob bei IndieHackers/X die Suche eingeschränkt war (z.B. Login-Wall,
Rate-Limit) — damit klar ist, ob ein erneuter Lauf später mehr finden könnte.

## Häufigkeit
Dieses Skript ist für wiederholten, manuellen Gebrauch gedacht (z.B.
wöchentlich). Bei jedem Lauf: neue Datei mit aktuellem Datum, alte Dateien
nicht überschreiben — so siehst du Entwicklung über Zeit.
