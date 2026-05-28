# AI Agent — Documentação técnica

> **Status:** doc gerada em 2026-05-27 pós PR #353 (10 auditorias) + 14 itens backlog (#354-#372).
> Reflete o estado pós-pivot Flow (`migration 054`) e o estado pós-`agent_conversations` UNIQUE
> (`migrations 070-071`). Caso o sistema avance, atualize a tabela [Status do sistema](#status-do-sistema) abaixo.
>
> **Público:** dev solo (ref rápida em prod) + Codex/outros agentes IA (spec read-only).
> Documentação cliente/suporte vive em outro lugar.

## Sumário

| Doc | O que cobre | Quando ler |
| --- | --- | --- |
| [01-architecture.md](./01-architecture.md) | Fluxo end-to-end de uma msg WhatsApp → resposta. Decisões arquiteturais (por que Flow, por que send-guard, por que UNIQUE partial). | Onboarding ou debug de bug "estranho que envolve várias camadas" |
| [02-data-model.md](./02-data-model.md) | Schema completo (`agent_*` + tabelas externas), FKs, RLS, todas as migrations 017-073, CHECK constraints. | Sempre antes de migration nova. |
| [03-flow-runtime.md](./03-flow-runtime.md) | `runner.ts`, tipos de nó (entry/ai_agent/action/condition), AI loop, `ToolExecutionMode`, `dry_run`, send-guard. | Bug no runtime do flow ou novo tipo de nó. |
| [04-tools-and-handlers.md](./04-tools-and-handlers.md) | 14 native handlers + tool presets + MCP + n8n_webhook. Padrão de handler. Lead interpolation. | Adicionar tool nova. |
| [05-knowledge.md](./05-knowledge.md) | Modos `full`/`rag`/`auto`, threshold em tokens, cache por `sources_hash`, Voyage RAG, hard-cap. | Cliente reclama de "IA não viu o doc" ou custo OpenAI altíssimo. |
| [06-humanization.md](./06-humanization.md) | Split, pause/resume keywords (fuzzy + unaccent), business hours, after-hours cooldown, handoff, auto-pausa quando humano responde. | Cliente reclama de UX da IA (ritmo, horário, pausa). |
| [07-tester-and-canvas.md](./07-tester-and-canvas.md) | `testAgentLive`, `simulateCrmEvent`, `gate_warnings`. FlowCanvas, CAS optimistic locking, preview impact, NodeConfigSheet. | Dev no Tester ou no Canvas. |
| [08-templates-and-parity.md](./08-templates-and-parity.md) | Templates (`blank`, `consultor_funil_completo`, etc), `applyAgentTemplate`, materializer compartilhado, paridade Admin/CRM. | Novo template ou bug "Admin não bate com CRM". |
| [09-observability.md](./09-observability.md) | Todos os log codes (`incoming_pipeline_*`, `ai_agent_*`, etc), SQL pra dashboards, métricas chave. | Setup de monitoring ou triage em prod. |
| [10-runbooks.md](./10-runbooks.md) | "Cliente reclama de X → diagnóstico Y". Cenários reais já vistos (alucinação de agendamento, IA travada em etapa, factura OpenAI explodiu). | **Quando o cliente liga.** |
| [INVARIANTS.md](./INVARIANTS.md) | Spec read-only pra Codex. Shapes, contratos, o que NÃO mexer. Padrões obrigatórios. | Codex deve ler ANTES de qualquer edit em `lib/ai-agent/*` ou `packages/shared/src/ai-agent/*`. |

---

## Status do sistema

| Subsistema | Estado | Versão de referência |
| --- | --- | --- |
| **Flow runtime** | Estável, em prod | migration 054 (pivot) |
| **Tester** | Estável (gate_warnings + cost real) | PR #370 |
| **Knowledge** | Estável (3 modos, cache, threshold em tokens) | PR #371 |
| **Humanização** | Estável (fuzzy keywords + business hours) | PR #369 |
| **MCP** | Aceito no contrato; runtime depende de `mcp_server_connections` configurado | migration 062 |
| **n8n fallback** | Estável (timeout 8s + AbortController) | PR #372 |
| **Agenda integration** | Estável (4 handlers + Google Calendar) | migration 061 |
| **Admin parity** | Paridade total com CRM | PR #365 |
| **Webhook → fila async** | NÃO implementado (curto prazo cobre 95% dos casos via timeout 8s) | Follow-up |
| **Cost ceiling default** | NÃO implementado | Follow-up |
| **Handler `schedule_event`** | Placeholder (preset existe, sem runtime) | Follow-up |
| **Handler `send_audio`** | Placeholder (preset existe, sem TTS provider) | Follow-up |

## Status dos PRs principais (mai/2026)

- **PR-1 a PR-6** (#355-#358, #360, #361): barreiras críticas da auditoria #353. Mergeados.
- **Backlog #1 a #14** (#354, #359, #362-#372): refactors e melhorias. Mergeados.
- Total: **20 PRs**, **552+ testes**, 4 migrations (070-073), ~25% crescimento de cobertura ai-agent.

---

## Onde-encontrar-o-quê

Mapa rápido código ↔ doc.

### Por sintoma do cliente

| Sintoma | Comece em |
| --- | --- |
| "A IA não respondeu" | [10-runbooks.md § IA muda](./10-runbooks.md) |
| "A IA respondeu duas vezes" | [10-runbooks.md § Resposta duplicada](./10-runbooks.md) |
| "A IA inventou que agendou" | [10-runbooks.md § Alucinação de tool](./10-runbooks.md) |
| "A IA não viu o documento que subi" | [05-knowledge.md](./05-knowledge.md) |
| "A IA falou fora do horário" | [06-humanization.md § Business hours](./06-humanization.md) |
| "Mandei 'pausar' e a IA continuou" | [06-humanization.md § Keywords](./06-humanization.md) |
| "O factura OpenAI explodiu" | [05-knowledge.md § Hard-cap](./05-knowledge.md) + [09-observability.md](./09-observability.md) |
| "Salvei o canvas mas perdi minhas mudanças" | [07-tester-and-canvas.md § CAS](./07-tester-and-canvas.md) |
| "Tester verde mas em prod não dispara" | [07-tester-and-canvas.md § gate_warnings](./07-tester-and-canvas.md) |

### Por arquivo de código

| Arquivo | Doc relevante |
| --- | --- |
| `apps/crm/src/lib/ai-agent/executor.ts` | [01-architecture.md](./01-architecture.md) + [03-flow-runtime.md](./03-flow-runtime.md) |
| `apps/crm/src/lib/ai-agent/flow/runner.ts` | [03-flow-runtime.md](./03-flow-runtime.md) |
| `apps/crm/src/lib/ai-agent/flow/knowledge-injector.ts` | [05-knowledge.md](./05-knowledge.md) |
| `apps/crm/src/lib/ai-agent/flow/knowledge-cache.ts` | [05-knowledge.md § Cache](./05-knowledge.md) |
| `apps/crm/src/lib/ai-agent/flow/tester-gates.ts` | [07-tester-and-canvas.md § gate_warnings](./07-tester-and-canvas.md) |
| `apps/crm/src/lib/ai-agent/flow/lead-interpolation.ts` | [04-tools-and-handlers.md § Lead interpolation](./04-tools-and-handlers.md) |
| `apps/crm/src/lib/ai-agent/tools/*` | [04-tools-and-handlers.md](./04-tools-and-handlers.md) |
| `apps/crm/src/lib/ai-agent/summarization.ts` | [03-flow-runtime.md § Summarization](./03-flow-runtime.md) |
| `apps/crm/src/lib/ai-agent/debounce.ts` | [01-architecture.md § Debounce](./01-architecture.md) |
| `apps/crm/src/lib/ai-agent/send-guard.ts` | [03-flow-runtime.md § Send-guard](./03-flow-runtime.md) |
| `apps/crm/src/lib/whatsapp/incoming-pipeline.ts` | [01-architecture.md § Pipeline legacy](./01-architecture.md) |
| `packages/shared/src/ai-agent/humanization.ts` | [06-humanization.md](./06-humanization.md) |
| `packages/shared/src/ai-agent/template-materializer.ts` | [08-templates-and-parity.md](./08-templates-and-parity.md) |
| `packages/shared/src/ai-agent/flow.ts` + `flow-validation.ts` | [03-flow-runtime.md](./03-flow-runtime.md) |
| `packages/shared/src/ai-agent/token-estimate.ts` | [05-knowledge.md § Token threshold](./05-knowledge.md) |
| `packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx` | [07-tester-and-canvas.md § Canvas](./07-tester-and-canvas.md) |
| `packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx` | [07-tester-and-canvas.md § NodeConfigSheet](./07-tester-and-canvas.md) |
| `packages/ai-agent-ui/src/components/AgentCreationWizard.tsx` | [08-templates-and-parity.md](./08-templates-and-parity.md) |

### Por tabela do DB

| Tabela | Doc | Nota |
| --- | --- | --- |
| `agent_configs` | [02-data-model.md](./02-data-model.md) | Core. `is_primary` UNIQUE partial. `humanization_config` JSONB normalizado em runtime. |
| `agent_flows` | [02-data-model.md](./02-data-model.md) | Pivot mai/2026. `version` é o CAS lock (PR #359). |
| `agent_conversations` | [02-data-model.md](./02-data-model.md) | UNIQUE partial em `(org, lead, crm_conversation_id)` desde migration 071. Sticky por lead. |
| `agent_runs` + `agent_steps` | [02-data-model.md](./02-data-model.md) | Audit. `is_test=true` filtrável. |
| `agent_knowledge_sources` + `_chunks` | [05-knowledge.md](./05-knowledge.md) | Voyage RAG, dim 1024. |
| `pending_messages` | [01-architecture.md § Debounce](./01-architecture.md) | Buffer ~10s. RPCs só service_role. |
| `agent_followups` + `_runs` | [03-flow-runtime.md § Followups](./03-flow-runtime.md) | pg_cron */10. |
| `mcp_server_connections` | [04-tools-and-handlers.md § MCP](./04-tools-and-handlers.md) | OAuth opcional. |

---

## Convenções desta documentação

1. **Linguagem:** PT-BR no corpo, identificadores em inglês.
2. **Trechos de código:** sempre com caminho absoluto + número de linha quando relevante.
3. **Datas:** ISO 8601 (`2026-05-27`).
4. **Referências a PRs:** sempre via número (`PR #370`). Não copiar URLs longas no corpo.
5. **Migrations:** sempre com prefixo numérico (`migration 071`, não "a migration nova").
6. **"NUNCA" vs "evite":** "NUNCA" é regra dura (vai quebrar algo). "evite" é convenção (pode mexer sob aviso).
7. **Diagramas:** ASCII art simples (não Mermaid). Mais portável.

## Quem mantém

Atualização é responsabilidade de quem faz o PR. Toda mudança que toca em código listado aqui **DEVE** atualizar a doc correspondente no mesmo PR. Doc desatualizada é pior que sem doc.

Quando criar nova doc nesta pasta, atualize o [Sumário](#sumário) acima e o [mapa Onde-encontrar-o-quê](#onde-encontrar-o-quê).
