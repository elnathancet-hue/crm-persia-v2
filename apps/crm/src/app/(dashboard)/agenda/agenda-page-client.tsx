"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AgendaActionsProvider,
  AgendaCalendarView,
  AgendaHeader,
  AgendaOverview,
  AgendaTabs,
  AppointmentDrawer,
  useAgendaFilters,
  type AgendaTab,
} from "@persia/agenda-ui";
import type { Appointment } from "@persia/shared/agenda";
import { crmAgendaActions } from "@/features/agenda/crm-actions";

interface Props {
  initialAppointments: Appointment[];
  initialRange: { from: string; to: string };
}

/**
 * Wrapper client da Agenda. Monta o AgendaActionsProvider e gerencia
 * o state local da pagina (tab ativa, drawer, viewMode, data corrente).
 *
 * Os 4 PRs proximos vao incrementar:
 *   - PR5: modais de Novo/Editar appointment
 *   - PR6: tab "Disponibilidade" + "Páginas de agendamento"
 *   - PR7: lembretes WhatsApp + booking publico
 */
export function AgendaPageClient({ initialAppointments, initialRange }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AgendaTab>("overview");
  const [appointments, setAppointments] = useState<Appointment[]>(
    initialAppointments,
  );
  const [selected, setSelected] = useState<Appointment | null>(null);

  const filters = useAgendaFilters(new Date());
  const periodTitle = useMemo(
    () => filters.formatPeriodTitle(),
    [filters],
  );

  // Callbacks que atualizam state local + invalidam server data depois.
  const callbacks = useMemo(
    () => ({
      onOpenLead: (leadId: string) => router.push(`/leads/${leadId}`),
      onOpenChat: (leadId: string) => router.push(`/chat?lead=${leadId}`),
      onAppointmentChange: (id: string) => {
        // Refetch tudo da janela inicial — simples e correto pro MVP.
        // Otimizacao com .map(updated) por id fica pra um refactor futuro.
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
        // Invalida o cache da rota tambem, pra proxima navegacao SSR.
        router.refresh();
        // Suprime warning de id nao usado.
        void id;
      },
    }),
    [router, initialRange.from, initialRange.to],
  );

  const tabHidden: AgendaTab[] = ["availability", "booking-pages", "settings"];

  return (
    <AgendaActionsProvider actions={crmAgendaActions} callbacks={callbacks}>
      <div className="space-y-6">
        <AgendaTabs
          active={activeTab}
          onChange={setActiveTab}
          hidden={tabHidden}
        />

        {activeTab !== "overview" && (
          <AgendaHeader
            periodTitle={periodTitle}
            viewMode={filters.viewMode}
            onSetViewMode={filters.setViewMode}
            onPrev={filters.handlePrev}
            onNext={filters.handleNext}
            onToday={filters.handleToday}
            // PR5 vai ligar isto ao modal de criacao
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
        />
      </div>
    </AgendaActionsProvider>
  );
}
