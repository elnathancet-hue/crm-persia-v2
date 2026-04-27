-- Migration 030 — Campos extras de lead pra drawer "Informacoes do lead"
--
-- Drawer da referencia (Fase 2 da reformulacao do /crm) tem 3 secoes:
-- CONTATO, ENDERECO e ANOTACOES. CONTATO ja eh coberto pelos campos
-- existentes (name/phone/email + assigned_to/website novos). ENDERECO
-- e ANOTACOES precisam de colunas novas.
--
-- Idempotente: usa ADD COLUMN IF NOT EXISTS pra retry seguro.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address_country TEXT,
  ADD COLUMN IF NOT EXISTS address_state TEXT,
  ADD COLUMN IF NOT EXISTS address_city TEXT,
  ADD COLUMN IF NOT EXISTS address_zip TEXT,
  ADD COLUMN IF NOT EXISTS address_street TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS address_neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Index pra dropdown "Responsavel" do drawer (busca leads atribuidos
-- ao usuario corrente)
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to
  ON public.leads (organization_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
