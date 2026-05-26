# Post-Codex Audit — Ciclo de Hardening Pós PR #339

**Período:** 22/mai/2026 — sessão Claude pós merge do PR #339 (Codex)
**Objetivo:** auditar a lógica de fluxos do AI Agent que o Codex acabou de
introduzir/refatorar (PRs #332-#339) e fechar gaps identificados.
**Resultado:** 4 PRs (#340-#343), auditoria 100% endereçada, 425 tests
passing, zero downtime.

---

## Contexto

Após o Codex entregar a sequência intensiva de PRs #332-#339 cobrindo
runtime safety, flow builder, humanização, retomada do bot, hierarquia
visual, prompt simplificado e entry routing condicional, o user pediu uma
auditoria estrutural antes de mover pra próxima feature.

### Estado coberto antes da auditoria

| PR | Tema |
|---|---|
| #332 | Runtime safety: `send-guard.ts` + `ai_control_epoch` + status unification (migrations 066/067) |
| #333 | Flow builder validation (`flow-validation.ts`) |
| #334 | Humanized config controls |
| #335 | Resume button após operator reply |
| #336 | Interactivity humanized config |
| #337 | Simplify prompt + `new_lead_stage_id` (migration 068) |
| #338 | Visual hierarchy AgentEditor |
| #339 | Entry routing config (`EntryConditionsCard`, `pickAgentForLead`) |

---

## Auditoria — 7 Achados

A auditoria mapeou o caminho end-to-end de uma mensagem WhatsApp e
identificou 7 achados, ordenados por gravidade.

### 🔴 ALTA — bugs user-facing

#### 1. Routing não-sticky (`executor.ts:388-394`)

`pickAgentForLead` rodava em **TODA mensagem inbound**, não só na primeira.

**Cenário**: lead começa falando com agente A. Manda msg #2 que casa
regra do agente B. Antes:
- `pickAgentForLead` retorna B
- `find-or-create` por `(config_id=B, lead, conv)` não acha row
- **Cria 2ª `agent_conversations`** com state separado (current_node_id,
  variables, actions_executed)
- Lead acaba conversando com 2 agentes em paralelo na mesma conv

Comentário em `entry-conditions.ts:8-9` afirmava "stickiness via
`agent_conversations.config_id`" — promessa não cumprida.

#### 2. Resume keyword sem ownership (`executor.ts:592-597`)

Quando operador respondia manualmente:
- `actions/messages.ts:104` → `conversations.assigned_to = userId` +
  `status='waiting_human'` + bump epoch ✓ (PR #335 Codex)

Lead manda resume keyword (ex: "ATIVAR") depois:
- Executor limpava `human_handoff_at` ✓
- Executor **NÃO** mexia em `conversations.assigned_to` ❌
- Send-guard rejeitava próximo envio: `conversation_not_owned_by_ai`
- **IA travada permanente** — só botão "Retomar IA" manual funcionava

UX prometida pelo PR #335 quebrava em silêncio.

### 🟡 MÉDIA — hardening latente

#### 3. Pause keyword sem bump de epoch (`executor.ts:598-606`)

Send-guard rejeitava via `human_handoff_at IS NOT NULL` — funcionava.
Mas inconsistente com outros paths:

| Path | Bumpa epoch? |
|---|---|
| `actions/conversations.ts:54` (Assumir manual) | ✅ |
| `actions/messages.ts:89` (operator reply) | ✅ |
| `executor.ts:matchResume` (após fix #2) | ✅ |
| `executor.ts:matchPause` | ❌ ← gap |

Frágil: mudança futura na ordem de checks do send-guard quebraria.

#### 4. CRM triggers reusam `current_node_id` antigo (`triggers.ts:349-425`)

`stage_entered`/`segment_entered` reusam `agent_conversations` row.
`runFlow` força `startNodeId=null` (sempre entry), mas o
`current_node_id` antigo persiste até o UPDATE final na linha 437.

Se o run quebrar entre find e UPDATE (crash, timeout), próxima inbound
pode carregar node_id órfão de um run que NUNCA terminou.

#### 5. `EntryConditionsCard` usa Input cru pra UUIDs

`segment_match` e `pipeline_stage_match` pediam UUID em Input livre.
Typo silencioso = condition **nunca casa**, falha invisível pro cliente.

#### 6. Flow validation não alerta agentes órfãos

`validateFlowConfig` só valida estrutura do grafo dentro de UM flow.
Não detecta agente secundário sem `agent_entry_conditions` cadastradas
(= agente nunca recebe leads). Cliente publica e fica órfão sem warning.

### 🟢 BAIXA

#### 7. `agent_runs` órfão (consequência do #1)

Quando #1 forkava 2 agent_conversations, `agent_runs` apontava pra A
mas msgs/flow rodavam em B. Audit corrompido. Resolvido em cascata.

---

## Pontos positivos (estado saudável)

Backbone do flow já estava **sólido**:

- **`send-guard.ts`** — 1 query única que cobre `assigned_to` + `status` +
  `human_handoff_at` + `epoch`. Defesa em profundidade no envio.
- **Migrations 066/067/068 ortogonais** — sem dependências cruzadas
  problemáticas. Cada uma resolve 1 problema bem definido.
- **`OPEN_CONVERSATION_STATUSES` respeitada** — 8 lookups conferidos
  (executor, triggers, tester, incoming-pipeline, flows/engine, tests).
- **Dedup race fechada** em 3 níveis — try-catch 23505 em messages
  (UNIQUE migration 064), conversations (UNIQUE migration 063), leads
  (UNIQUE migration 010 + trigger 065).
- **Defense in depth** — phone normalization DB trigger (065) + app-layer
  Zod (`phoneBR.parse`), garantia que QUALQUER caminho (n8n custom,
  Supabase Studio, scripts) normaliza.

---

## PRs entregues

### PR #340 — Catchup CODEX_SYNC + .gitignore cleanup

**Branch:** `docs/codex-sync-may-2026`

CODEX_SYNC.md parou em PR #62 (25/abr). Append consolidado cobrindo o
periodo abril → 22/mai/2026 (PRs #322-#339). Inclui:

- Mapa dos bugs UAZAPI/WhatsApp (A/B/C/D/E/F/G/H/I)
- Chat UI WhatsApp-style (PR #329 + #331)
- Runtime safety + flow builder + RulesTab iterações
- Snapshot de saúde (424 tests, typecheck OK)
- Code quality audit (0 TODOs ativos, 0 @ts-ignore, 1 console.log
  intencional)
- Working tree health note

`.gitignore` adiciona 4 paths que apareciam como untracked entre
sessões e geravam ruído ("código sujo" relatado pelo Codex era de
working tree, não code quality):

```gitignore
.worktrees/
.codex-worktrees/
.pnpm-store/
kanban-studio/
```

### PR #341 — Bug J — Routing stickiness + Resume keyword ownership

**Branch:** `fix/agent-routing-stickiness-and-resume`
**Arquivos:** `apps/crm/src/lib/ai-agent/executor.ts` +
`apps/crm/src/__tests__/ai-agent-routing-stickiness.test.ts` (novo)
**Achados:** #1, #2

#### Fix #1 — Stickiness no lookup de `agent_conversations`

Mudança: o lookup de `agent_conversations` **não filtra mais por
`config_id`** — busca QUALQUER row para `(org, lead, crm_conversation_id)`.
Se existe, override `agentConfigId` com o `config_id` da row.

```ts
// Antes
let { data: agentConv } = await db
  .from("agent_conversations")
  .select("...")
  .eq("organization_id", orgId)
  .eq("config_id", agentConfigId)  // ← filtrava por config
  .eq("lead_id", leadId)
  .eq("crm_conversation_id", conversationId)
  .maybeSingle();

// Agora
let { data: agentConv } = await db
  .from("agent_conversations")
  .select("..., config_id, ...")
  .eq("organization_id", orgId)
  .eq("lead_id", leadId)
  .eq("crm_conversation_id", conversationId)
  .maybeSingle();
if (agentConv) {
  const existingConfigId = agentConv.config_id;
  if (existingConfigId && existingConfigId !== agentConfigId) {
    agentConfigId = existingConfigId;  // ← stickiness
  }
}
```

Mudança de agente só acontece em conversation NOVA.

#### Fix #2 — Resume keyword devolve ownership pra IA

```ts
if (matchResume) {
  await db
    .from("agent_conversations")
    .update({
      human_handoff_at: null,
      human_handoff_reason: null,
      ai_control_epoch: aiControlEpoch + 1,  // ← novo
    })
    .eq("id", agentConversationId);
  await db
    .from("conversations")
    .update({ assigned_to: "ai", status: "active" })  // ← novo
    .eq("id", conversationId);
}
```

Mantém paridade com o botão manual "Retomar IA" no chat-window.

#### Test novo

`ai-agent-routing-stickiness.test.ts` valida que lead com
`agent_conversations` preexistente mantém o `config_id` mesmo quando
`pickAgentForLead` retornaria outro agente.

### PR #342 — Bug K — Pause epoch bump + Trigger node_id reset

**Branch:** `fix/pause-keyword-epoch-and-trigger-node-reset`
**Arquivos:** `executor.ts` + `triggers.ts`
**Achados:** #3, #4

#### Fix #3 — Pause keyword bumpa epoch

```ts
} else if (matchPause) {
  await db
    .from("agent_conversations")
    .update({
      human_handoff_at: new Date().toISOString(),
      human_handoff_reason: "pause_keyword",
      ai_control_epoch: aiControlEpoch + 1,  // ← novo, padrão fechado
    })
    .eq("id", agentConversationId);
  ...
}
```

Fecha o padrão: **TODA transição de controle bump epoch**.

#### Fix #4 — Triggers resetam node_id antes do runFlow

```ts
// ANTES de runFlow no triggers.ts
await db
  .from("agent_conversations")
  .update({ current_node_id: null })
  .eq("id", agentConversationId);

// 4. Build realtime provider + run context.
const realtimeProvider = createRealtimeProvider({ ... });
```

Mesmo se o run quebrar depois, estado intermediário é coerente.

### PR #343 — EntryConditions Select + Orphan agent warning

**Branch:** `fix/entry-conditions-ui-polish`
**Arquivos:** `packages/ai-agent-ui/src/components/EntryConditionsCard.tsx`
**Achados:** #5, #6

#### Fix #5 — Select de catálogo pra UUIDs

```tsx
{newType === "segment_match" ? (
  <Select value={newValue} onValueChange={setNewValue}>
    <SelectTrigger>
      <SelectValue>
        {newValue
          ? catalogs.segments.find((s) => s.id === newValue)?.name
          : null}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      {catalogs.segments.map((s) => (
        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
) : newType === "pipeline_stage_match" ? (
  // similar pra pipeline_stages, mostra "Funil → Etapa"
) : (
  // Input livre pra tag_match, message_contains, lead_status_match
)}
```

Lista de regras também mostra nome resolvido em vez do UUID:
- Antes: `Lead esta no segmento: 4f3a2b1c-d7e8-...`
- Agora: `Lead esta no segmento: Clientes VIP`

#### Fix #6 — Banner de agente órfão

```tsx
const isOrphanWarning =
  !isPrimary && !loading && conditions.length === 0 && !adding;

{isOrphanWarning ? (
  <div className="flex items-start gap-2 rounded-lg border border-warning-ring bg-warning-soft p-3">
    <AlertTriangle className="size-4 shrink-0 text-warning" />
    <div>
      <p className="text-xs font-medium text-warning-soft-foreground">
        Agente órfão — não recebe leads
      </p>
      <p className="mt-0.5 text-xs text-warning-soft-foreground/80">
        Sem regras cadastradas, este agente nunca é acionado. Adicione
        pelo menos uma regra abaixo pra ele começar a receber leads.
      </p>
    </div>
  </div>
) : ...}
```

Antes era texto italic discreto que se misturava.

---

## Estado final dos 7 achados

| # | Achado | PR | Status |
|---|---|---|---|
| 🔴 1 | Routing stickiness | #341 | ✅ |
| 🔴 2 | Resume keyword ownership | #341 | ✅ |
| 🟡 3 | Pause epoch bump | #342 | ✅ |
| 🟡 4 | Trigger node_id reset | #342 | ✅ |
| 🟡 5 | EntryConditions Select | #343 | ✅ |
| 🟡 6 | Orphan agent warning | #343 | ✅ |
| 🟢 7 | agent_runs órfão (cascata #1) | #341 | ✅ |

**100% endereçado.**

---

## Validação completa

| Check | Resultado |
|---|---|
| `pnpm --filter @persia/shared typecheck` | ✅ |
| `pnpm --filter @persia/ai-agent-ui typecheck` | ✅ |
| `pnpm --filter @persia/crm typecheck` | ✅ |
| `pnpm --filter @persia/admin typecheck` | ✅ |
| `pnpm --filter @persia/crm test` | ✅ **425 tests** |
| `pnpm --filter @persia/crm build` | ✅ |
| `pnpm --filter @persia/admin build` | ✅ |

Zero migrations adicionadas no ciclo (achados eram de código + UI).
Sistema pronto pra produção sem janela de manutenção.

---

## Padrões reforçados / lições aprendidas

### 1. Toda transição de controle bumpa `ai_control_epoch`

Foi o padrão consolidado nos PRs #341 e #342:

- **Assumir manual** (Assumir botão) — bumpa
- **Operator reply** (mensagem direta no chat) — bumpa
- **Pause keyword** ("PAUSAR") — bumpa (novo via #342)
- **Resume keyword** ("ATIVAR") — bumpa (novo via #341)

`send-guard.ts:canAiSendNow()` agora pode contar com epoch como **fonte
canônica de fresh** mesmo se ordem de checks futuras mudar.

### 2. Stickiness em multi-agent via DB state, não config

Tentação inicial: ler `pickAgentForLead` antes de cada msg.

Padrão correto: **DB state vence config**. Se `agent_conversations`
existe pra `(lead, crm_conv)`, ele dita o `config_id` — independente
do que `pickAgentForLead` retornaria.

Mudança de agente requer conversation nova (close + reopen).

### 3. Pickers > Input livre pra UUIDs

Cliente leigo erra UUID. `<Input>` cru é trap silenciosa. Padrão pra
qualquer campo que aceita ID de catálogo (segments, stages, templates,
agendas, members, etc.): usar Select populado por `getFlowCatalogs`.

### 4. Warnings visuais > texto discreto

Agente órfão antes era italic muted-foreground — só dev olhando atento
percebia. Padrão: configs que **quebram funcionalidade** quando vazias
ou inválidas merecem banner amber com `<AlertTriangle>` + texto
explicativo + CTA implícita.

### 5. Defense in depth — banco + app

Já estabelecido pelo Codex (send-guard) e pelo Bug I (DB trigger).
Reforçado neste ciclo: state coerente no DB sempre, mesmo se app
quebrar (fix #4 do trigger node_id reset).

---

## Working tree health pós ciclo

Antes do ciclo:
- 7 stashes acumuladas (várias de sessões antigas)
- 3 untracked dirs (`kanban-studio/`, `.pnpm-store/`, `.worktrees/`)
- `.gitignore` não cobria nenhuma delas
- Codex relatava "código sujo" — era working tree

Depois:
- 0 stashes
- `kanban-studio/` deletado (projeto AI Studio standalone, não relacionado
  ao CRM)
- `.gitignore` cobre `.worktrees/`, `.codex-worktrees/`, `.pnpm-store/`,
  `kanban-studio/`
- `git status` limpo entre sessões

---

## Coordenação Claude × Codex — padrão estabelecido

### Divisão observada no ciclo

| Frente | Owner natural |
|---|---|
| Bugs WhatsApp/UAZAPI | Claude |
| DB migrations + constraints | Claude |
| Visual do chat / design system | Claude |
| Audit + hardening de runtime | Claude |
| AI Agent runtime + executor | Codex |
| Flow builder UI + validation | Codex |
| Config UI (RulesTab, EntryConditions) | Codex |
| Send-guard + epoch + handoff | Codex |

### Protocolo informal

1. **Cada PR é nominal** — branch tem prefixo do owner (`claude/...`,
   `codex/...`, ou `fix/...` quando é genérico).
2. **Working tree limpa antes de PR novo** — `git stash` se houver
   coisa em flight de outra sessão.
3. **CODEX_SYNC.md como handoff** — entry por PR cobrindo escopo
   técnico. Esta auditoria não foi pra lá ainda — vai num catchup
   futuro.

---

## Próximas oportunidades (não-bloqueante)

Achados de code smell da auditoria que ficaram pra eventual refactor:

| Arquivo | Linhas | Razão |
|---|---|---|
| `packages/crm-ui/src/components/KanbanBoard.tsx` | 4109 | Candidato a split (Column, Card, DragOverlay) |
| `packages/leads-ui/src/components/LeadInfoDrawer.tsx` | 2737 | Tabs poderiam virar componentes |
| `packages/ai-agent-ui/src/components/RulesTab.tsx` | 1617 | Accordions inline grandes |

Nenhum bloqueia features. Refactor pode acontecer quando dor de
manutenção justificar.

---

**Documento gerado em:** 22/mai/2026 — sessão Claude pós ciclo de
hardening do PR #339.
