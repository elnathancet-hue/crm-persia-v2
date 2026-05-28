# 10 — Runbooks

> "Cliente reclamou de X — o que fazer?" Cenários reais já vistos em prod.
> Cada runbook tem **Sintoma**, **Diagnóstico**, **Solução**, **Prevenção**.

## Convenção

Todo runbook começa pelo **sintoma do cliente** (em PT-BR informal, como vem no
WhatsApp/email do suporte). Depois traduz pra causa técnica.

## Índice

1. [A IA muda / não respondeu](#a-ia-muda--não-respondeu)
2. [A IA respondeu duas vezes](#a-ia-respondeu-duas-vezes)
3. [A IA inventou que agendou (alucinação)](#a-ia-inventou-que-agendou-alucinação)
4. [A IA não viu o documento que subi](#a-ia-não-viu-o-documento-que-subi)
5. [A IA falou fora do horário](#a-ia-falou-fora-do-horário)
6. [Mandei "pausar" e a IA continuou](#mandei-pausar-e-a-ia-continuou)
7. [A IA travou no mesmo nó (loop)](#a-ia-travou-no-mesmo-nó-loop)
8. [O custo do OpenAI explodiu](#o-custo-do-openai-explodiu)
9. [Salvei o canvas mas perdi minhas mudanças](#salvei-o-canvas-mas-perdi-minhas-mudanças)
10. [Tester verde mas em prod não dispara](#tester-verde-mas-em-prod-não-dispara)
11. [Conversation duplicada para o mesmo lead](#conversation-duplicada-para-o-mesmo-lead)
12. [Followup não disparou](#followup-não-disparou)

---

## A IA muda / não respondeu

### Sintoma
Lead mandou msg, IA não respondeu.

### Diagnóstico

```sql
-- 1. A msg chegou no DB?
SELECT id, content, sender, created_at, whatsapp_msg_id
FROM messages
WHERE conversation_id = '<conv_id>'
  AND sender = 'lead'
ORDER BY created_at DESC LIMIT 5;

-- 2. Existe agent_conversations row?
SELECT id, config_id, current_node_id, human_handoff_at, after_hours_notified_at
FROM agent_conversations
WHERE lead_id = '<lead_id>';

-- 3. Tem run associado?
SELECT id, status, error, model, tokens_input + tokens_output AS total_tokens, cost_usd_cents, started_at
FROM agent_runs
WHERE agent_conversation_id = '<agent_conv_id>'
ORDER BY started_at DESC LIMIT 5;
```

### Causas possíveis (em ordem de probabilidade)

| Causa | Como confirmar | Solução |
| --- | --- | --- |
| Feature flag desligada na org | `organizations.settings.features.native_agent_enabled` | UI Admin → toggle |
| Agent_config.status != 'active' | `agent_configs.status` | Mudar pra `'active'` |
| `human_handoff_at` setado (pause keyword ou stop_agent) | row em `agent_conversations` | Lead manda resume keyword OU admin limpa via SQL |
| Fora do horário comercial + cooldown ativo | `after_hours_notified_at > now() - 6h` | Esperar cooldown ou mudar horário |
| Pending_messages no buffer ainda | `flushed_at IS NULL` em `pending_messages` | Esperar tick (~10s) ou cron flush rodando? |
| OpenAI rate-limited | `agent_runs.error LIKE '%429%'` | Esperar backoff + escalar tier OpenAI |
| Cost ceiling estourou | log `ai_agent_flow_run_cost_ceiling_hit` | Aumentar `agent_cost_limits` da org |
| Bug interno (rare) | `agent_runs.status='failed'` + error | Investigar stack trace |

### Solução comum

99% dos casos: `human_handoff_at` setado de uma sessão anterior. SQL:

```sql
UPDATE agent_conversations
SET human_handoff_at = NULL, ai_control_epoch = ai_control_epoch + 1
WHERE id = '<agent_conv_id>';
```

Bump do epoch força outros runs em andamento a abortarem (defensive).

### Prevenção

- Monitor `ai_agent_enqueue_skipped_*` codes em logs.
- Dashboard com count de runs por hora — queda súbita = sinal.

---

## A IA respondeu duas vezes

### Sintoma
Lead recebeu 2 msgs idênticas (ou quase) da IA.

### Diagnóstico

```sql
-- Quantas runs disparou pro mesmo inbound?
SELECT inbound_message_id, COUNT(*) AS runs
FROM agent_runs
WHERE agent_conversation_id = '<id>'
GROUP BY inbound_message_id
HAVING COUNT(*) > 1;

-- Quantas msgs outgoing pra mesma conversation no mesmo timestamp?
SELECT created_at, content
FROM messages
WHERE conversation_id = '<id>' AND sender = 'ai'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at;
```

### Causas

| Causa | Como confirmar |
| --- | --- |
| Conversation duplicada (pré-migration 071) | [runbook abaixo](#conversation-duplicada-para-o-mesmo-lead) |
| Webhook retransmitido (Meta/UAZAPI) + n8n lento | Logs `incoming_pipeline_n8n_timeout` (PR #372) |
| Race entre native agent + n8n fallback | Feature flag inconsistente (não deveria mais ocorrer) |
| Cliente clicou "Resetar" + Tester rodando em paralelo | conversation Tester sintético confundindo |

### Solução

1. Confirmar UNIQUE partial está ativo (PR #355, migration 071):

```sql
SELECT * FROM pg_indexes WHERE indexname = 'agent_conversations_org_lead_crmconv_uniq';
```

Se não aparecer, **aplicar migration 071 imediatamente** — bug crítico.

2. Verificar timeout n8n (PR #372):

```bash
grep "incoming_pipeline_n8n_timeout" /var/log/easypanel/crm-persia-v2/*.log | tail -20
```

Se frequente, considerar mover pra fila async (follow-up).

### Prevenção

- Monitor query "conversas duplicadas" (zero esperado).
- Alert em `incoming_pipeline_n8n_timeout` > 50/hora.

---

## A IA inventou que agendou (alucinação)

### Sintoma
Lead pergunta "agendou?", IA responde "sim, agendei pra dia X às Y" mas nenhum
appointment foi criado no DB.

### Diagnóstico

```sql
-- Lead tem appointment recente?
SELECT id, start_at, status, created_at
FROM appointments
WHERE lead_id = '<id>'
ORDER BY created_at DESC LIMIT 5;

-- Step de create_appointment no último run?
SELECT step_type, native_handler, output, error, created_at
FROM agent_steps
WHERE run_id IN (
  SELECT id FROM agent_runs WHERE agent_conversation_id = '<id>' ORDER BY started_at DESC LIMIT 1
)
ORDER BY order_index;
```

### Causa raiz (PR #260)

Histórico: auto_actions disparavam **on_enter** na stage de agendamento. Notificação "lead
agendou" saía mesmo quando IA só **falou** que ia agendar (sem chamar `create_appointment`
de verdade).

Fix em PR #260: action_config.auto_actions ganhou trigger opcional `on_tool_success`. Notif
agora SÓ dispara depois de `create_appointment` retornar success.

### Solução em prod

1. Validar que migration 050 está aplicada:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'agent_stages' AND column_name = 'action_config';
```

2. Verificar template do agente: auto_action deve ter `trigger: "on_tool_success"`, não
   `"on_enter"`:

```sql
SELECT action_config FROM agent_stages WHERE config_id = '<id>';
```

3. Se trigger errado, atualizar via UI "Ações por etapa" ou SQL.

### Prevenção

- Templates novos sempre usam `on_tool_success` pra notifs de "lead fez X".
- Memory file `project_ai_agent_live_test_session.md` tem detalhe do bug.

---

## A IA não viu o documento que subi

### Sintoma
Cliente subiu doc PDF no agente, IA pergunta "não tenho essa informação".

### Diagnóstico

```sql
-- Source foi indexado?
SELECT id, title, type, indexing_status, error_message, created_at
FROM agent_knowledge_sources
WHERE agent_config_id = '<id>'
ORDER BY created_at DESC;

-- Quantos chunks gerou?
SELECT source_id, COUNT(*) FROM agent_knowledge_chunks
WHERE source_id IN (SELECT id FROM agent_knowledge_sources WHERE agent_config_id = '<id>')
GROUP BY source_id;

-- Modo configurado?
SELECT knowledge_mode FROM agent_configs WHERE id = '<id>';
```

### Causas

| Causa | Sintoma | Solução |
| --- | --- | --- |
| `indexing_status='pending'` ou `'indexing'` | Source ainda processando | Esperar (max 5min pra docs <1MB) |
| `indexing_status='failed'` | `error_message` mostra causa | Re-indexar via UI |
| Doc muito grande (>16k tokens) em modo `full` | Log `ai_agent_knowledge_full_exceeded_cap` (PR #371) | Trocar pra `rag` ou dividir doc |
| RAG retrieval com distance > threshold | Log `rag_retrieval_no_hits` | Reformular query OU lowering threshold |
| Cache cold + sources_hash mudou | Acontece nos primeiros 5min após upload | Aguardar ou clear cache (restart Next.js) |
| RLS bloqueando query | Schema desatualizado (rare) | `permission denied` no log |

### Solução comum

1. Confirmar source completed:

```sql
SELECT indexing_status FROM agent_knowledge_sources WHERE agent_config_id = '<id>';
```

2. Se completed mas IA não vê, conferir modo:

```sql
SELECT knowledge_mode FROM agent_configs WHERE id = '<id>';
```

3. Se `auto` e doc < 6k tokens, deveria ir pra `full`. Se `auto` e doc grande, vai pra
   `rag` — query do lead precisa "casar" semanticamente.

4. Forçar `full` se doc é pequeno e cliente quer 100% de garantia:

```sql
UPDATE agent_configs SET knowledge_mode = 'full' WHERE id = '<id>';
```

### Prevenção

- Doc grande (>16k tokens) deveria ser dividido em múltiplos `agent_knowledge_sources`
  (1 por capítulo).
- Cliente entende que `rag` retorna top-3 — pergunta vaga = retrieval ruim.

---

## A IA falou fora do horário

### Sintoma
Cliente configurou business hours mas IA respondeu às 23h.

### Diagnóstico

```sql
SELECT humanization_config->>'business_hours_enabled' AS enabled,
       humanization_config->>'business_hours_timezone' AS tz,
       humanization_config->'business_hours' AS hours
FROM agent_configs WHERE id = '<id>';
```

### Causas

| Causa | Solução |
| --- | --- |
| `business_hours_enabled = false` | Habilitar |
| Timezone errada | Validar contra `Intl.supportedValuesOf("timeZone")` |
| Range mal configurado (start >= end) | Sanitize devolve null = "fechado dia todo"; ver `business_hours` |
| Followup disparou (não respeita business_hours) | Documentado — limitação conhecida. Cliente ajusta delay_hours |
| Tester rodando (Tester ignora gate) | Conferir `agent_runs.is_test=true` |

### Solução

Validar JSONB:

```sql
-- Force defaults se config corrupto
UPDATE agent_configs
SET humanization_config = '{
  "business_hours_enabled": true,
  "business_hours_timezone": "America/Sao_Paulo",
  "business_hours": {
    "monday":    {"start": "09:00", "end": "18:00"},
    "tuesday":   {"start": "09:00", "end": "18:00"},
    "wednesday": {"start": "09:00", "end": "18:00"},
    "thursday":  {"start": "09:00", "end": "18:00"},
    "friday":    {"start": "09:00", "end": "18:00"},
    "saturday":  null,
    "sunday":    null
  },
  "after_hours_message": "Olá! Recebi sua mensagem fora do horário comercial..."
}'::jsonb
WHERE id = '<id>';
```

### Prevenção

- UI deveria validar antes de salvar (validation já existe).
- Templates novos com business_hours pre-configurados sensatos.

---

## Mandei "pausar" e a IA continuou

### Sintoma
Lead mandou "pausar" ou "humano", IA continuou respondendo.

### Diagnóstico

```sql
-- Keywords configurados?
SELECT humanization_config->'pause_keywords' AS keywords
FROM agent_configs WHERE id = '<id>';

-- Conversation está pausada?
SELECT human_handoff_at FROM agent_conversations WHERE lead_id = '<id>';

-- Log do match?
-- grep "ai_agent_paused_by_keyword" no log
```

### Causas

| Causa | Solução |
| --- | --- |
| Keyword não está em `pause_keywords` | Adicionar via UI |
| Lead escreveu "pausa por favor" mas catálogo só tem "PAUSAR" exato | **PR #369 já corrige** (fuzzy + word boundary). Se ainda acontece, conferir build de prod. |
| Match aconteceu mas DB UPDATE falhou | Logs |
| Conversation já estava pausada antes do match | check `human_handoff_at` em snapshot anterior |

### Solução

PR #369 introduziu fuzzy matching com word boundary + unaccent. "pausar por favor" agora
bate com "PAUSAR" no catálogo.

Se cliente está em build pré-PR #369, deploy o branch atual.

### Prevenção

- Keywords default sensíveis cobrem 95% dos casos.
- Cliente adiciona variações específicas via UI.

---

## A IA travou no mesmo nó (loop)

### Sintoma
Conversation com `current_node_id` igual há 10+ turnos. IA fica perguntando a mesma coisa.

### Diagnóstico

```sql
SELECT current_node_id, history_summary_run_count
FROM agent_conversations WHERE id = '<id>';

-- Quantos runs no mesmo node?
SELECT COUNT(*) FROM agent_runs r
JOIN agent_conversations ac ON ac.id = r.agent_conversation_id
WHERE ac.id = '<id>';
```

### Causas

| Causa | Solução |
| --- | --- |
| AI não emite emit_event esperado (instruction não clara) | Refinar instructions do nó AI |
| Edges sem label, runner sempre segue default | Adicionar edges nomeadas |
| `max_iterations` muito baixo no guardrails | Aumentar (default 10) |
| LLM hallucinating tool call que não muda estado | Adicionar instruction "Quando fizer X, chame emit_event(qualified)" |

### Solução

1. Adicionar instruction explícita no AI node: "Quando o lead aceitar agendar, chame
   `emit_event(event_name='qualified')` pra avançar."
2. Confirmar edge `label="qualified"` saindo do nó.
3. Resetar conversation pra unstuck:

```sql
UPDATE agent_conversations
SET current_node_id = NULL, ai_control_epoch = ai_control_epoch + 1
WHERE id = '<id>';
```

Próximo turno cai no entry node.

---

## O custo do OpenAI explodiu

### Sintoma
Fatura OpenAI da org saltou 5-10x em um dia.

### Diagnóstico

```sql
-- Top conversations por custo (24h)
SELECT
  agent_conversation_id,
  COUNT(*) AS runs,
  SUM(cost_usd_cents) / 100.0 AS total_usd,
  SUM(tokens_input + tokens_output) AS total_tokens,
  AVG(tokens_input + tokens_output) AS avg_tokens_per_run
FROM agent_runs
WHERE organization_id = '<org>'
  AND started_at > NOW() - INTERVAL '24 hours'
  AND is_test = FALSE
GROUP BY agent_conversation_id
ORDER BY total_usd DESC
LIMIT 10;
```

### Causas comuns

| Causa | Como confirmar |
| --- | --- |
| Doc gigante em modo `full` (sem hard-cap pre-PR #371) | `ai_agent_knowledge_full_exceeded_cap` log NUNCA aparecendo + check token count |
| Loop infinito num nó AI | runs >>> conversations |
| Cliente subiu doc 200KB em vez de dividir | tokens_input médio muito alto |
| gpt-5 reasoning tokens "comendo" budget | model='gpt-5*' + max_completion_tokens curto |
| Lead malicioso (spam) | uma conversation = >100 runs |

### Solução

1. Setar `agent_cost_limits` da org se ainda não tem:

```sql
INSERT INTO agent_cost_limits (organization_id, daily_usd_cents_cap, monthly_usd_cents_cap, tokens_per_run_cap)
VALUES ('<org>', 3000, 20000, 50000)  -- $30/dia, $200/mês, 50k tokens/run
ON CONFLICT (organization_id) DO UPDATE SET ...;
```

2. Aplicar hard-cap em knowledge (PR #371 já fez):

```sql
-- Verificar:
SELECT total_tokens FROM (
  SELECT SUM(LENGTH(content)/3) AS total_tokens
  FROM agent_knowledge_chunks akc
  JOIN agent_knowledge_sources aks ON aks.id = akc.source_id
  WHERE aks.agent_config_id = '<id>' AND aks.indexing_status = 'completed'
) t;
-- Se > 16000, IA usa rag automaticamente
```

3. Pausar conversations problemáticas:

```sql
UPDATE agent_conversations SET human_handoff_at = NOW()
WHERE id IN ('<ids>');
```

### Prevenção

- `agent_cost_limits` default por org nova (não implementado — follow-up).
- Alert em `cost_usd_cents > 100` em um único run (= caso suspeito).

---

## Salvei o canvas mas perdi minhas mudanças

### Sintoma
Admin editou o flow, salvou, mas ao reabrir o canvas as mudanças sumiram.

### Diagnóstico

```sql
SELECT version, updated_at, jsonb_array_length(config->'nodes') AS node_count
FROM agent_flows WHERE config_id = '<id>';
```

### Causas

| Causa | Solução |
| --- | --- |
| 2 admins editando simultaneamente | CAS (PR #359) — admin B deveria ter visto modal "outro admin salvou" |
| Frontend cache stale | Hard reload (Ctrl+Shift+R) |
| Branch antiga sem PR #359 | Conferir build deployed |

### Solução

PR #359 (CAS optimistic locking) impede sobrescrita silenciosa. Se admin B salvou em cima
de admin A:

1. UI mostra modal "Conflict — outro admin salvou. Recarregar ou sobrescrever?".
2. Admin A escolhe "Recarregar" pra ver a versão atual e re-aplicar suas mudanças.
3. Ou "Sobrescrever" se sabe o que está fazendo (passa expectedVersion=undefined).

Se modal NÃO apareceu, build pode estar antiga. Conferir:

```bash
git log --oneline | grep -i CAS
```

PR #359 deveria estar em main.

### Prevenção

- Sempre incluir `expectedVersion` em saveFlow.
- UI mostra "salvando" + "salvo às HH:MM" feedback.

---

## Tester verde mas em prod não dispara

### Sintoma
Admin testou o agente no Tester, funcionou. Em prod, lead manda msg e IA não responde.

### Diagnóstico

Conferir `gate_warnings` do último run no Tester (PR #370). Banner amarelo na UI mostra
"em prod hoje, esse run pularia por X".

3 gates possíveis:

| Code | O que significa |
| --- | --- |
| `feature_flag_off` | `native_agent_enabled` da org está false |
| `agent_not_active` | `agent_configs.status != 'active'` |
| `outside_business_hours` | Agora está fora do horário comercial |

### Solução

Banner amarelo na UI já diz o que fazer em PT-BR.

```sql
-- Conferir flag
SELECT settings->'features'->>'native_agent_enabled' FROM organizations WHERE id = '<org>';

-- Conferir status
SELECT status FROM agent_configs WHERE id = '<id>';
```

### Prevenção

- Tester sempre exibe `gate_warnings` quando houver.
- Cliente vê o aviso antes de "fazer deploy mental" do agente.

---

## Conversation duplicada para o mesmo lead

### Sintoma
Pré-migration 071: lead tinha 2 `agent_conversations` rows pro mesmo `(org, lead,
crm_conversation_id)`. Levou a respostas duplicadas.

### Diagnóstico

```sql
-- Pós-71, esta query SEMPRE retorna 0 rows
SELECT organization_id, lead_id, crm_conversation_id, COUNT(*)
FROM agent_conversations
WHERE crm_conversation_id IS NOT NULL
GROUP BY organization_id, lead_id, crm_conversation_id
HAVING COUNT(*) > 1;
```

### Histórico (PR #355)

Migration 070 criou tabela `agent_conversations_merge_log` com dry-run do que seria
deletado. DELETE manual após revisão.

Migration 071 adicionou UNIQUE partial:

```sql
CREATE UNIQUE INDEX agent_conversations_org_lead_crmconv_uniq
  ON agent_conversations (organization_id, lead_id, crm_conversation_id)
  WHERE crm_conversation_id IS NOT NULL;
```

Pós-71, 23505 catch + SELECT fallback no executor garante que webhook racing não cria 2
rows.

### Se a query acima retornar rows

**Bug crítico.** Possibilidades:

1. Migration 071 não foi aplicada (verificar `pg_indexes`).
2. Bug no catch (improvável — testado).
3. Cleanup pré-71 incompleto (rows antigas sobreviveram).

Solução manual:

```sql
-- Manter a row mais recente, deletar o resto
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, lead_id, crm_conversation_id
      ORDER BY created_at DESC
    ) AS rn
  FROM agent_conversations
  WHERE crm_conversation_id IS NOT NULL
)
DELETE FROM agent_conversations
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

### Prevenção

- Monitor query "duplicadas" daily (zero esperado).

---

## Followup não disparou

### Sintoma
Cliente configurou followup "24h sem resposta" mas IA não enviou nada.

### Diagnóstico

```sql
-- Followup está habilitado?
SELECT id, is_enabled, delay_hours, template_id
FROM agent_followups WHERE id = '<followup_id>';

-- Conversation candidate?
SELECT id, last_interaction_at, human_handoff_at,
       NOW() - last_interaction_at AS idle_for
FROM agent_conversations WHERE id = '<id>';

-- Já disparou pra essa conversation?
SELECT * FROM agent_followup_runs
WHERE followup_id = '<followup_id>' AND conversation_id = '<id>';

-- Cron rodou?
SELECT runid, start_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'ai-agent-followups-tick')
ORDER BY start_time DESC LIMIT 10;
```

### Causas

| Causa | Como confirmar |
| --- | --- |
| `is_enabled=false` | toggle UI |
| `last_interaction_at` foi atualizado recente (operator respondeu) | sintoma |
| `human_handoff_at` setado | tick filtra essas |
| Já disparou (`agent_followup_runs` row) | dedupe correto |
| Cron job pausado | `cron.job` table |
| Cron auth falhou (SCHEDULER_SECRET mismatch) | log do route |

### Solução

1. Verificar cron rodando:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ai-agent%';
```

2. Verificar last_interaction_at — quando msg de operator entrou, "relógio reiniciou":

```sql
SELECT NOW() - last_interaction_at FROM agent_conversations WHERE id = '<id>';
```

Esperado >= delay_hours. Se não, esperar.

3. Re-disparar manualmente (debug):

```bash
curl -X POST 'https://crm.funilpersia.top/api/ai-agent/followups/tick' \
  -H "X-Scheduler-Secret: $PERSIA_SCHEDULER_SECRET"
```

### Prevenção

- Cliente entende que followup roda */10min (delay max +10min do configurado).
- Cliente entende que operator respondendo reseta o relógio.

---

## Como adicionar runbook novo

1. Adicionar ao [Índice](#índice) com link.
2. Seguir template Sintoma / Diagnóstico / Causas / Solução / Prevenção.
3. SQL específico no Diagnóstico (não inglês genérico).
4. Linkar PR/migration quando aplicável.
5. Update memory file se for recorrente.

## Cross-refs

- Log codes do Diagnóstico: [09-observability.md](./09-observability.md)
- Schema das tabelas no SQL: [02-data-model.md](./02-data-model.md)
- Por que cada gate existe: [INVARIANTS.md](./INVARIANTS.md)
