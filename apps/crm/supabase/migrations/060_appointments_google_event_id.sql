-- ============================================================
-- MIGRATION 060: appointments.google_event_id
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT PR 14b (mai/2026): adiciona coluna pra linkar
-- appointment interno com event_id do Google Calendar. Permite
-- update/cancel bidirecional (V1 one-way: push CRM → Google;
-- PR 14c V2 adiciona pull Google → CRM).
--
-- Coluna NULL pra appointments criados ANTES do Google Calendar
-- conectado OU quando sync falhar (best-effort — appointment
-- interno é a fonte de verdade, Google é mirror).
-- ============================================================

BEGIN;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- Index pra reverse lookup (futuro PR 14c: webhook Google → CRM
-- precisa encontrar appointment pelo google_event_id).
CREATE INDEX IF NOT EXISTS idx_appointments_google_event_id
  ON public.appointments(organization_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

COMMENT ON COLUMN public.appointments.google_event_id IS
  'PR-FLOW-PIVOT PR 14b (mai/2026): ID do event correspondente no Google Calendar quando org tem conexão ativa + default_calendar_id. NULL se sync desabilitado/falhou.';

COMMIT;
