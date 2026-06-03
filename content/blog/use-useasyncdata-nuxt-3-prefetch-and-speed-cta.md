---
title: "How to Use useAsyncData in Nuxt 3 to Render the CTA Before Data"
slug: "use-useasyncdata-nuxt-3-prefetch-and-speed-cta"
description: "Stop slow data blocking your Nuxt 3 CTA: use useAsyncData with lazy and server:false so the page and CTA render immediately while non-critical data streams in afterwards."
tldr: "If a Nuxt 3 page awaits slow data before rendering, the CTA waits too. Mark non-critical fetches lazy with useLazyAsyncData (or useAsyncData with { lazy: true }) so the page renders immediately and the data fills in afterwards. The CTA paints on first load instead of being held hostage by an API call."
cluster: "framework-fixes"
tags: ["nuxt", "useasyncdata", "conversion-rate", "core-web-vitals", "cta"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "improve-conversion-vue-3-landing-page"
  - "fix-slow-lcp-nextjs-landing-page"
  - "good-conversion-rate-saas-landing-page"
faqs:
  - q: "What does the lazy option in useAsyncData do?"
    a: "By default useAsyncData blocks navigation until the fetch resolves, so the page waits for the data. With { lazy: true } (or useLazyAsyncData), the page renders immediately and the data loads in the background, with the pending state exposed so you can show a placeholder. Use it for data that isn't needed for first paint."
  - q: "How do I keep slow data from delaying my Nuxt CTA?"
    a: "Don't await it for the part of the page that includes the CTA. Mark the non-critical fetch lazy so the hero and CTA render right away, and render the data section separately once it arrives. The CTA never depends on the slow call."
  - q: "What's the difference between useAsyncData and useFetch in Nuxt 3?"
    a: "useFetch is a convenience wrapper around useAsyncData for simple HTTP requests. Both support the lazy option. Use useFetch for a straightforward endpoint and useAsyncData when you need custom logic in the handler, such as combining multiple sources."
---

If a Nuxt 3 page awaits slow data before it renders, your CTA is stuck waiting on an API call. **Mark non-critical fetches lazy with `useLazyAsyncData` (or `useAsyncData` with `{ lazy: true }`) so the page and CTA render immediately, and let the data fill in afterwards.** The most important action on the page stops being held hostage by a slow endpoint.

## Why the default blocks your CTA

`useAsyncData` and `useFetch` are blocking by default: Nuxt waits for the fetch to resolve before completing the navigation, so the whole page — hero, CTA, everything — appears only once the data is back. That's correct for data the page can't render without, but most landing-page data (a live customer count, recent testimonials, a stats widget) is *not* required for the CTA to work. Blocking on it delays the paint that matters.

The Nuxt-specific lever is the `lazy` option, which decouples rendering from the fetch.

## Render the CTA immediately, stream the data

```vue
<!-- pages/index.vue -->
<script setup>
// Non-critical: don't block first paint on it
const { data: stats, pending } = useLazyAsyncData('stats', () =>
  $fetch('/api/stats'),
)
</script>

<template>
  <main>
    <!-- Renders immediately — not waiting on /api/stats -->
    <h1>Ship a conversion fix every week</h1>
    <a class="cta" href="/agent/register">Start free trial</a>

    <!-- Fills in once the lazy data resolves; reserve the space -->
    <section style="min-height: 120px">
      <div v-if="pending" class="skeleton" />
      <p v-else>{{ stats?.customers }} teams shipping fixes weekly</p>
    </section>
  </main>
</template>
```

Two things make this work:

1. **`useLazyAsyncData`** lets the page render without waiting for `/api/stats`. The hero and CTA paint on first load.
2. **The `pending` flag plus a reserved `min-height`** show a skeleton while the data loads, so the section doesn't shift the layout when the real content arrives.

If the stats endpoint is slow or even fails, the CTA is unaffected — it was never coupled to it.

## When to keep a fetch blocking

Lazy isn't always right. If the data *is* the page — a product page that can't render without the product — keep it blocking so you don't flash an empty shell. The rule: block only on data the primary content genuinely needs; make everything else lazy.

## Steps to apply it

1. List the page's fetches and mark each as "needed for the CTA?" or not.
2. Convert the not-needed ones to `useLazyAsyncData` (or `useAsyncData(..., { lazy: true })`).
3. Render the hero and CTA outside any block on those fetches.
4. Use the `pending` flag with a reserved `min-height` to avoid layout shift.
5. Keep genuinely essential data blocking so you don't render an empty page.

## Confirm the page is faster for users

Capture LCP to PostHog with a `web_vitals` event and check the field number:

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
| 2,050      | 1,640    |

After making the stats fetch lazy, the hero should paint sooner and this number should fall. If you'd like a tool that finds what's slowing your highest-impact page and ships the fix as a Pull Request, that's what [Velyr](/agent/register) does.
