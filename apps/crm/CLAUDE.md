@AGENTS.md

# CRM Persia — Cliente

Este projeto e o CRM usado pelos clientes. Antes de qualquer alteracao, acione o skill `squad-crm-persia` para garantir contexto completo e sincronia com o Admin (D:\tmp\crm-persia-admin).

## Regras do Projeto

1. **Sempre use o Squad** — Acione `/squad-crm-persia` para qualquer tarefa neste projeto
2. **WhatsApp** — Campos sao `instance_url` e `instance_token` (NUNCA `api_url`/`api_token`)
3. **Realtime** — CRM usa `createBrowserClient()` (anon key com RLS)
4. **Auth** — Actions usam `getOrgId()` via organization_members
5. **Deploy** — Push em `main` → auto-deploy no EasyPanel (crm.funilpersia.top)
6. **Build** — Sempre `npm run build` antes de push
7. **Sincronia** — Verificar impacto no Admin a cada mudanca em tabelas/actions
8. **Migrations** — DB changes vao em `supabase/migrations/NNN_description.sql` deste repo. Aplicar via `npx supabase db push`, nunca via Dashboard. Ver `INFRASTRUCTURE.md` §11.

## Skills Disponíveis

- `squad-crm-persia` — Orquestrador principal (USAR SEMPRE)
- `uazapi-specialist` — WhatsApp/UAZAPI
- `n8n-architect` — Workflows n8n
- `criador-de-banco-de-dados` — Supabase/PostgreSQL
- `criador-de-sistema` — Next.js/TypeScript
- `designflow-kit` — UI/UX
