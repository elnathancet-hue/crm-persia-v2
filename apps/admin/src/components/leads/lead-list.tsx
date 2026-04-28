"use client";

// Admin Leads page — agora usa o mesmo LeadsList do cliente
// (@persia/leads-ui). Antes era UI legada com HTML cru + Tailwind custom.
// Mantemos o flow do admin: row click navega pra `<LeadDetail>` (full
// page) em vez do drawer in-place do CRM (que e CRM-specific por ora).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LeadsList, LeadsProvider } from "@persia/leads-ui";
import type { LeadWithTags } from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import { LeadDetail } from "@/components/leads/lead-detail";
import { getLeads, deleteLead } from "@/actions/leads";
import { adminLeadsActions } from "@/features/leads/admin-leads-actions";

export function LeadListPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [initialLeads, setInitialLeads] = useState<LeadWithTags[]>([]);
  const [initialTotal, setInitialTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Forca remount do LeadsList depois de delete pra re-fetchar inicial.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getLeads({ page: 1, limit: 20 })
      .then((result) => {
        if (result.error) {
          toast.error(result.error);
          setInitialLeads([]);
          setInitialTotal(0);
        } else {
          setInitialLeads((result.data ?? []) as LeadWithTags[]);
          setInitialTotal(result.count ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [activeOrgId, isManagingClient, reloadKey]);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (selectedLeadId) {
    return (
      <LeadDetail
        leadId={selectedLeadId}
        onBack={() => setSelectedLeadId(null)}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  const initialTotalPages = Math.ceil(initialTotal / 20);

  async function handleDelete(lead: LeadWithTags) {
    if (
      !window.confirm(
        `Remover lead "${lead.name ?? "sem nome"}"? Esta acao nao pode ser desfeita.`,
      )
    ) {
      return;
    }
    const result = await deleteLead(lead.id);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Lead removido");
    setReloadKey((n) => n + 1);
  }

  return (
    <LeadsProvider actions={adminLeadsActions}>
      <LeadsList
        key={reloadKey}
        initialLeads={initialLeads}
        initialTotal={initialTotal}
        initialPage={1}
        initialTotalPages={initialTotalPages}
        canEdit
        onRowClick={(lead) => setSelectedLeadId(lead.id)}
        onEditLead={(lead) => setSelectedLeadId(lead.id)}
        onDeleteLead={handleDelete}
      />
    </LeadsProvider>
  );
}
