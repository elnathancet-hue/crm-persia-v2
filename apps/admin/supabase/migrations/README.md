# apps/admin/supabase/migrations — LEGACY (pre-monorepo)

**Status:** CONGELADO. Nao adicionar, editar ou re-aplicar nenhuma migration aqui.

## Contexto

Estes arquivos sao o historico das migrations aplicadas no DB compartilhado
pelo repo V1 `crm-persia-admin` (arquivado em 2026-04-21). Ficam aqui apenas
como registro documental — cada uma ja foi aplicada uma unica vez no Supabase
em producao.

## Regra de hoje

**Toda migration nova vai em `apps/crm/supabase/migrations/`** (fonte unica
oficial, conforme `MEMORY.md` e `CLAUDE.md` do monorepo). Isso inclui
migrations que modificam tabelas originalmente criadas aqui (`admin_audit_log`,
`wa_templates`, `wa_template_sends`, `conversations.last_inbound_at`, etc).

Exemplo ja consolidado:
- `apps/admin/supabase/migrations/002_admin_audit_log.sql` (V1) foi
  re-canonicalizado em `apps/crm/supabase/migrations/012_admin_audit_log_canonical.sql`
  e corrigido em `013_fix_admin_audit_log_superadmin_policy.sql`.

## O que NAO fazer

- ❌ `cd apps/admin && supabase db push` — nao executar, pode recriar
  objetos ja canonicalizados no CRM e quebrar referencias
- ❌ Editar qualquer arquivo `.sql` aqui — produz migration fantasma sem
  efeito em prod e confunde o time
- ❌ Copiar um arquivo daqui pra `apps/crm/supabase/migrations/` com o
  mesmo numero — o numero ja foi usado; criar um novo numero sequencial

## O que fazer

- ✅ Qualquer mudanca de schema: criar novo arquivo em
  `apps/crm/supabase/migrations/NNN_description.sql` (proximo numero
  sequencial) + `cd apps/crm && supabase db push`
- ✅ Tabelas criadas aqui (wa_templates, admin_audit_log, etc) continuam
  vivas em prod — podem ser alteradas por nova migration no CRM
- ✅ Apos confirmar que nada mais referencia estes arquivos (ha cerca de
  30-60 dias de estabilidade), considerar arquiva-los em `legacy/` ou
  remover completamente
