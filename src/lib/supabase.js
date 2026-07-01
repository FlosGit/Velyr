import { createClient } from '@supabase/supabase-js'

// Single shared browser Supabase client.
//
// Calling createClient() in multiple modules spawns multiple GoTrueClient
// instances in the same window. They each maintain their own auth state,
// fight over localStorage tokens, and a write started by a client without
// the session attached returns 400/401 against RLS policies. Always import
// this re-export — never call createClient() at module scope elsewhere.
// Single source of truth for the Supabase project URL — reused by the supabase-js
// client below AND for direct Edge Function calls (e.g. the shopify-oauth ROUTE A start
// in AgentOnboarding). Resolving it in one place prevents the divergence that let a
// wrong var name silently break Shopify OAuth. VITE_ is primary (a Vite client only sees
// VITE_-prefixed vars); NEXT_PUBLIC_ is a legacy fallback.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL

export const supabase = createClient(
  SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
