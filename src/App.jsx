import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase.js'
import Home from './Home.jsx'
import Impressum from './pages/Impressum.jsx'
import PrivacyPolicy from './pages/PrivacyPolicy.jsx'
import AgentDashboard from './pages/AgentDashboard.jsx'
import AgentAuth from './pages/AgentAuth.jsx'
import AgentOnboarding from './pages/AgentOnboarding.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import AGB from './pages/AGB.jsx'
import AgentPublic from './pages/AgentPublic.jsx'
import Faq from './pages/Faq.jsx'
import CodeVsOverlay from './pages/CodeVsOverlay.jsx'
// Dev-only: lazy-loaded so Rollup excludes SiteNetworkDemo + mockSiteNetwork
// from the prod bundle (import.meta.env.DEV inlines to false at build time).
const SiteNetworkDemo = import.meta.env.DEV
  ? lazy(() => import('./pages/SiteNetworkDemo.jsx'))
  : null

// Blog pages are code-split so they don't bloat the Home bundle.
const BlogIndex    = lazy(() => import('./pages/BlogIndex.jsx'))
const BlogCategory = lazy(() => import('./pages/BlogCategory.jsx'))
const BlogArticle  = lazy(() => import('./pages/BlogArticle.jsx'))

const RESERVED_AGENT_PATHS = new Set(['login', 'register', 'dashboard', 'onboarding', 'reset-password', 'post-signup'])
const PUBLIC_AGENT_REGEX   = /^\/agent\/([a-z0-9][a-z0-9-]{1,28}[a-z0-9])$/

const RESERVED_BLOG_PATHS  = new Set(['category'])
const BLOG_CATEGORY_REGEX  = /^\/blog\/category\/([a-z0-9][a-z0-9-]*[a-z0-9])$/
const BLOG_ARTICLE_REGEX   = /^\/blog\/([a-z0-9][a-z0-9-]{1,70}[a-z0-9])$/

const Spinner = ({ label = 'Loading…' } = {}) => (
  <div style={{ minHeight: '100vh', background: '#f7f4ef', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, fontFamily: 'Jost, sans-serif' }}>
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    <div style={{ width: 32, height: 32, border: '2px solid rgba(28,25,23,0.15)', borderTopColor: '#2a5c45', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <p style={{ fontSize: 14, color: '#a09890', fontWeight: 300 }}>{label}</p>
  </div>
)

// Shown for unmatched paths instead of silently rendering the marketing home for
// any typo'd URL (e.g. /agetn/dashboard), which was confusing and bad for SEO.
const NotFound = ({ navigate }) => (
  <div style={{ minHeight: '100vh', background: '#f7f4ef', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, fontFamily: 'Jost, sans-serif', padding: 24, textAlign: 'center' }}>
    <h1 style={{ fontSize: 64, fontWeight: 300, color: '#2a5c45', margin: 0, letterSpacing: '-0.02em' }}>404</h1>
    <p style={{ fontSize: 16, color: '#1c1917', fontWeight: 300, margin: 0 }}>This page doesn’t exist.</p>
    <button
      onClick={() => navigate('/')}
      style={{ marginTop: 8, padding: '10px 22px', background: '#2a5c45', color: '#f7f4ef', border: 'none', borderRadius: 999, fontFamily: 'Jost, sans-serif', fontSize: 14, cursor: 'pointer' }}
    >
      Back to home
    </button>
  </div>
)

// Renders after a Supabase email confirmation when the user originally clicked
// "Subscribe". Waits for the Supabase session to be established (the hash
// tokens are detected by supabase-js asynchronously), then hands off to Stripe
// Checkout. Falls back to the dashboard if no pending intent or the session
// never materialises.
function PostSignup({ navigate }) {
  useEffect(() => {
    let cancelled = false
    let fallbackTimer = null
    let authSub = null

    const params = new URLSearchParams(window.location.search)
    const nextParam = params.get('next')
    let pending = nextParam === 'subscription' ? nextParam : null
    if (!pending) {
      try {
        pending = localStorage.getItem('postLoginCheckout')
          || sessionStorage.getItem('postLoginCheckout')
      } catch {}
    }
    if (pending !== 'subscription') {
      navigate('/agent/dashboard')
      return
    }

    const trigger = async () => {
      if (cancelled) return
      try { localStorage.removeItem('postLoginCheckout') } catch {}
      try { sessionStorage.removeItem('postLoginCheckout') } catch {}
      // Strip the hash/query before handing off so a back-button doesn't re-loop.
      window.history.replaceState({}, '', '/agent/post-signup')
      // No card at signup anymore: a "subscription" intent now means "start the
      // free trial", set up through onboarding (GitHub + Telegram). The trial
      // subscription is created server-side once onboarding completes.
      if (!cancelled) navigate('/agent/onboarding')
    }

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.user) { trigger(session.user); return }

      // No session yet — listen for it and put a hard timeout in place.
      const { data } = supabase.auth.onAuthStateChange((_event, s) => {
        if (cancelled || !s?.user) return
        if (authSub) authSub.unsubscribe()
        if (fallbackTimer) clearTimeout(fallbackTimer)
        trigger(s.user)
      })
      authSub = data?.subscription || null

      fallbackTimer = setTimeout(() => {
        if (cancelled) return
        if (authSub) authSub.unsubscribe()
        navigate('/agent/login')
      }, 8000)
    })()

    return () => {
      cancelled = true
      if (authSub) authSub.unsubscribe()
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [])

  return <Spinner label="Opening Stripe checkout…" />
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname)

  // Auth redirect handler. Supabase email links (confirmation, recovery, magic
  // link) deposit the user at the configured Site URL with a `#access_token=…`
  // or `#type=recovery` hash. We route those into the right place — and for a
  // confirmed signup, honour any pending Stripe checkout intent persisted to
  // localStorage by SubscribeButton.
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('type=recovery')) {
      window.history.replaceState({}, '', '/agent/reset-password' + hash)
      setPath('/agent/reset-password')
      return
    }
    if (hash.includes('access_token') || hash.includes('type=signup')) {
      let pending = null
      // Cross-device: the confirmation email's emailRedirectTo carries
      // ?next=subscription (set in AgentAuth signUp). Reading it here means a
      // user who confirms on a different device than they registered on still
      // gets routed to checkout — localStorage/sessionStorage (same-device only)
      // remain the fallback for the Google-OAuth implicit flow.
      try {
        const nextParam = new URLSearchParams(window.location.search).get('next')
        if (nextParam === 'subscription') pending = 'subscription'
      } catch {}
      if (!pending) {
        try {
          pending = localStorage.getItem('postLoginCheckout')
            || sessionStorage.getItem('postLoginCheckout')
        } catch {}
      }
      if (pending === 'subscription') {
        // Send the user through PostSignup which will wait for the Supabase
        // session and then trigger Stripe. Keep the hash so supabase-js can
        // still consume it if it hasn't already.
        window.history.replaceState({}, '', `/agent/post-signup?next=${encodeURIComponent(pending)}` + hash)
        setPath('/agent/post-signup')
      } else {
        // Keep the hash so supabase-js (detectSessionInUrl, implicit flow) can
        // still exchange the #access_token into a session — mirrors the intent
        // branch above. Stripping it here loses the session before _initialize
        // reads window.location.href.
        window.history.replaceState({}, '', '/agent/dashboard' + hash)
        setPath('/agent/dashboard')
      }
    }
  }, [])

  useEffect(() => {
    const handler = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigate = (to) => {
    window.history.pushState({}, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }

  // ── Routes ───────────────────────────────────────────────────────────────────
  if (import.meta.env.DEV && path === '/demo/network') return (
    <Suspense fallback={null}><SiteNetworkDemo navigate={navigate} /></Suspense>
  )
  if (path === '/agb')                     return <AGB navigate={navigate} />
  if (path === '/faq')                    return <Faq navigate={navigate} />
  if (path === '/code-vs-overlay')        return <CodeVsOverlay navigate={navigate} />
  if (path === '/impressum')              return <Impressum navigate={navigate} />
  if (path === '/privacy')                return <PrivacyPolicy navigate={navigate} />
  if (path === '/agent/login')            return <AgentAuth navigate={navigate} mode="login" />
  if (path === '/agent/register')         return <AgentAuth navigate={navigate} mode="register" />
  if (path === '/agent/reset-password')   return <ResetPassword navigate={navigate} />
  if (path === '/agent/post-signup')      return <PostSignup navigate={navigate} />
  if (path === '/agent/onboarding')       return <AgentOnboarding navigate={navigate} />
  if (path === '/agent' || path === '/agent/dashboard') return <AgentDashboard navigate={navigate} />

  // Public agent timeline: /agent/{slug} where slug is not a reserved path
  {
    const m = path.match(PUBLIC_AGENT_REGEX)
    if (m && !RESERVED_AGENT_PATHS.has(m[1])) {
      return <AgentPublic navigate={navigate} slug={m[1]} />
    }
  }

  // Blog. Order matters: index, then /blog/category/{cluster}, then /blog/{slug}
  // (article regex is single-segment and guarded so it can't swallow /category).
  if (path === '/blog') return (
    <Suspense fallback={<Spinner />}><BlogIndex navigate={navigate} /></Suspense>
  )
  {
    const mc = path.match(BLOG_CATEGORY_REGEX)
    if (mc) return (
      <Suspense fallback={<Spinner />}><BlogCategory navigate={navigate} cluster={mc[1]} /></Suspense>
    )
    const ma = path.match(BLOG_ARTICLE_REGEX)
    if (ma && !RESERVED_BLOG_PATHS.has(ma[1])) return (
      <Suspense fallback={<Spinner />}><BlogArticle navigate={navigate} slug={ma[1]} /></Suspense>
    )
  }

  // /pricing — redirects home and scrolls to pricing section
  if (path === '/pricing') {
    return (
      <Home
        navigate={navigate}
        scrollToPricing
      />
    )
  }

  if (path === '/') {
    return (
      <Home
        navigate={navigate}
      />
    )
  }

  // Unknown path → 404 (previously any unmatched URL silently rendered Home).
  return <NotFound navigate={navigate} />
}
