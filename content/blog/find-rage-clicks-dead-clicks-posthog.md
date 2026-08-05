---
title: "How to Find Rage Clicks and Dead Clicks in PostHog"
slug: "find-rage-clicks-dead-clicks-posthog"
description: "PostHog captures $rageclick automatically and $dead_click once you enable it. Runnable HogQL to rank both by page and by device, plus how to tell a real conversion blocker from a carousel false positive."
tldr: "PostHog fires $rageclick when a visitor makes three clicks each within 30 pixels and one second of the previous one, and it rides along with autocapture, so you probably already have the data. Dead clicks are clicks that change nothing on the page, and they stay off until you set capture_dead_clicks. Rank both per page and per session with HogQL and you get a frustration signal that funnels and scroll depth cannot produce."
cluster: "posthog-recipes"
tags: ["posthog", "rage-clicks", "dead-clicks", "hogql", "autocapture", "frustration-signals"]
publishedAt: "2026-08-04"
updatedAt: "2026-08-04"
author: "Velyr Team"
related:
  - "measure-scroll-depth-posthog"
  - "track-cta-clicks-posthog"
  - "find-most-viewed-pages-posthog-hogql"
  - "mobile-vs-desktop-conversion-rate-gap"
  - "reduce-form-abandonment-react-multi-step-signup"
  - "what-is-a-micro-conversion"
faqs:
  - q: "What triggers a $rageclick event in PostHog?"
    a: "PostHog fires $rageclick after three clicks that are each within 30 pixels and one second of the previous one. The threshold is deliberately tight, so the event records someone hammering the same spot rather than ordinary repeated clicking."
  - q: "Do I need to enable rage click tracking?"
    a: "No. Rage click capture comes with autocapture, so if autocapture is enabled you already have $rageclick events going back through your retention window. Dead clicks are the opposite: they are off by default."
  - q: "How do I enable dead click tracking in PostHog?"
    a: "Turn on dead clicks autocapture in your PostHog project settings, or pass capture_dead_clicks: true to posthog.init(). Until then you will have zero $dead_click events, which is a settings result and not a verdict on your page."
  - q: "Are rage clicks always a bug?"
    a: "No. Carousels, sliders, drag handles and text that visitors select to copy all generate false positives. Rank by sessions rather than raw clicks and look at what the element actually is before treating it as a defect."
---

Two PostHog events record the moment a visitor tried to do something on your page and nothing happened: `$rageclick` and `$dead_click`. Neither appears in a funnel report and neither shows up in scroll depth, which is why most teams never look at them. They are also the only conversion signal that tends to name its own fix.

## What counts as a rage click

PostHog fires `$rageclick` after three clicks that are each within 30 pixels and one second of the previous one. That threshold is worth holding in your head while you read the numbers, because it does not capture mild irritation. It captures someone hammering the same spot.

Rage click capture rides along with autocapture. If autocapture is on, you already have these events for as far back as your retention window goes, without shipping any code. Recent posthog-js versions also ignore some common false positives, text selection being the frequent one, when you set `defaults` to a recent date. To exclude a specific element, give it the `.ph-no-rageclick` class.

## Dead clicks need switching on first

A dead click is a click that is not followed by a change to the page. Someone clicks something that looks like a button and the page just sits there. PostHog does not capture these by default. Enable dead clicks autocapture in project settings, or in your init call:

```js
posthog.init('<ph_project_token>', {
  api_host: '<ph_client_api_host>',
  capture_dead_clicks: true,
})
```

The events arrive as `$dead_click`. Because capture is off until you ask for it, an empty result almost always means the setting rather than a healthy page. Confirm you have any `$dead_click` events at all before you read anything into a zero.

## Rank rage clicks by page

Start with where the frustration is concentrated. This returns rage clicks per page over 30 days, alongside the number of distinct sessions that produced them:

```sql
SELECT
  properties.$pathname AS path,
  count() AS rage_clicks,
  countDistinct(properties.$session_id) AS sessions
FROM events
WHERE event = '$rageclick'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY path
ORDER BY rage_clicks DESC
LIMIT 20
```

Illustrative sample output:

| path      | rage_clicks | sessions |
|-----------|------------:|---------:|
| /pricing  | 412         | 63       |
| /         | 388         | 210      |
| /signup   | 96          | 71       |

The homepage looks worst by raw count and is the least interesting row. It has the most traffic, so it collects the most of everything. Pricing is the row to open: 412 clicks from only 63 sessions means roughly six and a half rage clicks per affected session, which is the shape of one element failing repeatedly rather than a broad annoyance.

## Split by device before you conclude anything

Tap targets, hover states and fixed headers behave differently on a phone, and a rage click cluster that exists only on mobile points somewhere very specific. Group by `$device_type`:

```sql
SELECT
  properties.$pathname AS path,
  properties.$device_type AS device,
  count() AS rage_clicks,
  countDistinct(properties.$session_id) AS sessions
FROM events
WHERE event = '$rageclick'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY path, device
ORDER BY rage_clicks DESC
LIMIT 20
```

Illustrative sample output:

| path     | device  | rage_clicks | sessions |
|----------|---------|------------:|---------:|
| /pricing | Mobile  | 361         | 44       |
| /pricing | Desktop | 51          | 19       |

A split like that is a layout finding, not a copy finding. Something on the pricing page is tappable in theory and not in practice at phone width. If your mobile numbers look bad across the board, the wider question of [how big a mobile to desktop gap is normal](/blog/mobile-vs-desktop-conversion-rate-gap) is worth answering first, so you know whether you are chasing a defect or a fact of life.

Rows can come back with a null device when events predate device capture or arrive from a server-side source. Read those as unknown rather than folding them into either bucket.

## Dead clicks name the element

Rage clicks tell you someone got angry. Dead clicks tell you what they were clicking on that does nothing:

```sql
SELECT
  properties.$pathname AS path,
  count() AS dead_clicks,
  countDistinct(properties.$session_id) AS sessions
FROM events
WHERE event = '$dead_click'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY path
ORDER BY dead_clicks DESC
LIMIT 20
```

Once you have the page, the PostHog toolbar is faster than SQL for the last step. Open the page with the toolbar and the heatmap shows dead click counts positioned on the actual elements, which turns "something on /pricing" into "the plan card border, and not the button inside it".

That distinction is the common finding. A plan card styled with a shadow and a hover cursor reads as a single large button to a visitor, so they click the card, and only the small link inside it is wired up.

## Telling a blocker from noise

Four checks separate a real conversion blocker from data exhaust.

Count sessions, not clicks. One determined visitor can generate thirty rage clicks in a minute, and raw totals will put that person ahead of a problem affecting hundreds of people.

Normalise against traffic. A page with ten times the visitors will show more of everything. Clicks per session, or per thousand pageviews, gives you the ranking that survives scrutiny.

Expect false positives from interaction patterns that genuinely involve repeated clicking. Carousels, sliders, drag handles, zoom controls and quantity steppers all produce them, as does text people select to copy, such as a coupon code or an API key.

Check what the element is before you call it broken. A dead click on a non-interactive element is not a bug in the sense that anything crashed. It is a design signal that the element looks clickable and is not, which costs conversions just as reliably as a broken button.

## From signal to fix

The gap between these two events and the rest of your analytics is that they arrive pre-diagnosed. A funnel can tell you that six in ten visitors leave the pricing page. A dead click cluster on the plan card tells you why they left, and what to change.

The fix is usually small: make the whole card the click target, raise the tap area to a comfortable size at 360 pixels wide, or remove the affordance so the element stops promising something it never does. Ship one of them, then re-run the query in two weeks against the same window length and confirm the cluster shrank.

Velyr reads both signals on its weekly pass, per page and split by device, and uses them as evidence for the single conversion fix it proposes. The fix arrives as a Pull Request on your repo, or as a staged theme write on Shopify, and nothing reaches your site until you approve it. If you would rather have the cluster found and the change written for you, that is [what the agent does](/agent/register).
