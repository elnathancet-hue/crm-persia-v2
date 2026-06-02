-- 087: identidade rica do remetente em group_messages (Etapa 1 do group-chat-feature-parity-roadmap)
-- Armazena telefone, lead, membership e kind resolvidos no momento do webhook.
-- Mensagens antigas ficam com NULL — a UI faz fallback para sender_name.

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS sender_phone              TEXT,
  ADD COLUMN IF NOT EXISTS sender_lead_id            UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sender_membership_id      UUID,
  ADD COLUMN IF NOT EXISTS sender_identity_kind      TEXT NOT NULL DEFAULT 'unknown'
    CHECK (sender_identity_kind IN ('phone', 'lid', 'unknown')),
  -- Etapa 3: reply contextual
  ADD COLUMN IF NOT EXISTS reply_to_whatsapp_msg_id TEXT;

-- Índice para busca por lead no histórico do grupo
CREATE INDEX IF NOT EXISTS idx_group_messages_sender_lead
  ON public.group_messages (group_id, sender_lead_id)
  WHERE sender_lead_id IS NOT NULL;

-- Índice para busca por telefone no histórico
CREATE INDEX IF NOT EXISTS idx_group_messages_sender_phone
  ON public.group_messages (organization_id, group_id, sender_phone)
  WHERE sender_phone IS NOT NULL;

-- Backfill best-effort: preenche sender_phone para mensagens antigas com sender_jid
-- (só JIDs que terminam em @s.whatsapp.net — telefone real)
UPDATE public.group_messages
SET
  sender_phone = REGEXP_REPLACE(
    SPLIT_PART(sender_jid, '@', 1),
    '^(\d{2})(\d{2})(\d{9})$', '+\1\2\3'
  ),
  sender_identity_kind = CASE
    WHEN sender_jid LIKE '%@s.whatsapp.net' THEN 'phone'
    WHEN sender_jid LIKE '%@lid'            THEN 'lid'
    ELSE 'unknown'
  END
WHERE sender_jid IS NOT NULL
  AND sender_identity_kind = 'unknown';
