---
title: "How to Optimise the Astro Image Component for a Fast Hero LCP"
slug: "optimise-astro-image-component-fast-hero-lcp"
description: "Make your Astro hero LCP fast: use the astro:assets Image component with loading=eager and fetchpriority=high, and a correct width/height so the hero paints quickly without layout shift."
tldr: "Astro's <Image> component from astro:assets optimises and sizes images at build time, but the hero needs two extra props: loading='eager' (don't lazy-load the LCP image) and fetchpriority='high' (preload it). Combined with explicit width and height, the hero paints fast and never shifts layout — directly improving LCP and CLS."
cluster: "framework-fixes"
tags: ["astro", "lcp", "core-web-vitals", "images", "conversion-rate"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "improve-conversion-astro-landing-page-islands"
  - "fix-slow-lcp-nextjs-landing-page"
  - "lcp-affect-conversion-rate-evidence-shows"
faqs:
  - q: "Does the Astro Image component lazy-load by default?"
    a: "Yes — like the browser default, Astro's <Image> uses loading='lazy' unless you override it. That's correct for below-the-fold images but wrong for the hero, which is usually your Largest Contentful Paint element. Set loading='eager' on the hero so it isn't deferred."
  - q: "What is fetchpriority='high' and when should I use it?"
    a: "fetchpriority='high' tells the browser to prioritise downloading that resource. Set it on your hero image so it's fetched ahead of less important assets, which lowers LCP. Use it only for the single most important above-the-fold image, not everywhere."
  - q: "Why does the Astro Image component need width and height?"
    a: "Explicit dimensions let the browser reserve the right amount of space before the image loads, preventing the content from jumping when it arrives. That protects your Cumulative Layout Shift score. Astro's <Image> requires them for local images precisely for this reason."
---

Astro's `<Image>` component from `astro:assets` optimises format and size at build time, but a hero image needs two props it doesn't set by default. **Add `loading="eager"` so the LCP image isn't lazy-loaded, and `fetchpriority="high"` so the browser preloads it — together with explicit `width` and `height` to stop layout shift.** That's the difference between a hero that paints fast and one that drags your Largest Contentful Paint.

## Why the default is wrong for the hero

`<Image>` is great: it generates modern formats, resizes, and adds dimensions. But it defaults to `loading="lazy"`, which is the right call for most images and the *wrong* call for the one image that is almost always your LCP element — the hero. Lazy-loading the hero means the browser delays the very paint that LCP measures.

The fix is framework-specific: Astro's component takes these as props and applies them at build time.

## The optimised hero image

```astro
---
// src/pages/index.astro
import { Image } from 'astro:assets'
import hero from '../assets/hero.png'
---
<main>
  <h1>Ship a conversion fix every week</h1>
  <Image
    src={hero}
    alt="Velyr dashboard"
    width={1200}
    height={750}
    loading="eager"          {/* don't lazy-load the LCP image */}
    fetchpriority="high"     {/* preload it ahead of other assets */}
  />
  <a class="cta" href="/agent/register">Start free trial</a>
</main>
```

Each prop does specific work:

1. **`loading="eager"`** opts the hero out of lazy-loading so the browser fetches it during the initial load, not after.
2. **`fetchpriority="high"`** pushes it up the network priority queue, ahead of fonts and below-the-fold images.
3. **`width` and `height`** (required for local images) let the browser reserve the space, so the text above and below doesn't jump when the image arrives — protecting CLS.

Because `src` points at a local asset import, Astro processes the file at build time: it emits an optimised, correctly-sized image and infers the intrinsic dimensions.

## Steps to apply it

1. Import your hero as a local asset and pass it to `<Image src={hero} />`.
2. Add `loading="eager"` and `fetchpriority="high"` — to the hero only.
3. Set `width` and `height` to the displayed size and keep the aspect ratio.
4. Leave every below-the-fold image on the default `loading="lazy"` so you don't compete for bandwidth.
5. Provide a real `alt` so the image is accessible and the markup is valid.

## Confirm the LCP improvement in the field

Lab tools like Lighthouse are a start, but real users matter. If you capture Core Web Vitals to PostHog with a `web_vitals` event, this HogQL shows the share of sessions in the "good" LCP band (under 2.5 seconds):

```sql
SELECT
  countDistinct(person_id) AS sessions,
  countDistinctIf(person_id, toFloat(properties.value) <= 2500) AS good_lcp,
  round(
    countDistinctIf(person_id, toFloat(properties.value) <= 2500)
    / countDistinct(person_id) * 100,
  1) AS good_lcp_pct
FROM events
WHERE event = 'web_vitals'
  AND properties.metric = 'LCP'
  AND timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| sessions | good_lcp | good_lcp_pct |
|---------:|---------:|-------------:|
| 2,400    | 1,980    | 82.5         |

Aim to push the good-LCP share up after the change. If you'd like the slowest, lowest-converting part of your page found and fixed as a Pull Request each week, that's what [Velyr](/agent/register) does.
