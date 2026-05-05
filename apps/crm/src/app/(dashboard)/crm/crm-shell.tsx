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
  ChevronRight,
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

  // PR-CRMOPS2: estado da biblioteca de funis. Sincronizado com URL
  // (?pipeline={id}) pra deep-link e refresh preservarem selecao.
  const pipelineParam = searchParams.get("pipeline");
  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(
    pipelineParam,
  );
  // Mantem em sync se URL mudar (back/forward do browser).
  React.useEffect(() => {
    setSelectedPipelineId(pipelineParam);
  }, [pipelineParam]);

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

  const backToBiblioteca = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pipeline");
    params.delete("tab");
    const qs = params.toString();
    router.push(qs ? `/crm?${qs}` : "/crm", { scroll: false });
    setSelectedPipelineId(null);
  };

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

        {/* Conteudo da tab ativa */}
        {activeTab === "pipeline" && (
          props.pipelines.length === 0 ? (
            <FunisEmptyState
              canCreate={canCreateFunil}
              onCreate={() => setCreateFunilOpen(true)}
            />
          ) : selectedPipelineId === null ? (
            <FunisLibrary
              pipelines={props.pipelines}
              stages={props.stages}
              dealsCount={(funilId) =>
                props.deals.filter((d) => d.pipeline_id === funilId).length
              }
              onSelect={selectFunil}
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
              pipelineId={selectedPipelineId}
              onBack={backToBiblioteca}
            />
          )
        )}
        {activeTab === "leads" && (
          <LeadList
            initialLeads={props.leadsListData.initialLeads}
            initialTotal={props.leadsListData.initialTotal}
            initialPage={props.leadsListData.initialPage}
            initialTotalPages={props.leadsListData.initialTotalPages}
          />
        )}
        {activeTab === "segmentos" && canManageSegments && (
          <SegmentList segments={props.segments as never} />
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
// Biblioteca de funis — PR-CRMOPS2
// Lista os funis configurados como cards clicaveis. Click = abre o Kanban.
// ============================================================================

function FunisLibrary({
  pipelines,
  stages,
  dealsCount,
  onSelect,
  canCreate,
  onCreate,
}: {
  pipelines: Pipeline[];
  stages: Stage[];
  dealsCount: (funilId: string) => number;
  onSelect: (funilId: string) => void;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-foreground">
          Funis configurados
        </h2>
        <span className="text-xs text-muted-foreground">
          {pipelines.length} funil{pipelines.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {pipelines.map((p) => {
          const pStages = stages.filter((s) => s.pipeline_id === p.id);
          const deals = dealsCount(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className="group rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {p.name}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pStages.length} etapa{pStages.length === 1 ? "" : "s"}
                    {deals > 0 && ` · ${deals} negócio${deals === 1 ? "" : "s"}`}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0" aria-hidden />
              </div>

              {/* Preview: bolinhas das etapas */}
              {pStages.length > 0 && (
                <div className="mt-3 flex items-center gap-1 flex-wrap">
                  {pStages.slice(0, 8).map((s) => (
                    <span
                      key={s.id}
                      title={s.name}
                      className="inline-block size-2.5 rounded-full ring-1 ring-black/5"
                      style={{ backgroundColor: s.color || "#6366f1" }}
                    />
                  ))}
                  {pStages.length > 8 && (
                    <span className="text-[10px] text-muted-foreground/70 ml-0.5">
                      +{pStages.length - 8}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}

        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-card">
                <Plus className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-medium">Criar novo funil</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground/80">
              Configure etapas e regras para um novo fluxo de vendas.
            </p>
          </button>
        )}
      </div>
    </div>
  );
}

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
