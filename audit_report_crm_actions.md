# Relatório de Auditoria — `apps/crm/src/actions` (audit_crm_actions.txt)

> Auditoria de segurança, performance e type safety. Stack: Next.js 15, Supabase (PostgreSQL + RLS), TypeScript, server actions multi-tenant.
> Gerado em 2026-06-10 por análise integral do dump (linhas 1–18092, 2 passes).

---

## 1. SEGURANÇA

### High

- **[High] ai-agent/tools.ts — listToolsForAgent / createCustomTool / updateTool / setNativeToolEnabled**: todas retornam rows de `agent_tools` com `select("*")`, que inclui `webhook_secret` (segredo usado pra assinar chamadas aos webhooks n8n do cliente). `listToolsForAgent` exige só `requireAgentRole("agent")` — qualquer agente da org recebe os secrets no payload da action. Viola a convenção "segredos nunca voltam ao cliente". **Fix**: select explícito sem `webhook_secret` (ou mapear pra shape público com `webhook_secret_set: boolean`), em todos os retornos. *(Mesmo bug existe no espelho admin — ver relatório admin.)*

- **[High] flows.ts — duplicateFlow**: o fetch do original usa `.eq("id", id).single()` **sem filtro de `organization_id`** (get/update/delete do mesmo arquivo filtram). Se RLS não bloquear, admin da org A duplica (e exfiltra nodes/edges/trigger_config de) um flow da org B pra dentro da própria org. **Fix**: adicionar `.eq("organization_id", orgId)` no fetch.

- **[High] flows.ts — deleteFlow**: `supabase.from("flow_executions").delete().eq("flow_id", id)` roda **antes** de validar que o flow pertence à org e **sem** filtro de org. Passando id de flow alheio, o histórico de execuções é apagado mesmo que o delete do flow depois falhe no filtro de org. **Fix**: validar ownership do flow primeiro; filtrar o delete de executions por `organization_id`.

- **[High] email-campaigns.ts — deleteEmailCampaign**: mesmo padrão — `email_sends.delete().eq("campaign_id", id)` sem filtro de org e antes de verificar que a campanha é da org. **Fix**: idem acima.

- **[High] ai.ts — updateAssistant**: `update({ ...data, updated_at })` faz mass assignment: server actions não validam shape em runtime, então um cliente malicioso pode incluir chaves arbitrárias (`organization_id`, `id`, etc.) no objeto e gravar colunas não previstas. **Fix**: whitelist explícita campo a campo (padrão já usado em `updateCampaignDraft`/`updateFlow`).

- **[High] appointment-types.ts — updateAppointmentType**: idem — `const updates = { ...input, ... }` + `update(updates as never)` aceita qualquer chave vinda do cliente (o `as never` ainda desliga o type check). **Fix**: copiar apenas os campos do `UpdateAppointmentTypeInput` um a um.

- **[High] ai.ts — getAssistant(orgId?)**: aceita `orgId` como parâmetro do cliente e usa direto na query (`resolvedOrgId = orgId || ctx.orgId`). Viola a regra do projeto "orgId vem só da sessão"; depende 100% de RLS pra não vazar o prompt/config de assistant de outra org. **Fix**: remover o parâmetro e usar sempre `ctx.orgId`.

- **[High] tags.ts — getTags / getTagsWithCount**: ambas aceitam `orgId?: string` vindo do cliente e fazem `const resolvedOrgId = orgId || ctx.orgId;`, passando o id do parâmetro direto pro shared (`listTags`/`listTagsWithCount`). O vazamento real é mitigado apenas porque `ctx.supabase` é o client com RLS — se a RLS de `tags` falhar, ou se o helper compartilhado usar admin client, vira leak cross-tenant total. **Fix**: ignorar o parâmetro e usar sempre `ctx.orgId`.

### Medium

- **[Medium] groups.ts — recordGroupJoin**: server action exportada SEM `requireRole`, que recebe `organizationId`, `groupId`, `campaignId` do cliente e escreve via `createAdminClient()` (bypassa RLS), criando leads/memberships e incrementando `participant_count`. Como `resolveSmartLink` expõe publicamente os UUIDs de org/grupo/campanha, qualquer um com o smart link da vítima pode injetar leads/memberships falsos na org alvo. Não há rate-limit (o `ipHash` é capturado mas não usado pra throttle). **Fix**: validar que `groupId`+`campaignId` realmente pertencem a `organizationId` e aplicar rate-limit por `ipHash`.

- **[Medium] groups.ts — runGroupAutomations**: exportada de arquivo `"use server"` sem auth, recebe `orgId` e `context.leadId` do cliente e usa admin client. Permite acionar `add_tag` sobre um `leadId` arbitrário numa org com automação ativa. **Fix**: mover pra módulo não-`"use server"` (helper interno) ou exigir segredo de webhook.

- **[Medium] team.ts — createTeamMember / updateMemberRole**: `role` vem do cliente sem validação contra enum permitido. Um `admin` pode criar membro com `role: "owner"` ou promover qualquer membro a `owner` (a checagem `if (member.role === "owner")` só impede ALTERAR um owner existente, não CRIAR um). Quebra a hierarquia owner > admin. **Fix**: rejeitar `role` fora de `{admin, agent, viewer}` quando o caller não for owner.

- **[Medium] tools.ts — createTool**: faz upload no bucket `"tools"` e persiste `getPublicUrl(storagePath)` (URL pública), diferente do padrão de `chat-media` (bucket privado + signed URL). Documentos da org acessíveis sem auth, com path semi-adivinhável (`${orgId}/${Date.now()}-${slug}.${ext}`). **Fix**: bucket privado + `createSignedUrl`.

- **[Medium] ai-agent/calendar.ts — buildOAuthStartUrl**: a validação `returnTo.startsWith("/")` aceita `//evil.com` (URL protocol-relative) → open redirect pós-login Google. **Fix**: rejeitar prefixo `//` e `/\` (`/^\/(?![\/\\])/`). *(Mesmo bug no admin.)*

- **[Medium] agenda/availability.ts — updateAvailabilityRule / deleteAvailabilityRule**: `createAvailabilityRule` força `user_id = userId` pra role agent, mas update/delete não checam ownership da regra (só org via ctx). Um agent pode editar/apagar a disponibilidade de outro usuário da org. **Fix**: pra role agent, carregar a regra e exigir `rule.user_id === userId` (ou `ensureCanActOnUser`).

- **[Medium] agenda/booking-pages.ts — createBookingPage**: `user_id: input.user_id ?? userId` sem `ensureCanActOnUser` — agent pode criar booking page em nome de qualquer usuário da org. **Fix**: aplicar `ensureCanActOnUser(input.user_id, userId, role)`.

- **[Medium] agenda/public.ts — submitPublicBooking**: action pública valida nome/phone/email, mas **não valida `start_local` contra a janela de disponibilidade nem o lookahead** (checagem só existe em `getPublicSlotsForDate`; o shared faz apenas conflict check). Chamando a action direto, um bot agenda em qualquer horário. `input.timezone` também é string livre. **Fix**: revalidar no submit que o horário cai num slot de `getAvailableSlots` do dia e que `timezone` é IANA válida.

- **[Medium] capture-sources.ts — updateCaptureSource**: `createCaptureSource` valida que `api_key_id` pertence à org e está ativa; o update grava `input.api_key_id` direto sem essa validação. `pipeline_id`/`stage_id`/`tag_ids` nunca são validados contra a org (em create nem update). **Fix**: repetir o check de `api_keys` no update e validar pipeline/stage/tags por `organization_id`.

### Low

- **[Low] ai-agent/tools.ts — createCustomTool**: com `execution_mode: "native"`, aceita qualquer `native_handler` sem validar contra os presets nem contra o gate `ENABLED_PRESET_PRS` — bypass do feature-gating que `createToolFromPreset`/`setNativeToolEnabled` aplicam. **Fix**: validar `native_handler` via `getPreset()` + gate também aqui.

- **[Low] agenda/public.ts — getPublicBookingPage**: único endpoint público sem rate limit (slots e submit têm) — permite enumeração barata de slugs. **Fix**: aplicar o mesmo `checkSlotsRateLimit`.

- **[Low] agenda/reminders.ts — createReminderConfig / updateReminderConfig**: configs org-wide criáveis por role `agent` enquanto delete exige `admin` (inconsistente); `trigger_offset_minutes` aceita qualquer número e `template_text` sem limite de tamanho. **Fix**: subir pra `admin` e clampar offset/length.

- **[Low] conversations.ts — scheduleMessage**: `media_url` e `type` vêm do cliente sem validação (URL arbitrária enviada depois ao lead via worker) e `scheduledAt` não é validado como ISO/futuro. **Fix**: validar URL (https + host esperado do bucket), enum de `type` e data futura.

- **[Low] webhooks.ts — createWebhook**: persiste `url` do formData sem validação (localhost / IP privado / 169.254.169.254 passam). A proteção SSRF do commit recente está no dispatcher, não aqui. **Fix**: validar a URL também na criação (mesma allowlist/denylist do dispatch) — defesa em profundidade.

- **[Low] organization.ts — updateOrgSettings**: mescla chaves arbitrárias do cliente direto no JSONB `settings` (sem allowlist). Permite sobrescrever qualquer flag lida em outros módulos. Mesmo padrão em `onboarding.updateOnboardingStep`. **Fix**: allowlist de chaves graváveis.

**Nota positiva**: nenhum vazamento de tokens WhatsApp encontrado nas actions — todos os selects de `whatsapp_connections` (messages.ts, groups.ts, leads-kanban.ts, whatsapp-status.ts) usam os tokens apenas server-side; nenhum aparece nos shapes de retorno. `mcp-servers.ts` corretamente expõe só `has_auth_token: boolean`.

---

## 2. PERFORMANCE

### High

- **[High] conversations.ts — getConversations (last_message)**: pra montar `last_message`, busca **todas as mensagens de todas as conversas abertas** (`.in("conversation_id", ids)` sem `limit`) e descarta tudo menos a primeira por conversa. Em org com histórico grande é um full scan transferido por request de lista. **Fix**: RPC com `DISTINCT ON (conversation_id)`/lateral join, ou desnormalizar `last_message_preview` em `conversations`.

- **[High] conversations.ts — getConversations (lista)**: sem paginação nem `.limit()` (traz todas as não-fechadas com leads + tags embutidos). **Fix**: paginação por cursor em `last_message_at`.

- **[High] leads-import.ts — importLeads (strategy=update)**: o loop `for (const { existingId, cand } of toUpdate)` faz por linha um SELECT + um UPDATE sequenciais. Com `MAX_ROWS=5000` e muitas duplicatas, até ~10k round-trips sequenciais. Risco de timeout. **Fix**: reusar `existingByPhone`/`existingByEmail` já carregados e fazer updates em lote/`Promise.all` em chunks.

### Medium

- **[Medium] conversations.ts — bulkApplyTagToConversationLeads**: `for (const leadId of leadIds) await addTagToLeadShared(...)` — N+1 sequencial (até 200 awaits). **Fix**: insert batch único em `lead_tags` (upsert com `onConflict`).

- **[Medium] conversations.ts — setNativeAgentHandoffForConversation**: SELECT das rows + UPDATE individual por row pra bump de `ai_control_epoch`. **Fix**: um único UPDATE com incremento via RPC/SQL.

- **[Medium] email-campaigns.ts — getEmailCampaigns**: carrega **todas** as rows de `email_sends` pra contar sent/opened/clicked em JS. **Fix**: agregação no banco (RPC `GROUP BY campaign_id, status`).

- **[Medium] flows.ts — getFlows**: carrega todas as rows de `flow_executions` só pra contar por flow. **Fix**: `count` agregado por `flow_id` no banco.

- **[Medium] crm-campaigns.ts — getCrmCampaignDetails**: 13 queries de count separadas (recipients × 7 status + jobs × 5). **Fix**: 2 queries `GROUP BY status` via RPC.

- **[Medium] groups.ts — getGroupMessages**: dentro de `for (const row of rows)` chama `matchLeadByPhone` e `matchLeadByName` com `await` por linha (até ~100 queries sequenciais) + UPDATE de membership por match. **Fix**: batch dos telefones/nomes numa query `.in(...)` e patch agregado.

- **[Medium] messages.ts — forwardMessagesToConversations**: laço aninhado (até 20×10 = 200 envios sequenciais); cada `sendMessageViaWhatsApp` re-consulta `conversations` e `whatsapp_connections` do zero (~200 buscas da connection). **Fix**: resolver conversa+connection uma vez por target; paralelizar com limite.

- **[Medium] groups.ts — syncGroups**: `upsert(...).select().single()` sequencial por grupo. **Fix**: upsert em lote.

- **[Medium] groups.ts — getGroups (correctness + perf)**: última mensagem por grupo via `.limit(groupIds.length * 3 + 10)` deduplicado em JS — grupos menos ativos ficam com `last_message_*` nulo apesar de terem mensagens (bug de correção, não só perf). **Fix**: RPC com `DISTINCT ON (group_id)`.

### Low

- **[Low] crm-campaigns.ts — getCampaignRecipients / getCampaignEvents**: sem paginação — milhares de rows `select("*")` de uma vez. **Fix**: `range()` + filtro no servidor.

- **[Low] agenda/public.ts — submitPublicBooking**: incremento de `total_bookings` com read-modify-write não atômico (race admitido no comentário). **Fix**: RPC `increment` ou trigger.

- **[Low→Medium] leads.ts — getLeadsListStats**: as 3 queries (deals/activities/conversations) trazem TODAS as linhas dos `leadIds` só pra contar e pegar a mais recente client-side. **Fix**: agregação `count` + LIMIT 1 por lead via RPC, ou `head: true` para counts.

---

## 3. TYPE SAFETY

- **[High] crm-campaigns.ts — todo o arquivo**: padrão `const db: { from: (t: string) => any } = supabase as any` em ~20 funções desliga completamente o type check de tabelas, colunas e payloads. Qualquer rename de coluna vira bug silencioso em runtime, num módulo que dispara mensagens em massa. **Fix**: regenerar `@/types/database` e tipar `db` (ou usar `asAgentDb` como nos módulos ai-agent).

- **[Medium] agenda/public.ts + reminders.ts — LooseDb**: mesmo padrão `{ from: (table: string) => any }`; em `public.ts` é especialmente arriscado porque o client é o **admin client (bypassa RLS)** — erro de coluna/tabela ali não é pego em build nem mitigado por RLS. **Fix**: regenerar types, remover `LooseDb`.

- **[Medium] appointment-types.ts — updateAppointmentType**: `update(updates as never)` é o que permite o mass assignment da seção 1 passar sem erro de compilação. **Fix**: tipar `updates` como `Partial<AppointmentType>` construído por whitelist.

- **[Low] conversations.ts — scheduleMessage / assignConversation / getConversations**: `insert(scheduledRow as never)` esconde divergências do schema de `scheduled_messages`; casts `(conv.leads as any)?.phone` mascaram o shape real da relação `leads` (objeto vs array do PostgREST). **Fix**: tipos gerados pro embed + type guard único.

- **[Low] messages.ts — embeds `as Record<string, unknown>`**: padrão `((conversation as Record<string, unknown>).leads as ...)?.phone` assume embed to-one. Se o PostgREST devolver array, `phone` vira `undefined` silenciosamente e a mensagem é persistida mas NÃO enviada ao WhatsApp, sem erro visível. **Fix**: tipar o retorno do select ou normalizar array/objeto explicitamente.

- **[Low] whatsapp-status.ts — `UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN!`**: non-null assertion em env var; se ausente, vai como header `admintoken: undefined` e a falha aparece tarde. **Fix**: validar env no boot.

**Nota**: a maioria dos `as any`/`as never` (tabelas de migrations 079/080/084/107 sem tipos gerados, inserts em JSONB) são casts documentados e inofensivos — não reportados.
