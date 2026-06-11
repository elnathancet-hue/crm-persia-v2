-- Migration 117: desnormalizar last_message_content + last_message_sender em conversations
-- Elimina a query unbounded de messages que buscava TODAS as msgs de TODAS as convs abertas
-- só pra montar o preview na lista. Agora o trigger já mantém essas colunas atualizadas.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_content TEXT,
  ADD COLUMN IF NOT EXISTS last_message_sender  TEXT;

-- Backfill: DISTINCT ON (conversation_id) é O(n log n) via index —
-- muito mais eficiente que um subselect correlacionado.
UPDATE public.conversations c
SET
  last_message_content = m.content,
  last_message_sender  = m.sender
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, content, sender
  FROM public.messages
  ORDER BY conversation_id, created_at DESC
) m
WHERE m.conversation_id = c.id;

-- Atualiza a função de trigger existente para também gravar as novas colunas.
-- Reutiliza o mesmo trigger on_message_created, sem criar trigger extra.
CREATE OR REPLACE FUNCTION public.update_lead_last_interaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.leads
  SET last_interaction_at = NOW()
  WHERE id = NEW.lead_id;

  UPDATE public.conversations
  SET last_message_at      = NOW(),
      last_message_content = NEW.content,
      last_message_sender  = NEW.sender,
      unread_count = CASE
        WHEN NEW.sender = 'lead' THEN unread_count + 1
        ELSE unread_count
      END
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;
