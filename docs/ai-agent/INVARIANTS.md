# AI Agent — Invariantes (Codex / agentes IA read-only)

> Este documento é **prescritivo**. Cada item abaixo é uma regra que NÃO pode ser quebrada sem
> review humano. Codex e outros agentes IA devem ler este arquivo ANTES de editar qualquer
> coisa em `apps/crm/src/lib/ai-agent/*`, `packages/shared/src/ai-agent/*` ou
> `apps/admin/src/actions/ai-agent/*`.
>
> Mudanças que conflitem com qualquer invariante abaixo exigem PR de "contract change" com
> review de UI owner + Runtime owner. Ver `CODEX_SYNC.md` na raiz pra protocolo.

## 0. Princípios

1. **Shared modules are read-only para runtime agents.** O conteúdo de
   `packages/shared/src/ai-agent/*` (types, helpers, contratos) é compartilhado entre CRM,
   Admin e Codex. Mudanças aqui DEVEM passar por revisão dupla. Não adicione campos novos
   "só pra um caso" — proponha contract change PR primeiro.
2. **Defensive parsing sempre.** Todo JSONB lido do DB (`humanization_config`, `guardrails`,
   `flow.config`, `action_config`, etc) DEVE passar por `normalizeXxx()` antes de ser usado.
   Nunca trate `as any` e siga em frente — runtime quebra silenciosamente.
3. **Best-effort no que é UX, fail-fast no que é dados.** Knowledge inject falhando = `null`
   + log + IA responde sem contexto. INSERT em `agent_conversations` falhando ≠ ok — DB
   garante consistência, código não pode mascarar.
4. **Idempotência por contract no que é "ação externa".** Cada handler com side effect (DB
   write, provider send, OpenAI call) DEVE ser idempotente OU ter rastro em
   `agent_steps` / `actions_executed_detail` que permita retry seguro.

---

## 1. Estrutura de tipos

### 1.1. NUNCA edite `packages/shared/src/ai-agent/types.ts` sem contract change PR

O arquivo é importado por 3 camadas:

- `apps/crm/src/lib/ai-agent/*` (runtime)
- `apps/crm/src/actions/ai-agent/*` (server actions)
- `apps/crm/src/features/ai-agent/*` + `packages/ai-agent-ui/*` (UI)
- `apps/admin/src/actions/ai-agent/*` (Admin runtime paralelo)

Quebra de campo aqui = quebra de runtime + UI ao mesmo tempo. Comentário no topo do
arquivo afirma isso.

### 1.2. `NATIVE_HANDLERS` array é a única fonte da verdade pros handlers

Todo novo handler nativo DEVE:

1. Adicionar string em `NATIVE_HANDLERS` em `packages/shared/src/ai-agent/types.ts`.
2. Adicionar entry em `tool-presets.ts` com `execution_mode: "native"` e mesmo
   `native_handler` slug.
3. Estender CHECK constraint do `agent_tools.native_handler` via migration nova.
4. Criar handler em `apps/crm/src/lib/ai-agent/tools/<slug>.ts` exportando `default async function`
   com signature `(ctx: HandlerContext, input: ParsedInput) => Promise<HandlerOutput>`.
5. Registrar em `apps/crm/src/lib/ai-agent/tools/registry.ts`.

Pular qualquer passo = ou ferramenta não aparece no Canvas, ou CHECK constraint falha no
INSERT, ou runtime não acha o handler. Os 4 passos são fail-fast em pontos diferentes.

### 1.3. `ToolExecutionMode` agora aceita `"mcp"` (PR #363)

Valores atuais: `"native" | "n8n_webhook" | "mcp"`. Caso adicione outro modo:

1. Atualizar tipo em `types.ts`.
2. Atualizar `flow.ts` (validator) + `flow-validation.ts`.
3. Atualizar `runner.ts` (dispatch `executeToolCall`).
4. Atualizar UI `NodeConfigSheet.tsx`.

---

## 2. Modelo flow vs legacy stages

### 2.1. Pivot mai/2026 (migration 054): flow é canônico

Antes: `agent_stages` + `agent_stage_tools` + `agent_configs.behavior_mode`.
Agora: `agent_flows.config` JSONB com `nodes[]` + `edges[]` + `enabled_tools[]`.

**Stages tables ainda existem** por retrocompat (não foi feito DROP), mas não são lidas
pelo runner. Não escreva código novo que dependa delas.

### 2.2. Entry node é obrigatório

Todo `flow.config` válido DEVE ter exatamente 1 nó do tipo `entry`. `findEntryNode()` retorna
o primeiro encontrado; sem entry node, `runFlow` aborta com `fatal_error: "no entry node"`.

Triggers suportados em `entry.data.trigger`:

- `"conversation_started"` — default. Lead manda primeira msg.
- `"pipeline_stage_entered"` — `entry.data.config.stage_id` obrigatório.
- `"segment_match"` — `entry.data.config.segment_id` obrigatório.
- `"keyword_match"` — `entry.data.config.keywords[]` obrigatório.

Validação live em `flow-validation.ts`. Adição de trigger novo exige update lá + no
`simulateCrmEvent` em `actions/ai-agent/tester.ts`.

### 2.3. Edges nomeadas

Edge tem `data.label` opcional. Quando AI node emite event via `emit_event` tool com
`event=X`, runner segue a edge com `label=X`. Default branch é edge sem label OU
`label="default"`.

`flowActionTypeToNativeHandler()` em `packages/shared/src/ai-agent/flow.ts` mapeia action
node type pro handler. Mantenha sincronizado.

---

## 3. Conversação e idempotência

### 3.1. `agent_conversations` UNIQUE partial

Migration 071 adiciona:

```sql
CREATE UNIQUE INDEX agent_conversations_org_lead_crmconv_uniq
  ON agent_conversations (organization_id, lead_id, crm_conversation_id)
  WHERE crm_conversation_id IS NOT NULL;
```

Significa: 2 webhooks paralelos do mesmo lead VÃO bater 23505 num deles. Código DEVE:

- INSERT em `tryEnqueueForNativeAgent` está dentro de try/catch que faz SELECT no 23505.
- Nunca confiar em "vou conferir antes de INSERT" — race condition. Sempre INSERT-or-rescue.

### 3.2. Sticky por lead

Uma vez criado, `agent_conversations` permanece com o mesmo `lead_id + crm_conversation_id`.
`config_id` pode mudar via `transfer_to_agent` (PR-5 reescreveu pra modelo flow), mas
`current_node_id` é resetado nesse caso (`shouldResetCurrentNodeId()` em `flow.ts`).

### 3.3. `human_handoff_at` é o gate central

Quando seta:

- `matchPause()` quando lead manda pause keyword.
- `transfer_to_user` handler.
- `stop_agent` handler.
- `pauseAgent()` helper (auto-pausa quando operator responde manualmente).

Quando limpa:

- `matchResume()` quando lead manda resume keyword.
- `auto_pause_minutes` expirado (`isAutoPauseExpired()`).

`canAiSendNow()` (em `send-guard.ts`) checa este campo + epoch antes de qualquer outbound.
**NUNCA bypassa.** Tester é o ÚNICO consumer que pode passar dryRun=true e pular o guard.

### 3.4. Conversations parity (PR #364)

Quando `matchPause`/`matchResume` rodam, ALÉM de mexer em `agent_conversations` também
atualizam `conversations.assigned_to` ('ai' ↔ 'human') pra refletir no Kanban. Helper
`updateConversationAssignment()` faz isso. Não duplique código — use o helper.

---

## 4. Send-guard e epochs

### 4.1. `ai_control_epoch` em `agent_conversations`

Toda vez que ownership muda (transfer, handoff, retomada), epoch incrementa. Em
`runFlow`, qualquer outbound checa que o epoch atual ainda é o mesmo do início do run. Se
mudou, aborta o send mid-flow — outro turno assumiu o controle.

Helper: `assertCanAct(ctx)` em `runner.ts`. Chame antes de `provider.sendText/sendMedia`
em qualquer handler que envie mensagens.

### 4.2. `dry_run` propaga via `FlowRunContext`

`ctx.dryRun = true` significa Tester. Handlers nativos DEVEM respeitar:

- Não persistir no DB.
- Não chamar provider real (Tester usa provider stub).
- Retornar shape simulado (ex: `{ created: true, simulated: true }`).

Comportamento padrão: handler que NÃO checa `dryRun` vai escrever no DB do Tester — bug.
Sempre checar.

---

## 5. Knowledge inject (`buildKnowledgeBlock`)

### 5.1. Cache invalida por `sources_hash`, não TTL

`knowledge-cache.ts` usa chave `(config_id, sources_hash)`. Hash é
`md5(MAX(updated_at) || COUNT(*))` das sources `completed`. Mudou source → hash muda →
cache miss.

NUNCA implemente TTL único — admin uploadando doc novo deveria ver IA reagir imediatamente,
não esperar 5 min.

### 5.2. Threshold em TOKENS, não bytes (PR #371)

`measureKnowledgeTokens()` usa heurística `chars/3` (PT-BR). Não troque por `content.length`
sem motivo forte. Pra bumps:

- `AUTO_FULL_TOKEN_THRESHOLD = 6000`: limite pro modo `auto` escolher full.
- `FULL_MODE_HARD_CAP_TOKENS = 16000`: hard-cap mesmo em modo `full` manual.

Acima do hard-cap → falla pra `rag`. Log: `ai_agent_knowledge_full_exceeded_cap` com
`total_tokens` + `cap_tokens`.

### 5.3. Best-effort: falha em knowledge NUNCA bloqueia AI

`buildKnowledgeBlock` retorna `null` em qualquer erro (RLS, schema, Voyage caiu). IA
continua respondendo sem contexto. Log estruturado: `ai_agent_knowledge_inject_failed`.

---

## 6. Humanização

### 6.1. Sempre normalize antes de usar

`agent_configs.humanization_config` é JSONB. PODE estar parcial em ambientes antigos
(pré-migration 041). Sempre passar por `normalizeHumanizationConfig(raw)` em runtime.

### 6.2. Keyword matching (PR #369)

`matchesPauseKeyword` / `matchesResumeKeyword` usam:

- `normalizeKeyword`: trim + uppercase + NFD unaccent.
- Word boundary regex (`\\b<keyword>\\b`).
- Case-insensitive via uppercase normalization.

False positive aceito: `"nao pausar"` dispara PAUSAR. Trade-off documentado.

NÃO altere pra match exato — quebra UX que clientes já dependem.

### 6.3. Business hours retorna `true` em falha (defensive)

`isWithinBusinessHours()` em caso de tz inválida ou Intl falhando retorna `true` (=
dentro do horário). Princípio: NÃO bloquear silenciosamente.

---

## 7. Cost limits

### 7.1. `assertWithinCostLimits` é check, não enforcement contínuo

Roda em 2 pontos:

1. Antes do `runFlow` em `executeDebouncedBatch`.
2. Dentro do AI loop, antes de cada `openai.chat.completions.create()`.

Quando bate, lança erro que vira `cost_ceiling` skip. Não tente "soft-fail" — explode é
o comportamento certo.

### 7.2. Limite vive em `agent_cost_limits` por org

Sem row → sem limite. Atual: admin precisa configurar manualmente. Follow-up: default
automático (não implementado).

---

## 8. Tester

### 8.1. Tester rodou contra DB real com `dryRun=true`

Não é dry-run total — algumas escritas acontecem (lead Tester sintético, agent_conversations,
agent_runs com `is_test=true`). Apenas handlers nativos com side-effects respeitam
`dryRun` e não escrevem no domínio do cliente.

Dashboards e queries de prod DEVEM filtrar `agent_runs.is_test = false`.

### 8.2. `gate_warnings` é INFORMACIONAL (PR #370)

Tester bypassa gates de prod (feature flag, status, business hours). `collectGateWarnings()`
em `flow/tester-gates.ts` retorna warnings em PT-BR pra UI mostrar banner amarelo. NUNCA
bloqueia o tester — apenas avisa o admin "em prod isso pularia".

Falhas de leitura silenciosas (catch swallow) — gate ausente > false alarm.

---

## 9. Flow CAS optimistic locking (PR #359)

### 9.1. `saveFlow` exige `expectedVersion`

Cliente envia `expectedVersion` (versão que tinha quando carregou). Server faz
`UPDATE ... WHERE version = expectedVersion`. Conflict (count=0) retorna `{ conflict: true,
current_version }` pro frontend mostrar modal "outro admin salvou; recarregue".

Backwards-compat: `expectedVersion` omitido = last-write-wins (não use em UI nova).

### 9.2. `previewFlowImpact` antes de save destrutivo (PR #362)

Antes de salvar mudanças, action retorna quantas `agent_conversations` ativas seriam
afetadas (ainda com `current_node_id` apontando pra nó removido). UI mostra confirmação.

---

## 10. Paridade Admin / CRM (PR #365)

### 10.1. Helpers compartilhados em shared

`packages/shared/src/ai-agent/template-materializer.ts` exporta `applyAgentTemplate()` e
`materializePresetTool()`. Tanto CRM quanto Admin chamam o mesmo helper. NUNCA reescreva
a lógica de seed só num dos lados.

### 10.2. Same shape para ações ao usuário

Tabelas de actions em Admin (`apps/admin/src/actions/ai-agent/*`) e CRM
(`apps/crm/src/actions/ai-agent/*`) DEVEM ter mesmas funções com mesma signature.
Diferenças exclusivas (Admin tem `requireSuperadmin`, CRM tem `requireRole`) ficam só no
auth boilerplate inicial.

Auditoria periódica recomendada: `diff` das pastas. Drift = bug.

---

## 11. Webhook → executor

### 11.1. 23505 catch obrigatório em 2 pontos (PR #355)

- INSERT em `leads` (path nativo, executor.ts).
- INSERT em `agent_conversations` (executor.ts).

Sem catch + SELECT fallback, webhook retransmitido por Meta/UAZAPI quebra com erro fatal.

### 11.2. Timeout 8s no fetch n8n (PR #372)

`fetchWithTimeout(8000)` com AbortController em `incoming-pipeline.ts`. Catch distingue
`AbortError` (`logError("incoming_pipeline_n8n_timeout")`) de erros genéricos
(`logError("incoming_pipeline_n8n_call_failed")`).

Não desabilite o timeout. Se n8n confiável e lento, mova-o pra worker assíncrono (follow-up).

---

## 12. Padrões obrigatórios em PRs novos

### 12.1. Comentário em PT-BR com backlog/PR number

Para que o `git blame` de 6 meses depois faça sentido:

```ts
// Backlog #N Auditoria (mai/2026): rodada R #M.
// <Contexto curto do que mudou e por quê>.
```

### 12.2. Tests reusam helpers existentes

Antes de mockar Supabase do zero, veja `apps/crm/src/test/helpers/supabase-mock.ts`.
Antes de mockar tester context, veja `apps/crm/src/test/helpers/tester-context-mock.ts`.

### 12.3. Migration nova exige update no doc

Toda migration nova em `apps/crm/supabase/migrations/` exige update em
[`02-data-model.md`](./02-data-model.md) tabela de migrations e (se mudou shape) na seção
da tabela afetada.

### 12.4. Handler novo exige update no doc

Toda tool nova exige update em [`04-tools-and-handlers.md`](./04-tools-and-handlers.md).

### 12.5. AbortController em qualquer fetch externo

`voyage-client.ts` (60s), `incoming-pipeline.ts` (8s n8n), `mcp/client.ts`,
`webhook-caller.ts`. Sem AbortController = retries cascateiam quando rede flaky.

---

## 13. O que NÃO mexer

- `apps/admin/supabase/migrations/` — pasta congelada (histórico pre-monorepo). Migrations
  novas vão em `apps/crm/supabase/migrations/`.
- `packages/shared/src/database.ts` — gerado por `supabase gen types`. Edita só via
  regeneração ou se faltar campo crítico (com nota em PR).
- `tokens_used_total` em `agent_conversations` — REMOVIDO em migration 073. Não readicione.

## 14. Onde reportar contract violations

Quando algum dos invariantes acima for violado em prod, ou identificar invariante novo
que deveria estar aqui, **abra PR de contract change** atualizando este arquivo + os docs
afetados em [docs/ai-agent/](./README.md). Não tente "consertar silenciosamente" no
código que consome.
