"use client";

// Thin wrapper: o SegmentsList real vive em @persia/segments-ui
// (compartilhado com apps/admin). Aqui resolvemos role (useRole) +
// injetamos as server actions via <SegmentsProvider>.
//
// PR-CRMOPS3: passa assigneeOptions (responsaveis da org) e
// viewLeadsHref (rota da tab Leads) — agora o segmento se conecta com
// o sistema. Click em "Ver leads" leva pra Leads filtrado.

import { SegmentsList, SegmentsProvider, type SegmentCatalogs } from "@persia/segments-ui";
import type { Segment } from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { crmSegmentsActions } from "@/features/segments/crm-segments-actions";

// Catálogos estáticos — valores conhecidos do domínio do CRM.
// Espelham os mesmos valores usados em LeadForm e LeadsList.
const STATUS_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Qualificado" },
  { value: "customer", label: "Cliente" },
  { value: "lost", label: "Perdido" },
];

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "indicacao", label: "Indicação" },
  { value: "outro", label: "Outro" },
];

const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "outro", label: "Outro" },
];

interface Props {
  segments: Segment[];
  /** PR-CRMOPS3: lista de responsaveis pra dropdown do criterio
   * "Responsavel" no ConditionBuilder. Vem do loader RSC do CRM. */
  assignees?: { id: string; name: string }[];
  /** Etapa 1: tags da org pra dropdown do critério "Tags". */
  tags?: { id: string; name: string; color: string | null }[];
  /** Etapa 9: pipelines e etapas para filtros de funil. */
  pipelines?: { id: string; name: string }[];
  stages?: { id: string; pipeline_id: string; name: string; color: string | null }[];
}

export function SegmentList({ segments, assignees = [], tags = [], pipelines = [], stages = [] }: Props) {
  const { isAdmin } = useRole(); // CRM: only admin+ pode gerir segmentos

  const catalogs: SegmentCatalogs = {
    tags,
    statuses: STATUS_OPTIONS,
    sources: SOURCE_OPTIONS,
    channels: CHANNEL_OPTIONS,
    pipelines,
    stages,
  };

  return (
    <SegmentsProvider actions={crmSegmentsActions}>
      <SegmentsList
        initialSegments={segments}
        canManage={isAdmin}
        assigneeOptions={assignees}
        catalogs={catalogs}
        // PR-CRMOPS3: ao clicar "Ver leads", navega pra tab Leads do
        // CRM filtrada pelo segmento. CrmShell le ?segment={id} e
        // injeta no listLeads.
        viewLeadsHref={(seg) => `/crm?tab=leads&segment=${seg.id}`}
      />
    </SegmentsProvider>
  );
}
