# pg_cron jobs do AI Agent — setup por ambiente

Esse doc lista os 4 `pg_cron` jobs que o AI Agent depende em produção e
como configurá-los em um ambiente novo (sandbox, staging, outra org).

A migration `cron.schedule` cria os jobs com **command placeholder** que
faz no-op até admin rodar a função de configuração. Sem o setup manual,
o job não dispara — não trava o resto do CRM.

## Histórico

Em mai/2026 descobrimos que migrations antigas (025, 051) usavam
`current_setting('app.settings.*', true)` no command. Em **Supabase
managed o admin não tem permissão pra `ALTER DATABASE postgres SET ...`**
no SQL Editor (erro `42501: permission denied`). Resultado: settings
ficam `NULL`, cron falha em `net._encode_url_with_params_array(NULL,...)`.

A solução adotada (migration 055) cria função `SECURITY DEFINER` que
reescreve o command do cron com URL+secret **hardcoded**. Funciona pelo
SQL Editor sem precisar superuser.

## Os 4 crons

| Job | Schedule | Endpoint | Env var | Header | Migration |
|---|---|---|---|---|---|
| `ai-agent-debounce-flush` | 15s | `/api/ai-agent/debounce-flush` | `PERSIA_DEBOUNCE_FLUSH_SECRET` | `X-Persia-Cron-Secret` | 055 |
| `ai-agent-followups-tick` | 10min | `/api/ai-agent/followups/tick` | `PERSIA_SCHEDULER_SECRET` | `X-Persia-Scheduler-Secret` | 051 |
| `ai-agent-scheduler-tick` | 1min | `/api/ai-agent/scheduler/tick` | `PERSIA_SCHEDULER_SECRET` | `X-Persia-Scheduler-Secret` | 025 |
| `ai-agent-indexer-tick` | 1min | `/api/ai-agent/indexer/tick` | `PERSIA_INDEXER_SECRET` | `X-Persia-Indexer-Secret` | (verificar) |

## Setup em ambiente novo (~5 min)

### 1. Gerar secrets (SQL Editor)

Cada cron tem env var própria. Gera 1 secret por env (ou reusa se já
existir no host):

```sql
SELECT
  encode(gen_random_bytes(32), 'hex') AS debounce_flush_secret;
-- repete pra cada env que faltar
```

### 2. Setar env vars no host (EasyPanel / Vercel / etc)

```
PERSIA_DEBOUNCE_FLUSH_SECRET=<valor_do_passo_1>
PERSIA_SCHEDULER_SECRET=<idem>
PERSIA_INDEXER_SECRET=<idem>
```

Salva — host reinicia o serviço sozinho.

### 3. Configurar cada cron com URL + secret (SQL Editor)

**Debounce flush** (single source of truth — usa função criada na 055):

```sql
SELECT configure_debounce_flush_cron(
  'https://SEU_HOST/api/ai-agent/debounce-flush',
  '<valor de PERSIA_DEBOUNCE_FLUSH_SECRET>'
);
```

**Outros 3 crons** (ainda dependem de `current_setting`, devem virar
funções nos próximos PRs por consistência):

```sql
-- Reescreve o command via cron.alter_job manualmente. Substitua
-- jobid pelo retorno de:
--   SELECT jobid FROM cron.job WHERE jobname = 'ai-agent-scheduler-tick';

SELECT cron.alter_job(
  job_id := <ID>,
  command := $$
    SELECT net.http_post(
      url := 'https://SEU_HOST/api/ai-agent/scheduler/tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Persia-Scheduler-Secret', '<valor de PERSIA_SCHEDULER_SECRET>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```

Repete pros outros 2 (`followups-tick` e `indexer-tick`) trocando URL +
header conforme tabela acima.

### 4. Verificar (aguardar ~1 min)

```sql
SELECT runid, status, return_message, start_time
FROM cron.job_run_details
WHERE jobid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE 'ai-agent%'
)
ORDER BY start_time DESC LIMIT 10;
```

Esperado: todas as linhas `status='succeeded'`. Se aparecer `failed`
com `net._encode_url_with_params_array`, alguma URL ainda está NULL
(geralmente o cron que ainda não foi reconfigurado).

## Backlog

- [ ] Migration `056_ai_agent_scheduler_cron.sql` com função
      `configure_scheduler_cron(url, secret)` análoga à 055
- [ ] Migration `057_ai_agent_followups_cron.sql` idem
- [ ] Migration `058_ai_agent_indexer_cron.sql` idem
- [ ] Considerar mover secrets pro Supabase Vault (encrypted at rest)
      em vez de hardcoded no `cron.job.command` (plaintext)
