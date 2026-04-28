"use client";

// Thin wrapper: o LeadsList real vive em @persia/leads-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + drawer "Informacoes
// do lead" (CRM-specific) e injetamos as server actions via
// <LeadsProvider>. router.refresh() dispara re-fetch do server component
// pai depois do drawer salvar, e o LeadsList sincroniza com o novo
// initialLeads.

import * as React from "react";
import { useRouter } from "next/navigation";
import { LeadsList, LeadsProvider } from "@persia/leads-ui";
import type { LeadWithTags } from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { crmLeadsActions } from "@/features/leads/crm-leads-actions";
import { LeadInfoDrawer } from "@/components/leads/lead-info-drawer";

interface Props {
  initialLeads: LeadWithTags[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
}

export function LeadList(props: Props) {
  const router = useRouter();
  const { isAgent } = useRole();
  // Drawer "Informacoes do lead" — CRM-specific (Fase 2, abre na linha
  // sem navegar). Mantido aqui (nao no pacote) porque o admin nao tem
  // essa feature ainda.
  const [infoDrawerLead, setInfoDrawerLead] =
    React.useState<LeadWithTags | null>(null);

  return (
    <>
      <LeadsProvider actions={crmLeadsActions}>
        <LeadsList
          {...props}
          canEdit={isAgent}
          onRowClick={(lead) => setInfoDrawerLead(lead)}
          onEditLead={(lead) => router.push(`/leads/${lead.id}`)}
          onDeleteLead={(lead) => router.push(`/leads/${lead.id}`)}
        />
      </LeadsProvider>

      {infoDrawerLead ? (
        <LeadInfoDrawer
          open={!!infoDrawerLead}
          onOpenChange={(open) => {
            if (!open) setInfoDrawerLead(null);
          }}
          lead={infoDrawerLead}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
