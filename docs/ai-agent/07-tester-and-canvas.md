# 07 — Tester e FlowCanvas

> Como `testAgentLive` executa contra o flow real com gate_warnings + cost real. Como
> FlowCanvas salva com CAS + preview impact. Como NodeConfigSheet valida.

## Tester

### Server actions

`apps/crm/src/actions/ai-agent/tester.ts`:

| Action | O que faz |
| --- | --- |
| `testAgentLive(req)` | Roda 1 turno do flow contra lead Tester sintético. Replica prod. |
| `simulateCrmEvent(req)` | Dispara entry node de tipo `pipeline_stage_entered` ou `segment_match` com inbound vazio. |
| `testAgent(req)` | Wrapper legado single-shot. Chama `testAgentLive` e adapta shape. |
| `resetTesterConversation()` | Apaga `agent_conversations` do lead Tester (zera state). |

### `testAgentLive` pipeline

```
1. requireAgentRole("agent")
2. Load agent_config (status + model + humanization_config)
3. Load flow via loadFlowByConfigId
4. collectGateWarnings(db, orgId, status, humanization)     ← PR #370
5. ensureTesterContext (cria lead Tester se não existe)
6. createTesterProvider (stub captura events em memória)
7. Build FlowRunContext com dryRun=true
8. runFlow(db, ctx, tester.currentNodeId)
9. persistCurrentNode (mesmo se aborted, pra debug)
10. Map FlowRunEvent → TesterEvent (subset UI-visível)
11. Calcula cost real:
    tokens_total = result.tokens_input + result.tokens_output
    cost_cents   = calculateCostUsdCents(model, tokens_input, tokens_output)
12. Return TesterLiveResponse
```

### `gate_warnings` (PR #370)

`apps/crm/src/lib/ai-agent/flow/tester-gates.ts` exporta `collectGateWarnings()`.

Tester **NUNCA bloqueia** — apenas avisa "em prod hoje, esse run pularia por X". Banner
amarelo na UI.

3 gates checados:

| Code | Quando | Mensagem (PT-BR) |
| --- | --- | --- |
| `feature_flag_off` | `organizations.settings.features.native_agent_enabled = false` | "Em produção, esse agente não está liberado pra esta organização (feature flag desligada). Tester ignora; prod pularia direto." |
| `agent_not_active` | `agent_configs.status != 'active'` | `Esse agente está em status "<status>". Em produção, só agentes "active" respondem.` |
| `outside_business_hours` | `humanization.business_hours_enabled = true` e `isWithinBusinessHours(now, ...)` falso | "Agora está fora do horário comercial configurado. Em produção, esse agente mandaria a mensagem de fora-do-horário ao invés de rodar o fluxo." |

Falhas de leitura silenciosas (catch swallow) — gate ausente > false alarm.

### Cost real (PR #370)

Antes: `tokens_used: 0, cost_usd_cents: 0` hardcoded. Tester reportava custo zero apesar
de consumir OpenAI real.

Agora: extrai `result.tokens_input/output` do runner + `calculateCostUsdCents(model, ...)`.
`model` vem de `agent_configs.model`. UI mostra o custo real em centavos USD.

### Lead Tester sintético

`apps/crm/src/lib/ai-agent/flow/tester-context.ts`:

```
phone:           "+5500000000XX"  (XX baseado em hash de orgId)
metadata:        { is_test: true }
assigned_to:     primeiro membro ativo da org (pra create_appointment funcionar)
```

Hidden do Kanban/Leads via filter `metadata.is_test IS NOT TRUE` em queries de UI.

`resetTesterConversation()` apaga `agent_conversations` + `pending_messages` + `agent_runs`
do lead Tester. **Mantém** o lead em si (não re-cria a cada teste). 

### Tester provider (stub)

`apps/crm/src/lib/ai-agent/flow/tester-provider.ts`:

```ts
interface FlowProviderStub {
  emit(event: Omit<TesterRunEvent, "ts">): void;
  getEvents(): TesterRunEvent[];
}
```

Implementa `WhatsAppProvider` inteiro mas só captura `sendText/sendMedia/setTyping/setTypingOff`
em memória com timestamps. UI reconstroi timeline cronológica.

### Service_role client

Tester precisa de service_role por causa das RPCs de debounce (migration 019:
`GRANT EXECUTE pending_messages_*` só pra service_role).

Auth check: `requireAgentRole("agent")` valida user antes. Depois usa `db = asAgentDb(supabase)`
onde `supabase` é o client service_role (PR #252).

### `TesterLiveResponse` shape

```ts
interface TesterLiveResponse {
  run_id: string | null;
  events: TesterEvent[];                      // timeline UI
  skipped?: "feature_flag_off" | "no_active_config" | ...;
  steps: TesterStepSummary[];
  next_node_id: string | null;
  tokens_used: number;                        // PR #370: real
  cost_usd_cents: number;                     // PR #370: real
  applied_config: { ... };                    // snapshot humanization
  human_message?: string;                     // PT-BR pra UI
  error?: string;
  gate_warnings?: Array<{                     // PR #370
    code: "feature_flag_off" | "agent_not_active" | "outside_business_hours";
    message: string;
  }>;
}
```

### `simulateCrmEvent`

Dispara entry node de tipo `pipeline_stage_entered` ou `segment_match`. Inbound vazio
(evento CRM não tem msg do lead).

Validação:

1. Flow tem entry node?
2. `entry.data.trigger === req.trigger_type`?
3. `entry.data.config.stage_id` (ou `segment_id`) === `req.target_id`?

Se algum falha → retorna `skipped: "other"` com erro PT-BR explicando "em prod isso não
dispararia porque...".

## FlowCanvas

`packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx`.

### Visão geral

Editor visual de flow baseado em `@xyflow/react`. Cliente arrasta nós, conecta edges,
configura cada nó. Persiste em `agent_flows.config` JSONB.

```
┌──────────────────────────────────────────────────────────────┐
│ [FlowSidebar]  ┌─────────────────────────────────┐           │
│  - paletes     │                                 │           │
│  - tools       │       ReactFlow canvas          │           │
│                │  • entry  → ai_agent → action   │           │
│                │              ↓                  │           │
│                │           condition             │           │
│                │              ↓ true / false     │           │
│                └─────────────────────────────────┘           │
│                                                              │
│ [InlineFormPanel]  ← edita nó clicado                        │
└──────────────────────────────────────────────────────────────┘
```

### CAS optimistic locking (PR #359)

```ts
async function saveFlow(configId, config, expectedVersion?) {
  // 1. IDOR check
  // 2. SELECT current version
  // 3. UPDATE WHERE version = expectedVersion
  // 4. count=0 → conflict, retorna current_version
  // 5. count=1 → success, version++
}
```

Frontend:

- `loadedVersion` salvo quando flow carrega.
- `handleSave` passa `expectedVersion: loadedVersion`.
- Server retorna `{ conflict: true, current_version: X }`.
- UI mostra modal "Outro admin salvou; recarregue" → opção "Recarregar" ou "Sobrescrever
  mesmo assim" (que omite `expectedVersion`).

Backwards-compat: `expectedVersion` omitido = last-write-wins. UI nova SEMPRE envia.

### `previewFlowImpact` (PR #362)

Antes de salvar mudanças destrutivas, action retorna quantas `agent_conversations` ativas
seriam afetadas (com `current_node_id` apontando pra nó removido).

```ts
async function previewFlowImpact(configId, newConfig) {
  const removedNodeIds = diff(currentConfig.nodes, newConfig.nodes);
  if (removedNodeIds.length === 0) return { affected: 0 };

  const count = await db.from("agent_conversations")
    .select("id", { count: "exact" })
    .eq("config_id", configId)
    .in("current_node_id", removedNodeIds);

  return { affected: count };
}
```

UI:

1. Cliente clica "Salvar".
2. Frontend chama `previewFlowImpact` primeiro.
3. Se `affected > 0`, mostra dialog "Vai afetar N conversas ativas".
4. Cliente confirma → chama `saveFlow`.
5. Conversas com `current_node_id` removido caem pro entry node no próximo turno (defensive
   fallback no runner).

### Validação antes de salvar (PR-4)

`handleSave` bloqueia salvar se houver validation errors. Errors vêm de `validateFlow()`
em `packages/shared/src/ai-agent/flow-validation.ts`:

- Falta entry node.
- Mais de 1 entry node.
- Nó sem edge de saída (exceto terminal).
- Edge sem source/target válido.
- AI node com edge entrando em loop com ele mesmo.
- Action node com `action_type` não suportado.
- Entry trigger sem config obrigatório (stage_id, segment_id, keywords).
- `create_appointment` action node sem `start_at`.
- `move_pipeline_stage` action sem `stage_id` nem `stage_name` (PR #366).

Validation warning permite salvar mas mostra banner amarelo:

- Nó órfão (sem edge entrando).
- AI node sem instructions.

### useFlowHistory (undo/redo)

`packages/ai-agent-ui/src/components/flow/use-flow-history.ts`. Snapshot do flow a cada
mudança significativa (move nó, criar edge, mudar config). Stack de 50 estados.

`Ctrl+Z` / `Ctrl+Shift+Z` integrados.

## NodeConfigSheet

`packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx`. Sheet lateral que abre
ao clicar num nó.

### Forms por tipo

**Entry node:**

- Trigger select.
- Config inputs por trigger:
  - `conversation_started`: nada extra.
  - `pipeline_stage_entered`: pipeline + stage selector (carrega via `listPipelines`).
  - `segment_match`: segment selector.
  - `keyword_match`: lista de keywords (input com chips).

**AI agent node:**

- Instructions textarea (multi-line, max 4000 chars).
- Enabled tools multi-select (checkboxes contra `flow.enabled_tools[]`).
- Model select (se override do agent_configs.model).

**Action node:**

- Action type select.
- Config form muda por action type:
  - `create_appointment`: datetime-local + duration + type_slug.
  - `move_pipeline_stage`: pipeline + stage selector (salva `stage_id`, label "Funil ›
    Etapa" — PR #366).
  - `add_tag`/`remove_tag`: tag_name input com autocomplete.
  - `send_media`: media slug picker.
  - `transfer_to_user`: member picker.
  - etc.

**Condition node:**

- Condition type select.
- Form por type.
- Labels pra true_label e false_label (= label da edge de saída).

### Validation feedback

Cada form mostra erros inline ao tentar salvar. Sheet não fecha se houver erro — força
correção.

## Drilling down

### Como adicionar nova ação ao canvas

1. Adicionar entry em `node-catalog.ts` (`packages/ai-agent-ui/src/components/flow/`).
   Contém label, icon, default config.
2. Atualizar `flowActionTypeToNativeHandler()` em `packages/shared/src/ai-agent/flow.ts`
   mapeando action_type → native_handler.
3. Adicionar form em `NodeConfigSheet.tsx`.
4. Atualizar validator em `flow-validation.ts` se há campos obrigatórios.
5. Atualizar este doc.

### Como adicionar nova entry trigger

1. Adicionar string ao union em `packages/shared/src/ai-agent/flow.ts`:
   `EntryNodeTrigger`.
2. Atualizar `flow-validation.ts` com regra de config obrigatório.
3. Atualizar `findEntryNode` se selecionando por tipo (hoje retorna primeiro entry, mas
   se múltiplos forem permitidos no futuro, lógica precisa mudar).
4. Atualizar `runFlow` pra decidir se o trigger bate (matching contra inbound text,
   stage_id event, etc).
5. Atualizar `simulateCrmEvent` em `tester.ts` pra deixar admin testar.
6. Atualizar `NodeConfigSheet` com form do novo trigger.

### Limitações conhecidas

- **Sem dark mode** no Canvas. ReactFlow funciona mas paleta default é light.
- **Pinch zoom no trackpad** às vezes conflita com scroll do navegador. Mac safari mais
  afetado.
- **Edges não podem ser editadas no label** depois de criadas — cliente deleta e recria.
  Trabalho de UX pra futuro.

## Cross-refs

- Server action `saveFlow`: `apps/crm/src/actions/ai-agent/flow.ts`
- AgentActions interface: `packages/ai-agent-ui/src/actions.ts`
- Tester server actions: `apps/crm/src/actions/ai-agent/tester.ts`
- Runner consumer do flow: [03-flow-runtime.md](./03-flow-runtime.md)
- Padrão de handler novo: [04-tools-and-handlers.md](./04-tools-and-handlers.md)
