-- ============================================================================
-- MIGRATION 066: Conversation handoff status unification
-- ----------------------------------------------------------------------------
-- Bug fixed:
--   Clicking "Assumir" used to set conversations.status='human_handling'.
--   WhatsApp webhooks only reused conversations with status IN
--   ('active', 'waiting_human'), so the next inbound message could create a
--   second conversation for the same lead and let the AI continue there.
--
-- Strategy:
--   - Treat `assigned_to` as the owner of the open conversation.
--   - Keep only canonical open statuses:
--       active        => open and owned by AI / normal flow
--       waiting_human => open and human-owned / waiting for human
--   - Merge duplicate open conversations across legacy statuses before
--     recreating the partial unique index.
--   - Mark native agent conversations as handed off when the canonical CRM
--     conversation is human-owned.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS public.conversations_org_lead_active_unique;

DO $$
DECLARE
  dup_groups integer;
  dup_total integer;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(cnt), 0)
  INTO dup_groups, dup_total
  FROM (
    SELECT organization_id, lead_id, COUNT(*) AS cnt
    FROM public.conversations
    WHERE status IN ('active', 'waiting_human', 'assigned', 'human_handling', 'ai_handling')
    GROUP BY organization_id, lead_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'Found % duplicate open conversation groups with % total conversations. Merging...',
      dup_groups, dup_total;
  ELSE
    RAISE NOTICE 'No duplicate open conversations found. Normalizing statuses only.';
  END IF;
END $$;

CREATE TEMP TABLE conv_handoff_merge_plan ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    organization_id,
    lead_id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, lead_id
      ORDER BY
        CASE
          WHEN assigned_to IS NOT NULL AND assigned_to <> 'ai' THEN 0
          WHEN status = 'waiting_human' THEN 1
          WHEN status = 'human_handling' THEN 2
          WHEN status = 'assigned' THEN 3
          ELSE 4
        END ASC,
        COALESCE(last_message_at, updated_at, created_at) DESC NULLS LAST,
        created_at DESC,
        id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id, lead_id
      ORDER BY
        CASE
          WHEN assigned_to IS NOT NULL AND assigned_to <> 'ai' THEN 0
          WHEN status = 'waiting_human' THEN 1
          WHEN status = 'human_handling' THEN 2
          WHEN status = 'assigned' THEN 3
          ELSE 4
        END ASC,
        COALESCE(last_message_at, updated_at, created_at) DESC NULLS LAST,
        created_at DESC,
        id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS keep_id
  FROM public.conversations
  WHERE status IN ('active', 'waiting_human', 'assigned', 'human_handling', 'ai_handling')
)
SELECT id AS drop_id, keep_id
FROM ranked
WHERE rn > 1;

CREATE TEMP TABLE conv_handoff_merge_members ON COMMIT DROP AS
SELECT drop_id AS id, keep_id FROM conv_handoff_merge_plan
UNION
SELECT DISTINCT keep_id AS id, keep_id FROM conv_handoff_merge_plan;

CREATE TEMP TABLE conv_handoff_merge_rollup ON COMMIT DROP AS
SELECT
  m.keep_id,
  MAX(c.last_message_at) AS last_message_at,
  MAX(c.updated_at) AS updated_at,
  SUM(COALESCE(c.unread_count, 0)) AS unread_count
FROM conv_handoff_merge_members m
JOIN public.conversations c ON c.id = m.id
GROUP BY m.keep_id;

UPDATE public.conversations c
SET
  last_message_at = COALESCE(r.last_message_at, c.last_message_at),
  updated_at = COALESCE(r.updated_at, c.updated_at, now()),
  unread_count = GREATEST(COALESCE(c.unread_count, 0), COALESCE(r.unread_count, 0))
FROM conv_handoff_merge_rollup r
WHERE c.id = r.keep_id;

UPDATE public.messages m
SET conversation_id = cmp.keep_id
FROM conv_handoff_merge_plan cmp
WHERE m.conversation_id = cmp.drop_id;

UPDATE public.agent_conversations ac
SET crm_conversation_id = cmp.keep_id
FROM conv_handoff_merge_plan cmp
WHERE ac.crm_conversation_id = cmp.drop_id;

UPDATE public.agent_followup_runs afr
SET conversation_id = cmp.keep_id
FROM conv_handoff_merge_plan cmp
WHERE afr.conversation_id = cmp.drop_id;

DELETE FROM public.conversations c
USING conv_handoff_merge_plan cmp
WHERE c.id = cmp.drop_id;

UPDATE public.conversations
SET
  status = CASE
    WHEN assigned_to = 'ai' THEN 'active'
    ELSE 'waiting_human'
  END,
  updated_at = now()
WHERE status IN ('assigned', 'human_handling', 'ai_handling');

UPDATE public.agent_conversations ac
SET
  human_handoff_at = COALESCE(ac.human_handoff_at, now()),
  human_handoff_reason = COALESCE(ac.human_handoff_reason, 'human_takeover'),
  updated_at = now()
FROM public.conversations c
WHERE ac.crm_conversation_id = c.id
  AND c.status = 'waiting_human'
  AND (c.assigned_to IS NULL OR c.assigned_to <> 'ai');

CREATE UNIQUE INDEX conversations_org_lead_active_unique
  ON public.conversations (organization_id, lead_id)
  WHERE status IN ('active', 'waiting_human');

COMMENT ON INDEX public.conversations_org_lead_active_unique IS
  'Prevents multiple open conversations per lead. Open statuses are active/waiting_human; assigned_to decides AI vs human owner.';

COMMIT;

-- ============================================================================
-- Rollback (manual):
--   DROP INDEX IF EXISTS public.conversations_org_lead_active_unique;
--   CREATE UNIQUE INDEX conversations_org_lead_active_unique
--     ON public.conversations (organization_id, lead_id)
--     WHERE status IN ('active', 'waiting_human');
--
-- Data merge and status normalization are intentionally not reversible.
-- ============================================================================
