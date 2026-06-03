---
title: "How to Track Outbound Link Clicks in PostHog"
slug: "track-outbound-link-clicks-posthog"
description: "Track outbound link clicks in PostHog with a custom event that records the destination, then rank where your traffic leaves to in HogQL. A reliable, no-guesswork approach."
tldr: "Add a click handler to outbound links that fires a custom outbound_click event with the destination URL as a property. That's more reliable than guessing from autocapture, and a single HogQL query then ranks exactly where your visitors leave to — so you know which external links are pulling traffic off your site."
cluster: "posthog-recipes"
tags: ["posthog", "outbound-links", "custom-event", "hogql", "click-tracking"]
publishedAt: "2026-06-05"
updatedAt: "2026-06-05"
author: "Velyr Team"
related:
  - "track-button-click-as-custom-event-posthog"
  - "track-cta-clicks-posthog"
  - "find-most-viewed-pages-posthog-hogql"
faqs:
  - q: "How do I track clicks on external links in PostHog?"
    a: "Attach a click handler to your outbound anchors that fires a custom event — outbound_click — with the destination URL as a property. Capturing it explicitly is more reliable than trying to infer it from autocapture, and it gives you a clean property to group by."
  - q: "Why track outbound clicks at all?"
    a: "Outbound clicks show where your visitors leave to — a documentation site, a partner, a social profile, or a competitor. If a large share leaves via one link, that's either a useful path you want to keep or a leak pulling people out of your funnel."
  - q: "Will the outbound event fire before the browser navigates away?"
    a: "Usually yes — posthog-js uses sendBeacon or a keepalive request that survives navigation. For links that open in the same tab, you can also add target or a tiny delay if you ever see drops, but for most outbound links it's reliable as-is."
---

To track outbound link clicks in PostHog, **add a click handler to your external links that fires a custom `outbound_click` event with the destination URL as a property.** Capturing it explicitly beats trying to infer it from autocapture, and one HogQL query then ranks exactly where your visitors leave to.

## Fire a custom event with the destination

The reliable approach is a small handler that records the href. Attach it to outbound anchors:

```js
document.querySelectorAll('a[href^="http"]').forEach((link) => {
  // skip links to your own domain
  if (link.hostname === location.hostname) return
  link.addEventListener('click', () => {
    posthog.capture('outbound_click', { destination: link.href })
  })
})
```

This fires `outbound_click` with a clean `destination` property you can group by. posthog-js sends the event with `sendBeacon` or a keepalive request, so it survives the navigation away from your page.

Capturing a deliberate event is better than depending on autocapture here: autocapture records the click, but the destination URL isn't a property you can rely on grouping by across versions. An explicit `destination` property is unambiguous and stable.

## Rank where your traffic leaves to

With the event flowing, this HogQL ranks your outbound destinations over 30 days:

```sql
SELECT
  properties.destination AS destination,
  count() AS clicks,
  countDistinct(person_id) AS people
FROM events
WHERE event = 'outbound_click'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY destination
ORDER BY clicks DESC
LIMIT 15
```

Illustrative sample output:

| destination                       | clicks | people |
|-----------------------------------|-------:|-------:|
| https://github.com/yourorg        | 540    | 480    |
| https://docs.yoursite.com         | 410    | 360    |
| https://twitter.com/yourhandle    | 190    | 170    |

Now you can see where people go when they leave — and whether that's intentional (your docs, your repo) or a leak (a link pulling people off a conversion page).

## What the data tells you

- **Expected destinations** (docs, GitHub, your own subdomains) confirm a healthy path — people engaging more deeply.
- **A surprising top destination** is worth investigating. A competitor or an unrelated site high on the list, especially from a conversion page, is traffic you're leaking at the wrong moment.
- **Outbound clicks from the pricing or signup page** deserve scrutiny — anything pulling attention away there is competing with your conversion.

## Use it to plug leaks

If a link near your CTA sends a meaningful share of visitors off-site before they convert, consider moving it lower, opening it in a new tab, or removing it. Every outbound click from a conversion-critical page is attention you didn't keep. If you'd like those leaks found and the fix shipped as a Pull Request each week, that's what [Velyr](/agent/register) does.
