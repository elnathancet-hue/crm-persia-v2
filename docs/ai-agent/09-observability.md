# 09 — Observability

> Log codes, métricas e SQL pra dashboards. Quando algo dá errado em prod, comece aqui.

## Onde os logs vão

`logError(code, context)` em `apps/crm/src/lib/observability.ts`. Em prod:

1. `console.error(prefixed)` — visível em logs do Next.js (EasyPanel).
2. Forward pra Sentry (quando `SENTRY_DSN` setado).
3. Eventualmente: opentelemetry export (não setup atual).

`errorMessage(err)` extrai mensagem de Error|string|unknown — usado pra serializar
exceptions em logs estruturados.

## Log codes (catálogo)

Ordenados por área do código. Use Cmd+F pra buscar.

### Webhook → executor

| Code | Quando | Severidade |
| --- | --- | --- |
| `incoming_pipeline_dedup_hit` | Msg duplicada por whatsapp_msg_id | info |
| `incoming_pipeline_n8n_timeout` | Fetch n8n abortou após 8s (PR #372) | warn |
| `incoming_pipeline_n8n_call_failed` | Erro genérico no fetch n8n (rede/auth/payload) | error |
| `incoming_pipeline_n8n_http_error` | n8n retornou !ok | warn |
| `incoming_pipeline_context_load_failed` | Falha ao carregar pipeline/stage do lead | warn |
| `incoming_pipeline_openai_call_failed` | Erro no fallback OpenAI | error |

### Native agent enqueue

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_enqueue_skipped_flag_off` | Feature flag desligada — fallback pro pipeline legacy | info |
| `ai_agent_enqueue_skipped_no_active_config` | Sem agent ativo na org | info |
| `ai_agent_enqueue_skipped_paused` | Conversation com `human_handoff_at` setado | info |
| `ai_agent_enqueue_skipped_after_hours` | Fora do horário comercial — após enviar after-hours msg (ou cooldown ativo) | info |
| `ai_agent_enqueue_skipped_paused_by_keyword` | Lead mandou pause keyword | info |
| `ai_agent_resumed_by_keyword` | Lead mandou resume keyword + reativa IA | info |
| `ai_agent_lead_insert_conflict` | 23505 catch + SELECT fallback no lead INSERT (PR #355) | info |
| `ai_agent_conversation_insert_conflict` | 23505 catch em agent_conversations (PR #355) | info |
| `ai_agent_paused_by_keyword` | Match em pause keyword | info |

### Flow runtime

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_flow_run_started` | Início de runFlow | debug |
| `ai_agent_flow_run_succeeded` | Fim normal | info |
| `ai_agent_flow_run_failed` | Erro fatal (sem entry node, config not found, etc) | error |
| `ai_agent_flow_run_max_iterations` | Loop bateu max sem resposta final | warn |
| `ai_agent_flow_run_send_guard_blocked` | assertCanAct falhou — outbound abortado mid-flight | warn |
| `ai_agent_flow_run_cost_ceiling_hit` | assertWithinCostLimits estourou | warn |
| `ai_agent_summarization_succeeded` | Resumo gerado e gravado em history_summary | info |
| `ai_agent_summarization_failed` | gpt-4o-mini call falhou | warn |

### Knowledge inject

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_knowledge_inject_failed` | Exception fora do esperado | error |
| `ai_agent_knowledge_full_load_failed` | SELECT chunks falhou | error |
| `ai_agent_knowledge_measure_failed` | SELECT pra estimar tokens falhou | error |
| `ai_agent_knowledge_full_exceeded_cap` | Fallback pra rag por hard-cap 16k tokens (PR #371) | warn |

### Voyage / RAG

| Code | Quando | Severidade |
| --- | --- | --- |
| `voyage_embed_failed` | Voyage API erro 4xx/5xx | error |
| `voyage_embed_timeout` | AbortController 60s | warn |
| `voyage_embed_retried` | Retry com backoff | debug |
| `rag_retrieval_no_hits` | top-k retornou vazio (mesmo doc completed na org) | info |

### Tools

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_tool_dispatch_failed` | Tool handler throw | error |
| `ai_agent_tool_unknown_handler` | native_handler slug não está no registry | error |
| `ai_agent_tool_webhook_timeout` | n8n_webhook tool abortou | warn |
| `ai_agent_tool_webhook_allowlist_rejected` | URL não está no allowlist da org | warn |
| `ai_agent_mcp_call_failed` | MCP server erro | error |

### Followups

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_followup_tick_started` | Cron tick rodando | info |
| `ai_agent_followup_dispatched` | Followup enviado | info |
| `ai_agent_followup_dedup_skip` | Já enviado (dedupe via UNIQUE) | debug |
| `ai_agent_followup_send_failed` | provider.sendText falhou pós-INSERT (sem rollback) | warn |

### Templates / Materializer

| Code | Quando | Severidade |
| --- | --- | --- |
| `apply_template_seed_tag_failed` | INSERT em tags falhou (best-effort) | warn |
| `apply_template_seed_agenda_failed` | INSERT em agenda_services falhou | warn |
| `apply_template_seed_template_failed` | INSERT em agent_notification_templates falhou | warn |
| `apply_template_materialize_flow_failed` | INSERT em agent_flows falhou (CRÍTICO — agente sem flow) | error |
| `apply_template_materialize_tool_failed` | INSERT em agent_tools falhou | warn |

### Auditoria geral

| Code | Quando | Severidade |
| --- | --- | --- |
| `ai_agent_dry_run_handler_called` | Handler chamado com dryRun=true (debug) | debug |
| `ai_agent_action_executed` | Action node executou handler | info |
| `ai_agent_action_executed_with_failures` | Auto-action em stage falhou parcialmente | warn |

## SQL pra dashboards

### Volume e custo por org (últimas 24h)

```sql
SELECT
  organization_id,
  COUNT(*) AS total_runs,
  SUM(tokens_input + tokens_output) AS total_tokens,
  SUM(cost_usd_cents) / 100.0 AS total_usd,
  AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_run_seconds
FROM agent_runs
WHERE is_test = FALSE
  AND started_at > NOW() - INTERVAL '24 hours'
GROUP BY organization_id
ORDER BY total_usd DESC;
```

### Top orgs por custo no mês

```sql
SELECT
  o.name,
  SUM(r.cost_usd_cents) / 100.0 AS month_usd,
  COUNT(DISTINCT r.agent_conversation_id) AS unique_conversations,
  COUNT(*) AS total_runs
FROM agent_runs r
JOIN organizations o ON o.id = r.organization_id
WHERE r.is_test = FALSE
  AND r.started_at >= DATE_TRUNC('month', NOW())
GROUP BY o.name
ORDER BY month_usd DESC
LIMIT 20;
```

### Conversas pausadas há muito tempo

```sql
SELECT
  ac.id,
  ac.organization_id,
  l.name AS lead_name,
  ac.human_handoff_at,
  NOW() - ac.human_handoff_at AS paused_for,
  EXTRACT(EPOCH FROM (NOW() - ac.human_handoff_at)) / 3600.0 AS paused_hours
FROM agent_conversations ac
JOIN leads l ON l.id = ac.lead_id
WHERE ac.human_handoff_at IS NOT NULL
  AND ac.human_handoff_at < NOW() - INTERVAL '7 days'
ORDER BY ac.human_handoff_at ASC
LIMIT 50;
```

### Runs falhados nas últimas 24h

```sql
SELECT
  organization_id,
  agent_conversation_id,
  config_id,
  model,
  error,
  started_at
FROM agent_runs
WHERE is_test = FALSE
  AND status = 'failed'
  AND started_at > NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;
```

### Knowledge hit/miss (precisa instrumentar — não default)

```sql
-- Se houver tabela de eventos com event_type='knowledge_lookup'
-- (não implementada hoje; mantém aqui como template)
SELECT
  organization_id,
  COUNT(*) FILTER (WHERE event_data->>'mode' = 'full') AS full_lookups,
  COUNT(*) FILTER (WHERE event_data->>'mode' = 'rag') AS rag_lookups,
  COUNT(*) FILTER (WHERE event_data->>'fallback' = 'true') AS hard_cap_fallbacks
FROM agent_events
WHERE event_type = 'knowledge_lookup'
GROUP BY organization_id;
```

### Tool errors por tipo

```sql
SELECT
  native_handler,
  COUNT(*) AS error_count
FROM agent_steps
WHERE step_type = 'tool'
  AND error IS NOT NULL
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY native_handler
ORDER BY error_count DESC;
```

### Followups disparados

```sql
SELECT
  af.name,
  f.config_id,
  COUNT(*) AS fired,
  MIN(afr.fired_at) AS first,
  MAX(afr.fired_at) AS last
FROM agent_followup_runs afr
JOIN agent_followups af ON af.id = afr.followup_id
WHERE afr.fired_at > NOW() - INTERVAL '7 days'
GROUP BY af.name, af.config_id
ORDER BY fired DESC;
```

### Conversas duplicadas (deveria ser ZERO pós migration 071)

```sql
SELECT
  organization_id,
  lead_id,
  crm_conversation_id,
  COUNT(*) AS dups
FROM agent_conversations
WHERE crm_conversation_id IS NOT NULL
GROUP BY organization_id, lead_id, crm_conversation_id
HAVING COUNT(*) > 1;
```

Se retornar qualquer row, **bug crítico**. Migration 071 deveria impedir.

### After-hours notifications stats

```sql
SELECT
  organization_id,
  COUNT(*) FILTER (WHERE after_hours_notified_at > NOW() - INTERVAL '24 hours') AS notified_24h,
  COUNT(*) FILTER (WHERE after_hours_notified_at > NOW() - INTERVAL '7 days') AS notified_7d
FROM agent_conversations
GROUP BY organization_id;
```

### Token / cost per model

```sql
SELECT
  model,
  COUNT(*) AS runs,
  SUM(tokens_input) AS input_tokens,
  SUM(tokens_output) AS output_tokens,
  SUM(cost_usd_cents) / 100.0 AS total_usd,
  AVG(cost_usd_cents / 100.0) AS avg_usd_per_run
FROM agent_runs
WHERE is_test = FALSE
  AND started_at > NOW() - INTERVAL '24 hours'
GROUP BY model
ORDER BY total_usd DESC;
```

### Hard-cap knowledge fallback (PR #371)

```sql
-- Precisa instrumentar logs em tabela. Hoje só via console.error.
-- Alternativa: scrape do log do EasyPanel filtrando pelo code.
```

## Métricas chave (sugestão)

| Métrica | Threshold "ok" | Threshold "alerta" |
| --- | --- | --- |
| `agent_runs.cost_usd_cents` p99 / dia | <300 (US$3) | >1000 (US$10) |
| `agent_runs.duration_seconds` p99 | <30s | >60s |
| `agent_runs.status='failed'` rate | <5% | >10% |
| `incoming_pipeline_n8n_timeout` count / hora | <10 | >50 (= time pra fila async) |
| Conversas pausadas >7d | <100 / org | crescimento mês a mês |
| `ai_agent_knowledge_full_exceeded_cap` count / dia | <1 | >5 (= cliente precisa rag manual) |

## Trace de uma mensagem

Quando cliente reclama "msg X não foi respondida", siga:

1. **`messages` table**: a msg do lead chegou? Filtrar por `lead_id + content`.
2. **`webhook_events` table**: webhook chegou? Filtrar por phone_number_id +
   timestamp.
3. **`agent_conversations`**: existe row pra (org, lead, crm_conversation_id)?
   `human_handoff_at` setado?
4. **`pending_messages`**: msg foi enfileirada? `flushed_at` é NULL = ainda no buffer.
5. **`agent_runs`**: rodou? `status='succeeded'` ou `'failed'`? `error`?
6. **`agent_steps`**: filtros `run_id`. Cada step com `input` + `output` + `error`.
7. **`messages` outgoing**: IA tentou enviar? `sender='ai'` + filtros conversation_id.
8. **Logs do servidor**: search por `lead_id` ou `agent_conversation_id` no EasyPanel.

Padrão de troubleshoot dispatch em [10-runbooks.md](./10-runbooks.md).

## Performance tuning

### Queries que tomam mais tempo

1. `loadConversationHistory` — SELECT em `messages` ordered DESC limit N. Index em
   `(conversation_id, created_at DESC)` ajuda.
2. `buildFullModeBlock` SELECT — `agent_knowledge_chunks` com JOIN em sources. Index
   composite `(source_id, chunk_index)` (migration 070).
3. RPC `match_agent_knowledge_chunks` — pgvector. ivfflat já indexado, mas pra orgs
   gigantes considerar HNSW.
4. `tryEnqueueForNativeAgent` — múltiplas queries serializadas. Hot path. Maior parte é
   I/O DB, não compute.

### Cache hits a buscar

- Knowledge cache (`knowledge-cache.ts`): in-memory, sources_hash. Hit ratio observável
  via log (não default).
- Catálogos (`tool-catalogs.ts`): hoje SEM cache, recarrega a cada turno. Candidato pra
  cache se virar problema.

## Pontos de extensão

### Eventos estruturados (não default)

Hoje logs vão pra `console.error`. Pra forward pra Sentry/OpenTelemetry/Datadog:

1. Implementar `logEvent(eventType, eventData)` em `lib/observability.ts`.
2. INSERT em `agent_events` table (criar via migration).
3. Worker batch envia pra destino externo.

Hoje não temos demand crítica — `console.error` + grep do EasyPanel cobre.

### Dashboard de prod

Sugestão: Grafana + Postgres exporter. Queries acima viram panels. Não setup atual.

Alternativa: Supabase Dashboard já mostra graphs básicos por table. Pra metrics customizadas,
SQL view materializada com refresh */15min.

## Cross-refs

- Runbooks específicos por sintoma: [10-runbooks.md](./10-runbooks.md)
- Schema de tabelas mencionadas: [02-data-model.md](./02-data-model.md)
