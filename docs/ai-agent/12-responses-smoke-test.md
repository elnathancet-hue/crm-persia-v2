# 12 — Smoke test Responses API (PR 5)

> Runbook pra você executar manualmente em **staging** (não em prod) com
> `AI_AGENT_OPENAI_API=responses` ativo. Cobre os 7 cenários do plano
> [11-openai-responses-migration.md § PR 5](./11-openai-responses-migration.md).
>
> Quando todos os 7 cenários passarem, libera o **PR 6** (flip default em prod).

## Pré-requisitos

1. **Migration 074** aplicada (`agent_runs.provider_mode`). Verificar:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'agent_runs' AND column_name = 'provider_mode';
   ```
   Deve retornar 1 row.

2. **Env var setada em staging:**
   ```
   AI_AGENT_OPENAI_API=responses
   ```
   No EasyPanel: app `@persia/crm` → Environment → adicionar variável → restart.
   No CRM rodando localmente: `.env.local`.

3. **Agente Tester** configurado em uma org sandbox com:
   - `agent_configs.status = 'active'`
   - Feature flag `native_agent_enabled = true` em `organizations.settings.features`
   - Flow com 1 entry node + 1 ai_agent node + tools (`add_tag`, `move_pipeline_stage`,
     `create_appointment`, `trigger_notification`, `emit_event`, `stop_agent`)

## Cenário 1 — Conversa simples (sem tool)

**Objetivo:** validar que o caminho Responses responde texto sem chamar tool.

**Como rodar:**
1. UI → Tester do agente sandbox.
2. Mensagem: `"oi, tudo bem?"`
3. Aguardar resposta.

**Asserts:**
- IA respondeu texto não-vazio.
- SQL:
  ```sql
  SELECT id, status, provider_mode, tokens_input, tokens_output, cost_usd_cents
  FROM agent_runs
  WHERE is_test = TRUE
  ORDER BY created_at DESC LIMIT 1;
  ```
  Esperado: `provider_mode = 'responses'`, `status = 'succeeded'`,
  `tokens_input > 0`, `tokens_output > 0`, `cost_usd_cents >= 0`.

## Cenário 2 — Conversa com RAG

**Objetivo:** validar que knowledge inject continua funcionando com Responses.

**Pré-requisito:** sandbox precisa ter pelo menos 1 `agent_knowledge_source` com
`indexing_status = 'completed'` e chunks com conteúdo identificável (ex: "Taxa: 6%").

**Como rodar:**
1. UI → Tester.
2. Mensagem: `"qual a taxa?"` (ou o conteúdo específico do doc indexado)

**Asserts:**
- Resposta contém o fato do doc (ex: "6%").
- SQL: `provider_mode = 'responses'` no run.

## Cenário 3 — `emit_event` segue edge nomeada

**Objetivo:** branching via tool funciona em Responses.

**Pré-requisito:** flow com AI node tendo `instructions[]` com handle nomeado (ex:
`qualified`) + edge saindo do AI node com `data.label = "qualified"` apontando pra
outro nó.

**Como rodar:**
1. UI → Tester.
2. Mensagem que satisfaz a condição da instruction (ex: "meu nome é Maria, tenho 30
   anos e moro em SP" se a instruction é `"quando o lead tiver nome+idade+cidade"`).

**Asserts:**
- Tester timeline mostra `tool_call: emit_event` + `edge_traversed: handle=qualified`.
- `agent_conversations.current_node_id` mudou pro próximo nó da edge.
- SQL: `provider_mode = 'responses'`.

## Cenário 4 — `move_pipeline_stage` muda lead no Kanban

**Objetivo:** handler nativo escreve em `leads.stage_id` quando IA chama.

**Como rodar:**
1. UI → Tester.
2. Mensagem que dispara o move (depende do prompt do agente, ex: "ok, pode me marcar
   como qualificado").

**Asserts:**
- SQL antes do teste:
  ```sql
  SELECT stage_id FROM leads WHERE id = '<lead_tester_id>';
  ```
- SQL depois:
  ```sql
  SELECT stage_id, sort_order FROM leads WHERE id = '<lead_tester_id>';
  ```
  `stage_id` mudou pro novo.
- `agent_steps` com `native_handler = 'move_pipeline_stage'` e `output.success = true`.
- SQL: `provider_mode = 'responses'`.

## Cenário 5 — `trigger_notification` envia template

**Objetivo:** notificação pra equipe sai via WhatsApp em modo Responses.

**Pré-requisito:** `agent_notification_templates` com `target_address` = um número de
WhatsApp seu (pra você verificar).

**Como rodar:**
1. UI → Tester.
2. Mensagem que dispara notificação (ex: lead aceitando agendar).

**Asserts:**
- WhatsApp recebe a notificação.
- `agent_steps` com `native_handler = 'trigger_notification'` e `output.success = true`.
- SQL: `provider_mode = 'responses'`.

## Cenário 6 — Erro de tool (handler falha)

**Objetivo:** tool retornando erro NÃO quebra o run; IA recebe o erro como tool result
e continua.

**Como rodar:**
1. UI → Tester.
2. Manda mensagem que faz IA tentar tool com input inválido (ex: `add_tag` com tag que
   não existe no catálogo).

**Asserts:**
- `agent_steps` com `native_handler = 'add_tag'` e `output.success = false` +
  `error` setado.
- Run final `status = 'succeeded'` (não falhou por causa do tool error).
- SQL: `provider_mode = 'responses'`.

## Cenário 7 — Handoff humano mid-run

**Objetivo:** send-guard aborta outbound se humano assume conversation durante o run.

**Como rodar (precisa coordenar 2 cliques):**
1. Abrir Tester + abrir SQL editor.
2. UI → Tester → manda mensagem que disparará uma resposta longa (3+ msgs splitadas).
3. Imediatamente após enviar (antes da resposta começar), no SQL editor:
   ```sql
   UPDATE agent_conversations
   SET human_handoff_at = NOW(), ai_control_epoch = ai_control_epoch + 1
   WHERE id = '<agent_conv_id>';
   ```

**Asserts:**
- IA enviou no máximo 1 mensagem (ou 0); send-guard abortou as próximas.
- `agent_runs.status` pode ser `'succeeded'` (run completou, só não enviou).
- `agent_steps` mostra `guardrail` com `reason: "human_handoff_active"` OU outbound
  abortado.
- SQL: `provider_mode = 'responses'`.

## Cenário 8 (bônus) — Tester live

**Objetivo:** Tester continua funcionando com gate_warnings + cost real em Responses.

**Como rodar:**
1. UI → Tester.
2. Conferir o painel direito: se org tem `native_agent_enabled = false`, banner amarelo
   "feature_flag_off" aparece.
3. Run uma conversa simples.
4. Conferir custo na UI: deve mostrar `cost_usd_cents > 0`.

**Asserts:**
- Banner gate_warnings funciona.
- Cost > 0 (não 0 hardcoded antigo).
- SQL: `provider_mode = 'responses'` no run com `is_test = TRUE`.

## Checklist final

Antes de liberar PR 6 (flip default em prod):

- [ ] Cenário 1 — Conversa simples
- [ ] Cenário 2 — RAG
- [ ] Cenário 3 — `emit_event`
- [ ] Cenário 4 — `move_pipeline_stage`
- [ ] Cenário 5 — `trigger_notification`
- [ ] Cenário 6 — Erro de tool
- [ ] Cenário 7 — Handoff mid-run
- [ ] Cenário 8 (bônus) — Tester

**Comparação cost/latência:**

```sql
-- Compara últimas 24h entre os 2 modos
SELECT
  COALESCE(provider_mode, 'unknown') AS mode,
  COUNT(*) AS runs,
  AVG(duration_ms) AS avg_duration_ms,
  AVG(tokens_input + tokens_output) AS avg_tokens,
  AVG(cost_usd_cents) / 100.0 AS avg_usd
FROM agent_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND is_test = FALSE
GROUP BY COALESCE(provider_mode, 'unknown')
ORDER BY mode;
```

Esperado: `responses` ≤ `chat` em duration (ou comparável) e tokens (Responses é mais
preciso no reasoning budget pra gpt-5*).

## Se falhar

Reverter staging:
```
AI_AGENT_OPENAI_API=chat
```
ou deletar a variável (default cai pra chat).

Restart do app. Próximo run usa Chat Completions de novo. Sem rollback de DB necessário
— `provider_mode` continua válido pra runs anteriores.

Abre issue com:
- Cenário que falhou
- SQL do run problemático (id, error_msg, status, provider_mode)
- Print da resposta IA vs esperado
- Comparar mesmo prompt em modo `chat` pra ver se é regressão de modo ou bug de
  prompt/preset.

## Refs

- Plano: [11-openai-responses-migration.md](./11-openai-responses-migration.md)
- Adapter: `apps/crm/src/lib/ai-agent/flow/openai-runtime.ts`
- Wire no runner: `apps/crm/src/lib/ai-agent/flow/runner.ts`
- Feature flag: `apps/crm/src/lib/ai-agent/flow/openai-api-mode.ts`
- Observability queries: [09-observability.md § Comparing chat vs responses](./09-observability.md)
