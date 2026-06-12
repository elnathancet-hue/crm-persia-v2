-- 119_product_tier.sql
-- Adiciona product_tier à tabela organizations para controle de plano de produto.
--
-- Tiers:
--   ai_simple  — IA + Agenda + Funil (sem Chat, Grupos, Campanhas)
--   crm        — ai_simple + Chat + Relatórios (sem Grupos, Campanhas)
--   growth     — Acesso completo

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS product_tier TEXT NOT NULL DEFAULT 'growth'
  CONSTRAINT organizations_product_tier_check
    CHECK (product_tier IN ('ai_simple', 'crm', 'growth'));

-- Atualiza services de orgs existentes para ficar consistente com growth (default).
-- Orgs que já tinham services configurados mantêm seus valores — não sobrescrevemos.
-- Apenas garantimos que o campo product_tier existe com valor válido.

COMMENT ON COLUMN organizations.product_tier IS
  'Tier de produto contratado: ai_simple | crm | growth. Controla quais módulos o CRM exibe e permite acessar.';
