"use client";

// CrmShell (PR-K5) — invólucro da rota /crm com tabs internas:
// Pipeline · Leads · Atividades · Ajustes
//
// Decisões:
// - Pipeline (default) = renderiza o KanbanBoard atual (CrmClient)
// - Leads = embed do LeadsList (vinha de /leads que agora redireciona pra cá)
// - Atividades = stub visual (PR-K7 vai implementar timeline funcional)
// - Ajustes = link pra /crm/settings (mantém a página standalone)
//
// Tab ativa controlada por ?tab=pipeline|leads|atividades|ajustes
// (default: pipeline). useSearchParams pra deep link funcionar.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Kanban,
  Users,
  Activity,
  Settings,
} from "lucide-react";
import { Badge } from "@persia/ui/badge";
import type {
  DealWithLead,
  LeadWithTags,
  OrgActivityRow,
  Pipeline,
  Stage,
  TagRef,
} from "@persia/shared/crm";

import { CrmClient } from "./crm-client";
import { LeadList } from "@/components/leads/lead-list";
import { ActivitiesTab } from "@/components/crm/activities-tab";

type CrmTab = "pipeline" | "leads" | "atividades" | "ajustes";

const TABS: {
  key: CrmTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "pipeline", label: "Pipeline", icon: Kanban },
  { key: "leads", label: "Leads", icon: Users },
  { key: "atividades", label: "Atividades", icon: Activity },
  { key: "ajustes", label: "Ajustes", icon: Settings },
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

  // Dados das Atividades (timeline) — PR-K7
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
}

export function CrmShell(props: CrmShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") ?? "pipeline") as CrmTab;
  const activeTab: CrmTab = TABS.some((t) => t.key === tabParam)
    ? tabParam
    : "pipeline";

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

  return (
    <div className="space-y-6">
      {/* Header da pagina */}
      <CrmPageHeader />

      {/* Tabs */}
      <CrmTabs
        active={activeTab}
        onChange={setTab}
        leadCount={props.leadCount}
        dealCount={props.dealCount}
        activityCount={props.activityCount}
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
      {activeTab === "atividades" && (
        <ActivitiesTab
          initialActivities={props.activitiesData.initialActivities}
          initialTotal={props.activitiesData.initialTotal}
          initialPage={props.activitiesData.initialPage}
          initialTotalPages={props.activitiesData.initialTotalPages}
        />
      )}
      {activeTab === "ajustes" && <AjustesEntry />}
    </div>
  );
}

// ============================================================================
// Header da pagina /crm — logo box + titulo + tagline + acao primaria
// (botao "Novo lead" ainda nao integrado — PR-K6 vai polir)
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
            CRM Kanban
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Gerencie oportunidades comerciais por etapa
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-nav com 4 tabs
// ============================================================================

function CrmTabs({
  active,
  onChange,
  leadCount,
  dealCount,
  activityCount,
}: {
  active: CrmTab;
  onChange: (next: CrmTab) => void;
  leadCount: number;
  dealCount: number;
  activityCount: number;
}) {
  return (
    <div className="flex gap-0.5 border-b border-border overflow-x-auto">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        const badgeValue =
          tab.key === "pipeline"
            ? dealCount
            : tab.key === "leads"
              ? leadCount
              : tab.key === "atividades"
                ? activityCount
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
            {/* Underline da tab ativa — mais marcado */}
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
// Ajustes — link pra /crm/settings (mantém a pagina standalone)
// ============================================================================

function AjustesEntry() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Settings className="size-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-foreground">
            Configurações do CRM
          </h3>
          <p className="text-sm text-muted-foreground">
            Pipelines, etapas, motivos de perda e mais.
          </p>
        </div>
        <Link
          href="/crm/settings"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Abrir configurações
          <Settings className="size-4" />
        </Link>
      </div>
    </div>
  );
}
