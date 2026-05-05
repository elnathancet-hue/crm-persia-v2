"use client";

// CrmShell — invólucro da rota /crm com 5 tabs internas:
// Pipeline · Leads · Segmentação · Tags · Atividades
//
// PR-CRMOPS (mai/2026): nova direção de produto.
//   - Removida tab "Ajustes" (era em PR-K5; PR-CRMCFG já tinha tirado).
//   - Removida rota dedicada /settings/crm (PR-CRMCFG, agora deletado).
//   - Configuração do Kanban volta pra inline (drawer "Editar estrutura"
//     dentro do KanbanBoard).
//   - Segmentação e Tags viraram tabs próprias do CRM (eram sub-tabs
//     escondidas em /settings/crm).
//   - Motivos de perda removido — quando precisar capturar motivo de
//     deal perdido, vai ser via input livre direto no fluxo (sem área
//     de configuração dedicada).
//
// Tab ativa controlada por ?tab=pipeline|leads|segmentos|tags|atividades
// (default: pipeline). useSearchParams pra deep link funcionar.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Filter as FilterIcon,
  Kanban,
  Tag as TagIcon,
  Users,
} from "lucide-react";
import { Badge } from "@persia/ui/badge";
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

type CrmTab = "pipeline" | "leads" | "segmentos" | "tags" | "atividades";

// PR-CRMOPS: 5 tabs na ordem exata do briefing (Pipeline · Leads ·
// Segmentação · Tags · Atividades).
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
  // Dados do Pipeline (Kanban)
  pipelines: Pipeline[];
  stages: Stage[];
  deals: DealWithLead[];
  pipelineLeads: { id: string; name: string; phone: string | null; email: string | null }[];
  tags: TagRef[];
  assignees: { id: string; name: string }[];

  // Dados do Leads (lista)
  leadsListData: {
    initialLeads: LeadWithTags[];
    initialTotal: number;
    initialPage: number;
    initialTotalPages: number;
  };

  // PR-CRMOPS: dados das tabs novas (Segmentação + Tags)
  segments: unknown[];
  tagsList: TagWithCount[];

  // Dados das Atividades (timeline)
  activitiesData: {
    initialActivities: OrgActivityRow[];
    initialTotal: number;
    initialPage: number;
    initialTotalPages: number;
  };

  // Contadores no badge das tabs (totais para hint visual)
  leadCount: number;
  dealCount: number;
  activityCount: number;
  segmentCount: number;
  tagCount: number;

  // PR-CRMOPS: props condicionais pra controle de permissão (regra 12
  // do briefing — manter compat com Admin que pode passar valores
  // diferentes). Defaults true; cada caller decide.
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

  const canManageTags = props.canManageTags ?? true;
  const canManageSegments = props.canManageSegments ?? true;

  const setTab = (next: CrmTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "pipeline") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.push(qs ? `/crm?${qs}` : "/crm", { scroll: false });
  };

  // Filtra tabs visíveis baseado nas permissões. Default: todas.
  const visibleTabs = TABS.filter((tab) => {
    if (tab.key === "tags" && !canManageTags) return false;
    if (tab.key === "segmentos" && !canManageSegments) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header da pagina */}
      <CrmPageHeader />

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
        <CrmClient
          pipelines={props.pipelines}
          stages={props.stages}
          deals={props.deals}
          leads={props.pipelineLeads}
          tags={props.tags}
          assignees={props.assignees}
        />
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
    </div>
  );
}

// ============================================================================
// Header da pagina /crm
// ============================================================================

function CrmPageHeader() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
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
    </div>
  );
}

// ============================================================================
// Sub-nav com 5 tabs (PR-CRMOPS — adicionadas Segmentação + Tags)
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
