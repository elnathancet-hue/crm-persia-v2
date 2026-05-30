-- 078: group_messages — histórico de chat dos grupos WhatsApp
-- Armazena mensagens inbound (recebidas no grupo) e outbound (enviadas pelo CRM).
-- Permite chat em tempo real na página de detalhes do grupo sem alterar o
-- schema de conversations/messages (que é lead-centric).

CREATE TABLE public.group_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  text TEXT,
  sender_name TEXT,    -- push name do participante (inbound) ou null (outbound)
  whatsapp_msg_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_group_messages_org_group_time
  ON public.group_messages(organization_id, group_id, created_at DESC);

ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_group_messages"
  ON public.group_messages FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Outbound inserts go through service_role (webhook + server actions bypass RLS).
-- This policy covers edge cases where client needs to insert directly.
CREATE POLICY "org_members_insert_group_messages"
  ON public.group_messages FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
