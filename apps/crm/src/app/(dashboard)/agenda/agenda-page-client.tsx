"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { PageTitle } from "@persia/ui/typography";
import {
  AgendaActionsProvider,
  AgendaAvailabilitySettings,
  AgendaBookingPagesList,
  AgendaCalendarView,
  AgendaCreateMenu,
  AgendaHeader,
  AgendaOverview,
  AgendaSettingsTab,
  AgendaTabs,
  AppointmentDrawer,
  CreateAppointmentDrawer,
  RescheduleAppointmentDrawer,
  useAgendaFilters,
  useAppointmentsRealtime,
  type AgendaCallbacks,
  type AgendaSettingsActions,
  type AgendaTab,
} from "@persia/agenda-ui";
import { useDebouncedCallback } from "@persia/leads-ui";
import type {
  AgendaService,
  Appointment,
  AppointmentKind,
  AvailabilityRule,
} from "@persia/shared/agenda";
import { crmAgendaActions } from "@/features/agenda/crm-actions";
import { searchLeadsForAgenda } from "@/actions/agenda/lead-search";
import {
  createReminderConfig,
  deleteReminderConfig,
  getReminderConfigs,
  seedDefaultReminderConfigs,
  updateReminderConfig,
} from "@/actions/agenda/reminders";
import { getDefaultAvailabilityRule } from "@/actions/agenda/availability";
import { createClient } from "@/lib/supabase/client";

interface Props {
  initialAppointments: Appointment[];
  initialRange: { from: string; to: string };
  services: AgendaService[];
  currentUserId: string;
  orgId: string | null;
  orgSlug: string;
}

/**
 * Wrapper client da Agenda. Monta o AgendaActionsProvider e gerencia o
 * state local (tab ativa, drawers, viewMode, data corrente, modal Novo).
 */
export function AgendaPageClient({
  initialAppointments,
  initialRange,
  services,
  currentUserId,
  orgId,
  orgSlug,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AgendaTab>("overview");
  const [appointments, setAppointments] = useState<Appointment[]>(
    initialAppointments,
  );
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [createKind, setCreateKind] = useState<AppointmentKind | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(
    null,
  );
  const [availabilityRule, setAvailabilityRule] =
    useState<AvailabilityRule | null>(null);

  const filters = useAgendaFilters(new Date());
  const periodTitle = useMemo(() => filters.formatPeriodTitle(), [filters]);

  // Carrega regra default 1x pra Calendar saber min/max time
  useEffect(() => {
    let cancelled = false;
    getDefaultAvailabilityRule(currentUserId)
      .then((r) => {
        if (!cancelled) setAvailabilityRule(r);
      })
      .catch((err) => {
        console.warn("[agenda] availability rule load:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const refetch = useCallback(() => {
    crmAgendaActions
      .getAppointments({
        from: initialRange.from,
        to: initialRange.to,
        limit: 500,
      })
      .then(setAppointments)
      .catch((err) => {
        console.error("[agenda] refetch falhou:", err);
      });
    router.refresh();
  }, [router, initialRange.from, initialRange.to]);

  // PR-AGENDA-REALTIME (mai/2026): antes a agenda era pull-only — 2
  // agentes da mesma org abertos podiam causar double-booking porque
  // o segundo so via INSERT/UPDATE/DELETE de appointment apos F5 ou
  // navegacao. Agora useAppointmentsRealtime escuta `postgres_changes`
  // em `appointments` filtrado por `organization_id` e dispara refetch
  // debounced (200ms trailing — burst de bulk move/create nao gera N
  // refetchs paralelos). Mesmo pattern do useKanbanLeadsRealtime
  // (PR #213). RLS de appointments (migration 031) ja filtra por org
  // no DB; filter no canal e camada extra.
  const supabase = useMemo(() => createClient(), []);
  const debouncedRefetch = useDebouncedCallback(refetch);
  useAppointmentsRealtime(supabase, orgId, debouncedRefetch);

  const callbacks = useMemo<AgendaCallbacks>(
    () => ({
      onOpenLead: (leadId: string) => router.push(`/leads/${leadId}`),
      onOpenChat: (leadId: string) => router.push(`/chat?lead=${leadId}`),
      onAppointmentChange: () => refetch(),
      searchLeads: (query: string, limit?: number) =>
        searchLeadsForAgenda(query, limit ?? 8),
      currentUserId,
      agendaUsers: [],
    }),
    [router, refetch, currentUserId],
  );

  const tabHidden: AgendaTab[] = [];
  const showCalendarHeader =
    activeTab === "calendar" || activeTab === "list";

  const settingsActions: AgendaSettingsActions = useMemo(
    () => ({
      list: () => getReminderConfigs(),
      create: (input) => createReminderConfig(input),
      update: (id, input) => updateReminderConfig(id, input),
      remove: (id) => deleteReminderConfig(id),
      seedDefaults: () => seedDefaultReminderConfigs(),
    }),
    [],
  );

  // Click em slot vazio do calendar → abre Create drawer com data preenchida
  const handleSelectSlot = useCallback((slot: { start: Date; end: Date }) => {
    setCreatePrefill(slot);
    setCreateKind("appointment");
  }, []);

  const handleCreateClose = useCallback(() => {
    setCreateKind(null);
    setCreatePrefill(null);
  }, []);

  const handleNovoMenuSelect = useCallback((kind: AppointmentKind) => {
    setCreatePrefill(null);
    setCreateKind(kind);
  }, []);

  return (
    <AgendaActionsProvider actions={crmAgendaActions} callbacks={callbacks}>
      <div className="space-y-6">
        {/* Header sticky com icone grande + titulo + "+ Novo" no canto direito.
            PR-AGENDA-VISUAL (mai/2026): paridade visual com /crm — antes a
            Agenda tinha <header> simples sem icone e tabs em pill (drift do
            resto do produto). Agora segue o mesmo pattern do CrmShell:
            sticky top, icone azul size-12, tabs underline. */}
        <div className="sticky -top-6 z-30 -mx-6 -mt-6 px-6 pt-6 pb-3 bg-background/95 backdrop-blur-sm border-b border-border/60 space-y-4">
          <AgendaPageHeader onNovoSelect={handleNovoMenuSelect} />
          <AgendaTabs
            active={activeTab}
            onChange={setActiveTab}
            hidden={tabHidden}
          />
        </div>

        {showCalendarHeader && (
          <AgendaHeader
            periodTitle={periodTitle}
            viewMode={filters.viewMode}
            onSetViewMode={filters.setViewMode}
            onPrev={filters.handlePrev}
            onNext={filters.handleNext}
            onToday={filters.handleToday}
            onCreate={undefined}
          />
        )}

        {activeTab === "overview" && (
          <AgendaOverview
            appointments={appointments}
            onSelectAppointment={setSelected}
          />
        )}

        {activeTab === "calendar" && (
          <AgendaCalendarView
            viewMode={filters.viewMode === "list" ? "week" : filters.viewMode}
            currentDate={filters.currentDate}
            appointments={appointments}
            availabilityRule={availabilityRule}
            onSelectAppointment={setSelected}
            onSelectSlot={handleSelectSlot}
            onChangeView={filters.setViewMode}
            onChangeDate={filters.setCurrentDate}
          />
        )}

        {activeTab === "list" && (
          <AgendaCalendarView
            viewMode="list"
            currentDate={filters.currentDate}
            appointments={appointments}
            availabilityRule={availabilityRule}
            onSelectAppointment={setSelected}
            onChangeDate={filters.setCurrentDate}
          />
        )}

        {activeTab === "availability" && <AgendaAvailabilitySettings />}

        {activeTab === "booking-pages" && (
          <AgendaBookingPagesList orgSlug={orgSlug} services={services} />
        )}

        {activeTab === "settings" && (
          <AgendaSettingsTab actions={settingsActions} />
        )}

        <AppointmentDrawer
          appointment={selected}
          onClose={() => setSelected(null)}
          onReschedule={(a) => {
            setSelected(null);
            setRescheduleTarget(a);
          }}
        />

        <CreateAppointmentDrawer
          open={createKind !== null}
          initialKind={createKind ?? "appointment"}
          services={services}
          prefillSlot={createPrefill}
          onClose={handleCreateClose}
        />

        <RescheduleAppointmentDrawer
          appointment={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
        />
      </div>
    </AgendaActionsProvider>
  );
}

// ============================================================================
// Header da pagina — icone grande + titulo + tagline + botao "+ Novo"
// PR-AGENDA-VISUAL (mai/2026): mesmo pattern do CrmPageHeader (crm-shell.tsx).
// Centralizar como primitive em packages/ui ainda nao vale a pena (2 callers
// so) — extrair quando aparecer 3o lugar pedindo a mesma estrutura.
// ============================================================================

function AgendaPageHeader({
  onNovoSelect,
}: {
  onNovoSelect: (kind: AppointmentKind) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20">
          <CalendarDays className="size-6" />
        </div>
        <div className="min-w-0">
          <PageTitle className="leading-none">Agenda</PageTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Acompanhe seus compromissos, organize a semana e cancele/reagende
            sem sair do CRM.
          </p>
        </div>
      </div>
      <AgendaCreateMenu onSelect={onNovoSelect} />
    </div>
  );
}
