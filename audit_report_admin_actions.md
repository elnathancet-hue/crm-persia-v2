# Relatório de Auditoria — `apps/admin/src/actions` (audit_admin_actions.txt)

> Auditoria de segurança, performance e type safety. Contexto crítico: o admin usa SERVICE-ROLE key que **bypassa RLS** — toda proteção é em código.
> Gerado em 2026-06-10 por análise integral do dump (linhas 1–11635, 2 passes).

**Nota geral**: não foi encontrado IDOR cross-tenant clássico em `agenda/*` e `ai-agent/*` — as queries filtram `organization_id` explicitamente e os `assert*BelongsToOrg` são consistentes. O `orgId` por parâmetro nas actions de `ai-agent/*` é validado por `requireAdminAgentOrg(orgId)` → `requireSuperadminForOrg(orgId)`, dentro da convenção.

---

## 1. SEGURANÇA

### High

- **[High] templates.ts — syncAllMetaTemplatesForCron**: função exportada num arquivo `"use server"` **sem nenhum auth check** (comentário admite: "Nao passa por auth do usuario") rodando `withAdmin` service-role sobre **todas as orgs**. Todo export async de arquivo `"use server"` vira endpoint POST invocável pelo client — qualquer pessoa com o action-ID (descobrível no bundle) dispara sync de templates de toda a plataforma (abuso de recurso, chamadas à Graph API da Meta em massa, rate-limit burn). **Fix**: mover a função para um módulo sem `"use server"` (ex: `@/lib/templates/cron.ts`) e importar no route handler do cron, que valida `CRON_SECRET`.

- **[High] admin.ts — getOrganizationDetail**: retorna `instance_token` em claro no shape da action (`whatsapp: { instanceToken: ... }`). Viola a regra de nunca devolver tokens de WhatsApp ao cliente — o token vai serializado no payload RSC/JS do browser. **Fix**: remover `instance_token` do retorno (devolver só `status`/`phone_number`, ou token mascarado); o form de edição grava sem nunca ler o valor atual.

- **[High] ai-agent/tools.ts — listToolsForAgent / createCustomTool / updateTool / setNativeToolEnabled**: `.select("*")` em `agent_tools` retorna a row inteira, incluindo `webhook_secret` (segredo HMAC dos webhooks n8n). Vaza pro browser em toda listagem/edição. **Fix**: selecionar colunas explícitas sem `webhook_secret`, ou strip antes do `return`. *(Mesmo bug no espelho CRM — ver relatório CRM.)*

### Medium

- **[Medium] ai-agent/knowledge.ts — createDocument**: aceita `storage_path` arbitrário do cliente sem validar o prefixo da org. Permite registrar fonte apontando pra pasta de OUTRA org no bucket; o indexer leria esse conteúdo pro org atual e `deleteKnowledgeSource` depois faria `storage.remove()` do arquivo alheio. **Fix**: em `normalizeDocumentInput`, exigir `input.storage_path.startsWith(\`${orgId}/\`)`.

- **[Medium] ai-agent/calendar.ts — buildOAuthStartUrl**: validação de `returnTo` é só `startsWith("/")`, que aceita `//evil.com/x` → open redirect pós-OAuth via `return_to` no state. **Fix**: rejeitar também `//` e `/\`.

- **[Medium] admin.ts — updateOrganization**: mass assignment — `data: Record<string, unknown>` spreadado direto no `UPDATE organizations`. Qualquer coluna pode ser sobrescrita (ex.: `settings` inteiro, apagando o webhook allowlist; `slug`, `plan`). **Fix**: allowlist de campos editáveis, copiando campo a campo.

- **[Medium] admin.ts — connectWhatsAppInstance**: grava `instance_url` sem validação de URL/protocolo (pode armazenar URL interna/loopback que vira SSRF quando o provider usar a conexão) e é a única mutação sensível do arquivo SEM `auditLog` — troca de credencial WhatsApp não deixa rastro. **Fix**: validar `https:` + hostname público (reusar validação SSRF do webhook-caller) e adicionar `auditLog`.

- **[Medium] campaigns.ts — executeCampaign**: a query de tags não filtra org: `lead_tags.select("lead_id, tags!inner(name)").in("tags.name", campaign.target_tags)` — casa tags **por nome em todos os tenants**. Mitigado pela interseção posterior com `leads` (org-scoped), mas lê linhas cross-tenant e pode segmentar errado. **Fix**: adicionar `.eq("tags.organization_id", orgId)`.

- **[Medium] settings.ts — updateOrgSettings**: mass assignment — `updates: Record<string, unknown>` spreadado direto no `update` de `organizations`. O client controla **qualquer coluna** da org ativa (plano, limites, flags de billing…). **Fix**: whitelist explícita.

- **[Medium] pipelines.ts — createLeadInPipeline**: `input.pipelineId`/`input.stageId` vêm do client e são gravados sem validar que pertencem à org — referência cross-tenant injetável (lead some do Kanban, corrompe relatórios). **Fix**: validar stage+pipeline contra `organization_id` antes do update.

- **[Medium] automations.ts — getTools**: `select("*")` em `integrations` retornado cru ao client. Tabelas de integração tipicamente guardam credenciais/config em JSONB; com service-role não há RLS pra mascarar. **Fix**: lista explícita de campos não sensíveis.

### Low

- **[Low] ai-agent/tools.ts — createCustomTool / validateToolPayload**: para `execution_mode: "native"`, `native_handler` aceito sem checar `getPreset()` nem `ENABLED_PRESET_PRS` — bypass do gating imposto em `createToolFromPreset`/`setNativeToolEnabled`. **Fix**: validar preset + gate também no caminho custom.

- **[Low] settings.ts — updateMemberRole / createTeamMember**: `role` é string livre, sem whitelist — dá pra criar/promover membro a `"owner"` ou inserir role inválida. `updateMemberRole` também permite **rebaixar o owner**. **Fix**: validar role contra enum e bloquear mudança quando `member.role === "owner"`.

- **[Low] settings.ts — getWhatsAppStatus**: retorna `instanceUrl` (URL do servidor UAZAPI) ao client — disclosure de infraestrutura desnecessário. **Fix**: retornar só `status` + `phone`.

- **[Low] campaigns.ts — updateCampaignStatus**: re-validação do template lê `wa_templates` por `id` sem `organization_id` e ecoa `tpl.name` em erro. **Fix**: adicionar `.eq("organization_id", orgId)`.

- **[Low] groups.ts — sendMessageToGroup / getGroupInfo / getGroupInviteLink**: aceitam JID cru do client sem checar que o grupo existe em `whatsapp_groups` da org — na prática envia texto pra **qualquer** número/JID via a instância da org. **Fix**: resolver o grupo por `whatsapp_groups (organization_id, group_jid)` antes do provider.

- **[Low] crm-campaigns.ts — uploadCampaignMediaAction**: cria bucket `campaign-media` com `public: true` — mídia acessível a quem tiver a URL, sem expiração. **Fix**: bucket privado + signed URLs (padrão chat-media).

- **[Low] segments.ts — createSegment / updateSegment**: `rules: unknown` persistido sem validação de schema (`as never`); regras malformadas só explodem na avaliação. **Fix**: validar shape `{ operator, conditions[] }` (zod) antes do insert.

---

## 2. PERFORMANCE

### High

- **[High] reports.ts — getReportStats**: `from("deals").select("value")` (2×) **sem paginação** — PostgREST corta no max-rows (default 1000), então `dealValue`/`revenueThisMonth` ficam **silenciosamente errados** para orgs com >1000 deals (o próprio arquivo usa loop paginado nas timelines, reconhecendo o limite). **Fix**: RPC com `SUM(value)` no Postgres, ou o mesmo loop paginado.

- **[High] campaigns.ts — executeCampaign**: `select("id, phone, name")` de **todos** os leads da org sem `.range()` — cap silencioso de 1000 linhas → campanha dispara para um subconjunto dos leads sem aviso. Filtro por tag feito em memória. **Fix**: paginar (ou filtrar por tag no SQL com join org-scoped) antes de montar `phones`.

- **[High] admin.ts — getOrganizationDetail / getAuditLogs**: `admin.auth.admin.listUsers({ perPage: 1000 })` carrega TODOS os usuários do projeto a cada chamada só pra mapear e-mails de um punhado de IDs, e silenciosamente quebra (e-mails vazios) a partir do usuário 1001. **Fix**: `Promise.all(userIds.map(id => getUserById(id)))`, ou espelhar `email` em `profiles`.

### Medium

- **[Medium] settings.ts — getTeamMembers / getSuperadmins**: mesmo `listUsers({ perPage: 1000 })` — todos os usuários auth da plataforma pra mapear e-mails de ≤100 membros. **Fix**: idem acima.

- **[Medium] settings.ts — addSuperadmin**: `listUsers()` **sem perPage** usa default (50) — com >50 usuários, o `find` por email falha com "Usuario nao encontrado" mesmo o usuário existindo. **Bug funcional, não só perf.** **Fix**: lookup direto por email ou paginação em loop.

- **[Medium] crm-campaigns.ts — getCrmCampaignDetails**: 14 round-trips (12 counts `head:true` por status + steps + targets). **Fix**: 2 queries `GROUP BY status` via RPC.

- **[Medium] crm-campaigns.ts — getCampaignRecipients / getCampaignEvents / listCrmCampaigns**: sem paginação/`.limit()` — recipients caem no cap de 1000 do PostgREST e a UI mostra lista truncada sem indicação. **Fix**: `.range()` + count com parâmetro `page`.

- **[Medium] reports.ts — getLeadsTimeline / getMessagesTimeline**: baixam **todas as linhas** da janela (loop sequencial de páginas de 1000) só pra contar por dia em JS. **Fix**: RPC `SELECT date_trunc('day', created_at), count(*) GROUP BY 1`.

- **[Medium] conversations.ts — getConversations**: fetch de "última mensagem" com `.limit(ids.length * 3)` não garante 1 msg por conversa — conversas com atividade antiga ficam com `last_message: null`. **Fix**: RPC `DISTINCT ON (conversation_id)` ou denormalizar.

- **[Medium] ai-agent/audit.ts — listRuns / resolveConversationIds**: ao filtrar por `config_id`/`lead_id`, carrega TODOS os ids de `agent_conversations` que casam (sem limit) e passa o array inteiro pro `.in(...)`. **Fix**: limitar a subquery ou denormalizar `config_id`/`lead_id` em `agent_runs`.

- **[Medium] admin.ts — getAuditFilterOptions**: `select("action").limit(5000)` pra derivar valores distintos em JS. **Fix**: `SELECT DISTINCT` via RPC, ou constante em código.

### Low

- **[Low] conversations.ts — bulkApplyTagToConversationLeads**: `await addTagToLeadShared` em `for` — N+1 (até 200 round-trips). **Fix**: insert batch com `onConflict ignore`.

- **[Low] groups.ts — syncGroups**: upsert por grupo em `for` — N+1. **Fix**: um único `.upsert(rows, { onConflict: "organization_id,group_jid" })`.

- **[Low] messages.ts — getMessages**: `options.limit` do client não é clampado (diferente de `getGroupMessages`, que clampa em 250). **Fix**: `Math.min(limit, 200)`.

- **[Low] ai-agent/usage.ts — getUsageStats**: três fetches de `agent_usage_daily` com janelas sobrepostas + load sequencial. **Fix**: buscar só month-to-date + janela e derivar "today" em memória; paralelizar no mesmo `Promise.all`.

---

## 3. TYPE SAFETY

- **[High] crm-campaigns.ts — todo o arquivo**: `const db: { from: (t: string) => any } = supabase as any` em ~15 funções elimina 100% da checagem de tipos no maior arquivo do app. Agrava: `target_kind: t.target_kind as never`, `createProvider(conn as never)`. **Fix**: regenerar `Database` types para `crm_campaign_*` e remover o helper `any`.

- **[High] whatsapp-manage.ts — módulo**: `process.env.UAZAPI_SERVER_URL!` e `UAZAPI_ADMIN_TOKEN!` no top-level — se a env faltar, `autoProvisionWhatsApp` faz `fetch("undefined/instance/create")` com `admintoken: undefined`, erro aparece como falha genérica. **Fix**: validação explícita com throw descritivo (lazy ou em `env.ts`).

- **[Medium] leads.ts — updateLead**: `updates: Record<string, unknown>` do client encaminhado ao shared com double-cast `as Record<string, never>` — silencia o contrato de `UpdateLeadInput`; se o shared não whitelistar, o client seta campos arbitrários do lead (incl. `organization_id`). **Fix**: tipar como `UpdateLeadInput` e deixar o TS validar.

- **[Medium] settings.ts — listApiKeys / revokeApiKey / getGoogleCalendarStatus / listMcpServersAdmin / deleteMcpServer / toggleMcpServer / listCaptureSourcesAdmin**: `(admin as any)` em todas as queries das tabelas novas (`api_keys`, `google_calendar_connections`, `mcp_server_connections`, `capture_sources`). **Fix**: regenerar Database types e remover os casts.

- **[Medium] lead-comments.ts — LooseDb + casts em cadeia**: três camadas de cast por função; o shape `Row` declarado (incl. join `profiles`) nunca é verificado contra o select real. **Fix**: gerar types da migration 037 e tipar o join.

- **[Medium] agenda/reminders.ts — LooseDb / loose()**: `{ from: (table: string) => any }` apaga a tipagem de todas as queries de reminders — typo de coluna compila limpo e o gate `ignoreBuildErrors: false` não pega nada aqui. **Fix**: tipar com `AgentDb`/`fromAny` ou generics do `Database`.

- **[Low] ai-agent/knowledge.ts — updateFAQ / deleteKnowledgeSource**: cast de JSONB sem type guard — metadata malformado leva a `storage.remove([undefined])` e merge de FAQ com `question: undefined`. **Fix**: validar `typeof meta.storage_path === "string"` antes de usar.

- **[Low] ai-agent/{feature-flag,webhook-allowlist}.ts + reactivate.ts — casts `as never`**: em updates/inserts de colunas JSONB — drift de schema passa despercebido. **Fix**: tipar via `Json`/helper `mergeJsonObject`.

- **[Low] campaigns.ts — sendUazapiCampaign / enqueueTemplateCampaign**: `campaign: Record<string, unknown>` com casts espalhados; o select é `"*"` numa tabela tipada — bastava tipar o retorno (`Tables<"campaigns">`). **Fix**: idem.
