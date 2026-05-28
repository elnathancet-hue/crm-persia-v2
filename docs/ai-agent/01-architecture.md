# 01 — Arquitetura

> **Pré-requisito:** [README](./README.md) (mapa de docs).

## TL;DR

O AI Agent é um pipeline em 5 fases que transforma uma mensagem inbound do WhatsApp
em uma resposta gerada por LLM, com gates de humanização, debounce, knowledge inject,
tool execution e send-guard.

```
Webhook → tryEnqueueForNativeAgent → debounce → flushReadyConversations
       → runFlow → outbound (WhatsApp)
```

Tudo numa única `agent_conversations` row sticky por `(org, lead, crm_conversation_id)`.

## Camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│ EXTERNO                                                             │
│   WhatsApp (UAZAPI ou Meta Cloud)                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ POST webhook
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ EDGE (Next.js route handlers)                                       │
│   apps/crm/src/app/api/whatsapp/webhook/route.ts          (UAZAPI)  │
│   apps/crm/src/app/api/whatsapp/webhook/meta/[id]/route.ts (Meta)   │
│   - Valida HMAC (Meta) / raw body                                   │
│   - Dedup por message_id (whatsapp_msg_id)                          │
│   - Cria Supabase client com SERVICE_ROLE_KEY                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ENTRY POINT                                                         │
│   tryEnqueueForNativeAgent  (lib/ai-agent/executor.ts)              │
│   - Feature flag: native_agent_enabled?                             │
│   - loadActiveAgentConfig                                           │
│   - ensureCrmContext (cria/reusa lead + conversation)               │
│   - pickAgentForConversation (entry conditions + stickiness)        │
│   - Humanization gates: pause/resume keyword, business hours        │
│   - Enqueue na pending_messages (debounce ~10s)                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DEBOUNCE WORKER                                                     │
│   flushReadyConversations  (lib/ai-agent/debounce.ts)               │
│   - Cron / expedite (Tester)                                        │
│   - claim_agent_conversation_flush RPC                              │
│   - executeDebouncedBatch                                           │
│   - assertWithinCostLimits (org level)                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FLOW RUNTIME                                                        │
│   runFlow  (lib/ai-agent/flow/runner.ts)                            │
│   - loadFlowByConfigId                                              │
│   - Inicia do current_node_id OU entry node                         │
│   - Visit cada nó: entry / ai_agent / action / condition            │
│   - AI loop: openai.chat.completions.create com tools               │
│   - Knowledge inject por turno (buildKnowledgeBlock + cache)        │
│   - History + summarization                                         │
│   - Tool dispatch: native / mcp / n8n_webhook                       │
│   - Send-guard (assertCanAct) antes de qualquer outbound            │
│   - Persiste current_node_id + history_summary + token totals       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ OUTBOUND                                                            │
│   provider.sendText / sendMedia / setTyping                         │
│   - Realtime provider (prod): UazapiAdapter / MetaCloudAdapter      │
│   - Tester provider: captura em memória (não chama WhatsApp)        │
│   - Split de mensagens longas (humanization)                        │
│   - Marca incoming msg como `read`                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Decisões arquiteturais

### Por que flow runtime substituiu o legacy stages

**Legacy (até migration 049):** `agent_configs.behavior_mode` enum
(`'free_message' | 'stages' | 'actions'`) controlava comportamento. Stages eram um pool
de instruções; runtime decidia qual aplicar via heurística da `transfer_to_stage`. Auto-actions
ficavam em `agent_stages.action_config.auto_actions[]` por stage.

**Problemas:**

- Cliente não enxergava o fluxo todo. Stages eram lista vertical, sem ramificação.
- Adicionar "ação se ela disser X" exigia stage nova só pra isso.
- `behavior_mode` confundia: o que muda exatamente entre os 3 modos? Resposta variava
  por handler.
- Routing era opaco: por que escolheu agente A e não B?

**Pivot (migration 054, PR-FLOW-PIVOT):** modelo visual com nodes + edges via `@xyflow/react`.

- `entry` node: trigger (conversation_started, stage_entered, segment_match, keyword_match).
- `ai_agent` node: configura instructions, model, tools habilitadas. Loop LLM acontece aqui.
- `action` node: 1 handler nativo isolado (sem LLM). Útil pra "ao chegar aqui, manda mídia X".
- `condition` node: rota baseada em variables / lead status.
- Edges nomeadas viram branches: AI node emite `emit_event(name="qualified")` →
  runner segue a edge `label="qualified"`.

**Conseqüências:**

- `agent_stages` tables permanecem (no DROP) por retrocompat, mas runner não lê.
- Cliente desenha o fluxo no Canvas. Persistido em `agent_flows.config` JSONB.
- CAS optimistic locking (PR #359): `agent_flows.version` impede 2 admins sobrescreverem
  edições.

Detalhe em [03-flow-runtime.md](./03-flow-runtime.md).

### Por que send-guard via epoch e não lock

Alternativa considerada: lock pessimista `SELECT ... FOR UPDATE` em
`agent_conversations`. Rejeitada porque:

- AI loop dura 5-30s. Lock por esse tempo trava outros writers (operator respondendo
  manualmente fica esperando).
- Lock distribuído cross-region complica.

Escolha: epoch monotônico + check no envio. `agent_conversations.ai_control_epoch`
incrementa toda vez que ownership muda (transfer, handoff, retomada). Runner snapshota
o epoch no início; antes de cada `provider.sendText`, valida que o epoch ainda é o mesmo.
Se mudou, aborta o send mid-flow.

Trade-off: AI pode processar tokens em vão (gerou resposta mas não enviou). Aceitável
pra evitar bloqueio de UI.

Detalhe em [03-flow-runtime.md § Send-guard](./03-flow-runtime.md).

### Por que debounce de 10s

Antes: cada msg do lead disparava um run próprio. Lead mandando 3 frases ("oi", "tá", "aí?")
gerava 3 calls OpenAI sequenciais. UX da IA ficava "robótica" — respondia cada msg em
isolamento.

Depois (migration 019): `pending_messages` buffer ~10s. Janela acumula msgs antes do run.
Runner concatena no inbound block. AI agora responde "oi, sim estou aqui!" em vez de 3
respostas separadas.

Configurável por agente em `agent_configs.debounce_window_ms`. Default 10000, range 0-60000.

Tester pode `expedite_debounce: true` pra forçar flush imediato (UX de teste exige resposta
sem espera).

RPCs em `apps/crm/supabase/migrations/019_ai_agent_debounce.sql`:

- `enqueue_pending_message(...)`: INSERT em pending_messages + bump `next_flush_at`.
- `claim_agent_conversation_flush(...)`: lock cooperativo pra worker pegar conversation.
- `complete_agent_conversation_flush(...)`: marca pending_messages flushed.
- `release_agent_conversation_flush(...)`: libera lock sem completar (rollback).

`GRANT EXECUTE` apenas pra `service_role`. **Importante**: Tester precisa de service_role
client por causa disso (PR #252).

### Por que UNIQUE partial em `agent_conversations`

Migration 071. Antes, 2 webhooks paralelos do mesmo lead podiam criar 2 rows. Sintoma:
respostas duplicadas pro lead. Causa: race entre `SELECT existing` e `INSERT new`.

Solução: index UNIQUE partial em `(organization_id, lead_id, crm_conversation_id) WHERE
crm_conversation_id IS NOT NULL`. INSERT racing → 23505 num deles → catch + SELECT
fallback.

Cleanup de duplicatas pré-migration: feito via `agent_conversations_merge_log` (migration
070) com dry-run primeiro. DELETE manual após revisão. Documentado em [02-data-model.md
§ Migrations](./02-data-model.md).

### Por que best-effort em knowledge inject

`buildKnowledgeBlock` retorna `null` em qualquer falha (RLS, Voyage API caiu, schema
mismatch). Princípio: IA responder sem contexto **>** IA não responder.

Falha visível via log estruturado `ai_agent_knowledge_inject_failed`. Admin enxerga em
dashboards e age. Mas o lead recebe resposta.

Mesmo princípio em business hours (`isWithinBusinessHours` retorna `true` em tz inválida),
catálogos de tools (loader silencioso quando schema falha) e seed de templates (`console.error`
mas segue).

Trade-off: cliente novo numa org com schema desatualizado pode receber resposta sem
knowledge — UX degradada, não quebrada.

## Pipeline legacy (sem feature flag)

Quando `organizations.settings.features.native_agent_enabled = false`, o webhook cai pro
fallback em `apps/crm/src/lib/whatsapp/incoming-pipeline.ts`:

```
processIncomingMessage
  ├─ dedup whatsapp_msg_id
  ├─ find/create lead + lead_activities + onNewLead flow
  ├─ flows.onKeyword (early-return se match)
  ├─ find/create conversation + bump last_message_at
  ├─ insert message + dispatchWebhook(message.received)
  └─ if assigned_to === 'ai':
       ├─ MODE 1: n8n webhook (com timeout 8s + AbortController, PR #372)
       │    └─ split + insert messages + provider.sendText + markAsRead
       └─ MODE 2 (fallback): OpenAI direto
            └─ ai_assistants table com prompt configurado
```

A escolha entre native_agent e legacy pipeline é por org. Migração gradual: ativa
`native_agent_enabled` em org piloto, observa, expande.

## Pontos de extensão

- **Novo trigger de entry node**: atualizar `flow-validation.ts` + `simulateCrmEvent`
  em `tester.ts`. Adicionar caso no `runFlow` que decide qual entry node disparar.
- **Novo tipo de node**: estender `FlowNode` union em `packages/shared/src/ai-agent/flow.ts`.
  Implementar visitor em `runner.ts`. Atualizar `NodeConfigSheet.tsx` com form.
- **Novo handler nativo**: 5 passos detalhados em
  [INVARIANTS § 1.2](./INVARIANTS.md#12-native_handlers-array-é-a-única-fonte-da-verdade-pros-handlers).
- **Novo tool execution mode**: `ToolExecutionMode` em types.ts já aceita `"native" |
  "n8n_webhook" | "mcp"`. Adicionar exige atualizar 4 lugares (ver
  [INVARIANTS § 1.3](./INVARIANTS.md#13-toolexecutionmode-agora-aceita-mcp-pr-363)).

## Referências cruzadas

- Dados: [02-data-model.md](./02-data-model.md)
- Runner detalhado: [03-flow-runtime.md](./03-flow-runtime.md)
- Tools: [04-tools-and-handlers.md](./04-tools-and-handlers.md)
- Knowledge: [05-knowledge.md](./05-knowledge.md)
- Humanização: [06-humanization.md](./06-humanization.md)
