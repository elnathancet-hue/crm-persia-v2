-- Migration 101: tabela de mensagens agendadas para grupos WhatsApp
-- Separada de scheduled_messages (que é para conversas 1:1)
-- O worker em send-scheduled-worker.ts também lê esta tabela

CREATE TABLE IF NOT EXISTS public.scheduled_group_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id UUID NOT NULL,  -- referência a whatsapp_groups(id)
  group_jid TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'error', 'cancelled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS
ALTER TABLE public.scheduled_group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_group_messages_org_access"
  ON public.scheduled_group_messages
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
  );

-- Índice para o worker (status + scheduled_at)
CREATE INDEX IF NOT EXISTS idx_scheduled_group_messages_pending_due
  ON public.scheduled_group_messages (status, scheduled_at)
  WHERE status = 'pending';
