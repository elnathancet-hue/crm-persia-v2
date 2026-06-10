-- Migration 115: profissional padrão por tipo de serviço + timezone da org
--
-- agenda_services.default_user_id: quando definido, create_appointment usa
-- este profissional em vez do assigned_to do lead. Permite modelar
-- "Consulta com Dr. João" como tipo fixo, independente de quem é o SDR
-- do lead.
--
-- organizations.default_timezone: timezone usado em agendamentos quando
-- o profissional não tem availability_rule configurada. Elimina o
-- hardcode de "America/Sao_Paulo" que quebra orgs em outros fusos.

-- 1. Profissional padrão por tipo de serviço
ALTER TABLE agenda_services
  ADD COLUMN IF NOT EXISTS default_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN agenda_services.default_user_id IS
  'Profissional padrão para este tipo de serviço. Quando definido, create_appointment e get_available_slots usam este usuário em vez do assigned_to do lead.';

-- 2. Timezone padrão da organização
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN organizations.default_timezone IS
  'Fuso horário padrão da organização. Usado em create_appointment e reschedule_appointment quando nenhum outro timezone está disponível.';
