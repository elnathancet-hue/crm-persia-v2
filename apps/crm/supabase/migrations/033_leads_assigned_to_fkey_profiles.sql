-- Migration 033 — Reaponta FK leads.assigned_to pra public.profiles(id)
--
-- PROBLEMA:
-- A migration 030 criou `leads.assigned_to UUID REFERENCES auth.users(id)`.
-- A query do Kanban (`packages/shared/src/crm/queries/deals.ts`) embeda o
-- responsavel via PostgREST com hint `profiles!leads_assigned_to_fkey`.
-- Como o FK aponta pra `auth.users` e nao pra `public.profiles`, PostgREST
-- nao consegue resolver a relacao e responde:
--
--   PGRST200: "Could not find a relationship between 'leads' and 'profiles'
--             in the schema cache"
--
-- Isso quebra a pagina /crm inteira (listDeals throwa).
--
-- SOLUCAO:
-- Como `public.profiles.id` e PK 1:1 que ja referencia `auth.users(id)`
-- (migration 001:87), todo `assigned_to` valido hoje tambem aponta pra um
-- profile existente — o trigger `handle_new_user` cria a row em profiles
-- pra cada novo auth.users (001:843). Reapontar a FK direto pra profiles
-- e semanticamente equivalente E habilita o embed do PostgREST.
--
-- Idempotente: usa pg_constraint pra checar antes de dropar/criar.

DO $$
BEGIN
  -- 1. Drop FK antigo (auth.users) se existir.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_assigned_to_fkey'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads DROP CONSTRAINT leads_assigned_to_fkey;
  END IF;

  -- 2. Cria FK novo apontando pra profiles (so se ja nao existir).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_assigned_to_fkey'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_assigned_to_fkey
      FOREIGN KEY (assigned_to)
      REFERENCES public.profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Forca PostgREST a recarregar o schema cache imediatamente
-- (sem isso a query continua falhando ate o proximo reload natural).
NOTIFY pgrst, 'reload schema';
