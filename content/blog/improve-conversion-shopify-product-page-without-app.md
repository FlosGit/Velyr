---
title: "How to Improve Conversion on a Shopify Product Page Without an App"
slug: "improve-conversion-shopify-product-page-without-app"
description: "Three theme-code edits that lift Shopify product page conversion without installing another app: a sticky add-to-cart snippet, an audit of the JavaScript your apps inject, and reserved space for late-loading widgets."
tldr: "The add-to-cart button on a long Shopify product page scrolls out of reach on mobile, and every app you install to fix that adds JavaScript to every page in the store. A sticky add-to-cart bar is about 40 lines of Liquid, CSS, and one IntersectionObserver. Write it into the theme, remove the app scripts you no longer use, reserve space for the widgets that load late, then measure add-to-cart rate before and after."
cluster: "framework-fixes"
tags: ["shopify", "liquid", "product-page", "conversion-rate", "mobile"]
publishedAt: "2026-07-30"
updatedAt: "2026-07-30"
author: "Velyr Team"
related:
  - "use-sveltekit-form-action-cut-checkout-drop-off"
  - "good-scroll-depth-landing-page"
  - "cumulative-layout-shift-hurt-conversion"
  - "track-cta-clicks-posthog"
faqs:
  - q: "Do I need an app for a sticky add-to-cart button on Shopify?"
    a: "No. A sticky add-to-cart bar is a Liquid snippet, a CSS block, and a short IntersectionObserver script. Writing it into the theme keeps the code on product pages only, whereas most apps load their JavaScript on every page of the store."
  - q: "Is it safe to edit Shopify theme code directly?"
    a: "Edit a duplicate theme, not the live one. Duplicate the theme from Online Store > Themes, make the change there, preview it, then publish. If your theme is connected to GitHub through Shopify's integration, work on a branch instead and let the merge sync it live."
  - q: "Why do Shopify apps slow down product pages?"
    a: "Apps add code through theme app extension blocks, through the ScriptTag API, or by writing into theme files directly. ScriptTags load on every storefront page whether the feature is used there or not, and code an old app wrote into your theme files stays behind after you uninstall it."
  - q: "How do I measure whether the change worked?"
    a: "Compare the share of product-page visitors who click add to cart in the weeks before and after the edit, using PostHog autocapture or your analytics tool. Keep the comparison windows the same length and watch mobile separately, since that is where a sticky bar does most of its work."
---

The add-to-cart button on a Shopify product page sits under the image gallery, the price, the variant pickers, and often a size guide. On a phone that puts it a scroll or two down, and then the shopper scrolls past it into the description and reviews and never sees it again. **Keeping the button reachable is theme-code work: a Liquid snippet, a CSS block, and one IntersectionObserver.** The app store will sell you the same feature for a monthly fee and a script on every page of the store.

## The sticky bar, in theme code

Two files change. First, a new snippet holding the bar itself.

```liquid
{% comment %} snippets/sticky-atc.liquid {% endcomment %}
{%- assign variant = product.selected_or_first_available_variant -%}

<div class="sticky-atc" id="sticky-atc">
  <img
    src="{{ product.featured_image | image_url: width: 96 }}"
    alt=""
    width="48"
    height="48"
    loading="lazy"
  >
  <div class="sticky-atc__meta">
    <span class="sticky-atc__title">{{ product.title }}</span>
    <span class="sticky-atc__price">{{ variant.price | money }}</span>
  </div>
  <button
    type="submit"
    form="{{ product_form_id }}"
    class="button button--primary"
    {% unless variant.available %}disabled{% endunless %}
  >
    {{ 'products.product.add_to_cart' | t }}
  </button>
</div>
```

The `form` attribute is what keeps this simple. A submit button can live anywhere in the document and still submit a form elsewhere on the page, so the bar reuses the real product form instead of duplicating cart logic. In Dawn and the Online Store 2.0 themes derived from it, `sections/main-product.liquid` assigns that id near the top as `product-form-` plus the section id. Check the variable name in your own theme before you rely on it.

Render the snippet at the bottom of `sections/main-product.liquid`, outside the product wrapper:

```liquid
{% render 'sticky-atc', product: product, product_form_id: product_form_id %}
```

Then the styles, in `assets/base.css` or whichever stylesheet your theme loads globally:

```css
.sticky-atc {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 4;
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 1rem;
  background: rgb(var(--color-background));
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.12);
  transform: translateY(110%);
  transition: transform 0.2s ease;
}

.sticky-atc.is-visible {
  transform: translateY(0);
}

.sticky-atc button {
  margin-left: auto;
}

@media screen and (min-width: 750px) {
  .sticky-atc { display: none; }
}
```

The bar starts off-screen and slides up only when the class is added, which means a JavaScript failure leaves it hidden rather than stuck over the page. Below Dawn's 750px breakpoint it is a mobile-only element, because on a desktop layout the real button is usually still in view.

The script watches the real form and shows the bar once it scrolls away:

```html
<script>
  (function () {
    var bar = document.getElementById('sticky-atc');
    var form = document.getElementById('{{ product_form_id }}');
    if (!bar || !form || !('IntersectionObserver' in window)) return;

    new IntersectionObserver(function (entries) {
      bar.classList.toggle('is-visible', !entries[0].isIntersecting);
    }, { threshold: 0 }).observe(form);
  })();
</script>
```

One observer, no scroll listener, no layout reads on every frame. Put it at the end of the snippet so `product_form_id` is still in scope.

If your theme swaps the price when a variant changes, the price in the bar will go stale. Dawn broadcasts variant changes over a small publish/subscribe helper, but the event name has moved between Dawn versions, so check what your copy actually emits before subscribing to it. If your theme emits nothing usable, drop the price from the bar or read it back out of the DOM after a change rather than guessing at an event.

## The app JavaScript you are already paying for

Installing an app for a sticky bar is one line of setup and no code review, which is why most stores do it. The cost shows up somewhere else. Apps get code onto your storefront three ways, and they behave differently:

Theme app extension blocks live in `templates/product.json` and render where you place them. These are the well-behaved ones. Remove the block in the theme editor and the code goes with it.

ScriptTags are injected by the app through the Admin API and load on every storefront page, including the pages where the feature does nothing. A currency converter, a review widget, and an upsell app each add their own.

Then there are the older apps that wrote directly into your theme files during install. Uninstalling those removes the app but leaves the code, so a store that has churned through a few apps over two years is often carrying snippets nobody has read since.

Open a product page with the network panel filtered to JS and count the third-party requests. Shopify's own Online store speed report under Analytics gives you a rougher version of the same picture over time. The apps you find that nobody uses are a faster win than most layout changes, and they cost nothing to remove beyond the care of checking each removal in a duplicate theme first.

## Leave room for whatever loads late

Review stars, trust badges, and stock counters usually render after first paint, and they push the add-to-cart button down as they arrive. A shopper who is already reaching for the button taps the wrong thing.

Give those containers a `min-height` matching their loaded state, and set explicit `width` and `height` on product images so the browser reserves the box before the file arrives:

```liquid
<img
  src="{{ product.featured_image | image_url: width: 1200 }}"
  alt="{{ product.featured_image.alt | escape }}"
  width="{{ product.featured_image.width }}"
  height="{{ product.featured_image.height }}"
>
```

This is the same layout-shift problem every framework has, with the twist that on Shopify the shifting element is often injected by something you did not write.

## Changing the theme without breaking the store

Duplicate the theme under Online Store > Themes, edit the copy, preview it on a real phone, then publish. Shopify keeps the previous theme in the list, so reverting is one click.

If the theme is connected to GitHub through Shopify's official integration, the picture is better and slightly stranger: the sync runs both ways. A merchant editing in the theme editor produces commits on the connected branch, and a merge into that branch syncs live within a minute or two. That gives you real review and real history, and it also means an accidental push is a deploy.

## Measuring it

Compare the share of product-page visitors who click add to cart, over equal windows before and after. With PostHog autocapture already collecting clicks, no new instrumentation is needed:

```sql
SELECT
  countDistinctIf(person_id, event = '$pageview'
    AND properties.$pathname LIKE '/products/%') AS product_viewers,
  countDistinctIf(person_id, event = '$autocapture'
    AND properties.$event_type = 'click'
    AND lower(properties.$el_text) LIKE '%add to cart%') AS atc_clickers,
  round(
    countDistinctIf(person_id, event = '$autocapture'
      AND properties.$event_type = 'click'
      AND lower(properties.$el_text) LIKE '%add to cart%')
    / countDistinctIf(person_id, event = '$pageview'
      AND properties.$pathname LIKE '/products/%') * 100,
  1) AS atc_rate_pct
FROM events
WHERE timestamp > now() - INTERVAL 28 DAY
```

Illustrative sample output:

| product_viewers | atc_clickers | atc_rate_pct |
|----------------:|-------------:|-------------:|
| 8,420           | 1,010        | 12.0         |

Run it once for the four weeks before the change and once for the four weeks after. Split by device if you can, since the sticky bar only exists on mobile and a blended number will understate it. A change this small will not survive a week of seasonal noise on low traffic, so give it the full window before deciding.

The awkward part of theme work is that finding the leak, writing the Liquid, and proving the number moved are three different jobs, and the last one is the one that gets skipped. [Velyr](/agent/register) connects to a Shopify store or its theme repo, ships one conversion fix a week as a staged change you approve over Telegram, and compares the before and after itself.
