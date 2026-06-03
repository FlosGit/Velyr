---
title: "How to Fix a Hydration-Delayed CTA in Next.js"
slug: "fix-hydration-delayed-cta-nextjs"
description: "A Next.js CTA that's a button with onClick is dead until hydration finishes. Make it a server-rendered link that works immediately, and isolate any JS to a small client island."
tldr: "If your primary CTA is a button with an onClick handler, it does nothing until React hydrates — which on a heavy page can be seconds. In the Next.js App Router, render the CTA as a plain server-rendered anchor so it's clickable in the first paint, and push any genuinely interactive behaviour into a small 'use client' island."
cluster: "framework-fixes"
tags: ["nextjs", "hydration", "cta", "app-router", "conversion-rate"]
publishedAt: "2026-06-04"
updatedAt: "2026-06-04"
author: "Velyr Team"
related:
  - "improve-conversion-nextjs-landing-page"
  - "improve-conversion-nextjs-pricing-page"
  - "lcp-affect-conversion-rate-evidence-shows"
faqs:
  - q: "Why doesn't my Next.js button work right after the page loads?"
    a: "A button with an onClick handler only does something once React has hydrated that component on the client. On a JavaScript-heavy page, hydration can take a second or more, during which early clicks are dropped. A plain anchor link works immediately because the browser handles it natively, no JS required."
  - q: "Is a hydration delay really costing conversions?"
    a: "It can. Visitors who click your CTA in the first moment and get no response often assume it's broken and leave. The fix is free — make the primary action a real link in the server-rendered HTML so it never depends on hydration."
  - q: "When do I actually need 'use client' for a CTA?"
    a: "Only when the click must run JavaScript before navigating — firing analytics that must complete, opening a modal, or mutating state. Even then, keep the element a real anchor or form so it degrades gracefully, and isolate the JS to the smallest possible client component."
---

If your primary CTA is a `<button onClick={...}>`, it's inert until React hydrates — and on a heavy page that can be seconds, during which early clicks vanish. **In the Next.js App Router, render the CTA as a plain server-rendered `<a>` so it works in the first paint, and push any genuinely interactive behaviour into a small `'use client'` island.** The fix costs nothing and removes a silent conversion leak.

## Why the button is dead on arrival

The App Router renders Server Components to HTML, ships it, then hydrates the interactive parts on the client. A `<button>` with an `onClick` has no behaviour in that initial HTML — the handler only attaches once hydration reaches it. A visitor who taps it during that window gets nothing. They don't know it's a hydration gap; they assume the site is broken.

A `<a href="/signup">`, by contrast, is handled by the browser itself. It works the instant the HTML paints, with or without JavaScript, hydrated or not.

## Make the CTA a real link in a server component

The page is a Server Component by default — keep the CTA here, as an anchor, with no client boundary:

```tsx
// app/page.tsx  (Server Component)
export default function Page() {
  return (
    <main>
      <h1>Ship a conversion fix every week</h1>
      <p>One high-impact fix, opened as a Pull Request.</p>
      {/* Works on first paint — no hydration required */}
      <a className="cta" href="/agent/register">Start free trial</a>
    </main>
  )
}
```

That's the whole fix for most pages. The most important action on the page is now click-resilient from the first frame.

## When you genuinely need JavaScript on click

Sometimes the click must run JS first — fire an analytics event that has to complete, or open a modal. Keep the element a real anchor and isolate only the JS into a tiny Client Component:

```tsx
// app/cta.tsx
'use client'
import { usePostHog } from 'posthog-js/react'

export function TrackedCta({ href, children }: { href: string; children: React.ReactNode }) {
  const posthog = usePostHog()
  return (
    <a
      href={href}
      onClick={() => posthog?.capture('cta_clicked', { location: 'hero' })}
    >
      {children}
    </a>
  )
}
```

Crucially this is still an `<a href>`. If hydration hasn't finished, the click still navigates — you only lose the analytics event for that one early click, not the conversion. The `onClick` is an enhancement, not a dependency. Import it into the server page as `<TrackedCta href="/agent/register">Start free trial</TrackedCta>`.

## Steps to apply it

1. Find your primary CTA. If it's a `<button>` that navigates, that's the bug.
2. Replace it with an `<a href>` in a Server Component — no `'use client'`.
3. If the click needs JS, wrap only the anchor in a small Client Component and keep the `href` so it degrades gracefully.
4. Reserve the rest of the page's interactivity (menus, toggles) in their own islands so they don't block the CTA.

## Confirm clicks aren't being lost

If you capture a `cta_clicked` event, this HogQL shows how many people click the CTA versus how many reach the page — a low ratio on a heavy page is a hydration-delay smell:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/') AS visitors,
  countDistinctIf(person_id, event = 'cta_clicked') AS clickers,
  round(
    countDistinctIf(person_id, event = 'cta_clicked')
    / countDistinctIf(person_id, event = '$pageview' AND properties.$pathname = '/') * 100,
  2) AS click_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 30 DAY
```

Illustrative sample output:

| visitors | clickers | click_rate_pct |
|---------:|---------:|---------------:|
| 5,400    | 360      | 6.67           |

After switching to a server-rendered anchor, watch this rate over the next two weeks. If it rises, you were losing early clicks to hydration.

## The takeaway

The fastest conversion fix on a Next.js page is often making the CTA a link instead of a button. It paints instantly, survives a slow bundle, and works even if JavaScript fails entirely. If you'd like leaks like this found and fixed as a Pull Request each week, that's what [Velyr](/agent/register) does.
