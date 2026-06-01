-- 084: adiciona sender_jid em group_messages
-- Armazena o JID do remetente (ex: "558699421406@s.whatsapp.net") para
-- permitir backfill preciso de group_memberships sem depender do msg_id.

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS sender_jid TEXT;

CREATE INDEX IF NOT EXISTS idx_group_messages_sender_jid
  ON public.group_messages(group_id, sender_jid)
  WHERE sender_jid IS NOT NULL;
