---
title: "How to Improve Conversion on a Next.js Pricing Page"
slug: "improve-conversion-nextjs-pricing-page"
description: "Improve Next.js pricing page conversion: make the plan toggle a client island, render plans in a server component for fast LCP, and default to annual — with App Router code."
tldr: "The highest-leverage Next.js pricing fixes are structural: render the plan cards in a server component so they paint fast, isolate only the monthly/annual toggle as a small 'use client' island, default the toggle to annual, and make the primary plan's CTA unmissable. Each is a few lines of App Router code."
cluster: "framework-fixes"
tags: ["nextjs", "pricing-page", "conversion-rate", "app-router", "cta"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "improve-conversion-nextjs-landing-page"
  - "good-conversion-rate-saas-landing-page"
  - "track-cta-clicks-posthog"
  - "pricing-page-layouts-that-convert-developer-tools"
faqs:
  - q: "Should a Next.js pricing page be a server or client component?"
    a: "Render the plan cards and copy in a server component so they're in the initial HTML and paint fast. Only the interactive part — the monthly/annual toggle — needs to be a Client Component marked 'use client'. Making the whole page a client component delays the most important content and hurts LCP."
  - q: "Should a pricing toggle default to monthly or annual?"
    a: "Default to annual if annual is the plan you want people to choose — the default is the anchor most visitors accept. Show the effective monthly price under an annual plan so the number still looks small, and make the saving explicit."
  - q: "How do I stop my pricing toggle from causing layout shift?"
    a: "Reserve the space for the price with a fixed-height container and avoid swapping element sizes when the toggle flips. If the monthly and annual prices have different widths, set a min-width so the card doesn't reflow, which protects your CLS score."
---

The biggest wins on a Next.js pricing page are structural, not cosmetic. **Render the plan cards in a server component so they're in the first HTML paint, isolate only the monthly/annual toggle as a small `'use client'` island, default the toggle to annual, and make the recommended plan's CTA unmissable.** Button colours barely move the number; where the interactivity boundary sits does.

## Why the whole page shouldn't be a Client Component

The instinct is to slap `'use client'` at the top of the page because the toggle needs state. That's the mistake: it pushes your entire pricing table — the content people came to read — behind client-side rendering, delaying Largest Contentful Paint. In the App Router, the page is a Server Component by default, and you want to keep it that way. The plans are static content; only the toggle is interactive.

So the structure is: a server component renders everything, and a tiny client island owns just the toggle and the prices that change with it.

## Render the plans in a server component

This is the page itself — no `'use client'`, so the plan cards ship in the initial HTML:

```tsx
// app/pricing/page.tsx  (Server Component — no 'use client')
import { PricingToggle } from './pricing-toggle'

const PLANS = [
  { name: 'Hobby', monthly: 0, annual: 0, cta: 'Start free' },
  { name: 'Growth', monthly: 29, annual: 24, cta: 'Start free trial', featured: true },
  { name: 'Scale', monthly: 99, annual: 82, cta: 'Start free trial' },
]

export default function PricingPage() {
  return (
    <main>
      <h1>Pricing</h1>
      {/* Only the interactive toggle + prices are a client island */}
      <PricingToggle plans={PLANS} />
    </main>
  )
}
```

The plan names, features, and CTAs are server-rendered. The data crosses the server/client boundary as a plain prop, which is allowed because it's serialisable.

## Isolate the toggle as a `'use client'` island

This is the genuinely App-Router-specific part: a small Client Component that owns the state, imported into a Server Component. It re-renders on toggle without dragging the rest of the page into the client bundle.

```tsx
// app/pricing/pricing-toggle.tsx
'use client'
import { useState } from 'react'

export function PricingToggle({ plans }) {
  // Default to annual — the default is the anchor most visitors accept.
  const [annual, setAnnual] = useState(true)

  return (
    <>
      <button onClick={() => setAnnual((a) => !a)} aria-pressed={annual}>
        {annual ? 'Billed annually (save ~17%)' : 'Billed monthly'}
      </button>

      <div className="plans">
        {plans.map((p) => (
          <section key={p.name} className={p.featured ? 'plan featured' : 'plan'}>
            <h2>{p.name}</h2>
            {/* Fixed-height price container avoids layout shift on toggle */}
            <p className="price" style={{ minHeight: 48 }}>
              €{annual ? p.annual : p.monthly}
              <span>/mo</span>
            </p>
            <a className={p.featured ? 'cta cta-primary' : 'cta'} href="/agent/register">
              {p.cta}
            </a>
          </section>
        ))}
      </div>
    </>
  )
}
```

Three conversion decisions are baked in here:

1. **Annual is the default** (`useState(true)`). Most visitors accept the default, so if annual is the plan you want chosen, anchor on it — and show the effective per-month price so the number still reads small.
2. **The featured plan is visually distinct** (`featured` class) with a primary CTA, so the eye lands on the plan you want people to pick.
3. **The price container has a fixed `minHeight`** so flipping the toggle doesn't reflow the card — protecting your Cumulative Layout Shift score.

## Steps to apply it

1. Move your pricing data into the server `page.tsx` and render the static cards there.
2. Extract only the toggle and the price display into a `'use client'` component, passing the plans as a prop.
3. Default the toggle state to annual and show the effective monthly price.
4. Give the recommended plan a distinct style and a single primary CTA.
5. Reserve vertical space for the price so the toggle never shifts layout.

## Verify the toggle is actually used

Before assuming the annual default helped, check whether people interact with the toggle at all and which plan CTA they click. If you capture a `plan_cta_clicked` event with the plan name, this HogQL ranks which plan converts:

```sql
SELECT
  properties.plan AS plan,
  countDistinct(person_id) AS clickers
FROM events
WHERE event = 'plan_cta_clicked'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY plan
ORDER BY clickers DESC
```

Illustrative sample output:

| plan   | clickers |
|--------|---------:|
| Growth | 412      |
| Scale  | 96       |
| Hobby  | 88       |

If almost everyone clicks the featured plan, your anchoring is working. If the free plan dominates, the featured plan's value isn't landing above the fold — and that's a copy problem, not a layout one.

## What not to spend time on

Gradient buttons, animated price counters, and three-column-versus-two-column debates rarely move conversion measurably. Spend the effort on the server/client boundary (for speed), the default that anchors choice, and a single obvious primary CTA. If you'd like that kind of structural fix found and shipped as a Pull Request each week, that's what [Velyr](/agent/register) does.
