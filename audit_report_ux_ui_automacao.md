# Auditoria UX/UI — Módulo Automação (CRM + Admin)

> Auditoria READ-ONLY (nenhum código alterado). 3 agentes: páginas de automação do CRM (+ arquitetura de informação), jornada completa do cliente leigo no AI Agent, e o módulo no admin. Complementa a seção 8 de `audit_report_ux_ui.md` (pacote ai-agent-ui) — achados de lá NÃO são repetidos aqui, salvo agravamento. Fonte de verdade: o código. Gerado em 2026-06-11.

---

## 0. Top 12 por impacto

1. **[Critical] "Avisar equipe" é um beco sem saída total**: o node do fluxo exige template e instrui "Crie na aba Notificações" ([NodeConfigSheet.tsx:837](packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:837)) — **a aba Notificações não existe** (`NotificationsTab` exportada mas nunca renderizada em app nenhum). O caso de uso nº 1 do dono de negócio ("me avisa quando o lead ficar pronto/pedir humano") está quebrado de ponta a ponta. O PR 22 removeu o `HandoffNotificationCard` do RulesTab prometendo que viveria no Fluxo — o CRUD nunca foi religado.
2. **[Critical] 4 motores de IA convivendo, 5 UIs**: runtime tenta agente nativo → keyword flows → n8n webhook → assistant legacy OpenAI ([incoming-pipeline.ts:476](apps/crm/src/lib/whatsapp/incoming-pipeline.ts:476)+). Configuráveis em `/automations/agents`, `/automations/assistant`, `/automations/webhook`, `/flows` e `/automations/splitter` — os 4 últimos ocultos da navegação mas com URLs vivas. Cliente que cai num link antigo configura o sistema errado, e **dois motores podem responder a mesma conversa**.
3. **[High] 9 componentes do pacote estão órfãos** (exportados, nunca wired em app algum): `NotificationsTab`, `FAQTab`, `SchedulingTab`, `CalendarConnectionsCard`, `HandoffNotificationCard`, `DecisionIntelligenceModal`, `QuickToolsCard`, `ReactivateAgentButton`, `LimitsUsageTab`. Três deles são becos na jornada (notificações, FAQ, reconectar Google in-context). ~2k linhas compiladas sem porta de entrada.
4. **[High] Excluir sem NENHUMA confirmação no CRM**: [assistant-list-client.tsx:259](apps/crm/src/app/(dashboard)/automations/assistant/assistant-list-client.tsx:259), [tools-client.tsx:268](apps/crm/src/app/(dashboard)/automations/tools/tools-client.tsx:268) (apaga arquivo do storage), [appointment-types-client.tsx:267](apps/crm/src/app/(dashboard)/automations/appointments/appointment-types-client.tsx:267) (quebra agendamento da IA). E no admin, pior: [appointments/page.tsx:109](apps/admin/src/app/(dashboard)/automations/appointments/page.tsx:109) deleta via form action direto, sem nem `confirm()`.
5. **[High] Salvar que falha em silêncio**: [splitter-client.tsx:49](apps/crm/src/app/(dashboard)/automations/splitter/splitter-client.tsx:49) e [webhook-client.tsx:31](apps/crm/src/app/(dashboard)/automations/webhook/webhook-client.tsx:31) com `catch { // silently fail }` no SAVE; flows-client com 4 catches mudos (criar/duplicar/toggle/excluir).
6. **[High] Biblioteca do canvas nasce invisível**: `sidebarCollapsed` inicia `true` ([FlowCanvas.tsx:214](packages/ai-agent-ui/src/components/flow/FlowCanvas.tsx:214)) e as 3 categorias nascem fechadas ([FlowSidebar.tsx:47](packages/ai-agent-ui/src/components/flow/FlowSidebar.tsx:47)) — o editor abre sem nenhum card visível e o empty state aponta pra "lateral esquerda" colapsada. Fix de 2 linhas, maior fricção da montagem de fluxo.
7. **[High] AuditTab não responde "a IA respondeu certo ontem?"**: runs sem lead, sem mensagens, sem link pra conversa — só metadados com jargão ("LLM", "guardrail", `native_handler`, JSON cru). O Tester traduz os mesmos step_types; o Audit não.
8. **[High] PromptBuilderSection não ajuda a escrever o prompt**: o campo mais importante do produto é um textarea monoespaçado colapsado, sem exemplo/estrutura/validação — o comentário do código promete modo "por partes (Persona/Missão/Regras/Estilo)" que não existe.
9. **[High] Admin: "Biblioteca de mídia" que não é**: o flyout e o card do hub prometem banco de mídia, mas [automations/tools/page.tsx](apps/admin/src/app/(dashboard)/automations/tools/page.tsx) entrega o legacy de integrações n8n — a biblioteca de mídia do cliente é **ingerenciável pelo admin**. E o Tester do admin é degradado (sem `testAgentLive`/reset/simulate — actions não wired).
10. **[High] Token economy invisível PRO ADMIN também (gap inverso)**: a política diz que o admin PODE ver tokens/custos, mas `LimitsUsageTab` está órfã e o RulesTab esconde os campos sem prop de override. O backend do admin já wire `setCostLimit`/`getUsageStats` ([admin-actions.ts:90](apps/admin/src/features/ai-agent/admin-actions.ts:90)) — só falta a UI.
11. **[Medium] Splitter fantasma**: `/automations/splitter` edita `ai_assistants.message_splitting` (só vale pro legacy) — cliente com Agente IA nativo configura e **nada acontece**, sem aviso (o nativo tem o próprio "picotar" na humanização).
12. **[Medium] tools-client "Copiar URL da API" copia URL quebrada**: gera `?orgId=ORG_ID` com placeholder literal ([tools-client.tsx:147](apps/crm/src/app/(dashboard)/automations/tools/tools-client.tsx:147)).

---

## 1. Arquitetura de informação — mapa das superfícies (CRM)

| Rota | O que é | Backend | Na nav? | Sobrepõe com |
|---|---|---|---|---|
| `/automations` (hub) | 2 cards: Agente IA, Biblioteca de mídia | — | ✅ | Nav mostra 3 itens, hub 2 — "Tipos de agendamento" sem card |
| `/automations/agents` | **AI Agent nativo** (novo) | `agent_configs` via `@persia/ai-agent-ui` | ✅ | concorre em runtime com legacy |
| `/automations/assistant` | Assistentes legacy | `ai_assistants` | ❌ (URL viva) | mesma entidade de `/ai` e do splitter |
| `/automations/splitter` | Picotador legacy | `ai_assistants.message_splitting` | ❌ (URL viva) | duplica humanização do nativo |
| `/automations/webhook` | IA externa n8n | `organizations.settings` | ❌ (URL viva) | 3º motor |
| `/automations/tools` | Biblioteca de mídia | `automation_tools` + bucket | ✅ | strings internas ainda dizem "Tool" |
| `/automations/appointments` | Tipos de agendamento | **`agenda_services`** | ✅ (sem card no hub) | Agenda chama a mesma tabela de "Serviço" |
| `/ai` | redirect → assistant | — | ❌ | `ai-client.tsx` (400 linhas, com UI de tokens) é **código morto** |
| `/flows` (+[id]) | Editor de fluxos legacy (JSON cru) | `flows` | ❌ órfã | colide com a aba "Fluxo" do agente; keyword flows ainda executam |

**Achados de IA (information architecture):**
- **[Alto]** 3 nomes pra "IA que responde" ("Agente IA", "Assistentes IA", "Webhook IA") + colisão com "agente" humano (role `agent`). Recomendação: banner de deprecação nas páginas legacy apontando pro Agente IA.
- **[Médio]** `agenda_services` = "Tipo de agendamento" na Automação e "Serviço" na Agenda — cliente cadastra um e vê o outro. Unificar vocabulário.
- **[Médio]** "Fluxos" ambíguo (`/flows` legacy vs aba Fluxo do agente). Matar/renomear o legacy (manter runtime de keyword até ripar).
- **[Baixo]** hub: adicionar o 3º card (Tipos de agendamento — página crítica: "sem isso a IA inventa títulos").
- **[Baixo]** deletar `ai-client.tsx` (morto e com UI de tokens que viola a política).

## 2. Jornada do leigo (resumo por passo)

1. **Lista**: ✅ empty state e banner de 5 estados exemplares. ⚠️ "recurso da organização" (feature flag) compete com ativar/pausar o agente — dois interruptores com vocabulário quase igual; `gpt-5-mini` cru no card.
2. **Wizard**: ✅ validação e resumo bons. ⚠️ `isPrimary` nasce desligado mesmo no 1º agente → cliente cria, ativa e ganha banner "Defina o principal" sem entender; nada comunica que um fluxo mínimo já foi seedado.
3. **Configuração**: ⚠️ obrigatório vs opcional invisível (nenhum asterisco; o badge "padrão" diz "não mexa", nada diz "nisso você PRECISA mexer"); grupo "Conhecimento" prometido na sidebar não existe (documentos enterrados no meio de Configurações); "Fontes estruturadas" pede JSON cru com "Validar JSON". ✅ accordions+DirtyDot+HelpTooltips+dirty-state exemplares.
4. **Conhecimento**: ⚠️ **FAQTab é código morto** — "quero que a IA responda as perguntas frequentes" não tem porta de entrada; erro de indexação só no `title` (hover); `window.confirm` com "chunks indexados". ✅ dropzone, formatos/limites comunicados, polling de status.
5. **Fluxo**: ver Top 12 itens 1 e 6. ⚠️ referências cross-module em texto puro sem link dentro de fullscreen com guard de saída ("Configure em Agenda → Tipos"); card "Criar agendamento" determinístico pede data fixa **em UTC** (armadilha — o caminho certo, IA negociando horário, é invisível); nodes sempre expandidos (440-580px) pesam o canvas. ✅ flow seedado, validação pré-save, preview de impacto, catálogo com o melhor PT-BR do módulo.
6. **Follow-ups**: ✅ "cobrar em 24h" em 4 interações, proteção anti-spam explicada, delays sugeridos. ⚠️ "Etapa" = 4ª acepção da palavra no módulo; MetricCard mostra janela default e não a configurada.
7. **Agenda/Calendar**: ⚠️ conectar Google = 6 saltos saindo do editor, com `CalendarConnectionsCard` (que faria em 2 cliques, com `returnTo` pronto) **órfão**; conexão expirada mostra "(expired)" cru sem CTA de reconectar. ✅ default "Agenda do CRM" zero-config.
8. **Teste**: ✅ modo fiel raro no gênero, "tools simuladas" remove medo. ⚠️ "Avançou para node: <uuid>" ilegível; "verifique logs" — cliente não tem logs.
9. **Ativação**: ⚠️ checklist de publicação é 1 chip ("Ativar agente") — dá pra ativar com prompt vazio/sem entrada/sem WhatsApp e nada avisa (o comentário promete 3 chips); `ReactivateAgentButton` órfão → conversa auto-pausada não tem reativação no módulo. ✅ tooltips de status excelentes.
10. **Acompanhamento**: ver Top 12 item 7.
11. **Notificações/handoff**: **nada wired** (ver Top 12 itens 1 e 3). O switch "Permitir transferir pra humano" existe, mas avisar o time é inconfigurável.

**Becos sem saída (ranking):** 1) aba Notificações inexistente; 2) AuditTab sem conversa; 3) Google Calendar via êxodo; 4) FAQTab inacessível; 5) biblioteca do canvas invisível; 6) "node: <uuid>" no Tester; 7) "verifique logs"; 8) cross-links em texto puro; 9) erro de indexação só no hover; 10) auto-pausa sem botão de reativar.

## 3. Vocabulário — inconsistências transversais

- **"Etapa"** = funil (Kanban) + follow-up + fluxo + Tester. A palavra mais usada é a mais ambígua.
- **Tarefa / card / node** — 3 nomes pro mesmo bloco do canvas.
- **"Template"** ×2: de mensagem (com CRUD) e de notificação (sem CRUD nenhum).
- **Entradas ×2**: EntryConditionsCard (Configurações) vs Entry nodes (canvas) — sem ponte explicativa.
- **Modelo em 3 dialetos**: "Padrão (recomendado)" (wizard) / "GPT-5 mini (padrão)" (RulesTab) / `gpt-5-mini` cru (card da lista).
- **"Agente nativo" / "recurso" / "Agente IA"** pra mesma feature flag.
- **Acentuação bipolar por idade do arquivo**: AgentsList/Wizard/RulesTab corretos; FollowupTab, EntryConditionsCard, metade do TesterSheet, splitter, assistant sem acentos.
- **Comentário ≠ código em 3 promessas de UX**: sidebar com grupo Conhecimento, PromptBuilder por partes, checklist 3 chips — o código documenta uma jornada melhor que a entregue.

## 4. Achados novos por página (CRM)

- **[Alto]** Excluir sem confirmação ×3 (Top 12 item 4) — padrão AlertDialog já existe em AgentsList:229.
- **[Alto]** Saves com catch silencioso (splitter/webhook) e 4 catches mudos no flows-client (Top 12 itens 5).
- **[Alto]** tools-client: página "Biblioteca de mídia" falando "Tool" em TODAS as strings ("Nova Tool", "Nenhuma tool", "Tool adicionada!").
- **[Médio]** "Copiar URL da API" com `ORG_ID` literal; box "API para n8n" com `GET /api/tools?...` exposto pro leigo (mover pra "Avançado").
- **[Médio]** appointment-types SEM opção de editar (action `updateAppointmentType` existe; UI só tem toggle/excluir) — errou a duração? excluir e recriar, perdendo o slug usado pela IA. + `slug:` em `<code>` no card sem explicação.
- **[Médio]** `<DropdownMenuTrigger><Button/>` (button aninhado) em assistant:240, tools:249, appointments:252 — mesma classe do achado geral, 3 telas novas.
- **[Médio]** flow-editor legacy: dois textareas de JSON cru com promessa "editor visual em breve" — reforça matar a rota.
- **[Baixo]** flows-client coluna "Leads" exibe `executions_count`; loading.tsx do hub desenha 5 tabs+6 cards que não existem mais (skeleton mentiroso); acentos (assistant:289/329/379, splitter:127/137, appointments:116, tools:205, flows:304); labels sem htmlFor nos dialogs de assistant/tools; `<input type="file">` cru; feedback de sucesso por `<span>`+setTimeout em vez de toast (splitter/webhook); AgentsList toasts com jargão ("Falha ao atualizar flag"); sem metadata em agents/[id] e flows/[id].
- **Já conhecidos confirmados**: catch{} em tools:143 e assistant:177; SelectValue crus (tools 173/318, assistant 310, appointments 365, flow-editor 152); aria-label de flows-client parcialmente corrigido (Editar ✅; Duplicar/Toggle/Excluir ❌).

## 5. Admin — módulo automação

**Respostas às perguntas-chave:**
1. **Token economy no admin: GAP** (Top 12 item 10) — backend pronto, UI órfã.
2. **Hub divergente nas 2 direções**: admin pré-cleanup (4 cards com legacy como primário + badge "Novo" obsoleto), sem card de appointments; flyout ≠ hub. Sem rota splitter (campos inline no form do assistant).
3. **Configurar agente PRA um cliente**: segurança exemplar (cookie assinado vs Zustand, cross-org write impossível), MAS loads `try/finally` **sem catch** → desync multi-tab rende lista vazia/"não encontrado" SEM erro visível; subtítulos com `activeOrgName` do Zustand sobre dados do cookie podem rotular dados da org errada; appointments nem é gated (`requireSuperadminForOrg` explode no error.tsx root).
4. **Paridade**: assistant = forks divergentes (nenhum superset); tools = **páginas sobre coisas diferentes**; webhook = read-only de outra fonte (não configura o webhook IA do cliente); appointments = versão reduzida e perigosa (sem editar, sem responsável `default_user_id` — peça da cadeia do agente, delete 1-clique).

**Achados novos (além do Top 12):** spinner infinito em erro (assistant:39, tools:17, webhook:19 — `.then` sem `.catch`); Tester degradado (sem testAgentLive/reset/simulate); `<select>` cru em appointments; metadata ausente em assistant/tools/webhook/agents/[id]; acentos em no-context-fallback e mensagens server ("Nome obrigatorio", "Duracao"); botão X do client-selector sem aria-label. **Já conhecidos**: race assistant:84-89 confirmado e agravado (retorno `{error}` ignorado); hub inalcançável no desktop **corrigido** (pode arquivar); duplicação assistant×settings/ai confirmada e crescendo.

**Positivos admin**: núcleo do Agente IA é o exemplo correto da unificação (package+DI, paridade visual total); segurança de contexto exemplar; modais caseiros do assistant com focus trap/escape/aria acima da média pra legacy.

## 6. Plano sugerido (ordem)

1. **PR-A1 (becos críticos)**: religar `NotificationsTab` (ou trocar "Avisar equipe" pra mensagem livre), abrir biblioteca do canvas por padrão (2 linhas), traduzir "node: <uuid>" pro label, checklist de publicação real (instruções+fluxo válido+entrada+WhatsApp).
2. **PR-A2 (confirmações + erros)**: AlertDialog nos 4 deletes sem confirmação (3 CRM + appointments admin), toast.error nos 6+ catches silenciosos, spinner infinito do admin.
3. **PR-A3 (deprecação dos legacy)**: banner "sistema antigo → use Agente IA" em assistant/splitter/webhook/flows; deletar `ai-client.tsx`; aviso no splitter quando agente nativo ativo; matar ou esconder `/flows`.
4. **PR-A4 (jornada)**: PromptBuilder guiado, wire `CalendarConnectionsCard` + reconectar expirado, wire `FAQTab` (ou remover), `isPrimary` default no 1º agente, AuditTab com lead+mensagens+link pro chat, cross-links clicáveis no NodeConfigSheet.
5. **PR-A5 (admin)**: aplicar cleanup do hub, portar Biblioteca de mídia real (package `automations-ui`?), wire `LimitsUsageTab` no admin (token economy é DEVER do admin), tester fiel (3 actions), appointments completo.
6. **PR-A6 (vocabulário + polish)**: unificar Etapa/Tarefa/Serviço/modelo, "Tool"→"arquivo", acentos em lote, metadata titles, aria-labels restantes.
