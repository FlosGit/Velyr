---
title: "How to Fix Cumulative Layout Shift in React"
slug: "fix-cumulative-layout-shift-react"
description: "Fix CLS in React: set width and height on images, reserve space for async content with a min-height, and use font-display swap. Get under web.dev's 0.1 good CLS threshold."
tldr: "Most React layout shift comes from three things: images without dimensions, content that loads after render with no reserved space, and font swaps. Set width and height on every image, give async sections a fixed min-height placeholder, and use font-display: swap with a matched fallback. That pushes most apps under web.dev's 0.1 good CLS."
cluster: "core-web-vitals"
tags: ["react", "cls", "core-web-vitals", "layout-shift", "performance"]
publishedAt: "2026-06-06"
updatedAt: "2026-06-06"
author: "Velyr Team"
related:
  - "cumulative-layout-shift-hurt-conversion"
  - "reduce-form-abandonment-react-multi-step-signup"
  - "fix-slow-lcp-nextjs-landing-page"
faqs:
  - q: "How do I fix layout shift in a React app?"
    a: "Reserve space for anything that loads or changes after the initial render: set explicit width and height on images, give lazily-loaded sections a fixed min-height placeholder, and avoid inserting content above existing content. The goal is that nothing visible moves once it has painted."
  - q: "Why does conditionally-rendered React content cause CLS?"
    a: "Because a component that renders null first and then real content after data loads pushes everything below it down when it appears. Render a placeholder of the same height while loading so the arrival of the real content doesn't move the layout."
  - q: "Does setting image width and height stop layout shift?"
    a: "Largely, yes. When the browser knows an image's dimensions up front, it reserves the correct space before the image loads, so surrounding content doesn't jump when it arrives. Always set both attributes, or use an aspect-ratio box."
---

Most React layout shift comes from three avoidable things. **Set `width` and `height` on every image, give async sections a fixed `min-height` placeholder so they don't push content down when they load, and use `font-display: swap` with a matched fallback.** That pushes most apps under web.dev's **0.1 good CLS** threshold.

## Fix 1: Always give images dimensions

An image with no dimensions occupies zero space until it loads, then suddenly shoves everything below it down. Set both attributes so the browser reserves the space up front:

```jsx
function Avatar({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      width={64}
      height={64}            /* browser reserves the box before load */
      style={{ aspectRatio: '1 / 1' }}
    />
  )
}
```

`width` and `height` (or an `aspect-ratio` box) let the browser hold the correct space before the image arrives, so nothing jumps.

## Fix 2: Reserve space for async content

The classic React CLS bug: a component returns `null` while loading, then renders real content that pushes the page down. Render a placeholder of the **same height** instead:

```jsx
import { useState, useEffect } from 'react'

function Stats() {
  const [data, setData] = useState<{ count: number } | null>(null)

  useEffect(() => {
    fetch('/api/stats').then((r) => r.json()).then(setData)
  }, [])

  // Reserve the height so the layout doesn't shift when data arrives
  return (
    <div style={{ minHeight: 72 }}>
      {data ? <p>{data.count} teams shipping weekly</p> : <div className="skeleton" />}
    </div>
  )
}
```

The `minHeight: 72` wrapper means the slot is the same size whether it's showing the skeleton or the loaded text — so the content below it never moves.

## Fix 3: Tame font swaps

When a web font replaces the fallback, text can reflow and shift the layout. Use `font-display: swap` so text is visible immediately, and pick a fallback with similar metrics so the swap barely moves anything:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
}
body { font-family: 'Inter', system-ui, sans-serif; }
```

## Steps to apply it

1. Audit every `<img>` for missing `width`/`height` and add them.
2. Find components that render `null` then content, and wrap them in a fixed-height placeholder.
3. Make sure no banner, cookie notice, or alert is inserted *above* existing content.
4. Set `font-display: swap` and a metrically-similar fallback.
5. Re-measure CLS in the field.

## Confirm the fix for real users

Capture CLS with the web-vitals library and check the good-band share:

```sql
SELECT
  countDistinct(person_id) AS sessions,
  countDistinctIf(person_id, toFloat(properties.value) <= 0.1) AS good_cls,
  round(
    countDistinctIf(person_id, toFloat(properties.value) <= 0.1)
    / countDistinct(person_id) * 100,
  1) AS good_cls_pct
FROM events
WHERE event = 'web_vitals'
  AND properties.metric = 'CLS'
  AND timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| sessions | good_cls | good_cls_pct |
|---------:|---------:|-------------:|
| 2,800    | 2,520    | 90.0         |

Drive the good-CLS share up after the change. If you'd like your worst layout-shift offender found and the fix shipped as a Pull Request, that's what [Velyr](/agent/register) does.
