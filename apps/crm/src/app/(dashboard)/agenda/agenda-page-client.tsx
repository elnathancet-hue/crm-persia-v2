"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AgendaActionsProvider,
  AgendaCalendarView,
  AgendaCreateMenu,
  AgendaHeader,
  AgendaOverview,
  AgendaTabs,
  AppointmentDrawer,
  CreateAppointmentDrawer,
  RescheduleAppointmentDrawer,
  useAgendaFilters,
  type AgendaCallbacks,
  type AgendaTab,
} from "@persia/agenda-ui";
import type {
  AgendaService,
  Appointment,
  AppointmentKind,
} from "@persia/shared/agenda";
import { crmAgendaActions } from "@/features/agenda/crm-actions";
import { searchLeadsForAgenda } from "@/actions/agenda/lead-search";

interface Props {
  initialAppointments: Appointment[];
  initialRange: { from: string; to: string };
  services: AgendaService[];
  currentUserId: string;
}

/**
 * Wrapper client da Agenda. Monta o AgendaActionsProvider e gerencia o
 * state local (tab ativa, drawers, viewMode, data corrente, modal Novo).
 *
 * PRs proximos:
 *   - PR5b: tabs Disponibilidade + Páginas de agendamento (admin)
 *   - PR6: booking publico /agendar/{org}/{slug}
 *   - PR7: lembretes WhatsApp via UAZAPI
 */
export function AgendaPageClient({
  initialAppointments,
  initialRange,
  services,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AgendaTab>("overview");
  const [appointments, setAppointments] = useState<Appointment[]>(
    initialAppointments,
  );
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [createKind, setCreateKind] = useState<AppointmentKind | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(
    null,
  );

  const filters = useAgendaFilters(new Date());
  const periodTitle = useMemo(() => filters.formatPeriodTitle(), [filters]);

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
      // agendaUsers: PR5b vai popular esta lista (admin pode atribuir
      // pra terceiros). Por enquanto agent so cria pra si mesmo.
      agendaUsers: [],
    }),
    [router, refetch, currentUserId],
  );

  const tabHidden: AgendaTab[] = ["availability", "booking-pages", "settings"];
  const showCalendarHeader = activeTab !== "overview";

  return (
    <AgendaActionsProvider actions={crmAgendaActions} callbacks={callbacks}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AgendaTabs
            active={activeTab}
            onChange={setActiveTab}
            hidden={tabHidden}
          />
          <AgendaCreateMenu onSelect={setCreateKind} />
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
            onSelectAppointment={setSelected}
            onSelectDay={filters.setCurrentDate}
          />
        )}

        {activeTab === "list" && (
          <AgendaCalendarView
            viewMode="list"
            currentDate={filters.currentDate}
            appointments={appointments}
            onSelectAppointment={setSelected}
          />
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
          onClose={() => setCreateKind(null)}
        />

        <RescheduleAppointmentDrawer
          appointment={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
        />
      </div>
    </AgendaActionsProvider>
  );
}
