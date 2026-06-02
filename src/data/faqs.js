// Single source of truth for the FAQ content.
// Consumed by src/pages/Faq.jsx (rendered page + FAQPage JSON-LD) AND by
// scripts/prerender.mjs (static prerendered /faq HTML). Keep it dependency-free
// (no JSX, no imports) so the Node prerender script can import it directly.
export const FAQS = [
  {
    q: 'What does Velyr do?',
    a: 'Every Monday, Velyr analyzes your repo and your analytics, identifies the #1 conversion problem, writes the code fix, and opens a GitHub Pull Request. You approve via Telegram (YES/NO).'
  },
  {
    q: 'How is Velyr different from a CRO agency or an A/B testing tool?',
    a: 'A CRO agency hands you a slide deck of recommendations; an A/B testing tool gives you a dashboard and leaves the implementation to you. Velyr writes the actual code change and opens it as a Pull Request in your repo — you just approve it. It runs every week automatically, and reverts itself if a change hurts your numbers.'
  },
  {
    q: 'Do I have to approve every change?',
    a: 'Yes. Nothing merges without your explicit YES reply. You see the exact code change in the PR before deciding.'
  },
  {
    q: 'How does Velyr connect to my code?',
    a: 'You install the Velyr GitHub App on the repository you want optimized, through a standard GitHub OAuth flow. The browser never holds your GitHub token, and Velyr only ever proposes changes as Pull Requests — it cannot merge anything itself.'
  },
  {
    q: 'Does it work with the Next.js App Router?',
    a: 'Yes. Velyr supports both the Next.js Pages Router and App Router, as well as plain React and Vite projects. For App Router it discovers your routes from the filesystem (app/**/page and layout files).'
  },
  {
    q: 'What analytics does it need?',
    a: 'Velyr reads your traffic, bounce rate, scroll depth, and click behavior from PostHog. During onboarding you paste a one-line analytics snippet into your site so the agent can ground its fixes in how visitors actually behave, not just how the code is laid out.'
  },
  {
    q: 'Can it track my competitors?',
    a: 'Yes. You can track up to two competitor URLs; Velyr snapshots them and factors changes on their sites into its weekly analysis.'
  },
  {
    q: 'What happens if a change makes things worse?',
    a: 'Velyr checks your bounce rate 48 hours after each merged fix. If site-wide bounce rate jumps +15pp or more, the agent automatically opens a revert PR.'
  },
  {
    q: 'What are Brand Guardrails?',
    a: 'Your written rules about what the agent shouldn\'t change — specific copy, design elements, claims. Suggestions that violate them are rejected before reaching you.'
  },
  {
    q: 'Does it analyze my whole funnel or just the homepage?',
    a: 'Your whole funnel. Velyr maps every page in your repo and cross-references them with your PostHog analytics — including how far visitors scroll on each page and what they actually click — to find where users drop off, then prioritizes the highest-impact fix.'
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — 14 days, all features included, credit card required to start. Cancel anytime during the trial and you\'re not charged.'
  },
  {
    q: 'What happens when the trial ends?',
    a: 'You\'re automatically charged €29 and your subscription continues monthly. If payment fails (expired card, etc.), the agent pauses and you have 7 days to update payment before the subscription cancels.'
  },
  {
    q: 'Which sites are supported?',
    a: 'React, Next.js, or Vite projects deployed on Vercel with a GitHub repo. Not supported: Shopify, Wix, Squarespace, Webflow.'
  },
]
