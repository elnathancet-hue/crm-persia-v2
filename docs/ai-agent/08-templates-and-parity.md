# 08 — Templates e paridade Admin/CRM

> Templates de agente, materializer compartilhado, paridade entre apps/crm e apps/admin.

## Templates disponíveis

`packages/shared/src/ai-agent/agent-templates.ts`. Cada template define:

- `slug`: identifier.
- `name`: label no Wizard.
- `description`: 1-2 frases.
- `system_prompt`: prompt base.
- `flow_config`: flow inicial (nodes + edges + enabled_tools).
- `humanization_config`: defaults customizados.
- `seed`: tags, agenda_services, notification_templates pra criar junto.

### Catálogo atual

| Slug | Etapas | Uso |
| --- | --- | --- |
| `blank` | 1 ai_agent simples | Cria do zero. Mínimo viável: entry → ai_agent. |
| `atendimento_whatsapp` | 3 | Recepção + qualificação + transferência |
| `pre_venda` | 4 | Descoberta + apresentação + objeções + agendamento |
| `pos_venda_cobranca` | 3 | Dúvidas de pagamento/boleto |
| `tira_duvidas_faq` | 1 | RAG-first (use após popular Documentos/FAQ) |
| `consultor_funil_completo` | 5 nós, full seed | **Mais completo**: humanização + auto-actions + seed de tags/tipos de agendamento/templates de notificação |

## `applyAgentTemplate` (shared)

`packages/shared/src/ai-agent/template-materializer.ts`. ~280 LOC. **Compartilhado** entre
CRM e Admin (PR #365 paridade).

### Pipeline

```
applyAgentTemplate(db, ctx, templateSlug)
  ├─ 1. Resolve template definition
  ├─ 2. Cria agent_config com:
  │     - name + description
  │     - system_prompt (base)
  │     - model (default gpt-5-mini)
  │     - humanization_config (merged sobre defaults)
  │     - status='draft' (cliente liga depois)
  │     - new_lead_stage_id (se especificado no ctx)
  │
  ├─ 3. seedTagsForTemplate
  │     - Loop template.seed.tags[]
  │     - Pra cada: tags.upsert ON CONFLICT(name) DO NOTHING
  │
  ├─ 4. seedAgendaServicesForTemplate
  │     - Loop template.seed.agenda_services[]
  │     - Pra cada: agenda_services.upsert ON CONFLICT(slug) DO NOTHING
  │
  ├─ 5. seedNotificationTemplatesForTemplate
  │     - Loop template.seed.notification_templates[]
  │     - INSERT em agent_notification_templates (config_id=novo agente)
  │
  ├─ 6. materializeFlowFromTemplate
  │     - INSERT agent_flows com config = template.flow_config
  │     - version = 1
  │
  ├─ 7. materializeToolsFromFlow
  │     - Loop template.flow_config.enabled_tools[]
  │     - Pra cada slug: materializePresetTool(db, ctx, slug)
  │       └─ INSERT agent_tools com:
  │             - name = preset.tool_call_name
  │             - description = preset.description (PT-BR)
  │             - input_schema = preset.input_schema (JSON Schema)
  │             - execution_mode = "native"
  │             - native_handler = preset.native_handler
  │             - is_enabled = true
  │
  └─ 8. Return { config_id }
```

### Best-effort

Cada step entre 3-7 tem try/catch com `console.error` (ou `logError`). Falha em seed (ex:
tag já existe com outro shape) **não** aborta o agente — cliente termina com agente
criado, mas alguma tag faltando. Mensagem de erro no log; UI não mostra (admin debug
via SQL).

### Quando NÃO usar

Cliente criando agente do zero (não via Wizard com template). Usar `createAgent()` direto
em `actions/ai-agent/configs.ts` com config mínimo.

## `materializePresetTool` (shared helper)

`packages/shared/src/ai-agent/template-materializer.ts`.

```ts
async function materializePresetTool(
  db: DBClient,
  ctx: { organizationId: string; configId: string },
  presetSlug: string,
): Promise<{ tool_id: string } | null> {
  const preset = TOOL_PRESETS[presetSlug];
  if (!preset) return null;

  const { data, error } = await db
    .from("agent_tools")
    .insert({
      organization_id: ctx.organizationId,
      config_id: ctx.configId,
      name: preset.tool_call_name,
      description: preset.description,
      input_schema: preset.input_schema,
      execution_mode: preset.execution_mode,
      native_handler: preset.native_handler ?? null,
      webhook_url: null,
      mcp_server_id: null,
      is_enabled: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[materializePresetTool] failed", { presetSlug, error });
    return null;
  }
  return { tool_id: data.id };
}
```

Caller decide se faz upsert por (config_id, name) ou check antes — depende do template.

## Paridade Admin/CRM (PR #365)

### Por que paridade existe

Admin e CRM têm UIs paralelas pra criar/editar agente. Antes do PR #365, `applyTemplate`
estava só no CRM (`apps/crm/src/actions/ai-agent/configs.ts`). Admin tinha sua própria
versão antiga com bugs (não seedava `is_primary`, ignorava `new_lead_stage_id`).

PR #365 extraiu pra shared (`template-materializer.ts`) e ambos chamam. Drift impossível.

### Estrutura paralela

```
apps/crm/src/actions/ai-agent/
  configs.ts                 → createAgent, updateAgent, applyTemplate, archiveAgent
  flow.ts                    → saveFlow, previewFlowImpact, getFlow
  tester.ts                  → testAgentLive, simulateCrmEvent, testAgent, reset
  feature-flag.ts            → setNativeAgentEnabled
  tools.ts                   → CRUD agent_tools
  knowledge.ts               → upload doc + trigger indexing
  ...

apps/admin/src/actions/ai-agent/
  configs.ts                 → mesmos métodos, auth via requireSuperadmin
  flow.ts                    → idem
  flow-catalogs.ts           → listPipelines (Admin precisa cross-org)
  tools.ts                   → idem
  ...
```

### Auth difference

```ts
// CRM
const { supabase, orgId } = await requireAgentRole("admin");

// Admin
const { supabase } = await requireSuperadmin();
const orgId = await getActiveOrgFromCookie();
```

Resto da função é idêntica. Auditoria recomendada: `diff` das pastas ai-agent/ entre
apps. Drift = bug.

### `is_primary` em ambos

Quando admin (qualquer app) seta `is_primary=true` em um agente, UPDATE em outros agentes
da org seta `is_primary=false`. UNIQUE partial em DB pega corner case.

Helper em `apps/crm/src/actions/ai-agent/configs.ts`: `setPrimaryAgent(configId)`.

### `humanization_config` merge

PR #365 reforçou que `updateAgent()` mescla `humanization_config` em vez de sobrescrever
inteiro. Sem merge, UI mandando só `{ split_enabled: true }` apagaria os outros campos.

Padrão:

```ts
const current = await db.from("agent_configs").select("humanization_config")...
const merged = normalizeHumanizationConfig({
  ...current.humanization_config,
  ...patch.humanization_config,
});
await db.from("agent_configs").update({ humanization_config: merged })...
```

## Wizard de criação (UI)

`packages/ai-agent-ui/src/components/AgentCreationWizard.tsx`. 3 steps:

1. **Template:** cards visuais com `name + description + icon`. Cliente escolhe `blank`
   ou um template completo.
2. **Nome:** input pro `agent_configs.name`. Sugere `"<Template name> — <Org name>"`.
3. **Modelo:** select entre `gpt-5-mini` (default), `gpt-5`, `gpt-4o-mini`, `gpt-4o`.

Após "Criar", chama `applyTemplate(slug, name, model)` e redireciona pra editor do agente
novo.

UX patterns documentados em memory file `project_ai_agent_redesign_v2.md`. Resumo:
sidebar agrupada > 10 tabs flat, Tester via FAB bottom-right, criação via wizard 3-step
com cards visuais de templates.

## Como adicionar template novo

1. Adicionar entry em `packages/shared/src/ai-agent/agent-templates.ts`:

```ts
export const AGENT_TEMPLATES: Record<string, AgentTemplateDef> = {
  meu_novo_template: {
    slug: "meu_novo_template",
    name: "Meu novo template",
    description: "Pra X cenário",
    system_prompt: "Você é um assistente especializado em...",
    humanization_config: { split_enabled: true, ... },
    flow_config: {
      nodes: [
        { id: "entry-1", type: "entry", position: { x: 0, y: 0 }, data: { trigger: "conversation_started" } },
        { id: "ai-1", type: "ai_agent", position: { x: 200, y: 0 }, data: { instructions: "...", enabled_tools: ["add_tag", "stop_agent"] } },
      ],
      edges: [{ id: "e1", source: "entry-1", target: "ai-1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
      enabled_tools: ["add_tag", "stop_agent"],
    },
    seed: {
      tags: [{ name: "interessado" }, { name: "nao_qualificado" }],
      agenda_services: [],
      notification_templates: [],
    },
  },
  // ...
};
```

2. Adicionar ícone + cor pro card em `AgentCreationWizard.tsx`.
3. Testar end-to-end em prod (criar agente via Wizard + verificar via SQL que todos os
   seeds aplicaram).
4. Atualizar tabela neste doc.

## Anti-patterns

### NÃO inicializar tools fora do flow.enabled_tools

Materializer linka tools só pra slugs em `flow_config.enabled_tools[]`. Se template lista
uma tool mas NÃO inclui no `enabled_tools`, ela é "fantasma": existe em `agent_tools`,
mas runner não considera no AI loop.

Sempre sync: `enabled_tools[]` deve listar TODOS os slugs presentes nos nós AI/action.

### NÃO seedar via SQL direto

Tentação: "vou criar agente template via SQL pra rápido". Não. O template-materializer
faz validação + cria FKs corretas + chama hooks. SQL direto pula tudo, agente quebra
silenciosamente.

Pra seed em prod: chama action via API curl OU usa o Wizard mesmo.

### NÃO duplicar lógica entre Admin e CRM

PR #365 unificou. Resista à tentação de "vou só copiar essa função em Admin que é mais
fácil". Drift volta na próxima feature. Sempre extrair pra shared.

## Cross-refs

- Tabelas seedadas: [02-data-model.md](./02-data-model.md)
- Materializer fluxo no runtime: [03-flow-runtime.md](./03-flow-runtime.md)
- Wizard UI: `packages/ai-agent-ui/src/components/AgentCreationWizard.tsx`
- Memory file (UX patterns): `project_ai_agent_redesign_v2.md` (user memory dir)
