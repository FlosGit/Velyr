// Mock SiteNetworkData — used for Stage 2 component development.
// Represents a plausible React SaaS conversion site.
// Statuses are explicitly sourced:
//   fix-in-flight → a real agent_runs row with waiting_approval + file_edited match
//   optimized     → agent_business_dna.status = 'success'
//   All others    → neutral / tracked (no invented verdicts)

export const mockSiteNetworkData = {
  meta: {
    subscriptionId: 'mock-sub-001',
    runId:          'mock-run-042',
    snapshotAt:     '2026-05-26T09:00:00Z',
    framework:      'react',
    domain:         'example.com',
    totalNodes:     20,
    totalEdges:     23,
  },

  nodes: [
    // ── hub (fixed at center) ──────────────────────────────────────────────
    {
      id: '__hub__', label: 'example.com', route: '/', cluster: 'core',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: true, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },

    // ── core ───────────────────────────────────────────────────────────────
    {
      id: 'src/App.jsx', label: 'App', route: null, cluster: 'core',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },
    {
      id: 'src/components/Nav.jsx', label: 'Navigation', route: null, cluster: 'core',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },
    {
      id: 'src/components/Footer.jsx', label: 'Footer', route: null, cluster: 'core',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },

    // ── marketing ──────────────────────────────────────────────────────────
    {
      id: 'src/pages/Home.jsx', label: 'Home', route: '/', cluster: 'marketing',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: false, isGrouped: false, groupCount: 0,
      rank: 2,
      rankReason: 'Above-fold layout controls first-impression conversion for 40% of sessions',
      dropOffScore: 0.65,
    },
    {
      id: 'src/pages/Pricing.jsx', label: 'Pricing', route: '/pricing', cluster: 'marketing',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: false, isGrouped: false, groupCount: 0,
      rank: 1,
      rankReason: 'Primary conversion bottleneck — 78% of paid-intent visitors exit without converting',
      dropOffScore: 0.80,
    },
    {
      id: 'src/components/Hero.jsx', label: 'Hero', route: null, cluster: 'marketing',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: 3,
      rankReason: 'Hero CTA placement and copy directly impact trial sign-up rate',
      dropOffScore: 0.70,
    },
    {
      // Gold: open PR waiting for YES/NO in Telegram
      id: 'src/components/PricingCard.jsx', label: 'Pricing Card', route: null, cluster: 'marketing',
      status: 'fix-in-flight', statusSource: 'agent_runs.status=waiting_approval',
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: 1,
      rankReason: 'Feature comparison lacks visual hierarchy; users miss the value differentiator',
      dropOffScore: 0.75,
    },
    {
      // Green: a previous fix was deployed and survived the 48h rollback window
      id: 'src/components/CTAButton.jsx', label: 'CTA Button', route: null, cluster: 'marketing',
      status: 'optimized', statusSource: 'agent_business_dna.status=success',
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: 5,
      rankReason: null,
      dropOffScore: 0.30,
    },
    {
      id: 'src/components/Testimonials.jsx', label: 'Testimonials', route: null, cluster: 'marketing',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: 7, rankReason: null, dropOffScore: 0.35,
    },

    // ── auth ───────────────────────────────────────────────────────────────
    {
      id: 'src/pages/Login.jsx', label: 'Login', route: '/login', cluster: 'auth',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: false, isGrouped: false, groupCount: 0,
      rank: 6, rankReason: null, dropOffScore: 0.40,
    },
    {
      id: 'src/pages/Register.jsx', label: 'Sign Up', route: '/register', cluster: 'auth',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: false, isGrouped: false, groupCount: 0,
      rank: 4,
      rankReason: 'Registration form friction reduces paid conversion by an estimated 15%',
      dropOffScore: 0.55,
    },

    // ── product ────────────────────────────────────────────────────────────
    {
      id: 'src/pages/Dashboard.jsx', label: 'Dashboard', route: '/dashboard', cluster: 'product',
      status: 'neutral', statusSource: null,
      isEntry: true, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: 0.20,
    },
    {
      id: 'src/pages/Onboarding.jsx', label: 'Onboarding', route: '/onboarding', cluster: 'product',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: 8, rankReason: null, dropOffScore: 0.50,
    },

    // ── content (grouped long-tail) ────────────────────────────────────────
    {
      id: 'src/pages/blog', label: 'Blog · 14 posts', route: '/blog', cluster: 'content',
      status: 'tracked', statusSource: null,
      isEntry: false, isHub: false, isGrouped: true, groupCount: 14,
      rank: null, rankReason: null, dropOffScore: null,
    },

    // ── utility ────────────────────────────────────────────────────────────
    {
      id: 'src/hooks/useAuth.js', label: 'Auth Hook', route: null, cluster: 'utility',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },
    {
      id: 'src/utils/api.js', label: 'API Client', route: null, cluster: 'utility',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },
    {
      id: 'src/utils/analytics.js', label: 'Analytics', route: null, cluster: 'utility',
      status: 'neutral', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },

    // ── legal (watched, de-emphasised) ────────────────────────────────────
    {
      id: 'src/pages/Privacy.jsx', label: 'Privacy', route: '/privacy', cluster: 'legal',
      status: 'tracked', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },
    {
      id: 'src/pages/Terms.jsx', label: 'Terms', route: '/terms', cluster: 'legal',
      status: 'tracked', statusSource: null,
      isEntry: false, isHub: false, isGrouped: false, groupCount: 0,
      rank: null, rankReason: null, dropOffScore: null,
    },
  ],

  edges: [
    // hub → root entry
    { source: '__hub__',                    target: 'src/App.jsx',                    kind: 'structural', weight: 1 },

    // App → pages (import-graph traversal would find these)
    { source: 'src/App.jsx',                target: 'src/pages/Home.jsx',             kind: 'import',     weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/Pricing.jsx',          kind: 'import',     weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/Login.jsx',            kind: 'import',     weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/Register.jsx',         kind: 'import',     weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/Dashboard.jsx',        kind: 'import',     weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/blog',                 kind: 'import',     weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/Privacy.jsx',          kind: 'structural', weight: 1 },
    { source: 'src/App.jsx',                target: 'src/pages/Terms.jsx',            kind: 'structural', weight: 1 },

    // Home → components
    { source: 'src/pages/Home.jsx',         target: 'src/components/Hero.jsx',        kind: 'import',     weight: 1 },
    { source: 'src/pages/Home.jsx',         target: 'src/components/Testimonials.jsx',kind: 'import',     weight: 1 },
    { source: 'src/pages/Home.jsx',         target: 'src/components/Nav.jsx',         kind: 'import',     weight: 1 },
    { source: 'src/pages/Home.jsx',         target: 'src/components/Footer.jsx',      kind: 'import',     weight: 1 },

    // Pricing → components
    { source: 'src/pages/Pricing.jsx',      target: 'src/components/PricingCard.jsx', kind: 'import',     weight: 1 },
    { source: 'src/pages/Pricing.jsx',      target: 'src/components/CTAButton.jsx',   kind: 'import',     weight: 1 },
    { source: 'src/pages/Pricing.jsx',      target: 'src/components/Nav.jsx',         kind: 'import',     weight: 1 },

    // Hero → CTA
    { source: 'src/components/Hero.jsx',    target: 'src/components/CTAButton.jsx',   kind: 'import',     weight: 1 },

    // Auth → hook
    { source: 'src/pages/Login.jsx',        target: 'src/hooks/useAuth.js',           kind: 'import',     weight: 1 },
    { source: 'src/pages/Register.jsx',     target: 'src/hooks/useAuth.js',           kind: 'import',     weight: 1 },

    // Dashboard → utilities
    { source: 'src/pages/Dashboard.jsx',    target: 'src/utils/api.js',               kind: 'import',     weight: 1 },
    { source: 'src/pages/Dashboard.jsx',    target: 'src/utils/analytics.js',         kind: 'import',     weight: 1 },
    { source: 'src/pages/Dashboard.jsx',    target: 'src/components/Nav.jsx',         kind: 'import',     weight: 1 },

    // Onboarding
    { source: 'src/pages/Onboarding.jsx',   target: 'src/hooks/useAuth.js',           kind: 'import',     weight: 1 },
  ],
}
