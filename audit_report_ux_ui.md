# Relatório de Auditoria UX/UI — CRM Persia v2

> Auditoria READ-ONLY (nenhum código alterado). 8 agentes em paralelo cobrindo: primitivos `@persia/ui`, shell+páginas do CRM, chat, `crm-ui`+`agenda-ui`, `leads-ui`+`tags-ui`+`segments-ui`, `ai-agent-ui`, app admin e varredura transversal por grep. **Fonte de verdade: o código** (skills e memórias do projeto verificadas como parcialmente desatualizadas — ver seção 12).
> Gerado em 2026-06-11.

---

## 1. Top 15 por impacto

1. **[Critical] Tema do admin quebrado na raiz**: `apps/admin/src/app/globals.css` NÃO define metade do vocabulário do DS no `@theme` — faltam `--color-popover(-foreground)`, `--color-secondary`, todos os spacing tokens (`--spacing-card/-section/-stack/-form/-inline`), `--radius` e escala, `--badge-notification`, `--chat-*`. Em Tailwind 4, utility sem token no theme não é gerada → `bg-popover` (Dialog/Select/Dropdown de `@persia/ui`) e `px-card-lg`/`gap-stack` **não existem no CSS compilado do admin**: conteúdo de Dialog/Select/Dropdown renderiza sem background e paddings colapsam em todos os pacotes compartilhados. É também a causa-raiz das ~115 cores hardcoded do admin. Falta ainda `@custom-variant dark (&:is(.dark *))` → `dark:` no admin segue o SO, não o toggle.
2. **[Critical] Chat: morte silenciosa do realtime** ([chat-window.tsx:1138](apps/crm/src/components/chat/chat-window.tsx:1138)): canal cai (`CHANNEL_ERROR`/`CLOSED`) → só `console.warn`; sem banner, sem polling de fallback. E o flag `realtimeWorking` da lista nunca reseta ([conversation-list.tsx:292](apps/crm/src/components/chat/conversation-list.tsx:292)) → polling de 5s nunca reassume. Operador perde lead achando que ninguém respondeu.
3. **[High] Som/notificação de mensagem nova NUNCA disparam** ([conversation-list.tsx:216](apps/crm/src/components/chat/conversation-list.tsx:216)): `playNotification`/`desktopNotify` desestruturados e jamais chamados no chat; os botões de sino/som salvam preferência mas não fazem nada. Controle que mente.
4. **[High] Admin: campo "Senha" do EditClientModal é no-op silencioso** ([client-sidebar.tsx:446](apps/admin/src/components/client-sidebar.tsx:446)): valor nunca é enviado (`updateOrganization` nem aceita password), toast diz "Conta atualizada". Campo de segurança fake.
5. **[High] Admin: "WhatsApp: Conectado ✓" hardcoded** no modal de troca de contexto ([client-sidebar.tsx:210](apps/admin/src/components/client-sidebar.tsx:210)) — verde pra toda org, sempre.
6. **[High] Kanban: botão de coluna vazia morto** ([KanbanBoard.tsx:1801](packages/crm-ui/src/components/KanbanBoard.tsx:1801)): "clique para adicionar" faz `getElementById("add-deal-...")` que não existe em lugar nenhum — clicar não faz nada.
7. **[High] AI Agent: ação "Criar agendamento" pede data/hora EM UTC do cliente leigo** ([NodeConfigSheet.tsx:853](packages/ai-agent-ui/src/components/flow/NodeConfigSheet.tsx:853)): "Para 14:00 em São Paulo, use 17:00" — agendamentos sairão errados.
8. **[High] Token economy vazando pro cliente**: slider de debounce no RulesTab wired nos 2 apps ([RulesTab.tsx:1101](packages/ai-agent-ui/src/components/RulesTab.tsx:1101)); "Teto de custo atingido" no Tester ([TesterSheet.tsx:789](packages/ai-agent-ui/src/components/TesterSheet.tsx:789)); "custo/barato" no wizard ([AgentCreationWizard.tsx:48](packages/ai-agent-ui/src/components/AgentCreationWizard.tsx:48)). Viola decisão do PR #228.
9. **[High] Encaminhar mensagens: limites silenciosos** ([messages.ts:498](apps/crm/src/actions/messages.ts:498)): server corta em 10 msgs/20 conversas via `.slice()` sem aviso, UI não comunica limite, lista de destinos corta em 25.
10. **[High] Hydration #418 vivo em 3 lugares**: chip de agendamento do Kanban ([KanbanBoard.tsx:4056](packages/crm-ui/src/components/KanbanBoard.tsx:4056), `new Date()`+`toLocaleString` em dados SSR), audit log do admin ([audit-client.tsx:311](apps/admin/src/app/(dashboard)/audit/audit-client.tsx:311)), slot picker do booking público ([PublicSlotPicker.tsx:32](apps/crm/src/app/agendar/[orgSlug]/[pageSlug]/components/PublicSlotPicker.tsx:32)).
11. **[High] Fuso horário UTC corrompendo UX**: KPIs do dashboard zeram às 21h BRT ([dashboard/page.tsx:42](apps/crm/src/app/(dashboard)/dashboard/page.tsx:42)); filtro "Hoje" dos filtros avançados filtra o dia seguinte à noite ([LeadsAdvancedFilters.tsx:68](packages/leads-ui/src/components/LeadsAdvancedFilters.tsx:68)).
12. **[High] `useDialogMutation` sem guard de in-flight** ([use-dialog-mutation.ts](packages/ui/src/hooks/use-dialog-mutation.ts)): duplo Enter/clique antes do re-render dispara a server action 2x — criação duplicada. (O hook em si matou a família "dialog não fecha" — mas precisa do guard.)
13. **[High] Falha silenciosa em fluxos primários**: criar funil e criar negócio só fazem `console.error` no catch ([CreateKanbanDialog.tsx:61](packages/crm-ui/src/components/CreateKanbanDialog.tsx:61), AddDealDialog); toggles de tool/assistente com `catch {}` ([tools-client.tsx:143](apps/crm/src/app/(dashboard)/automations/tools/tools-client.tsx:143)) — "desativei a IA" e ela continua respondendo; ações de instância WhatsApp com 5 `catch {}` (instances-client.tsx).
14. **[High] `signUp` ainda lança throw** ([auth.ts:25](apps/crm/src/actions/auth.ts:25)): registro com email duplicado = erro genérico em inglês/500 (login já foi corrigido no PR-B10, registro ficou de fora). + Item de menu "Meu Perfil" aponta pra rota `/profile` que não existe ([header.tsx:119](apps/crm/src/components/layout/header.tsx:119)) → 404 inglês.
15. **[High] Sem `error.tsx`/`not-found.tsx` raiz nos 2 apps**: CRM só tem em `(dashboard)`; admin tem ZERO error boundary. Erro de server component nas páginas públicas (`/agendar`, `/g`) = tela padrão do Next em inglês pro lead final. Admin `reports` faz `catch { notFound() }` → 404 inglês quando contexto expira.

---

## 2. Achado estrutural raiz — tema do admin (detalhe)

- Correção à memória do projeto: o admin **JÁ TEM** tokens de outcome (`success/failure/progress/warning` + `-soft`/`-ring`) e de sidebar (globals.css:56-80, 100-135). O que falta é o resto do `@theme` (item 1 do Top 15).
- **Drift de valores**: light background admin `#FFFFFF` vs CRM `#F8F5F0`; dark admin cinza `#0F0F0F` vs CRM navy; `--primary` dark do admin continua azul (CRM vira gold) → no dark o admin mistura sidebar navy/gold + conteúdo cinza + botões azuis. `--destructive` hex fixo `#A91B1B` nos 2 temas.
- **`body.managing-client`** só sobrescreve `--primary`/`--ring` — `--sidebar-primary` não → item ativo do sidebar fica azul com botões âmbar. Classe aplicada via `useEffect` → flash azul→âmbar pós-hidratação. Tema dark aplicado em `useEffect` sem script inline → flash light→dark a cada reload; em `/login` o tema escolhido nunca aplica.
- **Fix sugerido**: portar o bloco `@theme` completo do CRM pro admin + `@custom-variant dark` + script inline de tema no `<head>` + incluir `--sidebar-primary` no managing-client.

## 3. Design System — `@persia/ui`

**Estados/comportamento:**
- **[High] Checkbox sem `indeterminate` visual** (checkbox.tsx) — LeadsList passa o prop; seleção parcial aparece como check cheio. Fix: `MinusIcon` + estilos `data-indeterminate`.
- **[High] Toaster do DS é código morto** (sonner.tsx): os 2 layouts importam `Toaster` direto de `"sonner"` com `richColors` — toasts fora dos tokens. Fix: importar de `@persia/ui/sonner` ou deletar o wrapper.
- **[High] CommandDialog renderiza DialogTitle FORA do DialogContent** (command.tsx:51-55) — `aria-labelledby` quebrado; defaults em inglês. Usado no tag-picker.
- **[Medium] Button sem prop `loading`** — todo submit depende do caller compor disabled+Spinner manualmente (Spinner tem 1 consumer no monorepo).
- **[Medium] AlertDialogFooter mantém `-mx-4 -mb-4`** — a mesma margem negativa removida do DialogFooter (bug #190 documentado em dialog.tsx:104).

**A11y/i18n nos primitivos (afeta 100% dos 2 apps):**
- **[Medium] Defaults em inglês**: `sr-only "Close"` em dialog.tsx:75 e sheet.tsx:75; `DialogFooter showCloseButton` com texto VISÍVEL "Close"; pagination "Previous/Next/Go to..."; spinner `aria-label="Loading"`; sidebar "Toggle Sidebar"; carousel/breadcrumb. Fix: traduzir defaults.
- **[Medium] Contraste reprovado em tokens sólidos**: `--warning` amber-500 + foreground branco (~2.1:1); `--destructive` red-500 + branco (~3.3:1); `--success` emerald-600 + branco (~3.3:1); dark `--primary` gold + branco (~2.2:1) — Button default no dark ilegível. Fix: escurecer os sólidos ou foreground escuro.
- **[High] DropdownMenuTrigger aceita `<Button>` como children** → `<button><button>` (HTML inválido) em ≥6 telas (appointment-types, team, assistant, tools, chat-window:1509, message-input:577). O DS é **Base UI**, não Radix — não existe `asChild`; o pattern correto é `render={<Button/>}`.

**Consistência/superfície:**
- **[Medium] DS de duas camadas não adotado**: DialogShell/FeatureSheet/PageShell/MetricCard/EntityList/BulkActionBar/Toolbar com 0-1 consumers reais; 8 consumers de SheetContent chutam largura na mão — o drift que FeatureSheet existia pra matar. `MetricCard` duplicado localmente em agenda-ui e ai-agent-ui.
- **[Medium] ~30 componentes mortos no barrel** mantendo `embla-carousel`, `recharts`, `vaul`, `react-day-picker`, `react-resizable-panels`, `input-otp` como dependências sem uso. `empty.tsx` coexiste com `empty-state.tsx`.
- **[Medium] Alturas/radius inconsistentes**: NativeSelect/InputGroup h-8 vs padrão h-9; Input `rounded-lg` vs Button `rounded-md`; Dialog `rounded-xl` vs DialogShell força `rounded-2xl`; Badge `rounded-4xl` vs StatusBadge `rounded-full`. API inconsistente: `kind` vs `tone` vs `variant`; `failure` vs `destructive`.
- **[Low] Touch targets**: Button xs/icon-xs (24-28px) sem expansão de hit-area (Checkbox/Switch têm `after:-inset` — replicar).

## 4. CRM — shell, rotas e páginas

- **[High] Error/not-found raiz ausentes** (item 15 do Top); `notFound()` chamado em flows/[id], agents/[id], campaigns/[id] sem not-found.tsx correspondente.
- **[Medium] `loading.tsx` faltando** em: flows, email, landing-pages, todo `settings/*`, onboarding/setup e na página pública `agendar/[orgSlug]/[pageSlug]` (lead no 4G).
- **[Medium] ~14 páginas sem metadata title** (campaigns, flows, email, landing-pages, groups/[id], leads/fields, settings/{whatsapp,team,queues,webhooks,billing,google-calendar}, automations/{tools,appointments,agents/[id]}, onboarding). B-N3 (/reports) foi corrigido; o padrão não foi replicado.
- **[Medium] Sidebar**: "Automacao" e "Relatorio" sem acento em [navigation.ts:67,93](apps/crm/src/lib/constants/navigation.ts:67) (**B-N1 ainda presente**); "Config" abreviado.
- **[Medium] Dashboard com fuso do servidor** (item 11 do Top).
- **[Low] Rotas órfãs**: `/email`, `/landing-pages`, `/flows` são páginas completas sem entrada na navegação.
- **[Low] PublicLeadForm**: labels sem `htmlFor`/inputs sem `id` (tocar no label não foca no celular); `text-white` hardcoded; 7 primitivos HTML crus na página mais pública do produto.
- **[Low] `(auth)` sem metadata**; alert() nativo + jargão em admin/instances.
- **Positivos**: globals.css do CRM exemplar (tokens completos documentados); páginas públicas com not-found PT-BR, generateMetadata dinâmico, honeypot, validação Zod on-blur; skip-link, prefers-reduced-motion, toasts acima do bottom-nav mobile; sidebar 100% tokens.

## 5. CRM — Chat

- **[Critical/High] Realtime + som/notificação** (itens 2-3 do Top 15).
- **[High] Scroll roubado**: todo INSERT seta auto-scroll incondicional ([chat-window.tsx:1112](apps/crm/src/components/chat/chat-window.tsx:1112)) — operador lendo histórico é puxado pro fim; sem pill "X novas mensagens".
- **[High] getConversations sem limit + preview errado** (cap 1000 do PostgREST → "Sem mensagens" incorreto) + reload a cada INSERT org-wide sem debounce.
- **[High] Encaminhar: limites silenciosos** (item 9 do Top); painel de encaminhar é `div fixed` sem focus trap/Esc/role, cobrindo a área onde se marcam os checkboxes.
- **[Medium] Texto sem bolha otimista** (mídia tem, texto não — msg "some" 1-3s em conexão lenta); falha de mídia descarta o arquivo (sem retry com o anexo).
- **[Medium] Busca na conversa enganosa**: filtra só as 50 msgs carregadas e casa contra campos internos (`type`, `sender`) — "ai"/"image" retornam falsos positivos.
- **[Medium] Header não reflete mudanças da conversa** (assinatura só em messages — 2 agentes podem responder o mesmo lead sem perceber).
- **[Medium] template-selector.tsx fora do DS**: modal à mão sem focus trap/Esc, `<input>`/`<button>` crus, "APPROVED" em inglês, "Configuracoes/Cabecalho/Botao" sem acento. É a tela que destrava a janela de 24h da Meta.
- **[Low] AudioPlayer com rgba() hardcoded + sem aria-label; paleta de avatar divergente entre lista (10 cores) e janela (8 hex) — mesmo lead muda de cor; empty state único pra busca/filtros/inbox zero; badge de não lidas sem cap 99+.
- **Positivos**: foco pós-envio OK (fix confirmado), Enter/Shift+Enter, otimista de mídia exemplar com dedupe, status WhatsApp-style completo com retry, paginação preservando scroll, janela de 24h Meta bem resolvida, tokens `--chat-*` com dark mode completo.

## 6. Kanban (`crm-ui`) e Agenda (`agenda-ui`)

- **[High] Botão de coluna vazia morto** (item 6 do Top); **[High] criar funil/negócio falham em silêncio** (item 13); **[High] chip de agendamento = hydration #418** (item 10) — o próprio arquivo documenta o `RelativeTime` criado pra isso e o chip novo não usa.
- **[Medium] Sem alternativa de teclado no desktop** pra mover etapa (select nativo é `md:hidden`; card é div sem tabIndex); outcome de etapa no PipelineStagesEditor é drag-only.
- **[Medium] Vocabulário misturado pós lead-centric**: header diz "Leads:", seleção diz "negócios selecionados", toasts respondem "N leads movidos" — duas entidades pro leigo. "Ver no Kanban" vs decisão de chamar de "Funil".
- **[Medium] B-N4 confirmado** ([AgendaOverview.tsx:61-126](packages/agenda-ui/src/components/AgendaOverview.tsx:87)): "Esta semana" = próximos 7 dias, mas "Aguardando/Realizados/Cancelados" contam TUDO sem janela; lista abaixo é só hoje → KPIs incoerentes entre si.
- **[Medium] agenda-ui inteiro sem toast de sucesso** (grep `toast.` = 0) e sem `useDialogMutation`; conflito de horário detectado por `msg.startsWith("Conflito com")` (frágil) e sem sugerir slots livres (o backend da IA já tem `buildAvailabilityError` — o humano não recebe o mesmo).
- **[Medium] Esc/overlay descarta dados sem aviso** (ImportLeadsWizard 5 passos, CreateLeadFromKanban, AppointmentForm); **[Medium] AppointmentCard = `<button>` dentro de `<button>`**; **[Medium] WeeklyAvailabilityEditor com HTML cru** e labels sem htmlFor; **[Medium] AgendaCalendarView com hex hardcoded** pra block/event (quebra dark mode); **[Medium] SelectValue cru no AddDealDialog** (mostra UUID do lead).
- **[Low] ~270 linhas de código morto** (`_DealDetailDialogRemoved`), `text-[9px]` ilegível (3 ocorrências), chip awaiting_confirmation com amber cru (token warning existe), "Voce pode reverter depois" sem caminho de reversão, ActivitiesTab com fallback de tipo cru, `formatRelativeShortPtBR` duplicado, BookingPageDrawer "nasce com erro" (sem touched), ImportLeadsWizard sem progresso em import grande.
- **Status B-N2**: **resolvido por remoção** (dialog antigo virou código morto), MAS o **AddDealDialog vivo herda o mesmo problema** — Título (3403) e Valor (3431) sem `name`/`id`, Labels sem htmlFor.
- **Positivos**: scroll interno por coluna, drag feedback completo com dedup e rollback, MarkAsLostDialog sempre captura motivo, ActivitiesTab exemplar (stage_change com label PT-BR — bug histórico corrigido), ImportLeadsWizard acima da média, agenda-tones cumpre a promessa (zero cromática crua nos badges), AppointmentForm bem construído.

## 7. Leads / Tags / Segmentos

**Status dos bugs de mai/2026** (8 corrigidos, 3 presentes, 1 parcial):

| Bug | Status | Evidência |
|---|---|---|
| B-S1/B-S4/B-T1/B-T2/B-T3 dialogs não fecham | ✅ Corrigidos | `useDialogMutation` adotado (SegmentsList:491, TagsList:128) |
| B-S2 sem toast | ✅ Corrigido | successToast em todas as mutations |
| B-S6/B-T4 aria-label icon-only | ✅ Corrigidos | SegmentsList:1075+, TagsList:259 |
| B-T5 "sera" | ✅ Corrigido | "será" TagsList:381 |
| B-N9 Editar → página legacy | ✅ Corrigido | ambos os apps abrem o drawer |
| **B-S3 counter do segmento** | ⚠️ Parcial | create retorna `lead_count=0` antes do refresh ([segments.ts:189](apps/crm/src/actions/segments.ts:189)) — card recém-criado mostra "0 leads" até reload |
| **B-N6 pills de tag stale no drawer** | ❌ Presente | `currentTags` deriva só de `lead.lead_tags`, sem optimistic update ([LeadInfoDrawer.tsx:278](packages/leads-ui/src/components/LeadInfoDrawer.tsx:278)) |
| **B-N7 aria-sort** | ❌ Presente | grep = 0 em packages |
| **B-S5 status texto livre** | ✅ CRM / ❌ Admin | admin não passa `catalogs` ([segments/page.tsx:58](apps/admin/src/app/(dashboard)/segments/page.tsx:58)) → Status/Origem/Canal/Responsável viram Input livre (Responsável exige UUID digitado!) |

**Achados novos:**
- **[High] Sort duplo conflitante** ([LeadsList.tsx:525](packages/leads-ui/src/components/LeadsList.tsx:525) + DataTable:95): colunas com `renderSortHeader` (server-side) E `sortable: true` (client-side) — um clique dispara os dois + `<button>` aninhado; status/source ordenam só a página atual (mentira com paginação server).
- **[High] Criar lead sem feedback de erro**: `handleSubmit` sem try/catch ([LeadForm.tsx:265](packages/leads-ui/src/components/LeadForm.tsx:265)) — telefone duplicado = exceção sem toast; sem toast de sucesso.
- **[Medium]**: empty state ignora filtros avançados ("Cadastre seu primeiro lead" com filtro ativo); buscar/filtrar reseta ordenação silenciosamente; sem chips removíveis de filtros ativos (o comentário do arquivo promete); datas UTC no filtro "Hoje" (item 11); Celular/E-mail do drawer sem validação inline (LeadForm valida, drawer não); `<form>` aninhado no drawer (LeadCommentsTab); `confirm()` nativo em remover-de-grupo e excluir comentário; 2 SelectValue crus (produto em edição mostra UUID); admin sem preview/duplicar de segmento (adapter não wireia).
- **[Low]**: Enter sem guard de pending no TagsList (double-submit); indicador de cor com `borderColor:"#000"` invisível no dark; "Proximo" sem acento (LeadsList:1256); ações do card de segmento só no hover (invisíveis em touch); HEALTH_UI com emerald/amber cru; emojis ⚙/💬 como ícones de tab; ~110 linhas de código morto (`{false && ...}`); "Ver grupo completo" via `window.location.href` com rota fixa (quebra no admin).
- **Positivos**: `useDialogMutation` matou a família inteira de bugs de dialog; preview de segmento exemplar (count+amostra+debounce+anti-race); ConditionBuilder 100% leigo; LeadForm com Zod PT-BR + detector de duplicado com ações; bulk actions completas; ExportLeadsDialog bem tratado.

## 8. AI Agent (`ai-agent-ui`)

**Vazamentos de token economy (regra do PR #228):**
- **[High] Slider de debounce** wired no cliente (RulesTab:1101-1146, persiste `debounce_window_ms`) — comentário no próprio arquivo (:445) diz que cliente não ajusta.
- **[High] "Teto de custo atingido"** no Tester (:789) + "Rate limit atingido" (:787).
- **[Medium] "custo"/"barato"** no wizard (:48, :53) — cliente de plano fixo.
- ✅ Conforme: `LimitsUsageTab`/`LimitsEditor`/`UsageStatsCards` NÃO estão wired em lugar nenhum (export morto — risco latente: mover pra entrypoint `/admin` ou marcar com comentário de política). `max_iterations`/`timeout`/`cost_ceiling`/`context_summary_*` sem UI.

**Jargão exposto ao cliente (amostra do mapeamento completo — 25+ strings com arquivo:linha):** "Acelerar janela de debounce", "pipeline real... Tools simuladas", "entry triggers não-conversacionais", "Avançou para node: node-3f2a…", "Ferramenta: create_appointment" (cru), "handler retornou sucesso", "Servidor MCP", "Rodando pipeline...", erro de import com enum cru, "usado em N node(s)", modelos crus "gpt-5-mini" (wizard usa rótulos amigáveis — inconsistente), steps "LLM/tool/guardrail" no AuditTab, "Indexada (12 chunks)", `output_handle` em font-mono, `algoritmo "least-loaded"`, placeholder "ex: new, qualified, lost" (cliente digita enum em inglês).

**Achados gerais:**
- **[High] 6 `<SelectValue />` crus** mostram enum cru no trigger (RulesTab:1029 "gpt-5-mini", :1702 "rewrite", :2550 "json", :2649 "custom", :2881 "merge"; TesterSheet:875 "pipeline_stage_entered") — confirmado no base-ui 1.4.1.
- **[High] Horário em UTC na ação Criar agendamento** (item 7 do Top).
- **[High] Exclusão de template sem confirmação** (RulesTab:3043 `usedInNodes={[]}` hardcoded — fluxo de confirmação é código morto; delete imediato quebra nodes que referenciam).
- **[Medium]**: wizard divergiu do redesign aprovado (2 steps sem templates vs 3-step com cards — confirmar se foi decisão posterior); rótulos "(em breve)" obsoletos em triggers que JÁ funcionam (NodeConfigSheet:81, :324); ENTRY_ITEMS fora da sidebar do canvas + bloqueio de 2ª entrada contradiz comentário do PR 29; copy aponta card "Enviar template fixo" que não existe no catálogo; dois editores de nome com semânticas diferentes (header blur-save vs RulesTab dirty); seção "tools" morta no union; `stagesCount={0}` hardcoded → aviso falso "Sem etapas cadastradas" SEMPRE visível no Tester; FollowupTab icon-only sem aria-label; promessa de "backup do navegador" inexistente no modal de impacto.
- **[Low]**: amber/blue cru em banners do Tester e badge do RulesTab; `<textarea>` cru com estado de erro que nunca aparece (`border-input : border-input`); "Configurar" via `window.location.href`; categorias do FlowSidebar todas fechadas + busca sem estado vazio; ~2k linhas de exports mortos (NotificationsTab, SchedulingTab com cron_expr + window.confirm, FAQTab etc — podem ser wired sem revisão de vocabulário); NodeConfigSheet shell morto com Save que mentiria; Tester sem aria-live; dezenas de strings sem acento (RulesTab, TesterSheet, FollowupTab, EntryConditionsCard).
- **Positivos**: dirty-state exemplar (UnsavedChangesGuard 2 camadas + sticky save bar + retry); canvas acima da média (undo/redo, Dagre, validação pré-save, optimistic locking, preview de impacto); node-catalog segue bem o vocabulário aprovado; FieldCard+HelpTooltip+DefaultBadge ótimos pra leigos; empty states com CTA em todas as listas.

## 9. Admin

- **[Critical] Tema quebrado na raiz** (seção 2) + **[Critical] campo Senha no-op** + **[High] "Conectado ✓" fake** + **[High] botão Excluir que se recusa** (SearchClientsModal:310) + **[High] excluir org com `confirm()` de um clique** (clients-list:69).
- **[High] Race em delete/toggle de assistente** (automations/assistant:84,89): fire-and-forget + reload síncrono — item reaparece, erro nunca exibido (settings/ai faz certo — duplicação interna com qualidade divergente).
- **[High] Rotas órfãs**: `/settings/templates` e `/settings/ai` sem nenhum link; hub `/automations` inalcançável no desktop (flyout não o inclui).
- **[High] Zero error.tsx/not-found.tsx**; loading.tsx só em 2 rotas; `reports` → 404 inglês quando contexto expira.
- **[High] Troca de contexto sem reload** (client-selector:78): cookie+Zustand trocam, layout continua sem banner âmbar — risco direto de mexer na org errada. Dois fluxos de troca com comportamentos diferentes.
- **[Medium]**: rail corta em 20 orgs silenciosamente; entrada no modo cliente escondida (gatilho é o logo, painel nasce fechado, fallback instrui painel invisível); QR estático até 5min (expira em ~60s) + modais de QR sem focus trap (o app TEM o padrão `useFocusTrap` e não usa aqui); troca de role sem confirmação + taxonomia divergente ("usuario" = "Agente" numa tela, "Usuário" noutra, e diverge do CRM); auto-remoção de superadmin possível; audit log com fallback de action crua + emerald/amber cru (tokens existem!); dashboard engole erro mostrando zeros; ~20 páginas sem metadata; ~6 `htmlFor` no app inteiro; login sem aria/role=alert.
- **Drift CRM↔admin**: campanhas duplicadas quase byte-a-byte (2.075 linhas, melhorias indo só pra um lado — candidato a `packages/campaigns-ui`); **chat do admin é fork antigo** (542 vs 2.644 linhas — sem encaminhar, media-viewer, template-selector); assistentes IA duplicados DENTRO do admin (2 forms, 2 actions, 1 com bug). Sem drift: Kanban/Leads/Segments/Tags/Agents/Agenda (pacotes DI funcionando).
- **Positivos**: banner âmbar + HeaderOrgBadge + saída dupla no modo cliente; NoContextFallback em 22 páginas; auditoria é a melhor lista do admin; infra própria de modal acessível usada na maioria; fluxo Meta Cloud pós-conexão exemplar.

## 10. Varredura transversal (números confirmados hit a hit)

| Varredura | Resultado |
|---|---|
| PT-BR sem acento | ~45 strings em 21 arquivos nos apps (admin = maior ofensor) + dezenas em crm-ui/ai-agent-ui (detalhe nas seções 6 e 8) |
| Cores cromáticas hardcoded | 139 em 27 arquivos: ~115 no admin, 2 reais no CRM (team-performance MEDAL_COLORS, campaign-mini-card), hex no login do admin e client-sidebar |
| HTML cru de primitivo | 215 em 37 arquivos (PublicLeadForm público com 7; chat-window 15; forms inteiros do admin) |
| `<SelectValue />` cru | 20 ocorrências (6 no ai-agent-ui, 2 no chat, 12 em settings/automations) |
| Icon-only sem aria-label | 14 confirmados (flows, email, groups: enviar/microfone sem label) |
| Datas cruas SSR (#418) | 2 candidatos vivos (audit-client, KanbanBoard chip) + PublicSlotPicker |
| `text-[10-13px]` | 392 em 90 arquivos (KanbanBoard 35-38, groups-client 31) |
| `alert()`/`confirm()` nativos | 43 em 24 arquivos (incl. excluir org, e 1 dentro de packages/leads-ui) |
| `console.log` em .tsx | limpo |
| Inglês user-facing | 2 (sr-only "Close" em dialog/sheet — afeta todos os modais) |
| `catch {}` silencioso | 7 (tools toggle, assistant toggle, 5 em instances) |

## 11. Status consolidado dos bugs conhecidos (mai/2026)

- ✅ Corrigidos: B-S1, B-S2, B-S4, B-S6, B-T1, B-T2, B-T3, B-T4, B-T5, B-N3, B-N9, B-N2 (por remoção — mas AddDealDialog vivo herda o problema), B-N5 (epicentros; 3 candidatos novos vivos), foco do input pós-envio, checkbox encaminhar.
- ❌ Presentes: **B-N1** (sidebar sem acento), **B-N6** (pills de tag stale), **B-N7** (aria-sort), **B-N4** (KPI agenda — agora com causa exata mapeada), **B-S5 no admin** (catalogs não passados), **B-S3 parcial** (count 0 no create).
- Decisões de produto #17 (página legacy /leads/[id]) e #20 (status vs etapa) continuam em aberto — o achado de vocabulário "negócio×lead" do Kanban (seção 6) é o mesmo problema do #20 em outra roupa.

## 12. Divergências skills/memória vs código (confirmar e atualizar docs)

1. **`@persia/chat-ui` NÃO existe** — MEMORY.md lista o pacote; chat vive em `apps/crm/src/components/chat/` (e o admin tem fork antigo próprio). A skill squad-crm-persia já estava correta nisso.
2. **`packages/ui/docs/patterns.md` NÃO existe** — referenciado em 5 arquivos do código (index.ts:10, relative-time, use-dialog-mutation, use-optimistic-list, action-result).
3. **DS é Base UI, não Radix** — comentário em dialog-hero.tsx:32 fala "a11y do Radix"; patterns Radix (`asChild`) não existem — explica os triggers com button aninhado.
4. **Convenção de radius documentada não bate com o código**: Badge é `rounded-4xl` (não full), Dialog é `rounded-xl` (não 2xl), inputs `rounded-lg` (não md).
5. **"64 primitivos"** → na real 71 componentes + 3 hooks, ~30 sem nenhum consumer.
6. **Admin TEM tokens de outcome/sidebar** (memória dizia que não tinha base) — o gap real é popover/secondary/spacing/radius/custom-variant (seção 2).
7. **Wizard do AI Agent**: memória diz "3-step com cards de templates"; código é 2-step sem templates ("Templates removidos — cliente sempre começa do zero" em comentário). Confirmar se foi decisão posterior do dono.
8. **Memória de bugs de mai/2026 majoritariamente desatualizada** — 12 de 18 itens corrigidos (seção 11).
9. **`useOptimisticList`** (Pattern #4 do DS): zero consumers — pattern documentado nunca adotado.
10. **Toaster**: docs dizem "toasts seguem tokens do DS" — ambos os apps montam o sonner cru com richColors.
11. **designflow-kit (fallback genérico)**: padrões de chat com `bg-blue-100 dark:bg-blue-900/30` contradizem a regra de tokens do próprio projeto — o código real usa tokens `--chat-*` (correto); a seção CRM Persia da skill está OK, o fallback é que confunde.

## 13. Plano de ataque sugerido (ordem de PRs)

1. **PR tema admin** (Critical, raiz): portar `@theme` completo + `@custom-variant dark` + script inline de tema + managing-client cobrindo sidebar-primary. Destrava o uso correto dos pacotes compartilhados e elimina a justificativa das 115 cromáticas.
2. **PR chat confiabilidade**: reconexão/polling fallback + banner + ligar som/notificação + scroll inteligente + limites de encaminhar comunicados.
3. **PR fixes de 1 linha em lote**: B-N1 acentos sidebar, sr-only "Close"→"Fechar", metadata titles (~34 páginas nos 2 apps), "Proximo"→"Próximo", aria-labels faltantes, alert/confirm→toast/AlertDialog nos casos de 1 clique.
4. **PR token economy + jargão AI Agent**: remover slider debounce do cliente, "Teto de custo"→mensagem neutra, 6 SelectValue, "(em breve)" obsoletos, UTC→horário local na ação de agendamento.
5. **PR primitivos**: Checkbox indeterminate, guard in-flight no useDialogMutation, Button loading, AlertDialogFooter margens, CommandDialog title, Toaster do DS.
6. **PR admin fluxos**: campo senha, "Conectado" fake, excluir org com type-to-confirm, race do assistant, rotas órfãs, error/not-found.
7. **PR hydration/timezone**: chip do Kanban, audit-client, PublicSlotPicker, dashboard KPIs, filtro "Hoje".
8. **Sprint 5 (maior)**: unificar campanhas em `packages/campaigns-ui` e decidir destino do chat do admin (fork morre ou pacote).
