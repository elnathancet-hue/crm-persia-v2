-- Etapa 3: Avatares em grupos
-- Adiciona colunas para armazenar avatar de participante, avatar do remetente
-- em mensagens e imagem do grupo.

-- Avatar do participante em group_memberships
ALTER TABLE public.group_memberships
  ADD COLUMN IF NOT EXISTS avatar_url           TEXT,
  ADD COLUMN IF NOT EXISTS avatar_fetched_at    TIMESTAMPTZ;

-- Avatar do remetente snapshot em group_messages (otimização para realtime render)
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS sender_avatar_url    TEXT;

-- Imagem do grupo em whatsapp_groups
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS image_url            TEXT,
  ADD COLUMN IF NOT EXISTS image_fetched_at     TIMESTAMPTZ;

-- Índice parcial: membros ativos sem avatar → facilita backfill
CREATE INDEX IF NOT EXISTS idx_group_memberships_avatar_missing
  ON public.group_memberships (organization_id, group_id)
  WHERE avatar_url IS NULL AND left_at IS NULL;
