---
title: "How to Improve Conversion on an Astro Landing Page with Islands"
slug: "improve-conversion-astro-landing-page-islands"
description: "Improve Astro landing page conversion with islands: ship the hero and CTA as static HTML, and hydrate only interactive bits with client:visible or client:idle to keep the page fast."
tldr: "Astro's advantage for conversion is that it ships zero JavaScript by default. Keep your hero, copy, and CTA as static HTML so they paint instantly, and turn only genuinely interactive pieces into islands hydrated with client:visible or client:idle. The result is a fast page where the CTA never waits on a bundle."
cluster: "framework-fixes"
tags: ["astro", "islands", "conversion-rate", "core-web-vitals", "cta"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "optimise-astro-image-component-fast-hero-lcp"
  - "improve-conversion-nextjs-landing-page"
  - "lcp-affect-conversion-rate-evidence-shows"
faqs:
  - q: "What is an Astro island?"
    a: "An island is an interactive component embedded in an otherwise static HTML page. Astro renders everything to HTML by default and ships no JavaScript; you opt specific components into client-side hydration with a client:* directive, so only those islands load JS while the rest of the page stays static and fast."
  - q: "What's the difference between client:load, client:idle, and client:visible?"
    a: "client:load hydrates immediately, client:idle waits until the browser is idle, and client:visible waits until the component scrolls into view. For below-the-fold widgets, client:visible avoids loading JS the visitor may never see, which keeps the initial page light."
  - q: "Should my CTA be an Astro island?"
    a: "Usually no. A CTA that links somewhere should be a plain anchor in static HTML so it works instantly with no JavaScript. Only make it an island if the click genuinely needs JS, and even then keep it a real link so it works before hydration."
---

Astro's whole advantage for conversion is that it ships **zero JavaScript by default**. **Keep your hero, headline, and CTA as static HTML so they paint instantly, and turn only the genuinely interactive pieces into islands hydrated with `client:visible` or `client:idle`.** A fast page where the CTA never waits on a bundle converts better than a slick one that does.

## Why "islands" matter for conversion

A typical React or Vue landing page hydrates the entire tree on load, including the static hero nobody interacts with. That JavaScript delays interactivity and competes for bandwidth with your image. Astro inverts this: the page is HTML, and interactivity is opt-in per component. The static parts — which is most of a landing page — cost no JS at all.

The genuinely Astro-specific lever is the `client:*` directive, which controls *when* each island hydrates.

## Keep the hero and CTA static

In an `.astro` page, the hero is just markup. No island, no directive, no JS:

```astro
---
// src/pages/index.astro  (frontmatter runs at build time)
import Newsletter from '../components/Newsletter.jsx'
import PricingToggle from '../components/PricingToggle.jsx'
---
<main>
  <h1>Ship a conversion fix every week</h1>
  <p>One high-impact fix, opened as a Pull Request.</p>
  <!-- Static anchor: works on first paint, no hydration -->
  <a class="cta" href="/agent/register">Start free trial</a>

  <!-- Below the fold: only hydrate when it scrolls into view -->
  <PricingToggle client:visible />

  <!-- Low priority: hydrate when the browser is idle -->
  <Newsletter client:idle />
</main>
```

Three deliberate choices:

1. **The CTA is a plain `<a>`** — it never depends on JavaScript, so it's clickable the instant the page paints.
2. **`PricingToggle` uses `client:visible`** — its JavaScript only loads when the visitor scrolls to it. If they convert from the hero, that bundle never downloads.
3. **`Newsletter` uses `client:idle`** — it's non-critical, so it waits until the browser has nothing better to do.

## Choosing the right directive

- **`client:load`** — hydrate immediately. Use only for something needed in the first viewport that genuinely requires JS (rare on a landing page).
- **`client:idle`** — hydrate when the main thread is free. Good for low-priority widgets near the top.
- **`client:visible`** — hydrate on scroll into view. The default choice for anything below the fold.

The rule: the further down and the less essential, the lazier the directive. Defaulting below-the-fold islands to `client:visible` keeps the initial load light, which protects your Largest Contentful Paint and Interaction to Next Paint.

## Steps to apply it

1. Audit your page: which parts are genuinely interactive? Usually just a toggle, a form, or a menu.
2. Render everything else as static `.astro` markup — especially the hero and CTA.
3. Make each interactive piece a component and add the laziest `client:*` directive that still works.
4. Keep the CTA a real anchor so it never waits on hydration.

## Confirm the page is actually faster for users

Capture Core Web Vitals to PostHog (via the web-vitals library, firing a `web_vitals` event with the metric and value), then check field LCP:

```sql
SELECT
  round(avg(toFloat(properties.value)), 0) AS avg_lcp_ms,
  countDistinct(person_id) AS sessions
FROM events
WHERE event = 'web_vitals'
  AND properties.metric = 'LCP'
  AND timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| avg_lcp_ms | sessions |
|-----------:|---------:|
| 1,840      | 2,210    |

An average LCP under 2.5 seconds is in the "good" band, which is what the island approach buys you. If you'd like a tool that finds the slowest, lowest-converting part of your page and ships the fix as a Pull Request, that's what [Velyr](/agent/register) does.
