# 04 — Tools e Handlers

> Catálogo completo das tools nativas, padrão de handler, lead interpolation,
> MCP, n8n_webhook.

## Catálogo (15 native handlers + 6 presets sem handler)

### Implementados (com handler em `apps/crm/src/lib/ai-agent/tools/`)

| Handler | Input | O que faz | Tabelas escritas |
| --- | --- | --- | --- |
| `stop_agent` | `{ reason? }` | Pausa IA + handoff humano + dispara `trigger_notification` se config. | `agent_conversations.human_handoff_at`, `lead_activities` |
| `transfer_to_user` | `{ user, reason? }` | Atribui lead a membro (resolve por email OU nome). | `leads.assigned_to`, `lead_activities`. Bumps epoch. |
| `transfer_to_agent` | `{ target_agent_name, reason? }` | Troca agente da conversa. Reset `current_node_id`. Preserva history_summary + variables. | `agent_conversations.config_id, current_node_id, ai_control_epoch` |
| `add_tag` | `{ tag_name }` | Atacha tag (cria se não existir). | `lead_tags`, `tags`, `lead_activities` |
| `remove_tag` | `{ tag_name }` | Desatacha tag (4 caminhos: por id, por name, por id+id, no-op). | `lead_tags`, `lead_activities` |
| `move_pipeline_stage` | `{ stage_id, reason? }` ou retrocompat `{ stage_name }` | Move lead no Kanban (mesmo funil). PR #366 passou pra `stage_id`. | `leads.stage_id, sort_order`, `lead_activities` + trigger onStageChanged |
| `set_lead_custom_field` | `{ field, value }` | Set campo custom no lead. `value` aceita lead interpolation `{{lead.X}}`. | `leads.custom_fields` |
| `trigger_notification` | `{ template_name, custom? }` | Dispara template WhatsApp pra equipe. | (provider) `sendText`, `lead_activities` |
| `send_media` | `{ slug, caption? }` | Envia mídia da Biblioteca (image/video/PDF). | (provider) `sendMedia`, `messages`, `lead_activities` |
| `create_appointment` | `{ type_slug, start_at, description?, ...overrides }` | Cria appointment + dispara notify lead. | `appointments`, `appointment_history`, `lead_activities` |
| `list_lead_appointments` | `{ only_upcoming?, limit? }` | Lista compromissos do lead. | leitura |
| `cancel_appointment` | `{ appointment_id, reason? }` | Cancela + notifica lead. | `appointments.status='cancelled'`, `appointment_history` |
| `reschedule_appointment` | `{ appointment_id, new_start_at, reason? }` | Cria novo `awaiting_confirmation`, marca original `rescheduled`. | `appointments`, `appointment_history` |
| `emit_event` | `{ event_name }` | Sinaliza pro runner seguir edge nomeada. Não escreve em DB. | — |
| `round_robin_user` | `{ pool?, reason? }` | Distribui lead entre membros ativos (round-robin via `agent_round_robin_state`). | `leads.assigned_to`, idem |

### Presets sem handler (visíveis em UI, IA não pode chamar)

Em `packages/shared/src/ai-agent/tool-presets.ts`. CHECK constraint do `agent_tools.native_handler`
**aceita** estes valores (não bloqueia INSERT), mas se IA chamar a tool, dispatch retorna
erro "handler not implemented".

- `assign_source`, `assign_product`, `assign_department` — placeholder pra UI; runtime
  trata como `transfer_to_user` parametrizado (não implementado ainda).
- `round_robin_agent` — distribui entre agentes (preset existe, sem implementação).
- `send_audio` — TTS, sem provider TTS escolhido.
- `schedule_event` — Google Calendar event direto (não via appointment). Implementação
  parcial em migration 059-061, runtime ainda placeholder.

## Padrão "nome amigável"

Após teste live (PR #246, mai/2026), 6 handlers que exigiam UUID foram refatorados pra
aceitar nomes humanos:

| Handler | Antes | Agora |
| --- | --- | --- |
| `add_tag` | `tag_id` UUID | `tag_name` valida contra catálogo da org (ilike) |
| `move_pipeline_stage` | `stage_id` UUID | `stage_name` (legacy) OU `stage_id` (PR #366, novo) |
| `transfer_to_user` | `user_id` UUID | `user` (nome OU email) |
| `transfer_to_stage` | `stage_id` UUID | `target_stage_name` |
| `transfer_to_agent` | `target_config_id` UUID | `target_agent_name` |
| `trigger_notification` | `template_id` UUID | `template_name` |

UUID continua aceito como fallback retrocompat (resolve por id primeiro, depois por name).

## Padrão de handler nativo

`apps/crm/src/lib/ai-agent/tools/<name>.ts`. Exporta `default async function` com signature
genérica:

```ts
import type { NativeHandler } from "@persia/shared/ai-agent";
import { z } from "zod";

const Input = z.object({
  // ...
});

const handler: NativeHandler<z.infer<typeof Input>> = async (ctx, rawInput) => {
  // 1. Parse + validate
  const input = Input.parse(rawInput);

  // 2. dry_run check
  if (ctx.dryRun) {
    return { simulated: true, ...stubOutput };
  }

  // 3. Resolve target (UUID/nome → entity)
  // 4. Side effect (DB write / provider call)
  // 5. Log to lead_activities com metadata.source='ai_agent'
  // 6. Return shape estável

  return { success: true, /* ... */ };
};

export default handler;
```

### `HandlerContext` (PR-5)

```ts
interface HandlerContext {
  db: AgentDb;
  organizationId: string;
  leadId: string;
  agentConversationId: string;
  agentConfigId: string;
  agentConfig: AgentConfig;        // PR-5 injeta pra evitar re-fetch
  agentConversation: AgentConversation;
  provider: WhatsAppProvider | FlowProviderStub;
  dryRun: boolean;
  inboundMessage: { text: string; received_at: string };
  flowConfig: FlowConfig;
}
```

Construído via `buildNativeHandlerContext()` em `apps/crm/src/lib/ai-agent/flow/handler-context.ts`.
Centraliza resolução de FK e injeção de helpers. NUNCA replique o objeto manualmente em
handlers — usa o helper.

### Registro em 3 arquivos

```
tools/<name>.ts                              # implementação
tools/registry.ts                            # export { addTagHandler, ... }
packages/shared/src/ai-agent/tool-presets.ts # preset visível no canvas
packages/shared/src/ai-agent/types.ts        # entrada em NATIVE_HANDLERS array
apps/crm/supabase/migrations/NNN_*.sql       # CHECK constraint do agent_tools.native_handler
```

5 passos. Pular qualquer um quebra em ponto diferente do pipeline.

## Lead interpolation (`{{lead.X}}`)

Helper compartilhado: `apps/crm/src/lib/ai-agent/flow/lead-interpolation.ts`.

Sintaxe: `{{lead.<field>}}` em strings. Substitui pelo valor do lead em runtime.

### Fields suportados

```ts
const LEAD_FIELDS = [
  "name", "phone", "email", "stage_name", "pipeline_name",
  "source", "tags", "city", "state", "country",
  "custom_fields.*",  // dot-notation pra custom fields
];
```

Funções principais:

- `hasLeadPlaceholders(text)`: scan rápido pra short-circuit.
- `loadLeadForInterpolation(db, leadId)`: SELECT com fields esperados.
- `interpolateLeadPlaceholders(text, lead)`: substitui ocorrências.

Quem usa:

- `set_lead_custom_field` handler (PR #367): `value` pode ser `"{{lead.email}}"`.
- `trigger_notification` body_template (já existia antes).
- `agent_notification_templates.body_template` em followups (idem).

Convenção: se template menciona campo inexistente (`{{lead.foo}}` mas lead não tem `foo`),
substitui por string vazia. Log estruturado em modo `--strict` (não atual default).

## `emit_event` — branching via tool

`apps/crm/src/lib/ai-agent/tools/emit-event.ts`. Tool especial: não escreve em DB nem chama
provider. Apenas sinaliza pro runner seguir edge nomeada.

```ts
// Tool schema:
{
  name: "emit_event",
  description: "Sinaliza um evento pra mover o fluxo pra próxima etapa nomeada.",
  parameters: {
    type: "object",
    properties: {
      event_name: { type: "string", description: "Nome da edge a seguir." }
    },
    required: ["event_name"]
  }
}

// Output (consumido pelo runner):
{ proceedToEdge: string }
```

Quando AI emit_event(`event_name="qualified"`), runner busca edge com `data.label="qualified"`
saindo do node atual. Default branch (label vazio ou "default") é usado quando AI não
chama emit_event mas o turno termina normalmente.

Cliente desenha as edges + labels no Canvas. AI node mostra os possíveis events no system
prompt automaticamente (auto-include em PR-6).

## MCP (`execution_mode = "mcp"`)

PR #363 + migration 062.

```
agent_tools.execution_mode = "mcp"
agent_tools.mcp_server_id  → mcp_server_connections.id
```

Pipeline:

1. `runner.ts` recebe tool call do LLM.
2. Match contra `agent_tools` → encontra `execution_mode="mcp"`.
3. Carrega `mcp_server_connections` (URL + auth credentials via Vault).
4. Chama MCP client (`apps/crm/src/lib/mcp/client.ts`) com timeout + AbortController.
5. Mapeia response pra tool_message no AI loop.

Auth types: `none`, `bearer` (token estático), `oauth` (refresh via Supabase Vault).

Dry-run: MCP client retorna `{ simulated: true }` sem chamar server real. Tester usa.

Configuração via UI Admin `/admin/mcp-servers/` (org pode ter múltiplos).

## n8n webhook (`execution_mode = "n8n_webhook"`)

Mais antigo, ainda em uso. Custom webhook caller em
`apps/crm/src/lib/ai-agent/webhook-caller.ts`.

```
agent_tools.execution_mode = "n8n_webhook"
agent_tools.webhook_url     → URL n8n
```

Pipeline:

1. Match contra `agent_tools` → encontra `execution_mode="n8n_webhook"`.
2. POST pra `webhook_url` com payload (input + ctx mínimo).
3. Resposta tratada como string OU JSON com `{ output?, text?, response? }`.

**Domínio allowlist** (`organizations.settings.webhook_allowlist.domains`): runtime
rejeita URLs cujo hostname não bate. Quando ausente/vazio, rejeita TUDO — opt-in por org.

Timeout: configurado no caller (default 30s). Sem allowlist → roda só com env de dev.

## Catálogos injetados no system prompt

`tool-catalogs.ts` carrega listas pra contexto da IA. Cada loader roda só se a tool
correspondente está habilitada no node.

| Loader | Pra qual tool | Conteúdo |
| --- | --- | --- |
| `loadTagCatalog` | `add_tag` / `remove_tag` | Tags da org + descrição (cap 50) |
| `loadMemberCatalog` | `transfer_to_user` | Membros ativos: nome + email + role |
| `loadAgentCatalog` | `transfer_to_agent` | Outros agentes ativos (exclui o atual) |
| `loadKanbanStageCatalog` | `move_pipeline_stage` | Etapas do funil DO LEAD (anota "← lead está aqui") |
| `loadNotificationTemplateCatalog` | `trigger_notification` | Templates ativos do agente |
| `loadAppointmentTypeCatalog` | `create_appointment` | Tipos: slug, duração, canal |
| `loadMediaCatalog` | `send_media` | Mídias ativas: slug, name, category |

### System prompt final (resumo)

```
[knowledge block se houver]
[agentConfig.system_prompt]
[node.data.instructions]

[mediaCatalog]
[tagCatalog]
[kanbanStageCatalog]
[memberCatalog]
[agentCatalog]
[notificationTemplateCatalog]
[appointmentTypeCatalog]

Responda ao cliente em português brasileiro, de forma objetiva e útil.
```

Catálogos vazios não inseridos (sem ruído no prompt).

## Tool-call sanitizer

`apps/crm/src/lib/ai-agent/tool-call-sanitizer.ts`. OpenAI às vezes retorna `tool_calls`
malformados (JSON string com aspas escapadas, vírgula trailing). Sanitizer tenta:

1. `JSON.parse` direto.
2. Se falhar, regex pra fix comum (trailing comma).
3. Se falhar, log + retorna `{}` e deixa o handler erroar mais explicitamente.

## Erros comuns no handler

| Sintoma | Causa raiz | Correção |
| --- | --- | --- |
| Handler escreve DB no Tester | Não checou `ctx.dryRun` | Adicionar early return no início |
| Handler ignora `agent_activities` log | Esqueceu insert | Sempre log `lead_activities` com `metadata.source='ai_agent'` |
| Tool não aparece no Canvas | Falta preset em `tool-presets.ts` | Adicionar entry |
| Tool aparece mas IA não pode chamar | Falta entry em `NATIVE_HANDLERS` array | Adicionar em types.ts |
| INSERT em agent_tools falha 23514 | CHECK constraint do `native_handler` não tem o slug | Migration nova estendendo CHECK |
| Handler quebra com `permission denied` no Tester | Tester usa user auth, não service_role | Verificar se RPC chamada exige service_role |

## Cross-refs

- Tabela `agent_tools`: [02-data-model.md § agent_tools](./02-data-model.md)
- Dispatch no runner: [03-flow-runtime.md § AI loop](./03-flow-runtime.md)
- Como handler é registrado no flow: [INVARIANTS § 1.2](./INVARIANTS.md)
- Catálogos no Canvas (UI): [07-tester-and-canvas.md](./07-tester-and-canvas.md)
