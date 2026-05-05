"use client";

// Thin wrapper: o SegmentsList real vive em @persia/segments-ui
// (compartilhado com apps/admin). Aqui resolvemos role (useRole) +
// injetamos as server actions via <SegmentsProvider>.
//
// PR-CRMOPS3: passa assigneeOptions (responsaveis da org) e
// viewLeadsHref (rota da tab Leads) — agora o segmento se conecta com
// o sistema. Click em "Ver leads" leva pra Leads filtrado.

import { SegmentsList, SegmentsProvider } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { crmSegmentsActions } from "@/features/segments/crm-segments-actions";

interface Props {
  segments: Segment[];
  /** PR-CRMOPS3: lista de responsaveis pra dropdown do criterio
   * "Responsavel" no ConditionBuilder. Vem do loader RSC do CRM. */
  assignees?: { id: string; name: string }[];
}

export function SegmentList({ segments, assignees = [] }: Props) {
  const { isAdmin } = useRole(); // CRM: only admin+ pode gerir segmentos

  return (
    <SegmentsProvider actions={crmSegmentsActions}>
      <SegmentsList
        initialSegments={segments}
        canManage={isAdmin}
        assigneeOptions={assignees}
        // PR-CRMOPS3: ao clicar "Ver leads", navega pra tab Leads do
        // CRM filtrada pelo segmento. CrmShell le ?segment={id} e
        // injeta no listLeads.
        viewLeadsHref={(seg) => `/crm?tab=leads&segment=${seg.id}`}
      />
    </SegmentsProvider>
  );
}
