// Single source of truth for the FAQ content.
// Consumed by src/pages/Faq.jsx (rendered page + FAQPage JSON-LD) AND by
// scripts/prerender.mjs (static prerendered /faq HTML). Keep it dependency-free
// (no JSX, no imports) so the Node prerender script can import it directly.
export const FAQS = [
  {
    q: 'What does Velyr do?',
    a: 'Every Monday, Velyr analyzes your site (a GitHub repo or a Shopify theme) and your analytics, identifies the #1 conversion problem, and writes the code fix. On GitHub the fix arrives as a Pull Request; on Shopify it is staged for your live theme. You can preview your site with the change applied, then approve or skip with one tap — in Telegram or from your dashboard.'
  },
  {
    q: 'How is Velyr different from a CRO agency or an A/B testing tool?',
    a: 'A CRO agency hands you a slide deck of recommendations; an A/B testing tool gives you a dashboard and leaves the implementation to you. Velyr writes the actual code change and stages it for your approval. It runs every week automatically, and if a shipped change hurts your numbers, it proposes a rollback.'
  },
  {
    q: 'Do I have to approve every change?',
    a: 'Yes. Nothing ships without your explicit approval. You see the exact code change before deciding, and a Preview button shows your site with the change applied — on GitHub via your host\'s PR preview deploy (when your host builds one), on Shopify on a safe throwaway copy of your theme that is deleted once you decide.'
  },
  {
    q: 'What does it optimize for?',
    a: 'The goal you choose. Tell the agent the one action that matters most — start a trial, add to cart, book a call — and it prioritizes fixes for that goal and measures every shipped change against it, alongside bounce rate. Without a goal it optimizes engagement and bounce.'
  },
  {
    q: 'How does Velyr connect to my code?',
    a: 'For a GitHub repo, you install the Velyr GitHub App through a standard GitHub OAuth flow; the browser never holds your GitHub token, and nothing merges without your YES. For a Shopify store, you authorize Velyr on your store through Shopify\'s standard authorization screen and pick the theme it should work on; nothing is written to your theme without your YES.'
  },
  {
    q: 'Does it work with Shopify?',
    a: 'Yes, two ways. Connect your store directly during onboarding: Velyr reads your live theme through Shopify and writes approved fixes straight to it, no GitHub needed. Or, if your theme is already synced to a GitHub repo via Shopify\'s official GitHub integration, connect that repo instead and every fix arrives as a pull request.'
  },
  {
    q: 'Does it work with the Next.js App Router?',
    a: 'Yes. Velyr supports both the Next.js Pages Router and App Router, as well as plain React and Vite projects. For App Router it discovers your routes from the filesystem (app/**/page and layout files).'
  },
  {
    q: 'What analytics does it need?',
    a: 'Velyr reads your traffic, bounce rate, scroll depth, and click behavior from PostHog. During onboarding you add a small analytics snippet to your site — on Shopify the agent offers to add it to your theme for you, gated on your approval — so its fixes are grounded in how visitors actually behave, not just how the code is laid out.'
  },
  {
    q: 'Can it track my competitors?',
    a: 'Yes. You can track up to two competitor URLs; Velyr snapshots them weekly, factors their changes into its analysis, and pings you on Telegram when a weekly snapshot shows one of them changed their hero, pricing, or main call-to-action.'
  },
  {
    q: 'What happens if a change makes things worse?',
    a: 'Velyr compares your bounce rate in the 48 hours after each shipped fix with the 48 hours before — scoped to the pages the fix touched where possible, site-wide otherwise. If it rose 15 percentage points or more, it proposes a rollback: a revert PR on GitHub, or restoring the previous theme files on Shopify. You approve it like any other change.'
  },
  {
    q: 'What are Brand Guardrails?',
    a: 'Your written rules about what the agent shouldn\'t change — specific copy, design elements, claims. They are handed to the agent as hard constraints on every run.'
  },
  {
    q: 'Does it analyze my whole funnel or just the homepage?',
    a: 'Your whole funnel. Velyr maps every page of your site and cross-references them with your PostHog analytics — including how far visitors scroll on each page and what they actually click — to find where users drop off, then prioritizes the highest-impact fix.'
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — 14 days, all features included, no credit card required. If you do nothing, the trial simply expires and you\'re never charged.'
  },
  {
    q: 'What happens when the trial ends?',
    a: 'The agent pauses — nothing is charged automatically, because no card is on file. To keep it running, you subscribe from your dashboard for €29/month, and you can cancel that anytime.'
  },
  {
    q: 'Which sites are supported?',
    a: 'React, Next.js, or Vite projects in a GitHub repo that auto-deploys — Vercel, Netlify, Render, Railway or Cloudflare Pages — and Shopify stores, connected directly or via GitHub theme sync. Not supported: Wix, Squarespace, Webflow.'
  },
]
