# AI Agent — Runbook de Deploy

Checklist único para ativar todas as features do AI Agent em produção
(RAG, Notifications, Scheduler, Calendar). Cada bloco é independente —
você pode aplicar só o que está pronto.

> ⚠️ **Ordem importa**: aplique migrations na ordem numérica. Cada
> bloco aqui assume que os anteriores já rodaram.

---

## Estado das migrations

| # | Migration | Feature | Status |
|---|---|---|---|
| 022 | `022_ai_agent_rag.sql` | RAG (knowledge base + indexer + pgvector) | ✅ aplicado |
| 023 | `023_ai_agent_notifications.sql` | Templates de notificação | ⏳ pendente |
| 024 | `024_ai_agent_rag_indexer_hardening.sql` | Hardening do indexer (limbo fix) | ⏳ pendente |
| 025 | `025_ai_agent_scheduled_jobs.sql` | Scheduled jobs (cron-based) | ⏳ pendente |
| 026 | `026_ai_agent_calendar.sql` | Google Calendar (Vault + OAuth) | ⏳ pendente |

Aplicar todos:

```bash
cd apps/crm
npx supabase db push
```

`db push` é idempotente — roda só as migrations não aplicadas.

---

## Bloco 1 — RAG hardening (PR #45)

**Migration**: 024

**O que faz**:
- Endurece `claim_agent_indexing_job()` pra evitar limbo `Em fila` permanente
- Recria pg_cron `ai-agent-indexer-tick` com `timeout_milliseconds = 60000` (era 5000)

**Pré-requisitos**: 022 já aplicado.

**Sem env var nova**. Se já tem `VOYAGE_API_KEY` + `PERSIA_INDEXER_SECRET` + DB settings de RAG, está pronto.

**Validação pós-deploy**:
```sql
-- Documentos presos com attempts >= 3 viram "failed" no próximo tick
SELECT indexing_status, COUNT(*) FROM agent_knowledge_sources GROUP BY 1;

-- Cron job rodando com timeout 60s
SELECT jobname, schedule
FROM cron.job
WHERE jobname = 'ai-agent-indexer-tick';
```

---

## Bloco 2 — Notifications (PR #43, #44)

**Migration**: 023

**O que faz**: tabela `agent_notification_templates`. Cada template vira um tool implícito `notify_<slug>` registrado em `agent_tools` (server action mantém em sync).

**Pré-requisitos**: nenhum dado novo.

**Sem env var nova**. Sem cron novo.

**Pré-requisito de runtime**: handler `trigger_notification` precisa estar registrado no `NativeHandlerRegistry`. Se Codex ainda não entregou PR7.1b, criar templates funciona mas o LLM chama o tool e o handler retorna `undefined`.

**Validação pós-deploy**:
```sql
-- Tabela criada
\d agent_notification_templates;

-- Tools sync funcionando: criar 1 template via UI e ver row em agent_tools
SELECT id, name, native_handler FROM agent_tools
WHERE native_handler = 'trigger_notification';
```

---

## Bloco 3 — Scheduler (PR #46, #47, ⏳ #PR7.2b)

**Migration**: 025

**O que faz**:
- Tabelas `agent_scheduled_jobs` + `agent_scheduled_runs`
- 3 RPCs (`claim`, `complete`, `fail`)
- pg_cron `ai-agent-scheduler-tick` cada 1min

### 3.1 — Aplicar migration

```bash
cd apps/crm && npx supabase db push
```

### 3.2 — Gerar secret e setar DB settings

No SQL Editor do Supabase:

```sql
-- Gera 48 chars hex
SELECT encode(gen_random_bytes(24), 'hex') AS scheduler_secret;
-- Copia o resultado (chamar de <SCHEDULER_SECRET>)
```

Depois (substituindo `<SCHEDULER_SECRET>`):

```sql
ALTER DATABASE postgres
  SET app.settings.scheduler_tick_url
  TO 'https://crm.funilpersia.top/api/ai-agent/scheduler/tick';

ALTER DATABASE postgres
  SET app.settings.scheduler_tick_secret
  TO '<SCHEDULER_SECRET>';
```

### 3.3 — Env vars no EasyPanel

CRM (`persia-crm-v2`):
```
PERSIA_SCHEDULER_SECRET=<SCHEDULER_SECRET>
```

Admin (`persia-admin-v2`) — pra bridge funcionar:
```
CRM_CLIENT_BASE_URL=https://crm.funilpersia.top
CRM_API_SECRET=<mesmo valor de PERSIA_SCHEDULER_SECRET ou outro>
```

### 3.4 — Pré-requisito de runtime

PR7.2b (Codex) precisa criar:
- `/api/ai-agent/scheduler/tick` endpoint
- `apps/crm/src/lib/ai-agent/scheduler/` runtime

Sem isso, pg_cron tenta bater no endpoint e recebe 404. Não causa loop infinito (cron só dispara a cada 1min), mas o `next_run_at` dos jobs nunca avança.

### 3.5 — Validação pós-deploy

```sql
-- Cron job ativo
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'ai-agent-scheduler-tick';
```

Logs do CRM devem mostrar `ai_agent_scheduler_tick_completed` a cada minuto.

---

## Bloco 4 — Google Calendar (PR #48, ⏳ #PR7.3b, #PR7.3c)

**Migration**: 026

### 4.1 — Pré-requisito EXTERNO (Google Cloud Console)

1. Acessa https://console.cloud.google.com/
2. Cria projeto novo "Persia CRM AI Agent" (ou usa existente)
3. **Enabled APIs & Services** → busca "Google Calendar API" → **Enable**
4. **OAuth consent screen**:
   - User Type: **External**
   - App name: "Persia CRM Agente"
   - Support email: (seu)
   - Developer contact: (seu)
   - Scopes: adicionar `.../auth/calendar.events`
   - Test users: (seu email enquanto não publica)
   - **Save and continue**
5. **Credentials** → **Create credentials** → **OAuth client ID**:
   - Application type: **Web application**
   - Name: "Persia CRM Production"
   - Authorized JavaScript origins: `https://crm.funilpersia.top`
   - Authorized redirect URIs: `https://crm.funilpersia.top/api/oauth/google/callback`
   - **Create**
6. Copia o **Client ID** + **Client Secret** que aparecerem

### 4.2 — Env vars no EasyPanel

CRM:
```
GOOGLE_OAUTH_CLIENT_ID=<...apps.googleusercontent.com>
GOOGLE_OAUTH_CLIENT_SECRET=<...>
```

### 4.3 — Aplicar migration

```bash
cd apps/crm && npx supabase db push
```

A migration habilita Supabase Vault. Se tiver erro `extension "supabase_vault" does not exist`, ative manualmente:
- Supabase Dashboard → Database → Extensions → busca `supabase_vault` → toggle on

### 4.4 — Pré-requisito de runtime

PR7.3b (Codex) precisa criar:
- `/api/oauth/google/callback` endpoint
- `apps/crm/src/lib/ai-agent/calendar/google-client.ts`
- Handler `schedule_event`

PR7.3c (Claude) cria UI de gerenciar conexões (pendente).

### 4.5 — Validação pós-deploy

```sql
-- Tabela e RPCs criadas
\d agent_calendar_connections;
SELECT proname FROM pg_proc WHERE proname IN (
  'get_calendar_refresh_token',
  'upsert_calendar_connection'
);

-- Vault habilitado
SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';
```

---

## Rollback geral

Cada migration tem bloco de rollback comentado no fim. Aplicar se precisar reverter:

```bash
psql "$SUPABASE_DB_URL" -f apps/crm/supabase/migrations/<N>.sql --include-comments
# OU manualmente: copia o BEGIN/COMMIT do bloco "-- Rollback (manual)"
```

⚠️ Rollback de migration 024 (RAG hardening) não desfaz jobs já marcados
`failed` — eles ficam como histórico. Não é problema, só cosmético.

---

## Validação ponta a ponta

Após **todos** os blocos aplicados (1-4):

1. Aba **FAQ** + upload de **Documento** funcionam → status vira `Indexada`
2. Aba **Notificações** → criar template + ver `notify_<slug>` em `agent_tools`
3. Aba **Agendamento** → criar job → após 1min, `last_run_at` deve atualizar
4. Aba **Regras** → quando PR7.3c chegar, selector de Calendar Connection
   aparecerá

Se algum bloco está em "✅ aplicado" mas a UI/feature falha, primeiro
checa env vars no EasyPanel + cron jobs no Supabase. 90% dos problemas
estão aí.

---

## Histórico de incidentes

- **2026-04-24** — RAG: documents presos em `Em fila` por causa de
  jobs com `attempts >= 3` que continuavam `pending` mas nunca eram
  claimados. Fix em migration 024.
- **2026-04-24** — RAG: 401 silencioso em uploads (CRM action usava
  user-scoped supabase em vez de service_role). Fix em PR #37.
- **2026-04-24** — RAG: enqueue de jobs falhava com RLS porque
  `agent_indexing_jobs` só tem policy SELECT. Fix em PR #38 (escala
  pra service_role no enqueue).
