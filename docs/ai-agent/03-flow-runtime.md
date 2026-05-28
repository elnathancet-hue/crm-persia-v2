# 03 — Flow runtime

> Como `runFlow` executa um turno. Inclui visitor dos nós, AI loop, summarization,
> send-guard, dry_run e cost ceiling.

## Entry point: `runFlow`

`apps/crm/src/lib/ai-agent/flow/runner.ts`.

```ts
async function runFlow(
  db: AgentDb,
  ctx: FlowRunContext,
  startNodeId: string | null,
): Promise<FlowRunResult>
```

`startNodeId` é o `current_node_id` salvo da última execução (`agent_conversations.current_node_id`).
Quando `null` → começa do entry node.

### `FlowRunContext` (resumo)

| Campo | Tipo | Notas |
| --- | --- | --- |
| `flow` | LoadedFlow | Output de `loadFlowByConfigId()`. |
| `agentConfigId` | string | |
| `organizationId` | string | |
| `crmConversationId` | string \| null | |
| `agentConversationId` | string | |
| `leadId` | string | |
| `inboundMessage` | `{ text, received_at }` | Vazio em CRM event simulado. |
| `provider` | WhatsAppProvider \| FlowProviderStub | Stub no Tester. |
| `dryRun` | boolean | Tester=true. |
| `flowConfig` | FlowConfig | Snapshot pra evitar re-fetch. |
| `agentConfig?` | AgentConfig | Opcional, injetado em PR-5 pra handlers. |
| `agentConversation?` | AgentConversation | Idem. |
| `sendGuard?` | AiOutboundSendGuard | Helper pra checar `canAiSendNow`. |

### `FlowRunResult` (resumo)

```ts
{
  ending_node_id: string | null;     // persistido em current_node_id
  assistant_reply: string;            // concat de todos os sends
  tool_calls_succeeded: number;
  tool_calls_failed: number;
  hit_max_iterations: boolean;
  tokens_input: number;               // soma de TODAS as iterações ping-pong
  tokens_output: number;
  fatal_error?: string;
  events: TesterRunEvent[];           // só no Tester (stub captura)
}
```

## Tipos de nó

### 1. `entry`

Visitor: `visitEntryNode`. Apenas marca o run como "começou daqui" e segue pra próxima edge.
Validação live em `flow-validation.ts` checa que existe exatamente 1 entry node por flow.

`entry.data.trigger`:

- `"conversation_started"` (default): qualquer msg do lead dispara.
- `"pipeline_stage_entered"`: hook do CRM. Roda via `simulateCrmEvent` no Tester.
- `"segment_match"`: idem.
- `"keyword_match"`: AI runner checa o inbound text contra `entry.data.config.keywords[]`
  ANTES de gastar OpenAI. Útil pra "redirecionar fluxo se lead disse 'preço'".

### 2. `ai_agent`

O nó principal. Roda o loop LLM.

Visitor: `visitAiAgentNode`. Pseudo-código:

```ts
function visitAiAgentNode(ctx, node) {
  const messages = await buildMessages(ctx, node);
    // - system: agentConfig.system_prompt + node.data.instructions
    // - knowledge block (buildKnowledgeBlock)
    // - history summary se houver
    // - last N messages (history)
    // - inbound atual

  const tools = buildToolsForNode(ctx.flow, node);
    // só tools listadas em node.data.enabled_tools (ou enabled_tools global do flow)

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    assertWithinCostLimits(ctx);                // intra-loop check (PR-2)
    assertCanAct(ctx);                           // send-guard via epoch (PR-3)

    const response = await openai.chat.completions.create({
      model: ctx.agentConfig.model,
      messages,
      tools,
      tool_choice: "auto",
      max_completion_tokens: 4096,               // PR-2: cobre reasoning de gpt-5
    });

    result.tokens_input += response.usage.prompt_tokens;
    result.tokens_output += response.usage.completion_tokens;

    const choice = response.choices[0];

    if (choice.finish_reason === "tool_calls") {
      for (const call of choice.message.tool_calls) {
        const handlerCtx = buildNativeHandlerContext(ctx, ...);  // PR-5
        const output = await dispatch(call, handlerCtx);          // native / mcp / n8n
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });

        // Edge nomeada? emit_event move o cursor pro próximo nó imediatamente
        if (call.function.name === "emit_event" && output.eventName) {
          return { proceedToEdge: output.eventName };
        }
      }
      continue;  // próxima iteração do loop
    }

    // finish_reason !== "tool_calls" → temos resposta final
    const reply = extractText(choice.message) || HANDOFF_REPLY;

    if (!ctx.dryRun || ctx.provider) {
      await sendAssistantReply(ctx, reply);     // split + setTyping + delay
    }

    return { proceedToDefaultEdge: true, reply };
  }

  // bateu max_iterations
  return { hit_max_iterations: true, proceedToDefaultEdge: true };
}
```

`MAX_ITERATIONS` default = 10 (em `agent_configs.guardrails.max_iterations`).

### 3. `action`

Roda 1 handler nativo isolado, sem LLM. Útil pra "ao chegar aqui, manda mídia X" sem
incluir no system prompt.

Visitor: `visitActionNode`. Resolve handler via `flowActionTypeToNativeHandler(node.data.action_type)`,
chama com `node.data.action_config` como input. Mesmo wiring de `buildNativeHandlerContext`.

Tipos suportados (mapeamento em `packages/shared/src/ai-agent/flow.ts`):

- `"send_text"`, `"send_media"`, `"add_tag"`, `"remove_tag"`, `"move_pipeline_stage"`,
  `"transfer_to_user"`, `"transfer_to_agent"`, `"stop_agent"`, `"trigger_notification"`,
  `"create_appointment"`, `"set_lead_custom_field"`.

Terminal nodes (sem edge de saída) param o flow e setam `current_node_id = null`. PR-4 garante
isso pra evitar conversation "presa" no DB.

### 4. `condition`

Branching baseado em variáveis ou lead state. Sem LLM.

Visitor: `visitConditionNode`. Avalia `node.data.condition` contra contexto e escolhe edge
de saída (`true_label` / `false_label`).

Tipos:

```ts
type Condition =
  | { type: "variable_match"; variable: string; operator: "eq" | "ne" | "contains"; value: string }
  | { type: "lead_status_match"; status: string }
  | { type: "lead_tag_present"; tag: string }
  | { type: "lead_in_stage"; stage_id: string };
```

## AI loop em detalhe

### `buildMessages`

Ordem (do system pra baixo, system primeiro):

1. `agentConfig.system_prompt`.
2. `node.data.instructions` (se preencher).
3. **Knowledge block** (`buildKnowledgeBlock`) — só se há docs indexados.
4. **History summary** (`history_summary` se setado).
5. **Last N messages** (default N=4, configurável via `context_summary_recent_messages`).
   Carregadas de `messages` table filtrando por conversation_id, excluindo soft-deleted.
6. **Inbound atual** (`ctx.inboundMessage.text`).

Helpers: `loadConversationHistory()` em `apps/crm/src/lib/ai-agent/summarization.ts`.

### Knowledge inject

Detalhe em [05-knowledge.md](./05-knowledge.md). Resumo:

- Carrega `agent_configs.knowledge_mode` (default `"full"`).
- Modo `"auto"`: mede tokens estimados; <6000 → full, >=6000 → rag.
- Hard-cap 16000 tokens: força fallback pra rag mesmo em `"full"` manual.
- Cache por `(config_id, sources_hash)` (PR #355\*).
- Falha silenciosa retorna `null` — IA roda sem contexto.

### Summarization

`maybeRunConversationSummarization()` é chamado pós-AI loop quando:

- `history_summary_run_count >= context_summary_turn_threshold` (default 6) OU
- Soma de tokens das últimas N msgs > `context_summary_token_threshold` (default 4000).

Roda 1 call extra com `gpt-4o-mini` resumindo as msgs antigas e gravando em
`history_summary`. Limpa o counter (`history_summary_run_count = 0`).

Custo: ~$0.01 por summarize. Por isso só roda no threshold, não a cada turno.

Helper: `runConversationSummarization()` em `apps/crm/src/lib/ai-agent/summarization.ts`.

### Cost ceiling

`assertWithinCostLimits(ctx)` em 2 pontos:

1. Antes de `runFlow` em `executeDebouncedBatch`.
2. Dentro do AI loop, antes de cada `openai.chat.completions.create`.

Lê `agent_cost_limits` da org. Sem row → sem limite (no-op). Com row, soma usage de hoje
+ mês e compara. Estoura → lança erro que vira `skipped: "cost_ceiling"` retornado pro
caller (debounce worker registra mas não falha o run de outras conversations).

Pontos:

- Loop intra-AI é importante: chamadas em sequência podem cumulativamente passar do cap
  mesmo que cada uma esteja sob o limite individualmente.
- Tester ignora cost limits (por design — admin quer testar mesmo perto do cap).

## Send-guard

`apps/crm/src/lib/ai-agent/send-guard.ts`.

### `assertCanAct(ctx)`

Checa antes de qualquer outbound:

1. `ai_control_epoch` do `agent_conversations` ainda é o mesmo do início do run?
2. `human_handoff_at` ainda é NULL?
3. `dryRun=false` E `provider` é real (não stub)?

Se qualquer falhar, aborta o send. Run continua processando (não erro fatal) mas não
envia. Útil pra:

- Operator humano respondeu mid-run → epoch bumpou → IA não interrompe.
- `transfer_to_user` no meio do run → epoch bumpou → IA para de enviar.
- Pause keyword detectado em concurrent webhook → `human_handoff_at` setado → IA para.

### Por que NÃO bloquear antes do AI loop

Considerado: checar send-guard no início do turno e abortar se humano está respondendo.
Rejeitado: humano pode estar respondendo numa msg de 5min atrás; bloquear IA por toda a
duration do handoff seria UX pior. Solução: deixar a IA processar; só não envia se o estado
mudar mid-flight.

Trade-off: tokens "perdidos" (gerou resposta mas não enviou). Aceitável — barato vs.
complexidade de lock distribuído.

## Followups runtime

`apps/crm/src/lib/ai-agent/followups/tick.ts`. Cron via pg_cron */10min (migration 051).

Pipeline:

1. Carrega todos `agent_followups` com `is_enabled=true` (cross-org, service_role).
2. Pra cada followup: query `agent_conversations` onde `last_interaction_at < now() -
   delay_hours` AND `human_handoff_at IS NULL` AND `config_id = followup.config_id`.
3. Filtra conversas já em `agent_followup_runs(followup_id, conversation_id)` (dedupe).
4. **INSERT em `agent_followup_runs` ANTES do `provider.sendText`** — UNIQUE constraint
   garante idempotency mesmo com ticks concorrentes.
5. Renderiza `template.body_template` com vars (`{{lead_name}}`, `{{agent_name}}`,
   `{{wa_link}}`, `{{lead_phone}}`) e envia pra `lead.phone`.
6. Falha de `sendText` pós-INSERT NÃO faz rollback — preferimos não retentar
   automaticamente (evita spam quando provider flaky).

Limite por tick: `MAX_PROCESSED_PER_TICK = 200`. Em escala alta, configurar tick mais
frequente (a cada 5min) em vez de aumentar o cap.

Auth: endpoint `/api/ai-agent/followups/tick` aceita `PERSIA_SCHEDULER_SECRET` OU
`CRM_API_SECRET` no header.

### Limitações conhecidas

- **Sem business_hours check**: pode disparar às 3am se a janela bate. Cliente
  configura delays compatíveis (48h em vez de 24h).
- **`last_interaction_at` em qualquer atividade**: se IA respondeu há pouco, relógio
  reinicia. Aceitável pro caso "X horas sem resposta", refinamento futuro = campo separado
  `last_inbound_message_at`.
- **Cleanup**: `agent_followup_runs` não TTL'd. Migration 027 sugere >90d via job manual.

## Dry-run

`ctx.dryRun = true` ativado pelo Tester. Convenções:

- **Handlers nativos**: checam `ctx.dryRun` e retornam shape simulado sem escrever DB.
- **Provider**: stub (`tester-provider.ts`) captura `sendText/setTyping/sendMedia` em
  memória. Real provider nunca chamado.
- **Tools n8n_webhook**: webhook-caller respeita dry_run? **Sim** (PR-5). Returns
  `{ simulated: true }`.
- **Tools mcp**: idem. MCP client retorna `{ simulated: true }`.
- **Knowledge**: sempre roda real (Voyage call etc) — Tester quer ver o efeito.
- **DB writes "internas"** (agent_runs, agent_steps): SIM rodam — Tester deixa rastro
  com `is_test=true`.

## Persistência pós-run

Ao fim do `runFlow`:

1. `persistCurrentNode(db, orgId, agentConvId, result.ending_node_id)` — UPDATE
   `agent_conversations.current_node_id`.
2. `finishRun(runId, status, tokens_input, tokens_output, cost_cents)` — UPDATE
   `agent_runs`.
3. `maybeRunConversationSummarization()` — se thresholds bateram.
4. `bumpLastInteractionAt(agentConvId)` — bump pra followups.

## Erros e recovery

| Erro | Como o runner trata |
| --- | --- |
| `fatal_error: "no entry node"` | Aborta. UI exibe via Tester. Cliente edita canvas. |
| `fatal_error: "config not found"` | Aborta. Geralmente race com delete de agente. |
| `fatal_error: "flow not found"` | Aborta. Agente sem flow configurado (template não aplicou). |
| OpenAI 429 / 500 | Retry com backoff (3x). Falha final = run status=failed. |
| Tool handler exception | Captura no try/catch do dispatch. Loga `agent_steps.error`. Loop continua na próxima iteração. |
| max_iterations atingido | Retorna `hit_max_iterations=true`. Cliente vê via Tester. |
| `send-guard` falhou | Run completa mas sem outbound. Lead não recebe. Status: succeeded. |
| Cost ceiling | Skip total. Run não criado. |

## Pontos de extensão

- **Novo tipo de nó**: implementar visitor, adicionar ao union em `flow.ts`, atualizar
  validator e `NodeConfigSheet`.
- **Novo limit/guardrail**: helpers em `cost-limits.ts` ou `rate-limits.ts`. Check no
  AI loop OU em `executeDebouncedBatch`.
- **Outro tipo de event** (emit_event nomes): cliente já configura via UI. Runner aceita
  qualquer string em `eventName` — só matching com edge label.

## Refs

- Tools dispatch + handler context: [04-tools-and-handlers.md](./04-tools-and-handlers.md)
- Knowledge inject: [05-knowledge.md](./05-knowledge.md)
- Send-guard origem: [06-humanization.md § Pause/Resume](./06-humanization.md)
- Tester wiring: [07-tester-and-canvas.md](./07-tester-and-canvas.md)
- Log codes: [09-observability.md](./09-observability.md)
