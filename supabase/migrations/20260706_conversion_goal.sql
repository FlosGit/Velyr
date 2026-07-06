-- C5: owner-defined conversion goal.
--
-- Lets the owner state the ONE action they want visitors to take (e.g. "clicks on the
-- 'Start free trial' button", "add to cart", "book a demo call"). The weekly run injects
-- it as the Pass-1 ranking bias + the Pass-2 optimization objective, so the agent
-- optimizes for the customer's actual goal instead of bounce rate alone.
--
-- Free-text (no CHECK) — it's a natural-language objective fed to the LLM, length-capped
-- in the API (api/agent/run.js handleUpdateSettings). Nullable; NULL = "no explicit goal,
-- optimize for engagement/conversion generally" (the pre-C5 behavior). Lives alongside
-- focus_page_path — both are owner-intent columns on the subscription.
--
-- Apply via the Supabase SQL editor (this repo does not auto-run migrations).

ALTER TABLE public.agent_subscriptions
  ADD COLUMN IF NOT EXISTS conversion_goal text;
