import { getAppointmentTypes, getOrgMembersForSelect } from "@/actions/appointment-types";
import { AppointmentTypesClient } from "./appointment-types-client";

export default async function AppointmentTypesPage() {
  const [types, members] = await Promise.all([
    getAppointmentTypes(),
    getOrgMembersForSelect(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tipos de agendamento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cadastre os tipos de consulta/serviço que o agente IA pode agendar (ex: &quot;Consulta inicial 30min&quot;,
          &quot;Avaliação 60min&quot;). Sem isso, a IA inventa títulos e durações diferentes a cada conversa.
        </p>
      </div>
      <AppointmentTypesClient initialTypes={types} members={members} />
    </div>
  );
}
