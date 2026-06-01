-- Etapa 8: Automações de Grupo
-- group_automations: regras configuradas por grupo
-- group_automation_logs: log de execuções para idempotência

CREATE TABLE group_automations (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id          uuid NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  trigger           text NOT NULL CHECK (trigger IN ('member_joined', 'member_left', 'lead_identified', 'message_received')),
  action_type       text NOT NULL CHECK (action_type IN ('add_tag')),
  action_payload    jsonb NOT NULL DEFAULT '{}',
  -- Para add_tag: { "tag_id": "uuid" }
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX group_automations_org_group_trigger_idx
  ON group_automations (organization_id, group_id, trigger)
  WHERE is_active = true;

-- Tabela de logs para idempotência: UNIQUE(automation_id, event_key) garante
-- que a mesma automação não execute duas vezes para o mesmo evento.
CREATE TABLE group_automation_logs (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id  uuid NOT NULL REFERENCES group_automations(id) ON DELETE CASCADE,
  event_key      text NOT NULL,
  executed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, event_key)
);

-- RLS: membros da organização gerenciam automações do seu grupo
ALTER TABLE group_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view group automations"
  ON group_automations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org admins can manage group automations"
  ON group_automations FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'agent')
    )
  );

-- Logs: apenas service_role acessa (sem policy = RLS bloqueia browser clients)
ALTER TABLE group_automation_logs ENABLE ROW LEVEL SECURITY;
