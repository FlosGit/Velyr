---
title: "Why Your React Hero Section Isn't Converting (and How to Fix It)"
slug: "fix-low-converting-react-hero-section"
description: "A low-converting React hero usually fails on three things: an unclear headline, a CTA below the fold, and no proof the CTA is even seen. Here's a runnable hero component with an IntersectionObserver that measures CTA visibility."
tldr: "A React hero section usually under-converts for one of three reasons: the headline describes the product instead of the outcome, the CTA sits below the fold, or you have no idea whether visitors even see the CTA. Fix the copy and layout, then instrument the button with an IntersectionObserver so you can prove it's visible."
cluster: "framework-fixes"
tags: ["react", "hero-section", "conversion-rate", "intersection-observer", "cta"]
publishedAt: "2026-06-02"
updatedAt: "2026-06-02"
author: "Velyr Team"
related:
  - "improve-conversion-nextjs-landing-page"
  - "measure-scroll-depth-posthog"
  - "track-cta-clicks-posthog"
faqs:
  - q: "What makes a hero section convert?"
    a: "A headline stating the outcome the visitor gets (not a description of the product), a one-line subhead that adds specifics, and a single primary CTA visible without scrolling. Clarity and visibility beat clever design almost every time."
  - q: "How do I know if visitors see my CTA?"
    a: "Instrument it. An IntersectionObserver fires when the button enters the viewport, so you can send an event and measure what share of visitors actually saw the CTA versus how many clicked it. A large gap between 'rendered' and 'seen' means it's too low on the page."
  - q: "Should the hero have one CTA or several?"
    a: "One primary CTA. A secondary, lower-commitment link (like 'See how it works') is fine, but competing equal-weight buttons split attention and usually lower the primary action's click-through."
---

If your React hero section isn't converting, the cause is almost always one of three things: **the headline sells the product instead of the outcome, the CTA is below the fold, or you can't prove the CTA is even being seen.** Fix the first two with copy and layout; fix the third by instrumenting the button.

## 1. The headline states the outcome, not the product

"An AI growth agent for React apps" describes you. "Ship a conversion fix every week — as a Pull Request" describes what the visitor gets. Lead with the outcome; put the category description in the subhead. This single change often moves hero conversion more than any visual tweak.

## 2. The CTA is above the fold — with one primary action

Competing buttons split attention. Use one primary CTA and, at most, one low-weight secondary link:

```jsx
function Hero() {
  return (
    <section className="hero">
      <h1>Ship a conversion fix every week</h1>
      <p>Velyr finds your #1 conversion problem and opens the fix as a Pull Request.</p>
      <div className="hero-actions">
        <a className="btn-primary" href="/signup">Start free trial</a>
        <a className="btn-link" href="#how">See how it works</a>
      </div>
    </section>
  )
}
```

Keep the hero short enough that `.hero-actions` is visible on a ~640px mobile viewport without scrolling.

## 3. Prove the CTA is seen (the unique part)

Most teams measure CTA *clicks* but never measure whether the button was even *visible*. A large gap between "rendered" and "seen" is the signal that your CTA is too low. An `IntersectionObserver` answers this precisely:

```jsx
import { useEffect, useRef } from 'react'

function PrimaryCta({ onSeen }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onSeen()            // e.g. posthog.capture('cta_seen', { id: 'hero' })
          obs.disconnect()    // fire once per page view
        }
      },
      { threshold: 0.5 }      // at least half the button visible
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [onSeen])

  return (
    <a ref={ref} className="btn-primary" href="/signup">Start free trial</a>
  )
}
```

Now you can compute a **"seen → clicked"** rate. If 90% of visitors see the CTA and 4% click, the button is working and the lever is upstream (the offer or headline). If only 35% ever see it, the button is below the fold — move it up. Pair `cta_seen` with a `cta_clicked` event to track both ends of that funnel.

## What not to bother with

Button color, gradient backgrounds, and hero animations rarely move the number in a measurable way. Spend the effort on a clear outcome headline, a visible single CTA, and the instrumentation that tells you which half of the funnel to fix next.
