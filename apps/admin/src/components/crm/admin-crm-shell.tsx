"use client";

// PR-T3 + PR-V1c: admin CRM shell com tabs internas, espelhando a
// estrutura do CRM cliente (apps/crm/src/app/(dashboard)/crm/crm-shell.tsx).
//
// 5 tabs: Pipeline (Funil), Leads, Segmentação, Tags, Atividades.
// PR-V1c adicionou Atividades — consome ActivitiesTab do @persia/crm-ui
// com getOrgActivities(superadmin) via DI.
//
// Cada tab renderiza o componente top-level ja existente do admin —
// CrmPage, LeadListPage, SegmentsPage, TagsPage, AdminActivitiesTab.
// Cada um ja faz isManagingClient check + NoContextFallback + fetch dos
// dados. Mounting lazy: so monta o componente da tab ativa pra evitar
// queries paralelas em todas tabs ao carregar.
//
// URL sync: ?tab=pipeline|leads|segmentos|tags|atividades. Default: pipeline.
// Replica o pattern do CrmShell pra deep links funcionarem identicos
// em ambos apps.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Filter as FilterIcon,
  Kanban,
  Tag as TagIcon,
  Users,
} from "lucide-react";
import { CrmPage } from "@/components/crm/crm-page";
import { LeadListPage } from "@/components/leads/lead-list";
import { AdminActivitiesTab } from "@/components/crm/admin-activities-tab";
import SegmentsPage from "@/app/(dashboard)/segments/page";
import TagsPage from "@/app/(dashboard)/tags/page";

type CrmTab = "pipeline" | "leads" | "segmentos" | "tags" | "atividades";

const TABS: {
  key: CrmTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "pipeline", label: "Funil", icon: Kanban },
  { key: "leads", label: "Leads", icon: Users },
  { key: "segmentos", label: "Segmentação", icon: FilterIcon },
  { key: "tags", label: "Tags", icon: TagIcon },
  { key: "atividades", label: "Atividades", icon: Activity },
];

export function AdminCrmShell() {
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
      {/* Header — espelha CrmShell cliente (icone + titulo + tagline). */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20">
            <Kanban className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground leading-none">
              CRM
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Funil, leads, segmentação e tags — gerencie como
              superadmin.
            </p>
          </div>
        </div>
      </div>

      {/* Sub-nav 4 tabs — visual identico ao CrmTabs do cliente. */}
      <div className="flex gap-0.5 border-b border-border overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              aria-pressed={isActive}
              className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-3 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isActive
                  ? "text-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className={`size-4 ${isActive ? "text-primary" : ""}`} />
              <span>{tab.label}</span>
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

      {/* Tab content — mount lazy (so a tab ativa monta).
          Cada componente cuida do seu proprio fetch + NoContextFallback. */}
      <div>
        {activeTab === "pipeline" && <CrmPage hideHeader />}
        {activeTab === "leads" && <LeadListPage />}
        {activeTab === "segmentos" && <SegmentsPage />}
        {activeTab === "tags" && <TagsPage />}
        {activeTab === "atividades" && <AdminActivitiesTab />}
      </div>
    </div>
  );
}
