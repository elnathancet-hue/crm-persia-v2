@AGENTS.md

# CRM Persia — Admin Panel

Este projeto e o painel administrativo do CRM Persia. Antes de qualquer alteracao, acione o skill `squad-crm-persia` para garantir contexto completo e sincronia com o CRM cliente.

## Regras do Projeto

1. **Sempre use o Squad** — Acione `/squad-crm-persia` para qualquer tarefa neste projeto
2. **WhatsApp** — Campos sao `instance_url` e `instance_token` (NUNCA `api_url`/`api_token`)
3. **Realtime** — Usar `getRealtimeClient()` (service_role) para subscriptions
4. **Auth** — Toda server action precisa de `requireSuperadmin()`
5. **Deploy** — Push em `main` faz auto-deploy no EasyPanel
6. **Build** — Sempre `npm run build` antes de push
7. **Sincronia** — Verificar impacto no CRM (D:\tmp\crm-persia) a cada mudanca
8. **Migrations** — NAO criar/editar nada em `apps/admin/supabase/migrations/` (pasta congelada, historico pre-monorepo). Toda migration nova vai em `apps/crm/supabase/migrations/NNN_...sql` + `cd apps/crm && supabase db push`. Ver `apps/admin/supabase/migrations/README.md`

## Skills Disponíveis

- `squad-crm-persia` — Orquestrador principal (USAR SEMPRE)
- `uazapi-specialist` — WhatsApp/UAZAPI
- `n8n-architect` — Workflows n8n
- `criador-de-banco-de-dados` — Supabase/PostgreSQL
- `criador-de-sistema` — Next.js/TypeScript
- `designflow-kit` — UI/UX
