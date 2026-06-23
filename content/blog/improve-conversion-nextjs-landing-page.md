---
title: "How to Improve Conversion Rate on a Next.js Landing Page"
slug: "improve-conversion-nextjs-landing-page"
description: "Three high-leverage Next.js conversion fixes: get the primary CTA above the fold, make the hero image LCP-fast with next/image priority, and add a sticky CTA — with runnable App Router code."
tldr: "The biggest conversion wins on a Next.js landing page are usually structural, not cosmetic: put the primary CTA above the fold, make the hero the LCP element and load it with next/image priority so it paints fast, and add a sticky CTA that follows the scroll. All three are a few lines of App Router code."
cluster: "framework-fixes"
tags: ["nextjs", "conversion-rate", "app-router", "core-web-vitals", "cta"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "fix-low-converting-react-hero-section"
  - "measure-scroll-depth-posthog"
  - "good-conversion-rate-saas-landing-page"
  - "improve-conversion-vue-3-landing-page"
  - "improve-conversion-astro-landing-page-islands"
  - "improve-conversion-nextjs-pricing-page"
faqs:
  - q: "Does page speed affect conversion on Next.js?"
    a: "Yes. A slow Largest Contentful Paint (LCP) delays when visitors can read your value proposition and CTA, and bounce rises with load time. On Next.js the hero image is often the LCP element, so loading it with next/image priority is one of the highest-leverage speed-and-conversion fixes."
  - q: "Where should the primary CTA go on a Next.js landing page?"
    a: "Above the fold — visible without scrolling on both desktop and mobile — and repeated once more deeper down. Many landing pages bury the only CTA below a tall hero, so the majority of visitors never see it."
  - q: "Should I use the App Router or Pages Router for a landing page?"
    a: "Either converts equally well; conversion depends on layout and speed, not the router. The code in this guide is App Router (app/page.tsx), but the same structure works in pages/index.tsx."
---

If you want to raise conversions on a Next.js landing page, **start with three structural fixes**: get the primary CTA above the fold, make the hero image the LCP element and load it with `next/image` `priority`, and add a sticky CTA. These move the number far more than button colors, and each is a few lines of App Router code.

## Fix 1: Put the primary CTA above the fold

The most common landing-page leak is a single CTA buried below a tall hero. If your analytics show the median visitor scrolls only ~40%, anything lower is invisible to most of your traffic.

In an App Router page, structure the hero so the CTA sits in the first viewport:

```tsx
// app/page.tsx
export default function Page() {
  return (
    <main>
      <section className="hero">
        <h1>Ship conversion fixes weekly</h1>
        <p>One high-impact fix as a Pull Request, every week.</p>
        {/* CTA in the FIRST viewport, not after three feature rows */}
        <a className="cta" href="/signup">Start free trial</a>
      </section>
      {/* features, social proof, etc. follow below */}
    </main>
  )
}
```

Keep the hero short enough that the CTA is visible at common mobile heights (≈640px tall viewport). If your headline + subhead + CTA don't fit, trim copy rather than pushing the button down.

## Fix 2: Make the hero LCP-fast with `next/image priority`

On most landing pages the hero image is the **Largest Contentful Paint** element. If it lazy-loads, LCP is slow, and a slow LCP delays the moment a visitor can act. `next/image` lazy-loads by default — which is wrong for the hero. Mark it `priority` so Next.js preloads it:

```tsx
import Image from 'next/image'

<Image
  src="/hero.webp"
  alt="Product dashboard"
  width={1200}
  height={750}
  priority          // preload — opt out of lazy-loading for the LCP image
  sizes="(max-width: 768px) 100vw, 1200px"
/>
```

Only the hero (and other above-the-fold imagery) should get `priority`; everything below the fold should keep the default lazy behavior so you don't fight for bandwidth.

## Fix 3: Add a sticky CTA that follows the scroll

A sticky CTA recovers visitors who read the whole page but scrolled past the hero button. It needs `'use client'` because it tracks scroll:

```tsx
'use client'
import { useEffect, useState } from 'react'

export function StickyCta() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  if (!show) return null
  return (
    <a className="sticky-cta" href="/signup">Start free trial</a>
  )
}
```

Render `<StickyCta />` from your server `page.tsx`. It stays out of the way until the user scrolls past the hero, then keeps the action one tap away.

## Verify the fix actually moved behavior

Don't guess — confirm the CTA is now being seen. If you use PostHog, this HogQL compares average max scroll depth on `/` before and after the change:

```sql
SELECT
  toStartOfWeek(timestamp) AS week,
  round(avg(properties.$prev_pageview_max_scroll_percentage) * 100, 1) AS avg_scroll_pct,
  count() AS sessions
FROM events
WHERE event = '$pageleave' AND properties.$pathname = '/'
  AND timestamp > now() - INTERVAL 8 WEEK
GROUP BY week ORDER BY week
```

A healthy outcome isn't necessarily *more* scrolling — it's more conversions because the CTA now sits where people already look. Pair this with your signup-rate query to confirm the lift.

These three changes are structural and framework-true. Ship them one at a time so each result is attributable, and measure against your own baseline.
