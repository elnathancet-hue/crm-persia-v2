-- Migration: Add CHECK constraint on messages.status
-- Motivation: enforce status enum at DB level so admin and CRM client
-- cannot write divergent values. The chat audit (2026-04-20) surfaced
-- inconsistencies between the two projects; this constraint prevents
-- future regressions regardless of which client writes.
--
-- Allowed states:
--   sending    — written on INSERT while provider call is in flight
--   sent       — after provider returned success
--   delivered  — after WhatsApp delivery receipt (future, via webhook)
--   read       — after WhatsApp read receipt (future, via webhook)
--   failed     — after provider call threw or returned error
--
-- Safety: pre-flight check runs a DO block that aborts if any row holds
-- a status outside the allowed set. If this block fails, migrate legacy
-- rows manually (UPDATE messages SET status='sent' WHERE status='...')
-- before re-running.

DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM messages
  WHERE status NOT IN ('sending', 'sent', 'delivered', 'read', 'failed');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Cannot add CHECK constraint: % rows have invalid status. Migrate legacy rows first.', invalid_count;
  END IF;
END $$;

ALTER TABLE messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed'));

-- Rollback (run manually if needed):
-- ALTER TABLE messages DROP CONSTRAINT messages_status_check;
