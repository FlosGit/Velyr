---
title: "How to Fix a Slow LCP on a Next.js Landing Page"
slug: "fix-slow-lcp-nextjs-landing-page"
description: "Fix slow LCP in Next.js: load the hero with next/image priority, preload the font with next/font, and keep the hero in a server component. Get under web.dev's 2.5s good threshold."
tldr: "On a Next.js landing page the LCP element is usually the hero image. Load it with next/image and the priority prop so it's preloaded instead of lazy-loaded, self-host the font with next/font to remove a render-blocking request, and keep the hero in a server component so it isn't gated behind hydration. That gets most sites under web.dev's 2.5s good LCP."
cluster: "core-web-vitals"
tags: ["nextjs", "lcp", "core-web-vitals", "next-image", "performance"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "lcp-affect-conversion-rate-evidence-shows"
  - "optimise-astro-image-component-fast-hero-lcp"
  - "improve-conversion-nextjs-landing-page"
  - "fix-cumulative-layout-shift-react"
  - "fix-hydration-delayed-cta-nextjs"
  - "use-useasyncdata-nuxt-3-prefetch-and-speed-cta"
faqs:
  - q: "Why is my Next.js LCP slow?"
    a: "Most often because the hero image — usually the LCP element — is lazy-loaded by default, so the browser fetches it late. Render-blocking fonts and client-side rendering of the hero also delay it. Loading the hero with next/image priority is the single highest-impact fix."
  - q: "What does the priority prop on next/image do?"
    a: "It opts the image out of lazy-loading and adds a preload hint, so the browser fetches it early. Use it only on the LCP image — typically the hero — and leave below-the-fold images on the default lazy behaviour so they don't compete for bandwidth."
  - q: "Does next/font improve LCP?"
    a: "It helps. next/font self-hosts the font files and removes the render-blocking request to an external font host, and it can preload the font, so text paints sooner. That reduces the delay before your headline — often part of the LCP element — appears."
---

On a Next.js landing page the LCP element is almost always the hero image. **Load it with `next/image` and the `priority` prop so it's preloaded instead of lazy-loaded, self-host the font with `next/font` to kill a render-blocking request, and keep the hero in a server component so it isn't gated behind hydration.** That gets most sites under web.dev's 2.5-second "good" LCP.

## Fix 1: Give the hero image `priority`

`next/image` lazy-loads by default — correct for most images, wrong for the one that *is* your LCP. The `priority` prop opts it out of lazy-loading and adds a preload hint:

```tsx
import Image from 'next/image'

export function Hero() {
  return (
    <section>
      <h1>Ship a conversion fix every week</h1>
      <Image
        src="/hero.webp"
        alt="Velyr dashboard"
        width={1200}
        height={750}
        priority                 // preload the LCP image, don't lazy-load it
        sizes="(max-width: 768px) 100vw, 1200px"
      />
    </section>
  )
}
```

Apply `priority` to the hero **only**. Every below-the-fold image should stay on the default lazy behaviour so it doesn't steal bandwidth from the hero.

## Fix 2: Self-host the font with `next/font`

A font requested from an external host is render-blocking and delays your headline — often part of the LCP element. `next/font` self-hosts the file and preloads it:

```tsx
// app/layout.tsx
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>{children}</body>
    </html>
  )
}
```

This removes the external request entirely and applies the font with no extra network round-trip, so text paints sooner.

## Fix 3: Keep the hero in a server component

If the hero is inside a `'use client'` boundary, it can't paint until hydration. Keep it as a Server Component (the App Router default) so it ships in the initial HTML and the LCP element renders without waiting on JavaScript. Only genuinely interactive bits below it need a client boundary.

## Steps to apply it

1. Find your LCP element (Chrome DevTools → Performance, or the web-vitals attribution).
2. If it's the hero image, render it with `next/image` and add `priority`.
3. Move fonts to `next/font` so they're self-hosted and preloaded.
4. Ensure the hero is a Server Component, not inside a client boundary.
5. Re-measure in the field, not just the lab.

## Confirm it worked for real users

Capture LCP with the web-vitals library and check the share of sessions in the good band:

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
| 3,100    | 2,650    | 85.5         |

Push the good-LCP share up after the change. If you'd like the slowest, lowest-converting part of your page found and fixed as a Pull Request each week, that's what [Velyr](/agent/register) does.
