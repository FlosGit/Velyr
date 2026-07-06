// Focused unit tests for the A1 rollback-reconciliation branches in run-reconcile.js.
// run: node api/_lib/run-reconcile.test.mjs
//
// reconcileDeployed / reconcileRejected take the supabase client as a parameter, so we
// drive them with a tiny chainable mock that records every update/insert and returns a
// configured result for the compare-and-swap `.select('id')` claim.

import assert from 'node:assert'
import { reconcileDeployed, reconcileRejected } from './run-reconcile.js'

// ── Chainable supabase mock ──────────────────────────────────────────────────
// Every supabase.from(...) starts a fresh chain. update/insert/select/eq mutate the
// chain's state and return the chain; awaiting it resolves the recorded operation. An
// update+select('id') (the CAS claim) returns the next configured `claims` entry.
function mockSupabase({ claims = [] } = {}) {
  const records = []
  let claimIdx = 0
  function makeChain() {
    const state = { table: null, op: null, payload: null, filters: [], select: null }
    const result = () => {
      records.push({ ...state, filters: [...state.filters] })
      if (state.op === 'update' && state.select) {
        return { data: claims[claimIdx++] ?? [{ id: 'run1' }], error: null }
      }
      return { data: null, error: null }
    }
    const chain = {
      _state: state,
      update(p) { state.op = 'update'; state.payload = p; return chain },
      insert(p) { state.op = 'insert'; state.payload = p; return chain },
      select(c) { state.select = c; return chain },
      eq(c, v) { state.filters.push([c, v]); return chain },
      single() { return chain },
      maybeSingle() { return chain },
      then(res, rej) { return Promise.resolve(result()).then(res, rej) },
    }
    return chain
  }
  return {
    from(t) { const c = makeChain(); c._state.table = t; return c },
    _records: records,
  }
}

const rec = (records, table, op) => records.filter(r => r.table === table && r.op === op)
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`) }

// ── reconcileDeployed ────────────────────────────────────────────────────────
await test('deployed(rollback run) → rolled_back + DNA pending→rollback', async () => {
  const sb = mockSupabase({ claims: [[{ id: 'run1' }]] })
  const run = { id: 'run1', rollback_reason: 'metrics_dropped', run_type: 'conversion_fix', subscription_id: 's1' }
  const out = await reconcileDeployed(sb, run, 'sha1')
  assert.equal(out.kind, 'rollback_executed')
  const upd = rec(sb._records, 'agent_runs', 'update')
  assert.equal(upd[0].payload.status, 'rolled_back')
  const dna = rec(sb._records, 'agent_business_dna', 'update')
  assert.equal(dna.length, 1, 'resolves the pending DNA row')
  assert.equal(dna[0].payload.outcome, 'rollback')
  // Must NOT insert a fresh pending DNA on a rollback.
  assert.equal(rec(sb._records, 'agent_business_dna', 'insert').length, 0)
})

await test('deployed(normal fix) → deployed + pending DNA insert', async () => {
  const sb = mockSupabase({ claims: [[{ id: 'run1' }]] })
  const run = { id: 'run1', rollback_reason: null, run_type: 'conversion_fix', subscription_id: 's1', analysis_result: { problem: 'x' } }
  const out = await reconcileDeployed(sb, run, 'sha1')
  assert.equal(out.kind, 'fix_deployed')
  assert.equal(rec(sb._records, 'agent_runs', 'update')[0].payload.status, 'deployed')
  const ins = rec(sb._records, 'agent_business_dna', 'insert')
  assert.equal(ins.length, 1)
  assert.equal(ins[0].payload.outcome, 'pending')
})

await test('deployed(rollback run, lost CAS race) → noop, no DNA touch', async () => {
  const sb = mockSupabase({ claims: [[]] }) // claim returns 0 rows
  const run = { id: 'run1', rollback_reason: 'metrics_dropped', run_type: 'conversion_fix', subscription_id: 's1' }
  const out = await reconcileDeployed(sb, run, 'sha1')
  assert.equal(out.kind, 'noop')
  assert.equal(rec(sb._records, 'agent_business_dna', 'update').length, 0)
})

// ── reconcileRejected ────────────────────────────────────────────────────────
await test('rejected(rollback run) → deployed (keep change live), no DNA', async () => {
  const sb = mockSupabase({ claims: [[{ id: 'run1' }]] })
  const run = { id: 'run1', rollback_reason: 'metrics_dropped', run_type: 'conversion_fix', subscription_id: 's1' }
  const out = await reconcileRejected(sb, run)
  assert.equal(out.kind, 'rollback_declined')
  const upd = rec(sb._records, 'agent_runs', 'update')[0]
  assert.equal(upd.payload.status, 'deployed')
  assert.equal(upd.payload.rollback_reason, 'rollback_declined')
  assert.equal(rec(sb._records, 'agent_business_dna', 'insert').length, 0)
})

await test('rejected(normal fix) → rejected + rollback DNA insert', async () => {
  const sb = mockSupabase({ claims: [[{ id: 'run1' }]] })
  const run = { id: 'run1', rollback_reason: null, run_type: 'conversion_fix', subscription_id: 's1', analysis_result: { problem: 'x' } }
  const out = await reconcileRejected(sb, run)
  assert.equal(out.kind, 'fix_rejected')
  assert.equal(rec(sb._records, 'agent_runs', 'update')[0].payload.status, 'rejected')
  const ins = rec(sb._records, 'agent_business_dna', 'insert')
  assert.equal(ins.length, 1)
  assert.equal(ins[0].payload.outcome, 'rollback')
})

console.log(`\nrun-reconcile A1 branches: ${passed}/5 passed`)
