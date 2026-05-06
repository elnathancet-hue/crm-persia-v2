"use client";

// CrmShell — invólucro da rota /crm com 5 tabs internas:
// Pipeline · Leads · Segmentação · Tags · Atividades
//
// PR-CRMOPS2 (mai/2026):
//   - Botão "+ Criar novo funil" sempre visível no canto superior
//     direito do header (briefing item B). Antes ficava escondido na
//     toolbar de filtros do KanbanBoard.
//   - Tab Pipeline virou "biblioteca de funis": lista os funis
//     configurados como cards clicáveis. Selecionar abre o Kanban
//     daquele funil. Quando 0 funis, mostra empty state com botão
//     "Criar primeiro funil".
//   - KanbanProvider subiu pro CrmShell pra o botão do header
//     conseguir chamar createPipeline.
//
// PR-CRMOPS (mai/2026): tab "Ajustes" REMOVIDA, /settings/crm
// REMOVIDO, configuração inline via drawer.
//
// Tab ativa controlada por ?tab=pipeline|leads|segmentos|tags|atividades
// (default: pipeline). useSearchParams pra deep link funcionar.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  Filter as FilterIcon,
  Kanban,
  Plus,
  Tag as TagIcon,
  Users,
} from "lucide-react";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import {
  CreateKanbanDialog,
  KanbanProvider,
} from "@persia/crm-ui";
import type {
  DealWithLead,
  LeadWithTags,
  OrgActivityRow,
  Pipeline,
  Stage,
  TagRef,
  TagWithCount,
} from "@persia/shared/crm";

import { CrmClient } from "./crm-client";
import { LeadList } from "@/components/leads/lead-list";
import { ActivitiesTab } from "@/components/crm/activities-tab";
import { SegmentList } from "@/components/segments/segment-list";
import { TagsPageClient } from "@/app/(dashboard)/tags/tags-client";
import { crmKanbanActions } from "@/features/crm-kanban/crm-kanban-actions";

type CrmTab = "pipeline" | "leads" | "segmentos" | "tags" | "atividades";

const TABS: {
  key: CrmTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "pipeline", label: "Pipeline", icon: Kanban },
  { key: "leads", label: "Leads", icon: Users },
  { key: "segmentos", label: "Segmentação", icon: FilterIcon },
  { key: "tags", label: "Tags", icon: TagIcon },
  { key: "atividades", label: "Atividades", icon: Activity },
];

interface CrmShellProps {
  pipelines: Pipeline[];
  stages: Stage[];
  deals: DealWithLead[];
  pipelineLeads: { id: string; name: string; phone: string | null; email: string | null }[];
  tags: TagRef[];
  assignees: { id: string; name: string }[];
  leadsListData: {
    initialLeads: LeadWithTags[];
    initialTotal: number;
    initialPage: number;
    initialTotalPages: number;
  };
  segments: unknown[];
  tagsList: TagWithCount[];
  /**
   * PR-CRMOPS3: segmento ativo aplicado como filtro na tab Leads
   * (vem da URL `?segment={id}`). Quando setado, LeadList mostra hint
   * "Filtrado por: <nome> · Limpar".
   */
  activeSegment?: { id: string; name: string } | null;
  activitiesData: {
    initialActivities: OrgActivityRow[];
    initialTotal: number;
    initialPage: number;
    initialTotalPages: number;
  };
  leadCount: number;
  dealCount: number;
  activityCount: number;
  segmentCount: number;
  tagCount: number;
  /** PR-CRMOPS2: permite criar novo funil via header. Default true. */
  canCreateFunil?: boolean;
  canManageTags?: boolean;
  canManageSegments?: boolean;
}

export function CrmShell(props: CrmShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") ?? "pipeline") as CrmTab;
  const activeTab: CrmTab = TABS.some((t) => t.key === tabParam)
    ? tabParam
    : "pipeline";

  const canCreateFunil = props.canCreateFunil ?? true;
  const canManageTags = props.canManageTags ?? true;
  const canManageSegments = props.canManageSegments ?? true;

  // PR-PIPETOOLS: a "biblioteca de funis" foi REMOVIDA — ela rouba foco
  // do Kanban (briefing). Agora na tab Pipeline:
  //   - Se ?pipeline={id} na URL e existe, usa.
  //   - Caso contrario, auto-seleciona o PRIMEIRO funil disponivel.
  //   - Pra trocar de funil, usuario usa o dropdown "Funil atual: X"
  //     dentro da toolbar do KanbanBoard (tambem inclui acao
  //     "+ Criar novo funil" e "Configurar funis").
  const pipelineParam = searchParams.get("pipeline");
  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(
    pipelineParam ?? props.pipelines[0]?.id ?? null,
  );
  // Sync com URL + auto-select fallback.
  React.useEffect(() => {
    if (pipelineParam) {
      setSelectedPipelineId(pipelineParam);
    } else if (props.pipelines.length > 0 && selectedPipelineId === null) {
      setSelectedPipelineId(props.pipelines[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineParam, props.pipelines.length]);

  // PR-CRMOPS2: dialog "Criar novo funil" — vive no shell pra ficar
  // disponivel em qualquer tab via botao do header.
  const [createFunilOpen, setCreateFunilOpen] = React.useState(false);

  const setTab = (next: CrmTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "pipeline") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    // Quando troca de tab, limpa selecao de funil (evita estado meio
    // que sobra: "estou em Leads mas selectedPipeline ainda esta setado").
    if (next !== "pipeline") {
      params.delete("pipeline");
    }
    const qs = params.toString();
    router.push(qs ? `/crm?${qs}` : "/crm", { scroll: false });
  };

  const selectFunil = (funilId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pipeline", funilId);
    params.delete("tab"); // garante tab=pipeline
    router.push(`/crm?${params.toString()}`, { scroll: false });
    setSelectedPipelineId(funilId);
  };

  // PR-PIPETOOLS: backToBiblioteca removido — biblioteca nao existe
  // mais. Pra trocar de funil, usuario usa o dropdown da toolbar.

  const visibleTabs = TABS.filter((tab) => {
    if (tab.key === "tags" && !canManageTags) return false;
    if (tab.key === "segmentos" && !canManageSegments) return false;
    return true;
  });

  return (
    <KanbanProvider actions={crmKanbanActions}>
      <div className="space-y-6">
        {/* Header da pagina — botao "Criar novo funil" no canto direito */}
        <CrmPageHeader
          canCreateFunil={canCreateFunil}
          onCreateFunilClick={() => setCreateFunilOpen(true)}
        />

        {/* Tabs */}
        <CrmTabs
          tabs={visibleTabs}
          active={activeTab}
          onChange={setTab}
          leadCount={props.leadCount}
          dealCount={props.dealCount}
          activityCount={props.activityCount}
          segmentCount={props.segmentCount}
          tagCount={props.tagCount}
        />

        {/* Conteudo da tab ativa.
            PR-PIPETOOLS: removida a "biblioteca de funis" do meio da
            tela. Quando ha funis, vai DIRETO pro Kanban (auto-select
            do 1o funil). Pra trocar de funil, dropdown na toolbar do
            KanbanBoard. Pra ver/criar/editar/excluir funis, drawer
            "Configurar funis" — tudo dentro do contexto do Kanban. */}
        {activeTab === "pipeline" && (
          props.pipelines.length === 0 || !selectedPipelineId ? (
            <FunisEmptyState
              canCreate={canCreateFunil}
              onCreate={() => setCreateFunilOpen(true)}
            />
          ) : (
            <CrmClient
              pipelines={props.pipelines}
              stages={props.stages}
              deals={props.deals}
              leads={props.pipelineLeads}
              tags={props.tags}
              assignees={props.assignees}
              // PR-HOTFIX-CRMOPS5: converte null pra undefined.
              // KanbanBoard espera `string | undefined`, mas o state
              // local pode ser null. Passar null ativava modo controlled
              // com value=null e disparava Base UI error #31.
              pipelineId={selectedPipelineId ?? undefined}
              onPipelineChange={selectFunil}
            />
          )
        )}
        {activeTab === "leads" && (
          <LeadList
            initialLeads={props.leadsListData.initialLeads}
            initialTotal={props.leadsListData.initialTotal}
            initialPage={props.leadsListData.initialPage}
            initialTotalPages={props.leadsListData.initialTotalPages}
            activeSegment={props.activeSegment ?? null}
          />
        )}
        {activeTab === "segmentos" && canManageSegments && (
          <SegmentList
            segments={props.segments as never}
            assignees={props.assignees}
          />
        )}
        {activeTab === "tags" && canManageTags && (
          <TagsPageClient initialTags={props.tagsList as never} />
        )}
        {activeTab === "atividades" && (
          <ActivitiesTab
            initialActivities={props.activitiesData.initialActivities}
            initialTotal={props.activitiesData.initialTotal}
            initialPage={props.activitiesData.initialPage}
            initialTotalPages={props.activitiesData.initialTotalPages}
          />
        )}

        {/* Dialog "Criar novo funil" — global ao shell */}
        {canCreateFunil && (
          <CreateKanbanDialog
            open={createFunilOpen}
            onOpenChange={setCreateFunilOpen}
            onCreated={(newPipelineId) => {
              toast.success("Funil criado");
              // Auto-seleciona o novo funil (vai pra view do Kanban dele).
              selectFunil(newPipelineId);
              router.refresh();
            }}
          />
        )}
      </div>
    </KanbanProvider>
  );
}

// ============================================================================
// Header da pagina — titulo + tagline + botao "Criar novo funil" (canto direito)
// ============================================================================

function CrmPageHeader({
  canCreateFunil,
  onCreateFunilClick,
}: {
  canCreateFunil: boolean;
  onCreateFunilClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20">
          <Kanban className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-foreground font-heading leading-none">
            CRM
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pipeline, leads, segmentação, tags e atividades — tudo num lugar só.
          </p>
        </div>
      </div>
      {canCreateFunil && (
        <Button
          type="button"
          onClick={onCreateFunilClick}
          className="h-9 gap-1.5 shrink-0"
          title="Criar novo funil"
        >
          <Plus className="size-4" aria-hidden />
          Criar novo funil
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Sub-nav com 5 tabs
// ============================================================================

function CrmTabs({
  tabs,
  active,
  onChange,
  leadCount,
  dealCount,
  activityCount,
  segmentCount,
  tagCount,
}: {
  tabs: typeof TABS;
  active: CrmTab;
  onChange: (next: CrmTab) => void;
  leadCount: number;
  dealCount: number;
  activityCount: number;
  segmentCount: number;
  tagCount: number;
}) {
  return (
    <div className="flex gap-0.5 border-b border-border overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        const badgeValue =
          tab.key === "pipeline"
            ? dealCount
            : tab.key === "leads"
              ? leadCount
              : tab.key === "atividades"
                ? activityCount
                : tab.key === "segmentos"
                  ? segmentCount
                  : tab.key === "tags"
                    ? tagCount
                    : null;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-pressed={isActive}
            className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-3 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isActive
                ? "text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className={`size-4 ${isActive ? "text-primary" : ""}`} />
            <span>{tab.label}</span>
            {badgeValue !== null && badgeValue > 0 && (
              <Badge
                variant="secondary"
                className="ml-0.5 h-5 min-w-[20px] rounded-full bg-muted/80 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                {badgeValue}
              </Badge>
            )}
            {isActive && (
              <span
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-t-full bg-primary"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// PR-PIPETOOLS: FunisLibrary REMOVIDA. Antes (PR-CRMOPS2) listava os
// funis como cards no meio da tela quando nenhum estava selecionado —
// rouba foco do Kanban (briefing user). Agora auto-seleciona primeiro
// funil e exibe diretamente o Kanban. Pra trocar de funil ou criar
// novo, dropdown na toolbar do KanbanBoard. Pra gerir todos os funis,
// drawer "Configurar funis" disponivel em qualquer momento.
//
// Mantemos so o FunisEmptyState pra caso de 0 funis.
// ============================================================================

function FunisEmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Kanban className="size-6" aria-hidden />
      </div>
      <h2 className="mt-3 text-base font-semibold">
        Nenhum funil configurado ainda
      </h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Crie seu primeiro funil pra começar a organizar oportunidades por etapa.
      </p>
      {canCreate && (
        <Button
          type="button"
          onClick={onCreate}
          className="mt-5 h-10 gap-1.5"
        >
          <Plus className="size-4" aria-hidden />
          Criar primeiro funil
        </Button>
      )}
    </div>
  );
}
