# Relatório de Auditoria — `packages/shared` (audit_shared.txt)

> Auditoria de segurança, performance e type safety. Contexto crítico: este código roda no CRM (RLS via anon key) E no admin (service-role **sem RLS**) — filtro explícito de `organization_id` é a única defesa garantida nos dois mundos.
> Gerado em 2026-06-10 por análise integral do dump (linhas 1–14784 e 19498–fim; `database.ts` [tipos gerados] pulado por não ter valor de auditoria), 3 passes.

---

## 1. SEGURANÇA

### High

- **[High] providers/uazapi-client.ts — UazapiClient.request() / adminRequest() (e configureUazapiWebhook em uazapi-webhook-config.ts)**: SSRF não mitigado — todo fetch vai para `${this.baseUrl}${path}` onde `baseUrl` é o `instance_url` vindo do banco, sem validação de scheme (aceita `http://`), de host (IP privado/link-local/metadata) nem allowlist de domínio UAZAPI. O fix recente de SSRF cobriu webhooks/MCP, mas **não** estes providers. Agravante: o header `token: this.token` (instance_token) e, em `downloadMedia`, o parâmetro `openai_apikey` são enviados ao host apontado — um `instance_url` malicioso/comprometido exfiltra o instance token e a chave OpenAI da org, e respostas de serviços internos retornam ao caller. **Fix**: validar `baseUrl` no construtor do `UazapiClient` (e em `configureUazapiWebhook`) com o mesmo guard SSRF do fix de webhooks — exigir `https:`, resolver/bloquear IPs privados ou allowlist `*.uazapi.com`. *(Combina com o achado do admin: `connectWhatsAppInstance` grava `instance_url` sem validação — fechar nas duas pontas.)*

### Medium

- **[Medium] agenda/mutations/appointments.ts — createAppointment / updateAppointment / rescheduleAppointment**: o PR-AGENDA-SEC adicionou `ensureLeadBelongsToOrg` só pra `lead_id`, mas `user_id`, `service_id`, `booking_page_id` (e `new_user_id` no reschedule) são aceitos sem validar pertencimento à org. Com service-role (admin, sem RLS), dá pra criar appointment vinculado a recursos de OUTRA org — FK só exige existência, não tenancy. **Fix**: replicar o padrão pra `user_id`/`service_id`/`booking_page_id`, ou helper genérico `ensureRowBelongsToOrg(table, id)`.

- **[Medium] agenda/mutations/appointments.ts — rescheduleAppointment + ensureNoConflict**: (a) operação não-atômica: marca original como `rescheduled` e só depois insere o replacement; se o INSERT falhar, slot perdido sem rollback. (b) TOCTOU: SELECT→INSERT sem constraint de exclusão — duas requisições concorrentes (flush de debounce do AI agent + operador humano) geram double-booking. **Fix**: (a) inverter ordem ou RPC transacional; (b) EXCLUDE constraint com `tstzrange(start_at, end_at)` + `user_id` no Postgres.

- **[Medium] crm/mutations/products.ts — addLeadProduct / updateLeadProduct**: ao contrário de `addTagToLead`, insere `{ lead_id, product_id }` sem validar que lead nem produto pertencem à org; `updateLeadProduct` idem no patch. Referência cross-tenant gravável; leitura via `select("*, org_products(*)")` no admin (sem RLS) embeda catálogo de outra org. **Fix**: replicar o padrão de `addTagToLead` — validar `leadId` e `product_id` por `organization_id` antes de gravar.

- **[Medium] crm/queries/leads.ts — listLeads (filtro assigneeIds)**: interpolação crua em `.or()`: `` query.or(`assigned_to.in.(${realIds.join(",")}),assigned_to.is.null`) ``. Um "id" como `x),id.not.is.null` injeta condições arbitrárias no grupo OR (filter injection PostgREST). Contido — o `.eq("organization_id", orgId)` é ANDado fora do grupo — mas permite bypass de filtros dentro da org. **Fix**: validar cada id contra regex UUID (e o sentinela `__none__`) antes do join.

- **[Medium] validation/lead.ts — phoneBR / phoneBROptional**: o transform descarta o `+` antes de contar dígitos, então qualquer internacional com 10–11 dígitos é tratado como BR: `+1 555 123 4567` → `+5515551234567`. Telefone canônico errado → mensagens WhatsApp pro número errado, dedup quebrado. **Fix**: se o raw começa com `+` (ou `00`), aceitar `+${digits}` sem reescrever DDI.

### Low

- **[Low] agenda/mutations/appointments.ts — CreateAppointmentInput.enforce_conflict_check**: o bypass de conflito (`false`, pensado pra cron/import) vive no mesmo DTO que as actions consomem — qualquer action que faça spread do JSON do client herda o bypass. **Fix**: separar em parâmetro interno fora do DTO de input.

- **[Low] agenda/queries/booking-pages.ts — getBookingPagePublicBySlug**: resolvedor público retorna o `BookingPage` completo, incluindo `user_id`, `organization_id` e `total_bookings`. **Fix**: projeção public-safe (slug, title, description, duration, location/meeting_url, status).

- **[Low] ai-agent/notifications.ts — renderNotificationTemplate**: render em duas passadas (custom primeiro, fixed depois) — valor custom vindo do LLM (influenciável pelo lead) contendo `{{lead_phone}}`/`{{wa_link}}` é expandido na segunda passada (injeção de placeholders na notificação da equipe). `renderHandoffTemplate` é single-pass e não tem o problema. **Fix**: passada única com regex combinado, ou escapar `{{` nos valores custom.

- **[Low] crm/mutations/leads-kanban.ts — moveLeadToStage / moveLeadToPipeline**: UPDATEs finais usam só `.eq("id", leadId)` sem `.eq("organization_id", orgId)`, confiando no SELECT org-scoped anterior. TOCTOU + desvio do padrão defense-in-depth — crítico porque roda com service-role. Mesmo gap no merge-path de `createLead` (mutations/leads.ts). **Fix**: adicionar filtro de org nos updates.

- **[Low] crm/mutations/leads.ts, tags.ts, products.ts (+ queries)**: `throw new Error(error.message)` cru, vazando nomes de constraints/tabelas/códigos PG pro frontend — risco que `mutations/errors.ts` documenta e deals.ts/pipelines.ts já corrigem. **Fix**: `sanitizeMutationError(error, "...")` em todos.

- **[Low] chat-media.ts — getChatMediaPath**: checagem de host com prefixo invertido — `!normalizedSupabaseUrl.startsWith(normalizedOrigin)` — origem que seja *prefixo* do supabaseUrl passa; e com `supabaseUrl === undefined` qualquer URL externa com o marker é tratada como mídia interna a assinar. **Fix**: igualdade exata de origem e retornar `null` sem `supabaseUrl`.

- **[Low] providers/meta-cloud.ts — downloadMedia() → graph()**: `messageId` interpolado no path sem `encodeURIComponent` — id com `/`, `?` redireciona o GET autenticado pra outro endpoint Graph (vem de webhook HMAC-verificado, defesa em profundidade). **Fix**: `encodeURIComponent(messageId)`.

- **[Low] providers/uazapi.ts — connect()**: body cru de erro da UAZAPI repassado em `ConnectionResult.error` até a UI (pode expor detalhes de infra do servidor UAZAPI). **Fix**: mensagem genérica PT-BR; detalhe só em log server-side.

**Notas positivas**: filtro `.eq("organization_id", orgId)` presente em todas as queries/mutations de agenda; `segments/match-leads.ts` e `audience-resolver.ts` sem injeção (allowlist de campos + métodos parametrizados); `validate-rules.ts` sem bypass (allowlist igual ou mais restrita que o matcher); `template-parser.ts` sem injeção (valores entram como dados em JSON); `AgentCalendarConnectionPublic` omite tokens corretamente; `listAgendaServices` sanitiza wildcards de ILIKE.

---

## 2. PERFORMANCE

### High

- **[High] crm/segments/match-leads.ts — todos os resolvers (lenient e strict)**: nenhuma query usa `.limit()`/`.range()`; o PostgREST corta em 1000 rows por default. Para orgs com >1000 leads, `findMatchingLeadIdsStrict` **trunca silenciosamente a audiência de campanha** (modo strict não detecta — é resposta parcial, não erro), e o `segmentId` do `listLeads` filtra errado. Os caminhos `not_contains` e `deal_status is_null` ainda carregam "todos os leads do org" em memória. **Fix**: loop paginado com `.range()` até página incompleta, ou RPC SQL.

- **[High] providers/uazapi-client.ts request() + providers/meta-cloud.ts graph()/uploadMedia()/listRemoteTemplates()**: nenhum fetch externo tem timeout (`AbortSignal`) nem retry — undici espera até ~5 min por headers. Uma instância UAZAPI travada congela server actions, handler de webhook e disparo de campanhas por minutos, segurando workers do Next. **Fix**: `fetch(url, { ...options, signal: AbortSignal.timeout(15_000) })` em `request`/`adminRequest`/`graph`, com retry curto (1–2x, backoff) só para GET/429/5xx.

### Medium

- **[Medium] crm/segments/match-leads.ts + validate-rules.ts — sem cap de conditions**: `Promise.all(rules.conditions.map(...))` dispara 1+ query por condition e nada limita o array (JSONB livre) — segmento com centenas de conditions vira DoS de DB. **Fix**: rejeitar `conditions.length > 20` no validador e nos matchers.

- **[Medium] crm/campaigns/audience-resolver.ts — fetchLeadsByIds**: `.in("id", ids)` com lista potencialmente de milhares de UUIDs sem chunking — estoura limite de URL do PostgREST e falha a campanha; preview retorna `recipients` completo sem paginação. **Fix**: chunkar em lotes de ~200 com `Promise.all`.

- **[Medium] crm/queries/tags.ts — listTagsWithCount**: baixa TODAS as rows de `lead_tags` só pra contar em JS — e o cap de 1000 torna contagens **erradas** acima disso. A 2ª query também não filtra `organization_id` (seguro só porque tag_id é org-owned). **Fix**: RPC/view com `GROUP BY tag_id` ou `count: "exact", head: true` por tag.

- **[Medium] providers/meta-cloud.ts — markAsRead()**: `await` sequencial em loop, 1 POST por messageId. **Fix**: `Promise.allSettled(messageIds.map(...))`.

### Low

- **[Low] crm/queries/deals.ts (listDeals), leads-kanban.ts (listLeadsKanban), pipelines.ts (listPipelines withStagesAndDeals)**: sem limit/paginação com embeds nested — cap de 1000 faz o Kanban **omitir cards silenciosamente** em orgs grandes. **Fix**: paginação por stage ou limit documentado.

- **[Low] crm/mutations/pipelines.ts — createPipeline**: 6 INSERTs sequenciais pras stages default. **Fix**: um único `.insert(DEFAULT_STAGES.map(...))`.

- **[Low] ai-agent/template-materializer.ts — applyAgentTemplate**: await-em-loop nos seeds + **todo erro engolido via `console.error`** — o agente nasce parcialmente materializado sem ninguém saber. **Fix**: acumular erros e retornar `{ warnings: string[] }` pra UI; `Promise.allSettled` nos seeds independentes.

- **[Low] providers/uazapi.ts — sendMedia()**: catch genérico dispara fallback legacy v1 pra **qualquer** erro (401, 400, timeout), dobrando latência e mascarando o erro original. **Fix**: fallback só em 404/405; senão re-throw.

- **[Low] whatsapp.ts — contrato checkNumber(phone)**: `UazapiClient.checkUser()` aceita batch, mas o contrato só expõe unitário — validação de listas de campanha vira N requests. **Fix**: `checkNumbers(phones[])` opcional no contrato.

---

## 3. TYPE SAFETY / CORREÇÃO

### Medium

- **[Medium] ai-agent/template-materializer.ts vs agenda/types.ts + mutations/services.ts — drift de schema em agenda_services**: o materializer insere `slug`, `default_channel`, `default_location`, `default_meeting_url` e deduplica por `slug`, mas o tipo `AgendaService` ("source-of-truth") e `createAgendaService`/`updateAgendaService` não conhecem essas colunas. Ou (a) serviços criados pela UI nascem com `slug` NULL — quebrando o lookup `type_slug` do handler `create_appointment` do AI agent; ou (b) o seed do template falha silenciosamente (erro engolido). **Fix**: adicionar `slug`/`default_*` ao tipo e ao insert/update de mutations/services.ts.

- **[Medium] providers/meta-cloud.ts — extractFirstMetaMessage()**: processa apenas `entry[0].changes[0].value.messages[0]`. A Meta agrupa múltiplas mensagens num único POST de webhook — as demais são **descartadas silenciosamente** (perda de mensagens inbound). **Fix**: retornar array (ou caller iterar `entry[].changes[].value.messages[]`).

- **[Medium] template-parser.ts — buildTemplateComponents()**: botão não-URL gera `{ type: "payload", text: vals[i] }` — o Graph API exige campo `payload`, não `text`; e botões OTP recebem `sub_type: "quick_reply"`, que a Meta rejeita pra authentication templates. Envio falha com 400. **Fix**: `btn.subType === "URL" ? { type: "text", text: v } : { type: "payload", payload: v }` e sub_type correto pra OTP.

- **[Medium] crm/campaigns/audience-resolver.ts — fetchLeadsByIds**: select é `"id, name, phone"` mas o retorno fabrica `chat_jid: null` via cast. A regra "elegível se tem telefone OU conversa WhatsApp" nunca funciona — leads com conversa mas sem phone são sempre inelegíveis. **Fix**: buscar o JID real ou remover `chat_jid` do tipo e da regra.

### Low

- **[Low] ai-agent/agent-templates.ts — isAgentTemplateSlug**: usa `value in TEMPLATES` (inclui prototype) — `"constructor"` passa o guard e `getAgentTemplate` retorna `undefined` tipado como `AgentTemplate` → crash no primeiro acesso. `template_slug` chega via input de cliente. **Fix**: `Object.prototype.hasOwnProperty.call(TEMPLATES, value)`.

- **[Low] ai-agent/flow.ts — normalizeNode**: pra `action`/`condition` faz `as FlowActionType`/`as FlowConditionType` sem validar contra os unions. JSONB corrompido passa a normalização e downstream vira no-op silencioso. **Fix**: validar contra `FLOW_ACTION_TYPES`/`FLOW_CONDITION_TYPES` as const e descartar node desconhecido (igual ao `entry`).

- **[Low] crm/mutations/leads-kanban.ts — todas as funções**: chamam `sanitizeMutationError(err.message)` passando *string*, mas a função espera objeto — early-return genérico sem `console.error` e sem mapeamento de códigos PG. Erros viram "Operacao falhou" sem rastro. **Fix**: passar o objeto (`sanitizeMutationError(stageErr)`).

- **[Low] crm/campaigns/audience-resolver.ts — fetchLeadsForTarget/fetchGroupsForTarget**: padrão `await query.then?.((r) => r) ?? {...}` converte builder sem `.then` em sucesso vazio silencioso. **Fix**: `await query` direto.

- **[Low] crm/mutations/conversations.ts — findOrCreateConversationByLead**: o SELECT da conversa existente descarta `error` — erro transitório de DB indistinguível de "não existe" → conversa duplicada. **Fix**: desestruturar `error` e throw antes do create.

- **[Low] providers/uazapi-client.ts — connect()/getStatus()/getQRCode()**: `const result: any` sobre resposta externa + `res.json() as Promise<T>` sem validação de shape — mudanças de payload viram `undefined` silencioso. **Fix**: interfaces estreitas + validar presença dos campos críticos.

- **[Low] providers/uazapi.ts — sendMedia() fallback**: `result!.MessageId` após switch sem `default` — novo membro no union vira TypeError em runtime. **Fix**: `default: throw` e remover o `!`.

- **[Low] providers/uazapi.ts + meta-cloud.ts — todos os sendXxx**: `success: true` hardcoded mesmo com id extraído `""` — callers persistem messageId vazio sem sinal de falha. **Fix**: `success: id.length > 0` ou throw.

- **[Low] providers/uazapi-webhook-config.ts — configureUazapiWebhook()**: retorna `Response` cru sem checar `res.ok` — webhook desconfigurado em silêncio (classe de bug "Bug B" documentada no próprio arquivo). **Fix**: checar `res.ok` e lançar erro com status dentro da função.
