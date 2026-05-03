"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  type AgendaCallbacks,
  type AgendaSettingsActions,
  type AgendaTab,
} from "@persia/agenda-ui";
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

interface Props {
  initialAppointments: Appointment[];
  initialRange: { from: string; to: string };
  services: AgendaService[];
  currentUserId: string;
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AgendaTabs
            active={activeTab}
            onChange={setActiveTab}
            hidden={tabHidden}
          />
          <AgendaCreateMenu onSelect={handleNovoMenuSelect} />
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
