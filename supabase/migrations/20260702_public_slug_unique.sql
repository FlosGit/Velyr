-- L3: enforce public_slug uniqueness at the database.
--
-- api/agent/run.js handleUpdateSettings picks a public_slug with a check-then-write
-- (SELECT ... WHERE public_slug = ?, then UPDATE) — a TOCTOU race lets two users
-- claim the same slug concurrently. This partial UNIQUE index makes the DB the
-- authoritative guard; the handler now catches the 23505 violation and returns 409.
--
-- Partial (WHERE public_slug IS NOT NULL) so the many rows with a NULL slug are not
-- forced unique. Apply via the Supabase SQL Editor (repo record of a manual migration).
-- If this errors on a duplicate-key, resolve the existing duplicate public_slug
-- values first, then re-run.

CREATE UNIQUE INDEX IF NOT EXISTS agent_subscriptions_public_slug_key
  ON agent_subscriptions (public_slug)
  WHERE public_slug IS NOT NULL;
