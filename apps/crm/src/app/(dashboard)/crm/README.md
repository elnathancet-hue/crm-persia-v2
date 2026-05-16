# Módulo `/crm` — Documentação técnica

**Última atualização:** 2026-05-16
**Mantenedor:** Squad CRM Persia (skill `squad-crm-persia`)
**Memória relacionada:** [`project_kanban_lead_centric.md`](../../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_kanban_lead_centric.md)

> Este README documenta o **estado atual** do módulo `/crm`. Cada PR que toca em arquivos listados aqui DEVE atualizar a seção correspondente. Doc desatualizada é pior que sem doc.

---

## 1. Visão geral

`/crm` é o coração operacional do sistema. Tela única com **5 tabs** que cobrem o ciclo completo de gestão de leads:

| Tab | Conteúdo | Componente principal |
|---|---|---|
| **Funil** | Kanban lead-centric (1 lead = 1 card) | `KanbanBoard` (`@persia/crm-ui`) |
| **Leads** | Tabela paginada (20/página) | `LeadsList` (`@persia/leads-ui`) |
| **Segmentação** | Listagem de segmentos + ConditionBuilder | `SegmentsList` (`@persia/segments-ui`) |
| **Tags** | CRUD de tags da org | `TagsList` (`@persia/tags-ui`) |
| **Atividades** | Timeline org-wide (20/página, "Carregar mais") | `ActivitiesTab` (`@persia/crm-ui`) |

URL state preservado em query string: `?tab=`, `?pipeline=`, `?lead=`, `?segment=`.

---

## 2. Modelo de dados — lead-centric

**Regra fundamental (desde mai/2026, migration 039 / PR #202):**

> 1 lead = 1 card no Kanban. Deals são subentidade comercial dentro do lead (histórico de oportunidades).

### Tabelas

| Tabela | Campos críticos pro Kanban | Owner |
|---|---|---|
| `leads` | `pipeline_id`, `stage_id`, `sort_order`, `expected_value`, `status` | source of truth do card |
| `deals` | `lead_id NOT NULL`, `stage_id`, `value`, `status`, `loss_reason` | histórico comercial (subentidade) |
| `pipelines` | `name`, `is_default` | container de stages |
| `pipeline_stages` | `pipeline_id`, `name`, `color`, `sort_order`, `outcome` (em_andamento/falha/bem_sucedido) | colunas do Kanban |
| `lead_tags` | junction (lead_id, tag_id) | tags coloridas no card |
| `lead_activities` | `lead_id`, `type`, `description`, `created_at` | timeline (imutável) |
| `lead_comments` | `lead_id`, `author_id`, `body` | comentários colaborativos |
| `deal_loss_reasons` | catálogo por org | dropdown "Motivo da perda" |

### Triggers DB ativos

| Trigger | Tabela | Quando | Lógica |
|---|---|---|---|
| `trg_lead_stage_status_sync` | `leads` | BEFORE INSERT/UPDATE OF stage_id | `outcome='falha'` → `status='lost'`; `outcome='bem_sucedido'` → `status='customer'` |
| `update_updated_at` | múltiplas | BEFORE UPDATE | atualiza `updated_at` |
| ~~`lead_auto_deal`~~ | — | — | **DROPPED na migration 039.** Deal vira opt-in (usuário cria manualmente via tab "Negócios" do drawer) |

### Constraint crítica

- `deals.lead_id NOT NULL + ON DELETE CASCADE` — deletar lead apaga histórico de deals.

---

## 3. Estrutura de arquivos

```
apps/crm/src/app/(dashboard)/crm/
├── page.tsx                  RSC: Promise.all(9 queries) + props pro shell
├── crm-shell.tsx             Container client com 5 tabs + Providers + Header sticky
├── crm-client.tsx            Wrapper do KanbanBoard com realtime + presence
└── README.md                 ← este arquivo
```

### Componentes externos consumidos

| Pacote | Componente | Responsabilidade |
|---|---|---|
| `@persia/crm-ui` | `KanbanBoard` | Pipeline view (adapter `LeadKanbanCard` → `DealWithLead` shape) |
| `@persia/crm-ui` | `CreateKanbanDialog`, `ManageFunisDrawer`, `EditKanbanStructureDrawer`, `MarkAsLostDialog`, `CreateLeadFromKanbanDialog`, `KanbanProvider` | Drawers/dialogs do Kanban |
| `@persia/crm-ui` | `ActivitiesTab` | Tab Atividades (paginada 20/p, infinite scroll) |
| `@persia/leads-ui` | `LeadsList`, `LeadsProvider`, `LeadInfoDrawer` | Tab Leads + drawer com tabs (Dados/Negócios/Campos/Comentários) |
| `@persia/leads-ui` | `useCurrentUser`, `useDealsRealtime`, `useDealPresence`, `useDebouncedCallback`, `useLeadPresence` | Hooks de realtime |
| `@persia/segments-ui` | `SegmentsList`, `ConditionBuilder`, `SegmentsProvider` | Tab Segmentação |
| `@persia/tags-ui` | `TagsList`, `TagsProvider` | Tab Tags |
| `@persia/shared/crm` | types + queries + mutations | core compartilhado entre apps/crm e apps/admin |

### Componentes locais relevantes

```
apps/crm/src/
├── components/leads/lead-list.tsx          Wrapper local do LeadsList (LeadsProvider + LeadInfoDrawer)
├── components/segments/segment-list.tsx    Wrapper local do SegmentsList
├── features/crm-kanban/crm-kanban-actions.ts   Adapter DI → KanbanActions
├── features/leads/crm-leads-actions.ts         Adapter DI → LeadsActions
└── features/segments/                         Adapter DI → SegmentsActions
```

---

## 4. Fluxo de dados

```
┌──────────────────────────────────────────────────────────────────┐
│ page.tsx (RSC)                                                   │
│  ↓ Promise.all([listPipelines, listLeadsKanban, getLeads,        │
│              getOrgActivities, getSegments, getTagsWithCount,     │
│              listStages, leads-for-picker, members])              │
│  ↓ + getLeadsListStats(leadIds) + assignees resolve               │
└──────────────────────────────────────────────────────────────────┘
                              ↓ props (RSC → Client)
┌──────────────────────────────────────────────────────────────────┐
│ CrmShell (client)                                                │
│  ├─ <LeadsProvider actions={crmLeadsActions}>                    │
│  ├─ <KanbanProvider actions={crmKanbanActions}>                  │
│  ├─ Header sticky (CrmPageHeader + CrmTabs)                      │
│  └─ Tab content                                                  │
└──────────────────────────────────────────────────────────────────┘
                              ↓ por tab
┌──────────────────────────────────────────────────────────────────┐
│ Pipeline → CrmClient → KanbanBoard (drag-drop, bulks, realtime)  │
│ Leads    → LeadList → LeadsList + LeadInfoDrawer                 │
│ Seg.     → SegmentList → SegmentsList + ConditionBuilder         │
│ Tags     → TagsPageClient → TagsList                             │
│ Ativ.    → ActivitiesTab                                         │
└──────────────────────────────────────────────────────────────────┘
                              ↓ user action
┌──────────────────────────────────────────────────────────────────┐
│ DI Adapter (crm-kanban-actions.ts, crm-leads-actions.ts)         │
│  ↓ chama server action local em apps/crm/src/actions/*           │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Server action (apps/crm/src/actions/)                            │
│  ↓ requireRole("agent"|"admin") → { supabase, orgId }            │
│  ↓ chama shared mutation/query (@persia/shared/crm/)             │
│  ↓ side effects: revalidatePath + onLeadChanged (sync UAZAPI)    │
└──────────────────────────────────────────────────────────────────┘
                              ↓
                       Supabase + RLS
```

---

## 5. Server actions — quick reference

> Documentação detalhada (assinatura + auth + descrição) está em [project_kanban_lead_centric.md](../../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_kanban_lead_centric.md) e nos próprios arquivos via JSDoc.

### `actions/leads-kanban.ts` (lead-centric, principal)

| Função | Auth | Substitui (legacy) |
|---|---|---|
| `createLeadInPipeline` | agent | `createLeadWithDeal` (`actions/crm.ts`) |
| `moveLeadStage` | agent | `updateDealStage` |
| `moveLeadToPipeline` | agent | (novo) |
| `bulkMoveLeads` | agent | `bulkMoveDeals` |
| `bulkMarkLeadsAsWon` | agent | `bulkSetDealStatus("won")` |
| `bulkMarkLeadsAsLost` | agent | `bulkMarkDealsAsLost` |
| `getLeadStageContext` | agent | `getLeadOpenDealWithStages` |
| `listPipelinesForLead` | agent | — |
| `listStagesForPipeline` | agent | — |
| `createDealForLead` | agent | (deal vira opt-in) |
| `updateDealMeta` | agent | — |
| `deleteDealForLead` | agent | — |

### Outras actions usadas no /crm

- **`actions/leads.ts`** — `getLeads`, `getLead`, `createLead`, `updateLead`, `deleteLead`, `getOrgTags`, `assignLead`, `getOrgActivities`, `getLeadStats`, `getLeadDealsList`, `getLeadsListStats`, `findLeadByPhoneOrEmail`, `bulkAssignLeads`, `bulkDeleteLeads`, exports/import
- **`actions/crm.ts`** — pipelines/stages CRUD (admin) + funções deal-centric **legacy** (mantidas pra compat; ver seção 10)
- **`actions/tags.ts`** — `getTagsWithCount`, `createTag`, `updateTag`, `deleteTag`, `addTagToLead`, `removeTagFromLead`
- **`actions/segments.ts`** — `getSegments`, `createSegment`, `updateSegment`, `deleteSegment`
- **`actions/lead-comments.ts`** — `getLeadComments`, `createLeadComment`, `updateLeadComment`, `deleteLeadComment`
- **`actions/custom-fields.ts`** — `getCustomFields`, CRUD + `getLeadCustomFields`, `setLeadCustomFieldValue`
- **`actions/leads-import.ts`** — `importLeads` (CSV/XLSX, cap 5000)
- **`actions/conversations.ts`** — `findOrCreateConversationByLead`
- **`actions/ai-agent/reactivate.ts`** — `getLeadAgentHandoffState`, `reactivateAgent`

### Shared core — `packages/shared/src/crm/`

- **`queries/leads-kanban.ts`** — `listLeadsKanban`, `findLeadStageContext`
- **`mutations/leads-kanban.ts`** — `moveLeadToStage`, `moveLeadToPipeline`, `bulkMoveLeads`, `bulkMarkLeadsAsWon/Lost`
- **`queries/leads.ts`, `lead-stats.ts`, `pipelines.ts`, `tags.ts`, `custom-fields.ts`, `loss-reasons.ts`** — read-only
- **`mutations/leads.ts`, `tags.ts`, `pipelines.ts`, `conversations.ts`** — CRUD
- **`mutations/deals.ts`** — `createDeal`, `updateDeal`, `deleteDeal` + 4 funções `@deprecated` (`moveDealKanban`, `bulkMoveDealsToStage`, `bulkUpdateDealStatus`, `bulkMarkDealsAsLost`)

---

## 6. Regras críticas (invariantes)

### Auth + RLS (defense-in-depth)

1. Toda server action começa com `requireRole("agent"|"admin")` (definido em `apps/crm/src/lib/auth.ts`).
2. Todas as queries explícitam `.eq("organization_id", orgId)` mesmo com RLS — defesa em camada.
3. RLS helper: `get_user_org_role(p_org_id UUID) → TEXT` (SECURITY DEFINER).

### Permissões por tabela

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `leads`, `deals`, `lead_tags`, `lead_activities` | agent+ | agent+ | agent+ | agent+ |
| `pipelines`, `pipeline_stages`, `deal_loss_reasons` | agent+ | admin+ | admin+ | admin+ |
| `lead_activities` | agent+ | agent+ | — (imutável) | — (imutável) |
| `lead_comments` | agent+ | agent+ | author | author |

### Lead-centric Kanban

- Source of truth do card: `leads.pipeline_id` + `leads.stage_id`.
- 1 lead = 1 card (a antiga regra "lead pode aparecer N vezes via N deals" foi eliminada na Fase 0).
- `KanbanBoard` internamente usa adapter (`packages/crm-ui/src/components/KanbanBoard.tsx`, linha ~380) que converte `LeadKanbanCard[]` em `DealWithLead[]` shape — `deal.id === lead.id` no UI legado. Handlers chamam `moveLeadStage` / `bulkMoveLeads`.

### ActionResult pattern

Mutations destrutivas retornam `Promise<ActionResult<T>>` (`{ data?: T; error?: string }`). UI não precisa try/catch — usa `.error`.

### Performance

- `Promise.all` em RSC pra paralelizar 9 queries.
- `revalidateLeadCaches(leadId)` invalida `/crm` + `/leads/:id` + `/chat` em uma chamada.
- Debounce 200ms em realtime refresh (burst de drag-drop = 1 refresh).
- Bulks: cap 200 itens por chamada.
- Tests realtime hooks usam mock supabase chainable.

---

## 7. Pontos de integração

> **Esta seção lista quem CONSOME o `/crm`**. Detalhes da arquitetura interna desses módulos vivem em READMEs próprios.

### AI Agent (`apps/crm/src/lib/ai-agent/tools/`)

| Tool | O que faz | Toca em |
|---|---|---|
| `move-pipeline-stage.ts` | Move lead entre stages do Kanban | `leads.pipeline_id`, `leads.stage_id` (lead-centric desde PR #205) |
| `lead-resolver.ts` (scheduler) | Filtra leads elegíveis pra jobs agendados | `leads.stage_id` direto (era `deals.stage_id` antes) |
| `transfer-to-user.ts` | Atribui lead a user | `leads.assigned_to` |
| `add-tag.ts` | Adiciona tag ao lead | `lead_tags` (junction) |
| `stop-agent.ts` | Pausa agent (handoff humano) | `agent_conversations` (não toca direto em leads) |

### API pública (`apps/crm/src/app/api/crm/route.ts`)

Endpoint REST consumido por **n8n flows externos**. Auth: `Bearer CRM_API_SECRET`.

Actions aceitas: `move_lead` (alias `move_deal` pra compat), `add_tag`, `remove_tag`, `pause_bot`, `get_lead`, `update_lead`, `get_deal`, `list_stages`.

Side effects de `move_lead`:
- `moveLeadToStageShared` (activity log automático)
- `onStageChanged(orgId, leadId, stageId)` (flow triggers)
- `syncLeadToUazapi(orgId, leadId)` (dynamic import, fire-and-forget)
- `revalidateLeadCaches(leadId)`

### WhatsApp incoming-pipeline (`apps/crm/src/lib/whatsapp/incoming-pipeline.ts`)

Recebe webhooks UAZAPI/Meta Cloud, processa msg, alimenta contexto pro n8n.

Payload enviado ao n8n inclui (campos do `/crm`):
```ts
{
  leadId, conversationId, orgId,
  currentStage,        // lead.pipeline_stages.name
  currentPipeline,     // lead.pipelines.name
  dealId: null,        // mantido pra compat n8n; sem semantic atual
  dealValue,           // lead.expected_value
  tags: string[],      // lead_tags
  leadStatus,
  funnelStages: [{ name, description, sort_order }]
}
```

### Flow triggers (`apps/crm/src/lib/flows/triggers.ts`)

| Trigger | Disparado por | Callback |
|---|---|---|
| `onNewLead(orgId, leadId)` | webhook UAZAPI quando lead novo chega | `executeFlow` no array `flows where trigger_type='new_lead'` |
| `onKeyword(orgId, leadId, msg)` | incoming-pipeline match de palavra-chave | idem `trigger_type='keyword'` |
| `onTagAdded(orgId, leadId, tagName)` | server actions de tag | idem `trigger_type='tag_added'` |
| `onStageChanged(orgId, leadId, stageId)` | `move_lead`, AI Agent tool, `moveDealToStage` (legacy) | idem `trigger_type='stage_changed'` |

### Admin (`apps/admin/src/components/crm/crm-page.tsx`)

Renderiza o **mesmo `KanbanBoard`** mas com `<LeadsProvider actions={adminLeadsActions}>` + `<KanbanProvider actions={adminKanbanActions}>`. Auth: `requireSuperadminForOrg()` (cookie assinado + service-role bypassa RLS).

### Realtime (`apps/crm/src/app/(dashboard)/crm/crm-client.tsx` + `apps/admin/src/components/crm/crm-page.tsx`)

- `useKanbanLeadsRealtime(supabase, pipelineId, debouncedRefresh)` — postgres_changes em **`leads`** filtrado por `pipeline_id`. Captura drag-drop / AI Agent / `/api/crm` / bulk move — todos atualizam `leads.stage_id` pós-refactor lead-centric. **Sem este hook, mudanças via AI ou n8n só aparecem após refresh manual.**
- `useDealsRealtime(supabase, pipelineId, debouncedRefresh)` — postgres_changes em **`deals`** filtrado por pipeline. Mantido pra cobrir mudanças na tab "Negócios" do drawer (criar/editar/excluir deal).
- `useDealPresence({ supabase, pipelineId, currentUser })` — canal próprio `pipeline-presence-${pipelineId}`, mostra quem está vendo cada card.
- Debounce 200ms trailing.

> **Por que 2 hooks?** Pós-refactor lead-centric (PR #202), o source of truth do Kanban é `leads.stage_id`. `useDealsRealtime` sozinho perde 100% das movimentações de lead (`deals` não muda). Ambos rodam em paralelo: o de leads cobre o Kanban; o de deals cobre o drawer.

---

## 8. Tests

20 test files em `apps/crm/src/__tests__/`. **429/429 passando** (último merge).

Tests críticos pro `/crm`:
- `multi-tenant.test.ts` + `multi-tenant-isolation.test.ts` — isolamento de org
- `crm-shared-queries.test.ts` / `crm-shared-mutations.test.ts` / `crm-shared-pipelines.test.ts`
- `crm-bulk-mutations.test.ts` — bulks lead-centric
- `crm-mutations-errors.test.ts` — `sanitizeMutationError`
- `ai-agent-pr3-runtime.test.ts` — `movePipelineStageHandler` lead-centric
- `ai-agent-pr7.2-runtime.test.ts` — scheduler `filterByPipelineStages`
- `actions/__tests__/leads.test.ts` — actions de leads

Tests NÃO cobrem RLS (precisa SQL direto). Para validar RLS: ver `apps/crm/supabase/MULTI_TENANT_RLS_CHECKS.sql`.

### Como rodar

```bash
cd D:/tmp/crm-persia-monorepo
pnpm --filter @persia/crm test                # roda todos
pnpm --filter @persia/crm test multi-tenant   # filtra
pnpm --filter @persia/crm typecheck            # tsc
pnpm --filter @persia/crm dev                  # dev local
```

---

## 9. Como rodar local

1. **Env vars** em `apps/crm/.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL=https://tqogqaqwqbdfoevuizxu.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>`
   - `SUPABASE_SERVICE_ROLE_KEY=<service>` (server-side only)
   - `CRM_API_SECRET=<token>` (Bearer pro `/api/crm`)
   - `N8N_WEBHOOK_URL=<n8n endpoint>` (opcional pra incoming-pipeline)
2. **Migrations**: aplicar via SQL Editor do Supabase Dashboard (não `supabase db push` — bug permission denied).
3. **Dev server**: `pnpm --filter @persia/crm dev --turbo` (Turbopack — mais rápido que webpack no Windows).
4. **Login**: criar profile via Auth Dashboard → garantir membership em `organization_members` com role >= agent.

---

## 10. Pendências conhecidas (`@deprecated`)

### Funções deal-centric mantidas pra compat

Têm callers em adapters (`crm-kanban-actions.ts`, `admin-kanban-actions.ts`). Cleanup completo exige migrar todos adapters pra wire só lead-centric.

| Arquivo | Funções @deprecated |
|---|---|
| `packages/shared/src/crm/mutations/deals.ts` | `moveDealKanban`, `bulkMoveDealsToStage`, `bulkUpdateDealStatus`, `bulkMarkDealsAsLost` |
| `packages/leads-ui/src/actions.ts` | `getLeadOpenDealWithStages`, `updateDealStage` |
| `packages/crm-ui/src/actions.ts` | 11 métodos KanbanActions (`createDeal`, `createLeadWithDeal`, `updateDeal`, `moveDealStage`, `deleteDeal`, `bulkMoveDeals`, `bulkSetDealStatus`, `bulkDeleteDeals`, `bulkApplyTagsToDeals`, `markDealAsLost`, `bulkMarkDealsAsLost`) |
| `apps/crm/src/lib/crm/move-deal.ts` | `moveDealToStage` (caller: `crm.ts:273` updateDealStage server action legacy) |

### Outras pendências

- Filtros Kanban/Audit Admin/ConditionBuilder ainda aplicam onChange ao vivo (deveriam ter botão "Aplicar filtros" + "Limpar filtros" — só `LeadsAdvancedFilters` foi migrado).
- `DealCard` na tab Negócios do drawer não tem botões editar/excluir inline (actions já prontas: `updateDealMeta` + `deleteDeal`).
- Admin drawer (LeadInfoDrawer) ainda usa legacy `getLeadOpenDealWithStages` + `updateDealStage` (funciona via fallback no drawer).

---

## 11. Histórico de decisões arquiteturais

| PR | Conteúdo | Memory |
|---|---|---|
| [#201](https://github.com/elnathancet-hue/crm-persia-v2/pull/201) | DS Polish Global v3 — scrollbar 14px, tipografia DM Sans, primary em variants, destructive red-700 | — |
| [#202](https://github.com/elnathancet-hue/crm-persia-v2/pull/202) | Fase 0+1 lead-centric — Migration 039 + shared queries/mutations | [project_kanban_lead_centric.md](../../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_kanban_lead_centric.md) |
| [#203](https://github.com/elnathancet-hue/crm-persia-v2/pull/203) | Fase 2 — KanbanBoard adapter LeadKanbanCard → DealWithLead | idem |
| [#204](https://github.com/elnathancet-hue/crm-persia-v2/pull/204) | Fase 3 — LeadInfoDrawer "Mudar etapa/funil" + tab "Negócios" | idem |
| [#205](https://github.com/elnathancet-hue/crm-persia-v2/pull/205) | Fase 4 — AI Agent + `/api/crm` + WhatsApp context lead-centric | idem |
| [#206](https://github.com/elnathancet-hue/crm-persia-v2/pull/206) | Fase 5 — audit visual + cleanup | idem |
| [#207](https://github.com/elnathancet-hue/crm-persia-v2/pull/207) | UX copy leigos-friendly | — |
| [#208](https://github.com/elnathancet-hue/crm-persia-v2/pull/208) | fix: `<LeadsProvider>` envolvendo Kanban (CreateLeadFromKanbanDialog quebrava ao clicar "+") | — |
| [#209](https://github.com/elnathancet-hue/crm-persia-v2/pull/209) | UX 7 fixes (header sticky, scrollbar sem setas, tags contorno azul, etc) | — |

### Decisões fundamentais

1. **1 lead em 1 funil por vez** — `leads.pipeline_id` único, sem junction table multi-funil.
2. **`pipeline_id` nullable** — lead pode existir fora de funil (webhook não triado).
3. **Deal vira opt-in** — sem auto-deal trigger. Usuário cria oportunidade comercial via tab "Negócios" do drawer.
4. **Trigger DB sincroniza `lead.status`** — `outcome=falha/bem_sucedido` no stage destino → status atualizado automaticamente.
5. **`deals.lead_id` CASCADE** — deletar lead apaga histórico de deals.
6. **Adapter no KanbanBoard** preserva ~3500 linhas internas — `deal.id` carrega `lead.id`.

---

## 12. Checklist pra manter este README sincronizado

Cada PR que tocar em:
- `apps/crm/src/app/(dashboard)/crm/**`
- `apps/crm/src/actions/leads*`, `crm.ts`, `pipelines.ts`, `leads-kanban.ts`, `lead-comments.ts`, `custom-fields.ts`, `leads-import.ts`, `segments.ts`
- `apps/crm/src/features/{crm-kanban,leads,segments}/**`
- `packages/{crm-ui,leads-ui,segments-ui,tags-ui}/**`
- `packages/shared/src/crm/**`
- `apps/crm/supabase/migrations/0{2,3,4}*.sql` (qualquer migration que toque leads/deals/pipelines)
- `apps/crm/src/lib/ai-agent/tools/move-pipeline-stage.ts`, `lead-resolver.ts`
- `apps/crm/src/app/api/crm/route.ts`
- `apps/crm/src/lib/whatsapp/incoming-pipeline.ts`
- `apps/crm/src/lib/flows/triggers.ts`

… **DEVE atualizar a seção correspondente deste README** antes de mergear.

> Se a mudança é arquitetural (nova table, novo trigger DB, novo modelo de dados), atualizar TAMBÉM:
> - [`project_kanban_lead_centric.md`](../../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_kanban_lead_centric.md) (ou criar memory file novo)
> - Skill [`squad-crm-persia`](../../../../../../../../../../Users/ELNATHAN/.claude/skills/squad-crm-persia/SKILL.md)
