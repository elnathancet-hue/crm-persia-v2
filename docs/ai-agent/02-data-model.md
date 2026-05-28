# 02 — Modelo de dados

> Schema completo do AI Agent. **Source of truth:** `apps/crm/supabase/migrations/`.
> Quando der diff entre este doc e SQL real, **SQL ganha** — atualize o doc.

## Tabelas core (`agent_*`)

### `agent_configs`

1 row por agente. PK `id` (uuid). Org scope via `organization_id`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid FK → organizations | RLS scope |
| `name` | text | |
| `description` | text? | |
| `model` | text | `"gpt-5-mini"` default. Aceita `gpt-5`, `gpt-5-mini`, `gpt-4o`, `gpt-4o-mini` (cost.ts). |
| `system_prompt` | text | |
| `status` | text | `"active" \| "draft" \| "paused"`. Só `active` responde em prod. |
| `is_primary` | boolean | UNIQUE partial: 1 primary por org (migration 044). |
| `behavior_mode` | text | Legacy. Pivot deprecou; runner não lê. |
| `scope_type` | text | `"org" \| "pipeline" \| "stage"`. Define onde routing aplica. |
| `scope_id` | uuid? | |
| `humanization_config` | jsonb | Ver [06-humanization.md](./06-humanization.md). Normalize antes de usar. |
| `guardrails` | jsonb | Cost/rate limits ainda em estudo. Hoje usado pra `max_iterations`. |
| `debounce_window_ms` | int | Default 10000. Range 0-60000. |
| `context_summary_*` | int | turn_threshold (default 6), token_threshold (default 4000), recent_messages (default 4). Ver [03-flow-runtime § Summarization](./03-flow-runtime.md). |
| `handoff_notification_enabled` | boolean | |
| `handoff_notification_target_*` | text | type + address (email/phone/user_id). |
| `handoff_notification_template` | text? | Template body. Default em shared. |
| `new_lead_stage_id` | uuid? FK → pipeline_stages | Auto-move lead pra essa stage no início (PR-FLOW-PIVOT). |
| `calendar_connection_id` | uuid? FK → agent_calendar_connections | OAuth Google. |
| `knowledge_mode` | text | `"full" \| "rag" \| "auto"`. Default `"full"`. Migration 069. |
| `created_at`, `updated_at` | timestamp | |

**Constraints:**

- `UNIQUE INDEX agent_configs_org_primary_uniq ON agent_configs (organization_id) WHERE
  is_primary = true` (migration 044).
- `CHECK status IN ('active', 'draft', 'paused')`.

### `agent_flows` (pivot mai/2026, migration 054)

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `config_id` | uuid FK → agent_configs (UNIQUE) | 1:1 com agent_configs. |
| `config` | jsonb | `{ nodes: [], edges: [], viewport: {}, enabled_tools: [] }`. |
| `version` | int | CAS optimistic locking (PR #359). Incrementa a cada UPDATE. |
| `created_at`, `updated_at` | timestamp | |

**`config.nodes[]` shape:**

```ts
{
  id: string;
  type: "entry" | "ai_agent" | "action" | "condition";
  position: { x: number; y: number };
  data: {
    label?: string;
    // entry
    trigger?: "conversation_started" | "pipeline_stage_entered" | "segment_match" | "keyword_match";
    config?: { stage_id?, segment_id?, keywords? };
    // ai_agent
    instructions?: string;
    enabled_tools?: string[];     // refs em flow.enabled_tools
    // action
    action_type?: string;          // mapeado pra native_handler via flowActionTypeToNativeHandler
    action_config?: Record<string, unknown>;
    // condition
    condition?: { type: "variable_match" | "lead_status_match" | ...; ... };
  };
}
```

### `agent_stages` (LEGACY, post-pivot)

Mantida por retrocompat. Runner não lê. Não escreva código novo dependente.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `config_id` | uuid FK → agent_configs | |
| `order_index` | int | |
| `slug` | text | |
| `situation` | text | Contexto da etapa pro LLM. |
| `instruction` | text | |
| `transition_hint` | text? | |
| `rag_enabled` | boolean | Pré-pivot. |
| `action_type` | text | `"free_message" \| "auto"`. Migration 046. |
| `action_config` | jsonb | `auto_actions[]` quando `action_type='auto'`. Migration 049. |

### `agent_tools`

Tool registrada por agente. Pode ser native, n8n_webhook ou mcp.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `config_id` | uuid FK → agent_configs | |
| `name` | text | Identifier OpenAI tool name. |
| `description` | text | Vê pelo LLM. |
| `input_schema` | jsonb | JSON Schema do input. |
| `execution_mode` | text | `"native" \| "n8n_webhook" \| "mcp"`. Migration 062 + PR #363 (mcp). |
| `native_handler` | text? | Quando native. CHECK contra enum (16+ valores até 072). |
| `webhook_url` | text? | Quando n8n_webhook. |
| `mcp_server_id` | uuid? FK → mcp_server_connections | Quando mcp. |
| `is_enabled` | boolean | |

**Constraints:**

- `CHECK native_handler IN ('transfer_to_user', 'transfer_to_agent', 'add_tag',
  'assign_source', 'assign_product', 'assign_department', 'round_robin_user',
  'round_robin_agent', 'send_audio', 'trigger_notification', 'schedule_event',
  'stop_agent', 'move_pipeline_stage', 'create_appointment', 'list_lead_appointments',
  'cancel_appointment', 'reschedule_appointment', 'send_media', 'emit_event',
  'set_lead_custom_field', 'remove_tag')`. Atualizado por migrations 040, 043, 056, 057, 072.

### `agent_stage_tools` (LEGACY)

Junction `(stage_id, tool_id, is_enabled)`. Pré-pivot. Não usar em código novo.

### `agent_conversations`

Sticky por lead. 1 row por `(org, lead, crm_conversation_id)`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid FK | |
| `lead_id` | uuid FK → leads | |
| `crm_conversation_id` | uuid? FK → conversations | NULL pra Tester sintético. |
| `config_id` | uuid FK → agent_configs | Pode mudar via `transfer_to_agent`. |
| `current_node_id` | text? | Pivot. ID do nó onde o flow parou. Resetado em transfer. |
| `current_stage_id` | uuid? FK → agent_stages | Legacy. |
| `variables` | jsonb | Vars que tools podem set/read. |
| `history_summary` | text? | Resumo das mensagens antigas (summarization PR #354). |
| `history_summary_run_count` | int | Quantos runs desde o último summarize. |
| `human_handoff_at` | timestamp? | Quando setado: IA pausada. NULL = ativa. |
| `after_hours_notified_at` | timestamp? | Cooldown 6h da after-hours msg. Migration 042. |
| `ai_control_epoch` | int | Incrementa em transfer/handoff. Send-guard checa. Migration 067. |
| `actions_executed` | jsonb | Array de stage_ids visitados (legacy). |
| `actions_executed_detail` | jsonb | Per-action retry tracking (PR3, migration 053). Shape: `{ [key]: { succeeded[], failed{idx: {attempts, last_error}} } }`. |
| `assigned_to_user_id` | uuid? | Quando handoff vai pra membro específico. |
| `flush_claimed_at`, `flush_claim_expires_at` | timestamp | Worker lock pro debounce. |
| `next_flush_at` | timestamp? | Quando próxima janela debounce expira. |
| `last_interaction_at` | timestamp | Bump em qualquer atividade. Followups usam. |
| `created_at`, `updated_at` | timestamp | |

**Constraints:**

- `UNIQUE INDEX agent_conversations_org_lead_crmconv_uniq ON agent_conversations
  (organization_id, lead_id, crm_conversation_id) WHERE crm_conversation_id IS NOT NULL`
  (migration 071). Pega webhook racing.

### `agent_runs`

1 row por turno de execução.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid FK | |
| `agent_conversation_id` | uuid FK | |
| `config_id` | uuid FK | Snapshot — se config mudar mid-run, run anterior tem ref. |
| `inbound_message_id` | uuid? FK → messages | NULL pra simulateCrmEvent. |
| `status` | text | `"running" \| "succeeded" \| "failed"`. |
| `model` | text | Snapshot do model usado. |
| `tokens_input`, `tokens_output` | int | Soma de todas as iterações do loop. |
| `cost_usd_cents` | int | `calculateCostUsdCents(model, in, out)`. |
| `is_test` | boolean | `true` pro Tester (PR #257, migration 047). Dashboards filtram. |
| `provider_mode` | text? | `"chat" \| "responses"` (migration 074). NULL = legacy/desconhecido. Setado em runtime via `getOpenAiApiMode()`. |
| `created_at` | timestamp | INSERT timestamp. |
| `duration_ms` | int | Tempo total do run, UPDATE no fim. |
| `error_msg` | text? | Error fatal do runFlow. |

### `agent_steps`

Audit granular. UI Tester renderiza estes na timeline.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `run_id` | uuid FK | |
| `order_index` | int | Sort. |
| `step_type` | text | `"llm" \| "tool" \| "guardrail" \| "summarization"`. |
| `tool_id` | uuid? FK | Quando step_type='tool'. |
| `native_handler` | text? | Quando native. |
| `input` | jsonb | |
| `output` | jsonb | |
| `duration_ms` | int | |
| `error` | text? | |
| `created_at` | timestamp | |

### `pending_messages`

Buffer de debounce. RPCs `service_role` only.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `agent_conversation_id` | uuid FK | |
| `inbound_message_id` | uuid FK → messages | UNIQUE — dedup automático. |
| `text` | text | |
| `received_at` | timestamp | |
| `flushed_at` | timestamp? | NULL = pendente. |

### `agent_knowledge_sources` + `agent_knowledge_chunks`

Voyage AI RAG. Dim 1024. Migration 022.

**Sources:**

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `agent_config_id` | uuid FK | |
| `type` | text | `"faq" \| "document"`. |
| `title` | text | |
| `status` | text | `"pending" \| "indexing" \| "completed" \| "failed"`. Renomeado em migration 022 (`indexing_status`). |
| `embedding_provider` | text | `"voyage"`. |
| `embedding_model` | text | `"voyage-3"`. |
| `embedding_dim` | int | 1024. |
| `error_message` | text? | |
| `created_at`, `updated_at` | timestamp | |

**Chunks:**

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `source_id` | uuid FK | |
| `chunk_index` | int | |
| `content` | text | |
| `embedding` | vector(1024) | pgvector. |
| `tokens` | int | |
| `created_at` | timestamp | |

**Index pgvector:** ivfflat ou hnsw em `embedding`. RPC `match_agent_knowledge_chunks`
faz top-k retrieval.

### `agent_notification_templates`

Templates WhatsApp pra equipe (`trigger_notification` handler).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `config_id` | uuid FK | |
| `name` | text | |
| `description` | text? | |
| `target_type` | text | `"user" \| "phone" \| "email"`. |
| `target_address` | text | Endereço final ou placeholder. |
| `body_template` | text | Vars: `{{lead_name}}`, `{{lead_phone}}`, `{{wa_link}}`, `{{agent_name}}`, `{{summary}}`. |
| `is_enabled` | boolean | |

### `agent_followups` + `agent_followup_runs`

Follow-up scheduler. Cron via pg_cron (migration 051) */10min.

**Followups:**

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `config_id` | uuid FK | |
| `name` | text | |
| `template_id` | uuid FK → agent_notification_templates | Reusa template como corpo da msg. |
| `delay_hours` | int | Range 1..720. |
| `is_enabled` | boolean | |
| `order_index` | int | |

**Runs:**

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `followup_id` | uuid FK | |
| `conversation_id` | uuid FK | |
| `fired_at` | timestamp | |
| `UNIQUE (followup_id, conversation_id)` | | Idempotency. 23505 em re-entrada = skip silencioso. |

### `agent_calendar_connections`

Google Calendar OAuth. Migration 025 + 059 (real).

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `provider` | text | `"google"`. |
| `refresh_token_vault_secret_id` | uuid | Supabase Vault encrypted. |
| `email` | text | |
| `is_active` | boolean | |

### `agent_entry_conditions`

Routing OR-logic. Migration 045.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `agent_config_id` | uuid FK | |
| `condition_type` | text | `"pipeline_stage" \| "segment" \| "tag" \| "lead_status"`. |
| `condition_value` | text | UUID ou string. |
| `priority` | int | |

### `agent_cost_limits`

Org-level rate/cost ceilings. Sem row = sem limite.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `organization_id` | uuid PK FK | |
| `daily_usd_cents_cap` | int | |
| `monthly_usd_cents_cap` | int | |
| `tokens_per_run_cap` | int | |
| `updated_at` | timestamp | |

### `mcp_server_connections`

MCP servers configurados por org. Migration 062.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid FK | |
| `name` | text | |
| `server_url` | text | |
| `auth_type` | text | `"none" \| "bearer" \| "oauth"`. |
| `auth_credentials_vault_secret_id` | uuid? | Vault. |
| `is_active` | boolean | |

## Tabelas externas que o agente lê/escreve

| Tabela | Leitura | Escrita | Handler |
| --- | --- | --- | --- |
| `leads` (CRM) | id, phone, name, pipeline_id, stage_id, assigned_to, metadata, custom_fields | `assigned_to`, `pipeline_id`, `stage_id`, `custom_fields` | `transfer_to_user`, `move_pipeline_stage`, `set_lead_custom_field`, round_robin_* |
| `lead_tags` (CRM) | — | INSERT/DELETE junction | `add_tag`, `remove_tag` |
| `tags` (CRM) | name, color | (cria se não existe) | `add_tag` |
| `lead_activities` (CRM) | — | INSERT com `metadata.source='ai_agent'` | TODOS os handlers (auditoria) |
| `pipeline_stages` (CRM) | id, name, outcome, pipeline_id | — | `move_pipeline_stage`, catálogos |
| `conversations` (chat) | id, status, assigned_to | `last_message_at`, `assigned_to` (matchPause/Resume) | `ensureCrmContext`, helpers de paridade |
| `messages` (chat) | content, sender, type | INSERT (sender=`ai`, status=`sent`) | `send_media`, `sendAssistantReply` |
| `appointments` (Agenda) | id, status, start_at, lead_id, type | INSERT, UPDATE (status, dates) | `create/list/cancel/reschedule_appointment` |
| `agenda_services` (Agenda) | slug, name, duration_minutes, default_channel | — | `create_appointment` + catálogo |
| `automation_tools` (Biblioteca) | slug, name, file_url, category, mime_type | (`usage_count` TODO) | `send_media` + catálogo |
| `organization_members` | user_id, is_active, role | — | `transfer_to_user`, catálogo |
| `profiles` | id, full_name, email | — | `transfer_to_user`, catálogo |
| `organizations` | settings.features, settings.webhook_allowlist | — | feature flag, allowlist |
| `segments` + `segment_memberships` | id, lead_id | — | entry conditions |

## Migrations (cronológicas)

| Migration | O que faz |
| --- | --- |
| `017_ai_agent_core.sql` | Tabelas core: agent_configs, agent_stages, agent_tools, agent_conversations, agent_runs, agent_steps |
| `019_ai_agent_debounce.sql` | pending_messages + RPCs enqueue/claim/complete/release (service_role only) |
| `022_ai_agent_rag.sql` | agent_knowledge_sources + agent_knowledge_chunks + pgvector index |
| `023_ai_agent_notifications.sql` | agent_notification_templates (body_template, NÃO body) |
| `024_scheduled_jobs.sql` | agent_scheduled_jobs |
| `025_calendar_connections.sql` | agent_calendar_connections (vault refresh tokens) |
| `027_ai_agent_followups.sql` | agent_followups + agent_followup_runs (UNIQUE) |
| `031_agenda_module.sql` | appointments + agenda_services + availability_rules |
| `039_kanban_lead_centric.sql` | leads ganha pipeline_id/stage_id/sort_order |
| `040_ai_agent_agenda_handlers.sql` | CHECK constraint pros 4 handlers de agenda |
| `041_ai_agent_humanization.sql` | agent_configs.humanization_config JSONB |
| `042_ai_agent_after_hours_notified.sql` | agent_conversations.after_hours_notified_at |
| `043_ai_agent_send_media_handler.sql` | CHECK pro send_media |
| `044_ai_agent_primary.sql` | agent_configs.is_primary BOOLEAN + UNIQUE partial |
| `045_ai_agent_entry_conditions.sql` | agent_entry_conditions (routing OR-logic) |
| `046_ai_agent_behavior_mode.sql` | agent_configs.behavior_mode enum + agent_stages.action_type |
| `047_ai_agent_runs_is_test.sql` | agent_runs.is_test |
| `048_agenda_services_for_ai.sql` | agenda_services.slug + default_channel + default_location |
| `049_ai_agent_stage_action_config.sql` | agent_stages.action_config + agent_conversations.actions_executed |
| `050_ai_agent_stage_action_trigger.sql` | Trigger opcional `on_tool_success` em auto_actions (PR #260) |
| `051_ai_agent_followups_pg_cron.sql` | pg_cron job `ai-agent-followups-tick` */10min |
| `052_ai_agent_seed_transfer_tools.sql` | Backfill seed retroativo (PR #263) |
| `053_ai_agent_actions_executed_detail.sql` | actions_executed_detail JSONB + per-action retry (PR #265) |
| `054_ai_agent_flow_pivot.sql` | agent_flows table + JSONB config |
| `056_ai_agent_emit_event_handler.sql` | CHECK pro emit_event |
| `057_ai_agent_set_lead_custom_field_handler.sql` | CHECK pro set_lead_custom_field |
| `058_segment_memberships.sql` | Segment runtime |
| `059_google_calendar_connections.sql` | OAuth real (substitui placeholder de 025) |
| `060_appointments_google_event_id.sql` | Sync bidirecional |
| `061_google_calendar_pull_sync.sql` | Pull sync via cron |
| `062_mcp_server_connections.sql` | MCP servers + mcp_server_id em agent_tools |
| `063_conversations_unique_active.sql` | UNIQUE em conversations ativas |
| `064_phone_normalization_and_msg_dedup.sql` | Normalize phone + dedup whatsapp_msg_id |
| `065_lead_phone_normalize_trigger.sql` | Trigger pra normalize ao INSERT |
| `066_conversation_handoff_status_unification.sql` | Unifica status |
| `067_ai_agent_send_guard_epoch.sql` | agent_conversations.ai_control_epoch |
| `068_agent_new_lead_stage.sql` | agent_configs.new_lead_stage_id |
| `069_agent_knowledge_mode.sql` | agent_configs.knowledge_mode |
| `070_agent_conv_dedup_prep.sql` | agent_conversations_merge_log + cleanup dry-run + indexes |
| `071_agent_conv_uniq.sql` | UNIQUE partial em agent_conversations |
| `072_ai_agent_remove_tag_handler.sql` | CHECK pro remove_tag |
| `073_drop_tokens_used_total.sql` | Drop column órfão |
| `074_agent_runs_provider_mode.sql` | `agent_runs.provider_mode` TEXT NULL (chat\|responses) + CHECK + index parcial. PR 5 prep da migração Responses. |

## RLS (Row-Level Security)

Todas as tabelas `agent_*` têm RLS habilitado. Policies básicas:

- **SELECT/INSERT/UPDATE/DELETE:** `auth.uid()` deve ser membro de `organization_members`
  com `organization_id = NEW.organization_id` E status ativo.
- **service_role:** bypass total (usado pelo runtime, webhooks, cron, Tester).
- **anon_role:** sem acesso direto. Tudo passa via Edge API com auth check antes.

RPCs do debounce (migration 019) têm `GRANT EXECUTE TO service_role` apenas. UI nunca
chama direto.

## Convenções

1. **UUID v4 em PK.** Nunca serial/bigint pra entidades scoped por org (risk de leak
   cross-tenant via enumeração).
2. **`organization_id` em todas as `agent_*` tables.** Sem exceção. RLS depende.
3. **JSONB pra schemas evolutivos** (humanization_config, action_config, flow.config,
   variables). Sempre normalize ao ler.
4. **timestamps:** `created_at NOT NULL DEFAULT now()`, `updated_at` via trigger.
5. **soft delete:** não usamos. Hard delete + cascading ou marcar `status='archived'`.

## Como adicionar coluna ou tabela

1. Nova migration sequencial em `apps/crm/supabase/migrations/NNN_descricao.sql`.
2. Aplicar via `npx supabase db push` (NUNCA via Dashboard).
3. Regenerar types: `npx supabase gen types typescript > packages/shared/src/database.ts`.
4. Atualizar este doc com a tabela/coluna.
5. PR.

## Cross-refs

- Como o flow runtime consome estas tabelas: [03-flow-runtime.md](./03-flow-runtime.md)
- Como handlers escrevem: [04-tools-and-handlers.md](./04-tools-and-handlers.md)
- Knowledge sources/chunks fluxo: [05-knowledge.md](./05-knowledge.md)
