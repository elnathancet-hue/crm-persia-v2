"use client";

// Admin CRM page — agora usa o mesmo Kanban do cliente (@persia/crm-ui).
// Antes era uma UI legada (kanban-board.tsx + crud inline). A unificacao
// resolve drift visual: melhorias no funil aparecem em ambos os apps
// automaticamente. Auth permanece isolado: admin usa
// requireSuperadminForOrg + service-role; cliente usa requireRole + RLS.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { KanbanBoard, KanbanProvider } from "@persia/crm-ui";
import type {
  DealWithLead,
  Pipeline,
  Stage,
} from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import {
  ensureDefaultPipeline,
  getDeals,
  getLeads,
  getPipelines,
  getStagesForOrg,
} from "@/actions/pipelines";
import { adminKanbanActions } from "@/features/crm-kanban/admin-kanban-actions";

interface KanbanLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export function CrmPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<DealWithLead[]>([]);
  const [leads, setLeads] = useState<KanbanLead[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    let basePipelines = (await getPipelines()) as Pipeline[];
    if (basePipelines.length === 0) {
      const ensured = await ensureDefaultPipeline();
      if (ensured) {
        basePipelines = (await getPipelines()) as Pipeline[];
      }
    }
    const [stagesData, dealsData, leadsData] = await Promise.all([
      getStagesForOrg(),
      getDeals(),
      getLeads(),
    ]);
    setPipelines(basePipelines);
    // Database types ainda nao incluem `outcome` no row de pipeline_stages
    // (coluna existe em prod via migration; types autogerados estao stale).
    // O cast via `unknown` mantem o componente fortemente tipado a partir do
    // shape canonico (@persia/shared/crm) e e o mesmo padrao usado no CRM.
    setStages(stagesData as unknown as Stage[]);
    setDeals(dealsData as unknown as DealWithLead[]);
    setLeads(leadsData as KanbanLead[]);
  }

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    reload()
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar CRM",
        );
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, isManagingClient]);

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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground">CRM</h1>
      {pipelines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nao foi possivel inicializar o funil. Tente recarregar.
        </p>
      ) : (
        <KanbanProvider actions={adminKanbanActions}>
          <KanbanBoard
            pipelines={pipelines}
            stages={stages}
            deals={deals}
            leads={leads}
            canEdit
            canManagePipelines
            onChange={() => {
              reload().catch((err) => {
                toast.error(
                  err instanceof Error
                    ? err.message
                    : "Erro ao recarregar CRM",
                );
              });
            }}
            goalsStorageKey="admin-kanban-goals-v1"
            // PR-CRMCFG: substitui o modal "Configurar funis" (removido).
            // Admin tambem ganha rota dedicada — ver
            // apps/admin/src/app/(dashboard)/crm/configurar/page.tsx.
            configHref="/crm/configurar"
          />
        </KanbanProvider>
      )}
    </div>
  );
}
