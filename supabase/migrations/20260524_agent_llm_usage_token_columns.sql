-- ════════════════════════════════════════════════════════════════════════════
-- Fix: agent_llm_usage is missing the token-count columns the cost-tracking RPC
-- writes to.
--
-- Symptom: every LLM call logs
--   "[llm-cap] failed to record usage: column input_tokens of relation
--    agent_llm_usage does not exist"
-- so cost tracking is dead and the monthly OpenRouter spend cap can't engage.
--
-- Root cause: agent_llm_usage was created in the live DB BEFORE
-- 20260520_agent_llm_usage.sql defined the token columns. That migration uses
-- `create table if not exists`, which is a no-op against the already-existing
-- table — so the columns it declares (input_tokens / output_tokens / cost_eur /
-- updated_at) were never actually added. The `create or replace function`
-- in the same file DID update agent_llm_usage_increment, so the RPC now INSERTs
-- into columns the table lacks → the error above.
--
-- This migration adds the missing columns with ALTER TABLE ... ADD COLUMN IF
-- NOT EXISTS so it is safe on both the broken table and a fresh one. Types match
-- the RPC signature (bigint token counts, numeric cost) — note the spec said
-- "int" but bigint is what agent_llm_usage_increment(... bigint, bigint ...)
-- passes and what the original migration declared.
--
-- Idempotent. Applied manually in the Supabase SQL Editor (Flo).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agent_llm_usage
  add column if not exists input_tokens  bigint not null default 0;

alter table public.agent_llm_usage
  add column if not exists output_tokens bigint not null default 0;

-- Defensive: the same no-op-create could have left these two missing as well.
-- Both are written by agent_llm_usage_increment on every INSERT/UPDATE.
alter table public.agent_llm_usage
  add column if not exists cost_eur   numeric(12,6) not null default 0;

alter table public.agent_llm_usage
  add column if not exists updated_at timestamptz   not null default now();
