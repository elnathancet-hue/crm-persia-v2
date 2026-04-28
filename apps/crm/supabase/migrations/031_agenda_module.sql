-- ============================================================
-- MIGRATION 031: Agenda module — foundation (PR1)
-- ------------------------------------------------------------
-- Cria as tabelas-base do modulo Agenda. Esta migration nao
-- adiciona nenhuma feature visivel ao usuario; apenas a estrutura
-- de dados sobre a qual os PRs seguintes (server actions, UI,
-- booking publico, lembretes) vao se apoiar.
--
-- DECISOES (ver discussao no chat):
--   #5 Unifica appointment + event + block em uma tabela so,
--      discriminada por `kind`. Bloqueio de horario eh um row
--      `kind='block'`, evento interno eh `kind='event'`.
--   #6 Slug por org. URL final eh
--      crm.funilpersia.top/agendar/{org.slug}/{booking_page.slug}.
--   #1 Google Calendar sync REUSA agent_calendar_connections
--      criada na migration 026. Toda appointment carrega FK
--      opcional pra essa connection + external_event_id.
--   Sem tabela `tasks`: a UI usa `lead_activities` ja existente.
--   Reminders/cron: ficam pra PR3+ (precisa do scheduler).
--
-- CONVENCOES:
--   - Idempotente (CREATE TABLE IF NOT EXISTS) pra retry seguro.
--   - Timestamps em TIMESTAMPTZ. start_at/end_at sao SEMPRE UTC
--     no DB; conversao pra timezone do agendamento eh feita pelo
--     codigo, nao pelo Postgres (pra evitar drift entre apps).
--   - duration_minutes redundante com (end_at - start_at) mas
--     simplifica filtros e evita interval math em query path
--     quente do calendar view.
--   - Soft delete via deleted_at; queries do app sempre filtram
--     `WHERE deleted_at IS NULL`.
--
-- ROLLBACK manual no final do arquivo.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) agenda_services — catalogo de servicos agendaveis por org
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agenda_services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price_cents INTEGER,
  color TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(name) BETWEEN 1 AND 100),
  CHECK (duration_minutes BETWEEN 5 AND 1440),
  CHECK (price_cents IS NULL OR price_cents >= 0),
  CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_agenda_services_org_active
  ON public.agenda_services (organization_id, is_active);

-- ============================================================
-- 2) availability_rules — janela semanal de atendimento por user
-- ------------------------------------------------------------
-- `days` eh JSONB no formato:
--   [
--     { "day_of_week": 1, "enabled": true,
--       "intervals": [{ "start": "09:00", "end": "12:00" },
--                     { "start": "14:00", "end": "18:00" }] },
--     ...
--   ]
-- day_of_week: 0=domingo, 6=sabado (alinhado com Date.getDay()).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.availability_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Padrão',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  days JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(name) BETWEEN 1 AND 100),
  CHECK (default_duration_minutes BETWEEN 5 AND 1440),
  CHECK (jsonb_typeof(days) = 'array')
);

-- Garante uma unica regra default por (org,user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_rules_default_per_user
  ON public.availability_rules (organization_id, user_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_availability_rules_org_user
  ON public.availability_rules (organization_id, user_id);

-- ============================================================
-- 3) booking_pages — paginas publicas de auto-agendamento
-- ------------------------------------------------------------
-- Slug eh unique POR ORG; URL final inclui o slug da org.
-- Regex restringe a-z0-9 com hifens, comprimento 1-50.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.agenda_services(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  meeting_url TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  lookahead_days INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','inactive')),
  total_bookings INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  CHECK (char_length(title) BETWEEN 1 AND 100),
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,49}$'),
  CHECK (duration_minutes BETWEEN 5 AND 1440),
  CHECK (buffer_minutes BETWEEN 0 AND 1440),
  CHECK (lookahead_days BETWEEN 1 AND 365),
  CHECK (total_bookings >= 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_pages_org_status
  ON public.booking_pages (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_pages_user
  ON public.booking_pages (user_id);

-- ============================================================
-- 4) appointments — UNIFICA compromisso, evento e bloqueio.
-- ------------------------------------------------------------
-- kind discrimina:
--   'appointment' = agendamento com lead (status flow normal)
--   'event'       = evento interno sem lead (reuniao de equipe)
--   'block'       = bloqueio de horario (folga, almoco) — bloqueia
--                   booking publico, invisivel pro lead.
--
-- lead_id eh NULL pra event/block. appointment pode ter lead_id
-- NULL tambem (compromisso pessoal/avulso).
--
-- external_calendar_connection_id + external_event_id sao pra
-- sync com Google Calendar via agent_calendar_connections (026).
-- recurrence_rule fica reservado pra RRULE futuro.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  kind TEXT NOT NULL DEFAULT 'appointment'
    CHECK (kind IN ('appointment','event','block')),

  title TEXT NOT NULL,
  description TEXT,

  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.agenda_services(id) ON DELETE SET NULL,
  booking_page_id UUID REFERENCES public.booking_pages(id) ON DELETE SET NULL,

  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',

  status TEXT NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status IN (
      'awaiting_confirmation','confirmed','completed',
      'cancelled','no_show','rescheduled'
    )),

  channel TEXT
    CHECK (channel IS NULL OR channel IN ('whatsapp','phone','online','in_person')),
  location TEXT,
  meeting_url TEXT,

  cancelled_at TIMESTAMPTZ,
  cancelled_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by_role TEXT
    CHECK (cancelled_by_role IS NULL OR cancelled_by_role IN ('agent','lead','system')),
  cancellation_reason TEXT,
  rescheduled_from_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,

  confirmation_sent_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,

  external_calendar_connection_id UUID REFERENCES public.agent_calendar_connections(id) ON DELETE SET NULL,
  external_event_id TEXT,
  external_synced_at TIMESTAMPTZ,

  recurrence_rule TEXT, -- reservado pra v2 (RFC 5545)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  CHECK (char_length(title) BETWEEN 1 AND 200),
  CHECK (end_at > start_at),
  CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  -- block/event nunca deveriam ter lead
  CHECK (kind = 'appointment' OR lead_id IS NULL),
  -- cancelamento coerente: se status=cancelled, deve ter cancelled_at
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

-- Indexes pra os 3 padroes de query mais comuns:
--   1) "agenda do dia" / "agenda da semana" do agente logado
CREATE INDEX IF NOT EXISTS idx_appointments_org_user_start
  ON public.appointments (organization_id, user_id, start_at)
  WHERE deleted_at IS NULL;

--   2) detalhe do lead (mostrar appointments dele)
CREATE INDEX IF NOT EXISTS idx_appointments_org_lead_start
  ON public.appointments (organization_id, lead_id, start_at)
  WHERE deleted_at IS NULL AND lead_id IS NOT NULL;

--   3) calendar view por janela [from, to)
CREATE INDEX IF NOT EXISTS idx_appointments_org_range
  ON public.appointments (organization_id, start_at, end_at)
  WHERE deleted_at IS NULL;

--   4) total_bookings counter da booking_page
CREATE INDEX IF NOT EXISTS idx_appointments_booking_page
  ON public.appointments (booking_page_id)
  WHERE deleted_at IS NULL AND booking_page_id IS NOT NULL;

--   5) Calendar sync inverso (qual appointment corresponde ao external_event)
CREATE INDEX IF NOT EXISTS idx_appointments_external_event
  ON public.appointments (external_calendar_connection_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- ============================================================
-- 5) appointment_history — audit trail por appointment
-- ============================================================
CREATE TABLE IF NOT EXISTS public.appointment_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'created','updated','status_changed','rescheduled','cancelled',
    'restored','confirmation_sent','reminder_sent','external_synced'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_by_role TEXT
    CHECK (performed_by_role IS NULL OR performed_by_role IN ('agent','admin','owner','lead','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_history_appointment
  ON public.appointment_history (appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_history_org
  ON public.appointment_history (organization_id, created_at DESC);

-- ============================================================
-- 6) Trigger: manter updated_at sincronizado
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_agenda_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agenda_services_updated_at ON public.agenda_services;
CREATE TRIGGER trg_agenda_services_updated_at
  BEFORE UPDATE ON public.agenda_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_agenda_set_updated_at();

DROP TRIGGER IF EXISTS trg_availability_rules_updated_at ON public.availability_rules;
CREATE TRIGGER trg_availability_rules_updated_at
  BEFORE UPDATE ON public.availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_agenda_set_updated_at();

DROP TRIGGER IF EXISTS trg_booking_pages_updated_at ON public.booking_pages;
CREATE TRIGGER trg_booking_pages_updated_at
  BEFORE UPDATE ON public.booking_pages
  FOR EACH ROW EXECUTE FUNCTION public.tg_agenda_set_updated_at();

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.tg_agenda_set_updated_at();

-- ============================================================
-- 7) RLS — todos seguem o padrao get_user_org_role (migration 004)
-- ------------------------------------------------------------
-- Servicos, paginas, appointments, history: owner/admin/agent
-- podem ler e escrever (regra simples; refinaremos por user_id
-- caso de auditoria pedir).
--
-- availability_rules: agent so pode ler/editar a propria.
-- owner/admin podem ver/editar de qualquer um da org.
-- ============================================================
ALTER TABLE public.agenda_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_history ENABLE ROW LEVEL SECURITY;

-- agenda_services
CREATE POLICY "agenda_services_select" ON public.agenda_services
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "agenda_services_insert" ON public.agenda_services
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "agenda_services_update" ON public.agenda_services
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner','admin','agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "agenda_services_delete" ON public.agenda_services
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner','admin'));

-- availability_rules: usuario gerencia a propria; admin/owner gerenciam todas
CREATE POLICY "availability_rules_select" ON public.availability_rules
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner','admin','agent')
    AND (
      get_user_org_role(organization_id) IN ('owner','admin')
      OR user_id = auth.uid()
    )
  );
CREATE POLICY "availability_rules_insert" ON public.availability_rules
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner','admin','agent')
    AND (
      get_user_org_role(organization_id) IN ('owner','admin')
      OR user_id = auth.uid()
    )
  );
CREATE POLICY "availability_rules_update" ON public.availability_rules
  FOR UPDATE USING (
    get_user_org_role(organization_id) IN ('owner','admin','agent')
    AND (
      get_user_org_role(organization_id) IN ('owner','admin')
      OR user_id = auth.uid()
    )
  )
  WITH CHECK (
    get_user_org_role(organization_id) IN ('owner','admin','agent')
    AND (
      get_user_org_role(organization_id) IN ('owner','admin')
      OR user_id = auth.uid()
    )
  );
CREATE POLICY "availability_rules_delete" ON public.availability_rules
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner','admin')
    OR (get_user_org_role(organization_id) = 'agent' AND user_id = auth.uid())
  );

-- booking_pages
CREATE POLICY "booking_pages_select" ON public.booking_pages
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "booking_pages_insert" ON public.booking_pages
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "booking_pages_update" ON public.booking_pages
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner','admin','agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "booking_pages_delete" ON public.booking_pages
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner','admin'));

-- appointments
CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner','admin','agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));
-- Hard-delete eh raro: prefira soft-delete (set deleted_at).
CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner','admin'));

-- appointment_history: read-only pra membros da org, insert via SECURITY
-- DEFINER nas actions (auditoria fica fora do alcance do client).
CREATE POLICY "appointment_history_select" ON public.appointment_history
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner','admin','agent'));
CREATE POLICY "appointment_history_insert" ON public.appointment_history
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner','admin','agent'));

-- ============================================================
-- 8) Comentarios nas tabelas (ajuda quem inspeciona via Studio)
-- ============================================================
COMMENT ON TABLE public.appointments IS
  'Agendamentos, eventos internos e bloqueios de horario. Discriminado por kind.';
COMMENT ON COLUMN public.appointments.kind IS
  'appointment=com lead, event=interno sem lead, block=bloqueio de horario';
COMMENT ON COLUMN public.appointments.recurrence_rule IS
  'Reservado pra RRULE (RFC 5545). PR1 nao implementa recorrencia.';
COMMENT ON TABLE public.availability_rules IS
  'Janela semanal de atendimento por usuario. days = JSONB array indexado por day_of_week 0-6.';
COMMENT ON TABLE public.booking_pages IS
  'Paginas publicas de auto-agendamento. URL: /agendar/{org.slug}/{slug}.';

COMMIT;

-- ============================================================
-- ROLLBACK manual:
-- ============================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.appointment_history CASCADE;
--   DROP TABLE IF EXISTS public.appointments CASCADE;
--   DROP TABLE IF EXISTS public.booking_pages CASCADE;
--   DROP TABLE IF EXISTS public.availability_rules CASCADE;
--   DROP TABLE IF EXISTS public.agenda_services CASCADE;
--   DROP FUNCTION IF EXISTS public.tg_agenda_set_updated_at();
-- COMMIT;
