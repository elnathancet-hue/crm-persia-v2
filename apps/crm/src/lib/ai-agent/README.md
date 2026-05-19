# Módulo `lib/ai-agent` — Documentação técnica do AI Agent

**Última atualização:** 2026-05-17 (pós teste live PRs #252-256)
**Mantenedor:** Squad CRM Persia (skill `squad-crm-persia`)
**Memórias relacionadas:**
- [`project_ai_agent_module.md`](../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_ai_agent_module.md) — visão geral do módulo nativo
- [`project_ai_agent_sdr_humanization.md`](../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_ai_agent_sdr_humanization.md) — humanização SDR (PRs #235-238)
- [`project_ai_agent_integration_plan_v3.md`](../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_ai_agent_integration_plan_v3.md) — costura CRM/Agenda/Agente (PRs #239-244)

> Este README documenta o **estado atual** do AI Agent. Cada PR que toca em arquivos listados aqui DEVE atualizar a seção correspondente. Doc desatualizada é pior que sem doc.

---

## 1. Visão geral

O **AI Agent** é a cola entre [`/crm`](../../app/(dashboard)/crm/README.md) e [`/agenda`](../../app/(dashboard)/agenda/README.md) via WhatsApp. Responde mensagens reais de leads no [`/chat`](../../app/(dashboard)/chat/README.md), invocando os 2 módulos sem operador humano.

**Capacidades atuais:**
- Conversação humanizada (pause/resume keywords, picotagem de mensagens, horário comercial)
- Qualificação consultiva via etapas (`agent_stages`)
- Operações no CRM: adicionar tag, mover lead no Kanban, transferir pra membro/agente, parar agente
- Operações na Agenda: criar/listar/cancelar/reagendar appointments
- Envio de mídia da biblioteca (`automation_tools`)
- Notificações WhatsApp pra equipe (templates configurados)

**O que NÃO é:**
- Não substitui n8n totalmente — n8n continua opção pra cliente que quer (provider opcional via `agent_tools.execution_mode='n8n_webhook'`)
- Não tem voz/áudio (TTS preset existe mas handler não implementado)
- Não integra com Google Calendar runtime ainda (`schedule_event` preset existe mas só placeholder)

---

## 2. Modelo de dados

Schema introduzido pelas **migrations 017 → 049** (cronologicamente). Tabelas core:

| Tabela | Campos críticos | Notas |
|---|---|---|
| `agent_configs` | `name`, `system_prompt`, `model`, `status`, `is_primary`, `behavior_mode`, `humanization_config`, `guardrails`, `debounce_window_ms`, `handoff_notification_*` | 1 row por agente. `is_primary=true` UNIQUE por org via partial index |
| `agent_stages` | `config_id`, `order_index`, `slug`, `situation`, `instruction`, `transition_hint`, `rag_enabled`, `action_type`, `action_config` | Etapas do funil. `action_type` quando `behavior_mode='actions'` |
| `agent_tools` | `config_id`, `name`, `description`, `input_schema`, `execution_mode` (`native`\|`n8n_webhook`), `native_handler`, `webhook_url`, `is_enabled` | Tools registradas no agente |
| `agent_stage_tools` | junction `(stage_id, tool_id, is_enabled)` | Allowlist de tools por etapa |
| `agent_conversations` | `crm_conversation_id`, `lead_id`, `config_id`, `current_stage_id`, `variables`, `history_summary`, `human_handoff_at`, `actions_executed`, `next_flush_at` | Sticky por lead — preserva estado entre msgs |
| `agent_runs` | `agent_conversation_id`, `inbound_message_id`, `status`, `model`, `tokens_*`, `cost_usd_cents`, `is_test` | 1 row por execução. `is_test=true` filtrável em dashboards |
| `agent_steps` | `run_id`, `order_index`, `step_type` (`llm`\|`tool`\|`guardrail`\|`summarization`), `tool_id`, `native_handler`, `input`, `output`, `duration_ms` | Audit granular. UI Tester renderiza estes |
| `pending_messages` | `agent_conversation_id`, `text`, `received_at`, `flushed_at` | Buffer de debounce (msgs acumuladas <10s) |
| `agent_notification_templates` | `config_id`, `name`, `description`, `target_type`, `target_address`, `body_template` | Templates WhatsApp pra equipe |
| `agent_knowledge_sources` | `config_id`, `type` (`faq`\|`document`), `status`, `embedding_*` | RAG via Voyage AI (dim 1024) |
| `agent_calendar_connections` | `user_id`, `provider`, `refresh_token_vault_secret_id` | OAuth Google Calendar (runtime ainda placeholder) |
| `agent_followups` | `config_id`, `name`, `template_id` (→ `agent_notification_templates`), `delay_hours` (1..720), `is_enabled`, `order_index` | Follow-up scheduler — runtime em [`lib/ai-agent/followups/tick.ts`](followups/tick.ts), endpoint [`POST /api/ai-agent/followups/tick`](../../app/api/ai-agent/followups/tick/route.ts) |
| `agent_followup_runs` | `followup_id`, `conversation_id`, `fired_at`, `UNIQUE(followup_id, conversation_id)` | Idempotency log do dispatcher de followups. INSERT antes do `sendText` — `23505` em re-entrada concorrente vira skip silencioso |

### Tabelas externas que o agente lê/escreve

| Tabela | Leitura | Escrita | Por qual handler |
|---|---|---|---|
| `leads` (CRM) | id, phone, name, pipeline_id, stage_id, assigned_to, metadata | `assigned_to`, `pipeline_id`, `stage_id` | `transfer_to_user`, `move_pipeline_stage` |
| `lead_tags` (CRM) | — | INSERT junction | `add_tag` |
| `tags` (CRM) | name, color | (cria se não existe) | `add_tag` |
| `lead_activities` (CRM) | — | INSERT com `metadata.source='ai_agent'` | TODOS os handlers (auditoria) |
| `pipeline_stages` (CRM) | id, name, outcome, pipeline_id | — | `move_pipeline_stage`, `loadKanbanStageCatalog` |
| `conversations` (chat) | id, status, assigned_to | `last_message_at` | `ensureCrmContext` |
| `messages` (chat) | content, sender, type | INSERT (sender=`ai`, status=`sent`) | `send_media`, `sendAssistantReply` |
| `appointments` (Agenda) | id, status, start_at | INSERT, UPDATE (status, dates) | `create/list/cancel/reschedule_appointment` |
| `agenda_services` (Agenda) | slug, name, duration_minutes, default_channel | — | `create_appointment` + `loadAppointmentTypeCatalog` |
| `automation_tools` (Biblioteca) | slug, name, file_url, category | UPDATE `usage_count` (planejado) | `send_media` + `loadMediaCatalog` |
| `organization_members` | user_id, is_active | — | `transfer_to_user`, `loadMemberCatalog` |
| `profiles` | id, full_name, email | — | `transfer_to_user`, `loadMemberCatalog` |
| `organizations` | settings.features | UPDATE feature flag | `isNativeAgentEnabled` (read) |

---

## 3. Pipeline de execução

```
Mensagem WhatsApp (lead)
  │
  ▼
webhook/route.ts ou webhook/meta/[id]/route.ts
  │ (cria supabase com SERVICE_ROLE_KEY)
  ▼
tryEnqueueForNativeAgent(supabase, orgId, provider, msg)
  │
  ├─ isNativeAgentEnabled? → não: retorna handled=false (fallback n8n)
  ├─ loadActiveAgentConfig (is_primary OU created_at ASC)
  ├─ ensureCrmContext → cria/reusa lead + conversation + inbound message
  ├─ pickAgentForConversation (entry_conditions + stickiness)
  ├─ resolveAgentContext (agent_conversation + tools allowlist)
  │
  ├─ matchesPauseKeyword? → seta human_handoff_at, retorna skipped
  ├─ matchesResumeKeyword? → limpa human_handoff_at, continua
  ├─ business_hours fora? → envia after_hours_message, retorna skipped
  │
  ▼
enqueueDebounced (RPC enqueue_pending_message)
  │ — janela debounce ~10s acumula msgs do lead
  ▼ (cron tick OU expedite_debounce do Tester)
flushReadyConversations → executeDebouncedBatch
  │
  ▼
executeAgent (loop principal)
  │
  ├─ createRun (agent_runs row)
  ├─ buildSystemPromptWithRag (catálogos injetados)
  ├─ runStageAutoActionsIfPending (auto_actions da etapa atual)
  │
  ├─ LOOP (até max_iterations):
  │   ├─ assertWithinDeadline + assertWithinCostLimits
  │   ├─ openai.chat.completions.create({tools, tool_choice: "auto"})
  │   ├─ insertStep(type=llm)
  │   │
  │   ├─ finish_reason === 'tool_calls'?
  │   │   ├─ SIM: executeToolCall → handler nativo OU webhook → insertStep(type=tool)
  │   │   └─ NÃO: assistantReply = extractText() || HANDOFF_REPLY
  │   │       └─ sendAssistantReply (split + setTyping + delay)
  │   │       └─ detectStageTransitionAndRunActions (auto_actions da etapa NOVA)
  │   │       └─ maybeRunConversationSummarization (cada N turnos)
  │   │       └─ finishRun → return
  │   └─ next iteration
```

**Pontos-chave:**

- **Debounce window** (`enqueueDebounced`): default 10s. Tester pode `expedite_debounce: true` pra forçar flush imediato.
- **Stickiness**: `agent_conversations.config_id` faz o lead "ficar" no mesmo agente. Routing só na 1ª msg ou se `pickAgentForConversation` re-avaliar.
- **dryRun**: passa `true` no Tester. Tools nativas respeitam via `context.dry_run` (não persistem). `provider` continua sendo chamado (stub captura events).
- **`is_test=true`**: marca `agent_runs` quando vem do Tester. Dashboards filtram com `is_test=false`.

---

## 4. Tools nativas (handlers)

Implementadas em `tools/registry.ts` + handlers individuais. Cada handler implementa interface `NativeHandler` ([`packages/shared/src/ai-agent/tool-schema.ts:91`](../../../../shared/src/ai-agent/tool-schema.ts)):

| Handler | Input | O que faz | Tabelas escritas |
|---|---|---|---|
| `stop_agent` | `{ reason? }` | Pausa IA + handoff humano + dispara `trigger_notification` se config | `agent_conversations.human_handoff_at`, `lead_activities` |
| `transfer_to_user` | `{ user, reason? }` | Atribui lead a membro (resolve por email OU nome) | `leads.assigned_to`, `lead_activities` |
| `transfer_to_stage` | `{ target_stage_name, reason? }` | Avança etapa no MESMO agente | `agent_conversations.current_stage_id` |
| `transfer_to_agent` | `{ target_agent_name, reason? }` | Troca agente da conversa (preserva history_summary + variables) | `agent_conversations.config_id, current_stage_id` |
| `add_tag` | `{ tag_name }` | Atacha tag (cria se não existir) | `lead_tags`, `tags`, `lead_activities` |
| `move_pipeline_stage` | `{ stage_name, reason? }` | Move lead no Kanban (mesmo funil) | `leads.stage_id, sort_order`, `lead_activities` + trigger `onStageChanged` |
| `trigger_notification` | `{ template_name, custom? }` | Dispara template WhatsApp pra equipe | (provider) `sendText`, `lead_activities` |
| `send_media` | `{ slug, caption? }` | Envia mídia da Biblioteca (image/video/PDF) | (provider) `sendMedia`, `messages`, `lead_activities` |
| `create_appointment` | `{ type_slug, start_at, description?, ...overrides }` | Cria appointment + dispara notify lead | `appointments`, `appointment_history`, `lead_activities` |
| `list_lead_appointments` | `{ only_upcoming?, limit? }` | Lista compromissos do lead | leitura apenas |
| `cancel_appointment` | `{ appointment_id, reason? }` | Cancela + notifica lead via WhatsApp | `appointments.status='cancelled'`, `appointment_history` |
| `reschedule_appointment` | `{ appointment_id, new_start_at, reason? }` | Cria appointment novo `awaiting_confirmation`, marca original `rescheduled` | `appointments`, `appointment_history` |

**Presets sem handler** (visíveis em `tool-presets.ts` mas não no registry — IA não pode chamar):
`assign_source`, `assign_product`, `assign_department`, `round_robin_user`, `round_robin_agent`, `send_audio`, `schedule_event` (Google Calendar).

### Padrão "nome amigável" (PR #246, mai/2026)

Após teste live, 6 handlers que exigiam UUID foram refatorados pra aceitar nomes humanos:
- `add_tag` valida contra catálogo da org (ilike)
- `move_pipeline_stage`: `stage_name` (não UUID)
- `transfer_to_user`: `user` (nome OU email)
- `transfer_to_stage`: `target_stage_name`
- `transfer_to_agent`: `target_agent_name`
- `trigger_notification`: catálogo de templates no prompt

UUID continua aceito como fallback retrocompat.

---

## 5. Catálogos injetados no system prompt

`tool-catalogs.ts` carrega listas de opções (paralelo via `Promise.all`) e injeta no system prompt como blocos legíveis. Cada loader só roda se a tool correspondente está habilitada na etapa atual.

| Loader | Pra qual tool | Conteúdo injetado |
|---|---|---|
| `loadTagCatalog` | `add_tag` | Tags da org + descrição (cap 50) |
| `loadMemberCatalog` | `transfer_to_user` | Membros ativos: nome + email + role |
| `loadAgentCatalog` | `transfer_to_agent` | Outros agentes ativos (exclui o atual) |
| `loadKanbanStageCatalog` | `move_pipeline_stage` | Etapas do funil DO LEAD (anota "← lead está aqui") |
| `loadAgentStageCatalog` | `transfer_to_stage` | Etapas do agente atual (anota "← você está aqui") |
| `loadNotificationTemplateCatalog` | `trigger_notification` | Templates ativos do agente |
| `loadAppointmentTypeCatalog` | `create_appointment` | Tipos de agendamento (slug, duração, canal) |
| `loadMediaCatalog` | `send_media` | Mídias ativas (slug, name, category) — implementado em `executor.ts` |

**System prompt final** (`buildSystemPromptWithRag`):
```
[ragContext se houver]
[config.system_prompt]

Etapa atual: <stage.situation>
[actionLine se behavior_mode='actions']
[stage.instruction se behavior_mode='stages']
Dica de transição: <transition_hint>
[mediaCatalog]
[tagCatalog]
[kanbanStageCatalog]
[agentStageCatalog]
[memberCatalog]
[agentCatalog]
[notificationTemplateCatalog]
[appointmentTypeCatalog]
Responda ao cliente em portugues brasileiro, de forma objetiva e util.
```

---

## 6. Humanização (PRs #235-238, mai/2026)

`agent_configs.humanization_config` JSONB. Helpers em [`packages/shared/src/ai-agent/humanization.ts`](../../../../shared/src/ai-agent/humanization.ts).

| Campo | Default | Comportamento |
|---|---|---|
| `pause_keywords` | `["PAUSAR","HUMANO","STOP IA"]` | Match exato (case-insensitive). Quando lead manda, `human_handoff_at = now()` |
| `resume_keywords` | `["ATIVAR","IA ON","VOLTAR IA"]` | Reativa (`human_handoff_at = null`). Próxima msg vira processamento normal |
| `auto_pause_minutes` | `30` | Tempo após operator responder manualmente. 0 = nunca auto-pausa |
| `split_enabled` | `false` | Quando reply >= threshold, divide em N msgs curtas via `splitMessage` (chamada GPT extra) |
| `split_threshold_chars` | `200` | Mínimo de chars pra disparar split (range 50-1000) |
| `split_delay_seconds` | `2` | Delay entre msgs picadas com `setTyping` antes |
| `business_hours_enabled` | `false` | Quando true, fora do horário envia `after_hours_message` 1x por cooldown 6h |
| `business_hours_timezone` | `"America/Sao_Paulo"` | IANA tz pra `Intl.DateTimeFormat` |
| `business_hours` | seg-sex 9-18 | `Record<DayName, DayHours | null>` |
| `after_hours_message` | `"Olá! Recebi..."` | Texto enviado fora do horário (max 500 chars) |
| `handoff_include_summary` | `true` | Gera resumo via GPT antes de `trigger_notification` no handoff |

Validações via `normalizeHumanizationConfig(raw)` — runtime SEMPRE normaliza.

---

## 7. Auto-actions por etapa (PRs #248-250, mai/2026)

`agent_stages.action_config.auto_actions[]` — lista de ações que disparam **automaticamente** ao entrar na etapa, sem o LLM precisar chamar.

**Tipos suportados** (`StageAutoAction` em [`packages/shared/src/ai-agent/stage-actions.ts`](../../../../shared/src/ai-agent/stage-actions.ts)):
`add_tag`, `move_pipeline_stage`, `send_media`, `trigger_notification`, `transfer_to_user`, `transfer_to_agent`, `stop_agent`.

Idempotência via `agent_conversations.actions_executed` (array de stage_ids). 2 pontos de disparo no executor:

1. **Antes do loop LLM** — `runStageAutoActionsIfPending(stage_inicial)`
2. **Após `sendAssistantReply`** — `detectStageTransitionAndRunActions()` re-fetch `current_stage_id`; se mudou (via `transfer_to_stage`/`transfer_to_agent`), roda ações da nova etapa

Cliente edita via UI **"Ações por etapa"** ([`StageActionsEditor`](../../../../../packages/ai-agent-ui/src/components/StageActionsEditor.tsx) — PR #250). Falha gracioso: 1 ação que erra não bloqueia as outras; stage marcada como visitada mesmo com falhas parciais.

---

## 8. Tester fiel (PR #245)

`testAgentLive` ([`actions/ai-agent/tester.ts`](../../actions/ai-agent/tester.ts)) executa o pipeline **exatamente** como prod, com 3 ajustes cirúrgicos:

1. **Lead Tester sintético** ([`tester-context.ts`](./tester-context.ts)): phone `+5500000000XX` com `metadata.is_test=true`. Escondido do Kanban/Leads via filtro nas queries. `assigned_to` atribuído ao 1º membro ativo da org (pra `create_appointment` funcionar).
2. **Provider stub** ([`tester-provider.ts`](./tester-provider.ts)): implementa `WhatsAppProvider` inteiro mas captura `sendText/setTyping/sendMedia` em memória com timestamps. UI reconstroi timeline.
3. **service_role client**: necessário pras RPCs de debounce (`enqueue_pending_message`, `claim/complete_agent_conversation_flush`) que só dão GRANT pra `service_role`. Autorização continua via `requireAgentRole("admin")` (PR #252).

`agent_runs` criados com `is_test=true` (migration 047). Conversa persistente entre runs — usar botão "Resetar" pra zerar state.

⚠️ **Bug UX**: o botão "Resetar" fecha o sheet (`revalidatePath` re-mount). Workaround atual: reabrir Tester após reset.

---

## 9. Como criar um agente

Wizard em [`packages/ai-agent-ui/src/components/AgentCreationWizard.tsx`](../../../../../packages/ai-agent-ui/src/components/AgentCreationWizard.tsx). 3 steps: template → nome → modelo.

### Templates disponíveis

| Slug | Etapas | Uso |
|---|---|---|
| `blank` | 0 | Prompt base + anti-alucinação. Cria do zero |
| `atendimento_whatsapp` | 3 | Recepção + qualificação + transferência |
| `pre_venda` | 4 | Descoberta + apresentação + objeções + agendamento |
| `pos_venda_cobranca` | 3 | Dúvidas de pagamento/boleto |
| `tira_duvidas_faq` | 1 | RAG-first (use após popular Documentos/FAQ) |
| `consultor_funil_completo` | 5 | **Mais completo**: humanização + auto-actions + seedda tags/tipos de agendamento/templates de notificação |

### Seed automático (PR #251 + fixes #254/#255)

Quando o cliente escolhe o template `consultor_funil_completo`, o `applyTemplate` (em [`actions/ai-agent/configs.ts`](../../actions/ai-agent/configs.ts)):

1. Cria o `agent_config` com `behavior_mode='actions'` + `humanization_config`
2. Cria 4 tags (`qualificado`, `material-enviado`, `agendou-reuniao`, `cliente-fechado`)
3. Cria 2 `agenda_services` (`Consulta inicial 30min online`, `Reunião de fechamento 60min online`)
4. Cria 3 `agent_notification_templates` (target placeholder — cliente troca depois)
5. Materializa ~9 tools nativas em `agent_tools`
6. Linka todas as tools em todas as 5 stages via `agent_stage_tools` (45 rows)
7. Cria as 5 stages com `action_type` + `action_config.auto_actions`

Best-effort: falha em qualquer seed loga `console.error` mas segue. Agente criado sempre — cliente pode editar o que faltou.

---

## 9b. Follow-ups runtime (PR4 / mai/2026)

Cliente configura "avisar lead 24h sem resposta" via UI **"Follow-ups"** ([`FollowupsEditor`](../../../../../packages/ai-agent-ui/src/components/FollowupsEditor.tsx)). Cada `agent_followup` aponta pra um `agent_notification_template` (corpo da msg) + `delay_hours` (1..720).

Runtime ([`lib/ai-agent/followups/tick.ts`](followups/tick.ts)) é um tick chamado por cron externo via `POST /api/ai-agent/followups/tick` com auth `PERSIA_SCHEDULER_SECRET` ou `CRM_API_SECRET`. Pipeline:

1. Carrega todos `agent_followups` com `is_enabled=true` (cross-org via service_role)
2. Pra cada followup: query `agent_conversations` onde `last_interaction_at < now() - delay_hours` AND `human_handoff_at IS NULL` AND `config_id = followup.config_id`
3. Filtra conversas já em `agent_followup_runs(followup_id, conversation_id)` (dedupe)
4. **INSERT em `agent_followup_runs` ANTES do `provider.sendText`** — UNIQUE constraint garante idempotency mesmo com ticks concorrentes
5. Renderiza `template.body_template` com vars (`{{lead_name}}`, `{{agent_name}}`, `{{wa_link}}`, `{{lead_phone}}`) e envia pra **`lead.phone`** (NÃO pro `template.target_address` — templates aqui são reusados só como corpo da mensagem; destino sempre é o lead)
6. Falha de `sendText` pós-INSERT NÃO faz rollback do run — preferimos não retentar automaticamente pra evitar spam quando provider está flaky

Limites por tick: `MAX_PROCESSED_PER_TICK = 200`. Em escala alta, configurar tick mais frequente (a cada 5min) em vez de aumentar o cap (evita timeout do route).

**Cron**: agendado dentro da própria DB via [`pg_cron`](https://github.com/citusdata/pg_cron) — não depende de cron externo (EasyPanel/Vercel Cron/etc). Migration 051 registra o job `ai-agent-followups-tick` que roda `*/10 * * * *` (a cada 10min) e faz `net.http_post` no endpoint, reusando as DB settings `app.settings.scheduler_tick_url`/`_secret` (mesma infra do `scheduler-tick` da migration 025).

Pra inspecionar/parar/alterar a frequência depois:
```sql
-- Listar jobs ativos
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ai-agent%';

-- Ver últimas execuções
SELECT runid, start_time, status, return_message
  FROM cron.job_run_details
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'ai-agent-followups-tick')
  ORDER BY start_time DESC LIMIT 10;

-- Pausar / re-ativar
SELECT cron.unschedule('ai-agent-followups-tick');
-- (re-rodar a migration 051 ou cron.schedule(...) pra restaurar)
```

**Limitações conhecidas**:
- **Sem business_hours check**: pode disparar às 3am se a janela bate. Cliente configura delays compatíveis (48h em vez de 24h) ou aguarda follow-up que integre `isWithinBusinessHours` do `humanization_config`.
- **`last_interaction_at` é atualizado em qualquer atividade** (agente ou lead), então se a IA respondeu há pouco mas o lead não, o relógio re-iniciou. Aceitável pro caso "X horas sem resposta na conversa", mas refinamento futuro: campo separado `last_inbound_message_at`.
- **Cleanup de `agent_followup_runs`**: não implementado. Migration 027 sugere TTL >90d via job de manutenção (TODO).

---

## 10. Bugs conhecidos / pendências

Sessão de teste live em prod (mai/2026) descobriu 7 bugs. Documentação completa nos PRs linkados.

### ⚠️ Não corrigidos

| # | Sintoma | Impacto | Mitigação atual |
|---|---|---|---|
| **UX — Resetar fecha o sheet** | Clique no botão Resetar do Tester fecha o painel | Baixo (friction de teste) | Reabrir Tester manualmente após reset |

### ✅ Corrigidos na sessão de teste live

| # | Bug | PR |
|---|---|---|
| 1 | `permission denied for function enqueue_pending_message` — Tester usava client de user-auth, RPC só permite service_role | [#252](https://github.com/elnathancet-hue/crm-persia-v2/pull/252) |
| 2 | Bolha de resposta não renderizava no Tester (`!dryRun && provider` guard era forte demais) | [#253](https://github.com/elnathancet-hue/crm-persia-v2/pull/253) |
| 3 | Template não seedava `agent_stage_tools` — IA criada sem tools habilitadas | [#254](https://github.com/elnathancet-hue/crm-persia-v2/pull/254) |
| 4 | Schema mismatches em `applyTemplate` — `tags.description` não existe + `body` vs `body_template` | [#255](https://github.com/elnathancet-hue/crm-persia-v2/pull/255) |
| 5 | `create_appointment` selecionava `leads.timezone` (coluna inexistente) + Tester lead sem `assigned_to` | [#256](https://github.com/elnathancet-hue/crm-persia-v2/pull/256) |
| 6 | PR1 quick wins: `sendAssistantReply` não persistia em `messages`, `transfer_to_user` não pausava IA, auto-action queimava em placeholder, gpt-5* truncava em HANDOFF_REPLY (reasoning tokens dentro do budget) | [#259](https://github.com/elnathancet-hue/crm-persia-v2/pull/259) |
| **#7** | **PR2 — Alucinação de agendamento.** Causa raiz: auto_actions disparavam ON_ENTER (notif "lead agendou" saía mesmo sem appointment real). Fix: trigger opcional `on_tool_success` no schema + hook em `executeToolCall` pós-success. Template seed + migration 050 atualizados | [#260](https://github.com/elnathancet-hue/crm-persia-v2/pull/260) |
| **PR4** | Runtime de `agent_followups` (cron tick dispatcher) — schema/UI/CRUD existiam desde 027 mas faltava o dispatcher real. Pipeline: load enabled followups → dueConversations → INSERT idempotency lock → render + sendText pra lead. Migration 051 (PR #262) registra o pg_cron job `*/10 * * * *` | [#261](https://github.com/elnathancet-hue/crm-persia-v2/pull/261) + [#262](https://github.com/elnathancet-hue/crm-persia-v2/pull/262) |
| **#8** | **`transfer_to_stage` faltava no seed.** Causa raiz: `applyTemplate` coletava tools só de `auto_actions` + agenda + `transfer_to_user`. IA ficava presa na etapa 1 fazendo qualificação + apresentação + agendamento inline. Fix em 4 camadas: seed (configs.ts) + tool description imperativa (tool-presets.ts) + REGRA DE TRANSIÇÃO no system prompt + migration 052 (seed retroativo idempotente) | [#263](https://github.com/elnathancet-hue/crm-persia-v2/pull/263) |
| **PR3** | **Per-action retry tracking pra auto-actions on_enter.** Antes: 1 ação falhando marcava a stage inteira como visitada — side effect perdido pra sempre. Agora: tracking estruturado em `actions_executed_detail` JSONB (key `on_enter:<stage_id>`) com `succeeded[]` + `failed{}` por índice. Re-entrada retenta SÓ as falhas até `MAX_AUTO_ACTION_RETRIES=3`. Persist por ação garante crash-safety. Helpers em [stage-actions.ts](../../../../../packages/shared/src/ai-agent/stage-actions.ts), migration 053 | [#265](https://github.com/elnathancet-hue/crm-persia-v2/pull/265) |

### 📋 Follow-ups futuros (sem PR ainda)

- **Handler `schedule_event`** (Google Calendar OAuth runtime) — preset existe, falta wire-up
- **Handler `send_audio`** (TTS) — preset existe, sem provider TTS escolhido
- **Refator compartilhado `ensureCrmContext`** — achado #2 da auditoria 360, code smell não-bug
- **Bucket `tools` privado** — atualmente público, deveria virar signed URL
- **Hardening `usage_count`** em `automation_tools` — campo existe mas não é incrementado
- **Telemetria de alucinação** (Bug #7 belt-and-suspenders) — logar warning quando reply menciona "agendei" sem step `create_appointment succeeded` no run
- **Refinamento de prompts dos templates** — forçar `transfer_to_stage` mais cedo, evitar handoff prematuro
- **UI debug do PR3 retry tracking** — LeadDrawer mostrando estado `succeeded[]`/`failed{}` por ação + `last_error` (útil pra debug em prod sem precisar consultar SQL)
- **Telemetria de on_tool_success** usando `makeOnToolSuccessKey` — helper já pronto na PR3 mas sem uso runtime atual

---

## 11. Migrations relevantes (cronológicas)

```
017_ai_agent_core.sql          → agent_configs, agent_stages, agent_tools, agent_conversations, agent_runs, agent_steps
019_ai_agent_debounce.sql      → pending_messages + RPCs enqueue/claim/complete/release (service_role only)
022_ai_agent_rag.sql           → agent_knowledge_sources + embedding columns
023_ai_agent_notifications.sql → agent_notification_templates (body_template, NÃO body)
024_scheduled_jobs.sql         → agent_scheduled_jobs
025_calendar_connections.sql   → agent_calendar_connections (vault refresh tokens)
031_agenda_module.sql          → appointments + agenda_services + availability_rules
039_kanban_lead_centric.sql    → leads ganha pipeline_id/stage_id/sort_order (refator do Kanban)
040_ai_agent_agenda_handlers.sql → permissions pros handlers de agenda
041_ai_agent_humanization.sql  → agent_configs.humanization_config JSONB
042_ai_agent_after_hours_notified.sql → agent_conversations.after_hours_notified_at
043_ai_agent_send_media_handler.sql → CHECK constraint pro handler
044_ai_agent_primary.sql       → agent_configs.is_primary BOOLEAN + unique partial index
045_ai_agent_entry_conditions.sql → agent_entry_conditions (routing OR-logic)
046_ai_agent_behavior_mode.sql → agent_configs.behavior_mode enum + agent_stages.action_type
047_ai_agent_runs_is_test.sql  → agent_runs.is_test pra filtrar Tester de dashboards
048_agenda_services_for_ai.sql → agenda_services ganha slug + default_channel + default_location + default_meeting_url
049_ai_agent_stage_action_config.sql → agent_stages.action_config + agent_conversations.actions_executed
```

---

## 12. Como contribuir

1. **Antes de editar:** ler este README + a memória relacionada
2. **Toda nova tool nativa:**
   - Criar handler em [`tools/<name>.ts`](./tools/) com schema Zod + tratamento de `dry_run`
   - Adicionar em [`tools/registry.ts`](./tools/registry.ts) e [`tool-presets.ts`](../../../../shared/src/ai-agent/tool-presets.ts)
   - Atualizar `loadXxxCatalog` em [`tool-catalogs.ts`](./tool-catalogs.ts) se precisa contexto no prompt
   - Atualizar tabela da seção 4 deste README
3. **Toda mudança em schema:**
   - Validar contra DB real (não imaginado — lição do PR #255)
   - Migration adicional, NÃO Dashboard
   - Atualizar tabela da seção 2 deste README
4. **Toda mudança em humanização:**
   - Atualizar tabela da seção 6
   - Adicionar test no `humanization.test.ts`
5. **Toda mudança em `applyTemplate`:**
   - Testar **end-to-end em prod** (criar agente do template + verificar via SQL)
   - Schema mismatches são silenciados como `console.error` — VALIDAR ANTES de mergear
