"use client";

// Admin CRM page — agora usa o mesmo Kanban do cliente (@persia/crm-ui).
// Antes era uma UI legada (kanban-board.tsx + crud inline). A unificacao
// resolve drift visual: melhorias no funil aparecem em ambos os apps
// automaticamente. Auth permanece isolado: admin usa
// requireSuperadminForOrg + service-role; cliente usa requireRole + RLS.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { KanbanBoard, KanbanProvider } from "@persia/crm-ui";
import {
  useCurrentUser,
  useDealPresence,
  useDealsRealtime,
  useDebouncedCallback,
} from "@persia/leads-ui";
import type {
  DealWithLead,
  Pipeline,
  Stage,
} from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getSupabaseBrowserClient } from "@/lib/supabase";
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

interface CrmPageProps {
  /** PR-T3: quando true, esconde o <h1>CRM</h1> interno — usado
   *  quando renderizado dentro do AdminCrmShell (header ja vem do
   *  shell). Default false (standalone /crm preserva header). */
  hideHeader?: boolean;
}

export function CrmPage({ hideHeader = false }: CrmPageProps = {}) {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<DealWithLead[]>([]);
  const [leads, setLeads] = useState<KanbanLead[]>([]);
  const [loading, setLoading] = useState(true);

  // PR-V1b: realtime + presence pro Kanban (paridade com CRM cliente).
  //   - useDealsRealtime: outro agente moveu/criou/deletou deal → reload
  //   - useDealPresence: mostra avatares de quem ta vendo cada card
  // KanbanBoard hoje gerencia o pipelineId selecionado internamente
  // (props.pipelines + seletor interno). O admin nao expoe esse state
  // por enquanto — vamos assinar o primeiro pipeline como proxy
  // "pipeline ativo padrao". Caso evolua pra multi-pipeline com seletor
  // externo, reusa esse activePipelineId no callback do KanbanBoard.
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const currentUser = useCurrentUser(supabase);
  const activePipelineId = pipelines[0]?.id ?? null;
  // useDebouncedCallback armazena o callback num ref interno, entao
  // passar uma seta nova a cada render e seguro (sempre roda a versao
  // mais recente). Mesmo pattern do CRM cliente.
  const debouncedReload = useDebouncedCallback(() => {
    reload().catch(() => {
      /* erro tratado no useEffect inicial */
    });
  });
  useDealsRealtime(supabase, activePipelineId, debouncedReload);
  const { watchersByDeal: _watchersByDeal, setViewingDealId: _setViewingDealId } =
    useDealPresence({
      supabase,
      pipelineId: activePipelineId,
      currentUser,
    });
  // _watchersByDeal/_setViewingDealId: presence montada (admin ja
  // aparece pros outros usuarios do org). Repassar pro KanbanBoard
  // exigiria nova prop — fica pra PR proprio se demanda surgir.

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
      {!hideHeader && (
        <h1 className="text-xl font-bold text-foreground">CRM</h1>
      )}
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
            // PR-CRMOPS: configuracao do Kanban volta pra inline
            // (drawer + dialog dentro do KanbanBoard). Admin herda
            // canCreateKanban + canEditStages do canManagePipelines
            // (ambos true aqui).
          />
        </KanbanProvider>
      )}
    </div>
  );
}
