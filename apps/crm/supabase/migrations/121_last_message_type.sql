-- Migration 121: adiciona last_message_type em conversations
-- Permite que a lista de conversas mostre "Imagem", "Áudio", "Vídeo" etc
-- quando a mensagem não tem conteúdo textual.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_message_type TEXT;

-- Backfill com o type da última mensagem de cada conversa
UPDATE public.conversations c
SET last_message_type = m.type
FROM (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, type
  FROM public.messages
  ORDER BY conversation_id, created_at DESC
) m
WHERE m.conversation_id = c.id;

-- Atualiza o trigger para também gravar last_message_type
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
      last_message_type    = NEW.type,
      unread_count = CASE
        WHEN NEW.sender = 'lead' THEN unread_count + 1
        ELSE unread_count
      END
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;
