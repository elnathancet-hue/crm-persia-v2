import { getAppointments } from "@/actions/agenda/appointments";
import { AgendaPageClient } from "./agenda-page-client";

export const metadata = { title: "Agenda" };

// Pega 60 dias pra cobrir overview/calendar/list sem extra fetch.
function defaultRange() {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default async function AgendaPage() {
  const range = defaultRange();
  const initialAppointments = await getAppointments({
    from: range.from,
    to: range.to,
    limit: 500,
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhe seus compromissos, organize a semana e cancele/reagende sem
          sair do CRM.
        </p>
      </header>

      <AgendaPageClient
        initialAppointments={initialAppointments}
        initialRange={range}
      />
    </div>
  );
}
