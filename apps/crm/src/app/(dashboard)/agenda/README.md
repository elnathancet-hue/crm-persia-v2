# Módulo `/agenda` — Documentação técnica

**Última atualização:** 2026-05-17
**Mantenedor:** Squad CRM Persia (skill `squad-crm-persia`)
**Memória relacionada:** [`project_agenda_module.md`](../../../../../../../../../../Users/ELNATHAN/.claude/projects/D--tmp-crm-persia-monorepo/memory/project_agenda_module.md) (criar quando virar fonte de decisões)

> Este README documenta o **estado atual** do módulo `/agenda`. Cada PR que toca em arquivos listados aqui DEVE atualizar a seção correspondente. Doc desatualizada é pior que sem doc.

---

## 1. Visão geral

`/agenda` é o módulo de agendamentos integrado ao CRM. **6 tabs** internas mais **booking page pública** (`/agendar/[orgSlug]/[pageSlug]`):

| Tab | Conteúdo | Componente principal |
|---|---|---|
| **Visão geral** | 4 cards de stats + lista de hoje | `AgendaOverview` (`@persia/agenda-ui`) |
| **Calendário** | Grid semanal/mensal | `AgendaCalendarView` |
| **Lista** | Tabela paginada de todos os appointments | `AgendaCalendarView` em `viewMode="list"` |
| **Disponibilidade** | Configurar janela semanal por agente | `AgendaAvailabilitySettings` + `WeeklyAvailabilityEditor` |
| **Páginas de agendamento** | CRUD de booking pages públicas | `AgendaBookingPagesList` |
| **Ajustes** | Lembretes WhatsApp (reminder_configs) | `AgendaSettingsTab` + `ReminderConfigDrawer` |

URL state mínimo (tab é local state do client, não query string — diferença do `/crm`). Booking page pública é rota separada não autenticada (`/agendar/[orgSlug]/[pageSlug]`).

---

## 2. Modelo de dados

Schema introduzido pela **migration 031** (`apps/crm/supabase/migrations/031_agenda_module.sql`).

### Tabelas principais

| Tabela | Campos críticos | Notas |
|---|---|---|
| `appointments` | `kind`, `status`, `lead_id`, `user_id`, `start_at`, `end_at`, `timezone`, `cancelled_at`, `rescheduled_from_id`, `deleted_at` | Fonte de verdade do compromisso |
| `agenda_services` | `name`, `duration_minutes`, `color`, `is_active` | Catálogo org-wide (sem multi-agent — ver pendência #15) |
| `availability_rules` | `user_id`, `days` (JSONB), `timezone`, `is_default` | Por agente (não org-wide). 1 default por user |
| `booking_pages` | `slug`, `user_id`, `service_id`, `status`, `duration_minutes`, `buffer_minutes`, `lookahead_days`, `total_bookings` | Rota pública. Status='active' libera `/agendar/[org]/[slug]` |
| `appointment_history` | `appointment_id`, `action`, `metadata`, `performed_by_role` | Audit imutável (created/updated/cancelled/rescheduled/status_changed) |
| `agenda_reminder_configs` | `strategy`, `offset_minutes`, `template_text`, `is_active` | Configuração de lembretes (org-wide) |
| `agenda_reminder_sends` | `appointment_id`, `reminder_config_id`, `status`, `scheduled_for`, `sent_at`, `attempted_count`, `error` | Queue de envio (cron tick processa) |

### Status enum (`appointments.status`)

`'awaiting_confirmation' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled'`

CHECK constraint enforça no DB. UI usa `AppointmentStatusBadge` com tom semântico por status.

### Kind enum (`appointments.kind`)

`'appointment' | 'event' | 'block'`

- **appointment**: com lead, mostra no Kanban/drawer
- **event**: reunião interna (sem lead)
- **block**: folga/almoço (sem lead, vira indisponibilidade)

CHECK no DB: `(kind = 'appointment' OR lead_id IS NULL)` — eventos e bloqueios **não** carregam lead.

### RLS

`appointments` tem RLS habilitado, policies filtram por `organization_id`. `service_role` (admin) bypassa.

### Triggers DB

Nenhum trigger automático em appointments (diferente de `leads.stage_id` no /crm). Atualizações de status manuais via mutations shared.

### Cascade

- `appointments.organization_id` → `organizations(id) ON DELETE CASCADE` (org deletada apaga appointments)
- `appointments.lead_id` → `leads(id) ON DELETE SET NULL` (lead deletado deixa appointment órfão sem lead — possível query de cleanup futuro)
- `appointments.rescheduled_from_id` → `appointments(id) ON DELETE SET NULL`

---

## 3. Estrutura de arquivos

```
apps/crm/src/app/(dashboard)/agenda/
├── page.tsx                       # Server: hidrata dados iniciais
├── agenda-page-client.tsx         # Client: tabs + drawers + state
└── README.md                      # (este arquivo)

apps/crm/src/app/agendar/[orgSlug]/[pageSlug]/    # Booking pública (não dashboard)
└── page.tsx + form components

apps/crm/src/actions/agenda/
├── appointments.ts                # CRUD + getLeadAppointments + getUpcomingAppointmentsForLeads
├── availability.ts                # Regras semanais
├── booking-pages.ts               # CRUD booking pages
├── lead-search.ts                 # Search pra autocomplete de lead
├── org.ts                         # Metadados da org (slug)
├── public.ts                      # Endpoints sem auth (`/agendar/...`)
├── reminders.ts                   # Reminder configs (CRUD + seed defaults)
└── services.ts                    # Catálogo de serviços

apps/crm/src/lib/agenda/
├── notifications/
│   ├── dispatch.ts                # Notificações imediatas (cancel/reschedule WhatsApp)
│   └── messages.ts                # Templates pure functions
├── reminders/
│   └── dispatch.ts                # Cron tick processa agenda_reminder_sends queue
├── public-rate-limit.ts           # Rate limit IP-based pra booking público
└── security.ts                    # ensureCanActOnUser (cross-agent guard)

apps/crm/src/app/api/agenda/reminders/tick/route.ts  # Cron endpoint (Bearer-protected)

packages/agenda-ui/src/            # UI compartilhada (CRM + admin)
├── actions.ts                     # Interface AgendaActions (DI pattern)
├── context.tsx                    # AgendaActionsProvider
├── hooks/                         # useAppointments, useAppointmentsRealtime, ...
└── components/                    # AgendaTabs, AppointmentDrawer, etc

packages/shared/src/agenda/
├── types.ts                       # Appointment, AgendaService, etc + enums + CHECK
├── availability.ts                # getAvailableSlots, findScheduleConflict (puros)
├── labels.ts                      # PT-BR labels + formatDate/formatTime/formatWeekday
├── queries/                       # listAppointments, getAppointment, listConflictCandidates, ...
├── mutations/                     # createAppointment, cancelAppointment, ... + appointment_history
└── reminders.ts                   # renderReminderTemplate (interpolação de variáveis)
```

---

## 4. Fluxo de dados

```
                                  ┌────────────────────────┐
                                  │   /agenda (CRM tab)    │
                                  └───────────┬────────────┘
                                              │
              ┌──────────────────┬────────────┴─────────────┬────────────────┐
              │                  │                          │                │
              ▼                  ▼                          ▼                ▼
       AgendaActionsProvider  AgendaTabs          useAppointmentsRealtime  drawers
              │                                              │
              ▼                                              ▼
       crmAgendaActions                          postgres_changes(appointments)
       (adapter DI)                              filter organization_id
              │                                              │
              ▼                                              ▼
     apps/crm/src/actions/agenda/*.ts            debounce 200ms → refetch
              │
              ▼
     packages/shared/src/agenda/{queries,mutations}/*.ts
              │
              ▼
     Supabase (RLS por org_id) — appointments, agenda_*

                            ↑ paralelamente:
     ┌──────────────────────┴──────────────────────────────┐
     │                                                     │
   Booking público                                  AI Agent (PR #225)
   /agendar/[org]/[page]                            create/list/cancel/reschedule
     │                                                     │
     ▼                                                     ▼
   submitPublicBooking                          handlers em apps/crm/src/lib/ai-agent/tools/
     ├── cria/encontra lead                      ├── reusa shared mutations
     ├── cria appointment                        ├── notify lead via WhatsApp
     └── dispara onNewLead flow                  └── multi-tenant guard (lead_id)
```

---

## 5. Server actions quick reference

### `apps/crm/src/actions/agenda/appointments.ts`

| Função | Auth | Notas |
|---|---|---|
| `getAppointments(filters)` | agent | Lista com filtros (from/to/user/lead/kinds/statuses) |
| `getAppointmentById(id)` | agent | Single |
| `getLeadAppointments(leadId)` | agent | Pro drawer tab Agendamentos |
| `getUpcomingAppointmentsForLeads(leadIds, hours=48)` | agent | Pro chip do Kanban (PR #224) |
| `createAppointment(input)` | agent | Conflict check + history + cross-agent guard (PR #218) |
| `updateAppointment(id, input)` | agent | Cross-org lead_id guard (PR #218) |
| `updateAppointmentStatus(id, status)` | agent | Rejeita status='cancelled' (use cancelAppointment) |
| `cancelAppointment(id, input?)` | agent | Notifica lead via WhatsApp (PR #220) |
| `rescheduleAppointment(id, input)` | agent | Cria replacement + notifica lead (PR #220) |
| `deleteAppointment(id)` | agent | Soft delete (sets deleted_at) |
| `restoreAppointment(id)` | admin | Zera deleted_at |

### `apps/crm/src/actions/agenda/public.ts` (sem auth)

| Função | Notas |
|---|---|
| `getPublicBookingPage(orgSlug, pageSlug)` | Resolve org+page por slugs, status='active' |
| `getPublicSlotsForDate(pageId, date)` | Slots disponíveis (rate-limited por IP) |
| `submitPublicBooking(input)` | Cria lead (se novo) + appointment + dispara `onNewLead` (PR #219). Honeypot + rate limit |

### Outras actions

- **`availability.ts`** — CRUD de `availability_rules` (default 1 por user, `getDefaultAvailabilityRule`)
- **`booking-pages.ts`** — CRUD de booking pages (status active/draft/archived)
- **`services.ts`** — CRUD de `agenda_services` (`requireRole("admin")` em delete)
- **`reminders.ts`** — CRUD de `reminder_configs` + `seedDefaultReminderConfigs` (presets: confirmação +1h, lembrete -24h, -1h)
- **`lead-search.ts`** — `searchLeadsForAgenda(query, limit)` pra autocomplete em forms
- **`org.ts`** — `getOrgMeta()` (slug, name) pra preview da booking page

### Shared mutations (`packages/shared/src/agenda/mutations/`)

`appointments.ts` é onde vivem as invariantes:
- `validateTimeWindow` — start_at < end_at
- `ensureLeadBelongsToOrg` — defesa multi-tenant (PR #218)
- `ensureNoConflict` — conflict check usando `findScheduleConflict` puro
- `insertHistory` fire-and-forget em `appointment_history`

---

## 6. Regras críticas / invariantes

| Invariante | Onde | Documentação |
|---|---|---|
| Multi-tenant: `lead_id` em appointment precisa ser da mesma org | `ensureLeadBelongsToOrg` no shared (`mutations/appointments.ts`) | PR #218 |
| Cross-agent: agent/viewer só agenda pra si; admin/owner delegam | `ensureCanActOnUser` em `lib/agenda/security.ts` | PR #218 |
| Status='cancelled' só via `cancelAppointment` (preserva motivo+autor+role) | `mutations/appointments.ts:updateAppointmentStatus` rejeita | — |
| Reschedule cria novo appointment + marca original — não edita in-place | `mutations/appointments.ts:rescheduleAppointment` | — |
| `appointments.kind='appointment' OR lead_id IS NULL` — eventos/bloqueios não carregam lead | DB CHECK constraint (migration 031) | — |
| Soft-delete: `deleted_at` setada; queries filtram `IS NULL` por default | Todas as queries com flag `include_deleted` | — |
| Conflict check: 2 appointments do mesmo user em horários sobrepostos = rejeita | `findScheduleConflict` puro (sem fetch) + `listConflictCandidates` | — |
| Lead novo via booking público dispara `onNewLead` flow | `actions/agenda/public.ts:submitPublicBooking` | PR #219 |
| Cancel/Reschedule notifica lead via WhatsApp (fire-and-forget) | `lib/agenda/notifications/dispatch.ts` | PR #220 |
| Reminders queue: cron tick processa `agenda_reminder_sends` com status='pending' | `lib/agenda/reminders/dispatch.ts` + `/api/agenda/reminders/tick` | — |

---

## 7. Pontos de integração

### Com o `/crm` (Kanban, Leads, Drawer)

| Integração | Onde | PR |
|---|---|---|
| **Chip "📅 Em 2h" no card do Kanban** | `KanbanBoard` recebe `upcomingAppointments?: Map<leadId, item>` | PR #224 |
| **Tab "Agenda" no LeadInfoDrawer** | `LeadsActions.getLeadAppointments` | PR #221 |
| **Preview da última mensagem no AppointmentDrawer** | `AgendaActions.getLeadLastMessage` (consume `messages` table do chat) | PR #223 |
| **Booking público cria lead → dispara `onNewLead`** | `submitPublicBooking` → `lib/flows/triggers.ts:onNewLead` | PR #219 |

### WhatsApp (`@persia/shared/providers` — UAZAPI ou Meta Cloud)

| Caminho | Onde | Pattern |
|---|---|---|
| **Reminders queueados** | `lib/agenda/reminders/dispatch.ts` → cron tick `/api/agenda/reminders/tick` | Queue `agenda_reminder_sends` com retry 3x, scheduled_for, status. Provider via `whatsapp_connections` ativa da org |
| **Cancel/Reschedule (imediato)** | `lib/agenda/notifications/dispatch.ts` | Fire-and-forget sem queue (UX é "rápido ou nada") |
| **Templates** | `packages/shared/src/agenda/reminders.ts:renderReminderTemplate` | Variáveis: `{{lead_name}}`, `{{appointment_date}}`, `{{appointment_time}}`, etc |

### AI Agent (PR #225 em revisão)

4 tools nativas que destravam agendamento conversacional:

| Tool | Handler | Reusa |
|---|---|---|
| `create_appointment` | `lib/ai-agent/tools/create-appointment.ts` | `createAppointment` shared + resolve `user_id = lead.assigned_to` |
| `list_lead_appointments` | `lib/ai-agent/tools/list-lead-appointments.ts` | `listAppointments` shared (shape enxuto pra contexto LLM) |
| `cancel_appointment` | `lib/ai-agent/tools/cancel-appointment.ts` | `cancelAppointment` + `notifyLeadAppointmentCancelled` |
| `reschedule_appointment` | `lib/ai-agent/tools/reschedule-appointment.ts` | `rescheduleAppointment` + `notifyLeadAppointmentRescheduled` |

Pré-requisitos:
- Migration **040** aplicada (estende CHECK constraint de `agent_tools.native_handler`)
- Agent Editor habilita as tools por agente (UI já itera sobre `NATIVE_TOOL_PRESETS`)

### Realtime

- **`useAppointmentsRealtime(supabase, orgId, onEvent)`** (`packages/agenda-ui`) — escuta `postgres_changes` em `appointments` filtrado por `organization_id`. Captura INSERT/UPDATE/DELETE (PR #222)
- **Debounce 200ms** no caller (mesmo pattern do `useKanbanLeadsRealtime` no /crm)

### Admin (impersonation)

- **`apps/admin/src/components/crm/crm-page.tsx`** usa o mesmo `KanbanBoard` do CRM com `adminAgendaActions` (auth `requireSuperadminForOrg` + service-role)
- Realtime, drawer, chip — tudo funciona no admin com paridade

---

## 8. Tests

**4 suítes** em `apps/crm/src/__tests__/`:

| Suite | Cobertura |
|---|---|
| `agenda-availability.test.ts` | `getAvailableSlots`, `findScheduleConflict`, `isWithinAvailability` (puros) |
| `agenda-mutations.test.ts` | CRUD shared (create/update/cancel/reschedule) + multi-tenant guard + bookings |
| `agenda-security.test.ts` | `ensureCanActOnUser` (cross-agent guard) |
| `agenda-notify.test.ts` | Templates de notificação imediata (cancel/reschedule WhatsApp) |
| `ai-agent-agenda-tools.test.ts` | **(PR #225 em revisão)** 14 tests dos 4 handlers AI |

**Total atual em prod (até #224):** parte das 448 tests no `pnpm test`. Após merge do #225, **462 tests** total.

### Como rodar

```bash
cd D:/tmp/crm-persia-monorepo
pnpm --filter @persia/crm test --run agenda     # filtra
pnpm --filter @persia/crm test --run            # tudo
pnpm --filter @persia/agenda-ui typecheck       # ui-only
```

---

## 9. Como rodar local

1. **Env vars** já cobertos pelo `/crm` (`apps/crm/.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `PERSIA_SCHEDULER_SECRET` (Bearer pro endpoint cron de reminders)
   - `CRM_API_SECRET` (alternativa Bearer aceita pelo cron)
2. **Migrations:** 031 (módulo base) + 040 (AI Agent handlers — quando #225 mergear) aplicadas via SQL Editor
3. **Dev server:** `pnpm --filter @persia/crm dev --turbo` (porta 3000)
4. **Booking público:** acessar `http://localhost:3000/agendar/{orgSlug}/{pageSlug}` (não precisa de auth — checar `booking_pages.status='active'` no DB)
5. **Cron tick manual** (testar reminders sem esperar agendamento):
   ```bash
   curl -X POST http://localhost:3000/api/agenda/reminders/tick \
     -H "Authorization: Bearer $PERSIA_SCHEDULER_SECRET"
   ```

---

## 10. Pendências conhecidas

### Roadmap (não-críticos)

- **Google Calendar OAuth (#10)** — `apps/crm/src/lib/calendar/` foi roadmap PR7.3b mas ficou parado. Coluna `agent_configs.calendar_connection_id` existe mas sem implementação de OAuth + sync 2-way
- **CAPTCHA no booking público (#11)** — rate-limit + honeypot já cobrem ~95%. CAPTCHA pega só os 5% restantes
- **Service multi-agent (#15)** — `agenda_services` é org-wide hoje. Pra orgs com 3+ consultores oferecendo o mesmo serviço, criar tabela junction `agenda_service_agents` + slot resolver combinado. Pendente até cliente pedir
- **UAZAPI cancelar via keyword (#14)** — coberto naturalmente pelo `cancel_appointment` tool do AI Agent (PR #225). Action no Flow Builder pode entrar como complemento

### Outras

- `useAppointmentsRealtime` recebe `orgId` mas filtro é só channel — RLS é defesa principal
- Reschedule notify usa o **replacement** como contexto (data nova). Original aparece só como "Antes: X" no template
- Booking público registra appointment com `user_id = booking_page.user_id` (dono da page). Sem rotação automática entre agentes

---

## 11. Histórico de decisões arquiteturais

| PR | Conteúdo | Memory |
|---|---|---|
| [#210](https://github.com/elnathancet-hue/crm-persia-v2/pull/210) | Agenda DS Phase 1 — polimento visual nos 5 componentes mais visíveis | — |
| [#211](https://github.com/elnathancet-hue/crm-persia-v2/pull/211) | Agenda DS Phase 2 — views/settings/availability/booking | — |
| [#217](https://github.com/elnathancet-hue/crm-persia-v2/pull/217) | Paridade visual com /crm — ícone grande, header sticky, tabs underline | — |
| [#218](https://github.com/elnathancet-hue/crm-persia-v2/pull/218) | Fix 2 buracos multi-tenant — `ensureLeadBelongsToOrg` + `ensureCanActOnUser` | — |
| [#219](https://github.com/elnathancet-hue/crm-persia-v2/pull/219) | Booking público dispara `onNewLead` (paridade UAZAPI) | — |
| [#220](https://github.com/elnathancet-hue/crm-persia-v2/pull/220) | Cancel/Reschedule notifica lead via WhatsApp (fire-and-forget) | — |
| [#221](https://github.com/elnathancet-hue/crm-persia-v2/pull/221) | Tab "Agenda" no LeadInfoDrawer (fecha loop CRM↔Agenda) | — |
| [#222](https://github.com/elnathancet-hue/crm-persia-v2/pull/222) | Realtime de appointments (`useAppointmentsRealtime`, evita double-booking) | — |
| [#223](https://github.com/elnathancet-hue/crm-persia-v2/pull/223) | Preview da última mensagem do lead no AppointmentDrawer | — |
| [#224](https://github.com/elnathancet-hue/crm-persia-v2/pull/224) | Chip "📅 Em 2h" no card do Kanban (janela 48h) | — |
| [#225](https://github.com/elnathancet-hue/crm-persia-v2/pull/225) | **(em revisão)** 4 AI Agent tools — agendamento conversacional WhatsApp | — |

### Decisões fundamentais

1. **Mutations compartilhadas entre CRM e admin** — Mesma fonte de verdade. CRM usa `requireRole`, admin usa `requireSuperadminForOrg` antes de chamar shared
2. **`appointment_history` imutável** — Toda mutation insere fire-and-forget. Audit trail completo (created/updated/cancelled/rescheduled/status_changed)
3. **Reschedule não edita in-place** — Cria replacement (`rescheduled_from_id`) e marca original como `'rescheduled'`. Preserva linha original pra reports
4. **2 caminhos de WhatsApp**: queue (reminders pré-agendamento) + imediato (cancel/reschedule pós-evento)
5. **DI no agenda-ui** — Componentes do pacote consomem actions via `useAgendaActions()`. CRM e admin injetam seus adapters. Sem isso, pacote dependeria de auth do CRM
6. **Tab "Agenda" do drawer é read-only** — Cria/edita/cancela appointment vive em `/agenda`. Drawer é janela contextual

---

## 12. Checklist pra manter este README sincronizado

Cada PR que tocar em:

- `apps/crm/src/app/(dashboard)/agenda/**`
- `apps/crm/src/app/agendar/**` (booking pública)
- `apps/crm/src/actions/agenda/**`
- `apps/crm/src/lib/agenda/**`
- `apps/crm/src/app/api/agenda/**`
- `apps/crm/src/lib/ai-agent/tools/{create,list,cancel,reschedule}-appointment.ts`
- `packages/agenda-ui/**`
- `packages/shared/src/agenda/**`
- Schema (`apps/crm/supabase/migrations/03[1-9]_*.sql`, 040+)

Deve atualizar a seção correspondente neste README. O **PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) tem checklist explícito.
