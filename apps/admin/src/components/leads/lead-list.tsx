"use client";

// PR-U3: admin agora usa o mesmo <LeadInfoDrawer> compartilhado
// (@persia/leads-ui). Antes navegava pra full-page <LeadDetail>;
// agora row click abre drawer in-place — mesma UX do CRM cliente.
//
// Drawer recebe canEdit=true canDelete=true porque admin = superadmin.
// Exclusao via AlertDialog dentro do drawer (PR-U3).

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  LeadInfoDrawer,
  LeadsList,
  LeadsProvider,
  useDebouncedCallback,
  useLeadsRealtime,
} from "@persia/leads-ui";
import type { LeadWithTags } from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getLeads, deleteLead } from "@/actions/leads";
import { adminLeadsActions } from "@/features/leads/admin-leads-actions";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function LeadListPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [initialLeads, setInitialLeads] = useState<LeadWithTags[]>([]);
  const [initialTotal, setInitialTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // PR-U3: state do drawer (espelha pattern do CRM)
  const [infoDrawerLead, setInfoDrawerLead] = useState<LeadWithTags | null>(
    null,
  );
  // Forca remount do LeadsList depois de delete pra re-fetchar inicial.
  const [reloadKey, setReloadKey] = useState(0);

  // PR-U3: supabase client pro drawer (DI). getSupabaseBrowserClient
  // e singleton.
  const supabase = getSupabaseBrowserClient();

  // PR-V1b: realtime leads do org gerenciado. Quando outro agente
  // (ou o proprio cliente no CRM) cria/edita/deleta um lead, a lista
  // recarrega via setReloadKey. Debounce 200ms agrupa burst (bulk import
  // do CRM dispara N eventos rapidos).
  const triggerReload = useCallback(() => {
    setReloadKey((n) => n + 1);
  }, []);
  const debouncedReload = useDebouncedCallback(triggerReload);
  useLeadsRealtime(
    supabase,
    isManagingClient ? activeOrgId : null,
    debouncedReload,
  );

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  const initialTotalPages = Math.ceil(initialTotal / 20);

  // Mantido pra retro-compat com menu "Excluir" da linha (fora do drawer).
  // Drawer agora tem seu proprio botao Excluir com AlertDialog.
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
        onRowClick={(lead) => setInfoDrawerLead(lead)}
        onEditLead={(lead) => setInfoDrawerLead(lead)}
        onDeleteLead={handleDelete}
      />
      {infoDrawerLead ? (
        <LeadInfoDrawer
          open={!!infoDrawerLead}
          onOpenChange={(open) => {
            if (!open) setInfoDrawerLead(null);
          }}
          lead={infoDrawerLead}
          onSaved={() => setReloadKey((n) => n + 1)}
          supabase={supabase}
          // PR-U3: admin = superadmin, sempre pode editar e excluir
          canEdit
          canDelete
          onDeleted={() => {
            setInfoDrawerLead(null);
            setReloadKey((n) => n + 1);
          }}
        />
      ) : null}
    </LeadsProvider>
  );
}
