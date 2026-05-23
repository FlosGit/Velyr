// ─── SHARED SECRET ENCRYPTION (Stage 1D) ──────────────────────────────────────
// Single Node-side home for the agent's secret crypto, unifying the former
// duplicate copies in api/onboarding.js (writer) and api/agent/run.js (reader).
//
// FORMAT CONTRACT — `enc:v1:` + base64(iv(12) ‖ tag(16) ‖ ciphertext),
// AES-256-GCM, 32-byte key from AGENT_TOKEN_ENCRYPTION_KEY (64 hex chars).
// The Deno copy in supabase/functions/agent-run/index.ts MUST stay byte-
// compatible (cross-decryptable) with this file — both read/write the same
// agent_connections rows. Cross-runtime dedup into one module isn't viable
// (Vercel Node vs Supabase Deno bundle boundary; node:crypto vs Web Crypto),
// so the two are kept in lockstep by this contract — update both together if
// the wire format ever changes.
import crypto from 'node:crypto'

const ENC_PREFIX = 'enc:v1:'

function getEncryptionKey() {
  const hex = process.env.AGENT_TOKEN_ENCRYPTION_KEY
  if (!hex) throw new Error('AGENT_TOKEN_ENCRYPTION_KEY is not configured')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('AGENT_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

// Canonical empty-string rule (from onboarding.js): empty/absent → null. There
// is no point storing an encrypted empty secret, and null reads back cleanly
// for downstream `decryptSecret(...) || fallback` call sites.
export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null
  const key    = getEncryptionKey()
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

// Legacy plaintext (no `enc:v1:` prefix) is returned as-is so the migration is
// forward-only — encrypt-on-next-write upgrades rows without a backfill job.
// Throws on tampered/corrupt ciphertext rather than returning bad data.
export function decryptSecret(stored) {
  if (stored == null) return null
  if (typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored
  const blob = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
  const iv   = blob.subarray(0, 12)
  const tag  = blob.subarray(12, 28)
  const ct   = blob.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
