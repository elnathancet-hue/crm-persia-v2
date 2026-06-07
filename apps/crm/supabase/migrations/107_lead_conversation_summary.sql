-- Migration 107: coluna conversation_summary na tabela leads
-- Armazena o resumo gerado pela IA (ou editado manualmente) da conversa do lead.
-- Exibido na tab Dados do drawer antes de ANOTAÇÕES.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS conversation_summary TEXT;
