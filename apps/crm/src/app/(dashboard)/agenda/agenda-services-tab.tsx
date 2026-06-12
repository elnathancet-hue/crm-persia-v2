"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  getAppointmentTypes,
  getOrgMembersForSelect,
  type AppointmentType,
  type OrgMemberOption,
} from "@/actions/appointment-types";
import { AppointmentTypesClient } from "@/app/(dashboard)/automations/appointments/appointment-types-client";

/**
 * Tab "Serviços" da Agenda.
 * Busca os dados no client na primeira renderização pra não atrasar
 * o SSR da agenda (a maioria dos usuários vai direto pra overview/calendar).
 */
export function AgendaServicesTab() {
  const [types, setTypes] = React.useState<AppointmentType[] | null>(null);
  const [members, setMembers] = React.useState<OrgMemberOption[]>([]);

  React.useEffect(() => {
    Promise.all([getAppointmentTypes(), getOrgMembersForSelect()])
      .then(([t, m]) => {
        setTypes(t);
        setMembers(m);
      })
      .catch((err) => {
        console.error("[agenda-services]", err);
        setTypes([]);
      });
  }, []);

  if (types === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <AppointmentTypesClient initialTypes={types} members={members} />;
}
