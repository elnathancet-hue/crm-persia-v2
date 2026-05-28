# `lib/ai-agent` — pasta runtime

> **A documentação técnica completa moveu pra [`/docs/ai-agent/`](../../../../../docs/ai-agent/README.md)** (raiz do monorepo).
>
> Este README antigo (2026-05-17) ficou desatualizado pós pivot Flow + 20 PRs de
> auditoria mai/2026. Mantenho aqui só um mapa rápido pra navegar o diretório.

## O que vive aqui

Código runtime do AI Agent. Tudo que roda em response a webhook, cron tick, ou Tester.

```
lib/ai-agent/
├── executor.ts                  # entry point (tryEnqueueForNativeAgent)
├── debounce.ts                  # janela 10s + flushReadyConversations
├── cost-limits.ts               # assertWithinCostLimits + helpers
├── rate-limits.ts               # placeholder (não usado ativamente)
├── feature-flag.ts              # isNativeAgentEnabled
├── send-guard.ts                # assertCanAct (epoch + handoff check)
├── send-reply.ts                # sendAssistantReply (split + setTyping + provider.sendText)
├── summarization.ts             # runConversationSummarization + loadConversationHistory
├── pause-agent.ts               # pauseAgent helper (humano respondeu)
├── handoff-notification.ts      # template render + notify equipe
├── notifications.ts             # provider.sendText pra trigger_notification handler
├── tool-call-sanitizer.ts       # fix de tool_calls malformados do OpenAI
├── webhook-caller.ts            # n8n_webhook executor + allowlist
├── guardrails.ts                # max_iterations + helpers
├── db.ts                        # asAgentDb (typed wrapper de SupabaseClient)
│
├── flow/                        # runtime do flow pivot (post mai/2026)
│   ├── runner.ts                # runFlow — visitor de nós
│   ├── loader.ts                # loadFlowByConfigId + LoadedFlow
│   ├── types.ts                 # FlowRunContext, FlowRunResult, etc
│   ├── conditions.ts            # avalia condition node
│   ├── triggers.ts              # matching entry node triggers
│   ├── handler-context.ts       # buildNativeHandlerContext (PR-5)
│   ├── knowledge-injector.ts    # buildKnowledgeBlock (full/rag/auto)
│   ├── knowledge-cache.ts       # in-memory TTL + sources_hash
│   ├── lead-interpolation.ts    # {{lead.X}} placeholders (PR #367)
│   ├── tester-context.ts        # ensureTesterContext + lead sintético
│   ├── tester-gates.ts          # collectGateWarnings (PR #370)
│   ├── tester-provider.ts       # provider stub pro Tester
│   └── realtime-provider.ts     # provider real (chama Uazapi/Meta)
│
├── tools/                       # 1 handler nativo por arquivo
│   ├── registry.ts              # mapa native_handler → handler
│   ├── schemas.ts               # Zod schemas dos inputs
│   ├── shared.ts                # helpers comuns (lead_activities log)
│   ├── add-tag.ts
│   ├── remove-tag.ts            # PR #361
│   ├── move-pipeline-stage.ts
│   ├── set-lead-custom-field.ts # PR #367 (com lead interpolation)
│   ├── transfer-to-user.ts
│   ├── transfer-to-agent.ts     # PR-5 (modelo flow)
│   ├── stop-agent.ts
│   ├── send-media.ts
│   ├── create-appointment.ts
│   ├── list-lead-appointments.ts
│   ├── cancel-appointment.ts
│   ├── reschedule-appointment.ts
│   ├── trigger-notification.ts
│   ├── round-robin-user.ts
│   └── emit-event.ts            # branching via tool
│
├── rag/                         # Voyage AI + chunking + indexing
│   ├── voyage-client.ts
│   ├── retriever.ts
│   ├── chunker.ts
│   ├── indexer.ts
│   └── parsers/                 # PDF, DOCX, etc
│
├── followups/
│   └── tick.ts                  # cron */10min — dispara followups
│
└── scheduler/                   # placeholder pra scheduled jobs
```

## Onde estão as docs

| Quer entender... | Leia |
| --- | --- |
| Arquitetura geral | [docs/ai-agent/01-architecture.md](../../../../../docs/ai-agent/01-architecture.md) |
| Modelo de dados (tabelas, migrations) | [docs/ai-agent/02-data-model.md](../../../../../docs/ai-agent/02-data-model.md) |
| Flow runtime detalhado | [docs/ai-agent/03-flow-runtime.md](../../../../../docs/ai-agent/03-flow-runtime.md) |
| Tools e handlers | [docs/ai-agent/04-tools-and-handlers.md](../../../../../docs/ai-agent/04-tools-and-handlers.md) |
| Knowledge / RAG | [docs/ai-agent/05-knowledge.md](../../../../../docs/ai-agent/05-knowledge.md) |
| Humanização | [docs/ai-agent/06-humanization.md](../../../../../docs/ai-agent/06-humanization.md) |
| Tester + Canvas | [docs/ai-agent/07-tester-and-canvas.md](../../../../../docs/ai-agent/07-tester-and-canvas.md) |
| Templates + paridade Admin/CRM | [docs/ai-agent/08-templates-and-parity.md](../../../../../docs/ai-agent/08-templates-and-parity.md) |
| Observability / dashboards | [docs/ai-agent/09-observability.md](../../../../../docs/ai-agent/09-observability.md) |
| Troubleshooting "cliente reclama de X" | [docs/ai-agent/10-runbooks.md](../../../../../docs/ai-agent/10-runbooks.md) |
| Invariantes / contrato pra Codex | [docs/ai-agent/INVARIANTS.md](../../../../../docs/ai-agent/INVARIANTS.md) |
