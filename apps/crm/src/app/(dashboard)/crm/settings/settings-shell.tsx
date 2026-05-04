"use client";

// SettingsShell (PR-K10) — invólucro de /crm/settings com sub-tabs
// internas: Funis · Etiquetas · Motivos · Segmentos
//
// Decisões:
// - Funis = renderiza CrmSettingsClient (pipelines + stages, ja existente)
// - Etiquetas = embed do TagsPageClient (vinha de /tags que agora redireciona)
// - Motivos = renderiza LossReasonsManager (PR-K4)
// - Segmentos = embed do SegmentList (vinha de /segments que agora redireciona)
//
// Tab ativa controlada por ?tab=funis|etiquetas|motivos|segmentos
// (default: funis). Deep link funciona.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Filter as FilterIcon,
  Kanban,
  Settings as SettingsIcon,
  Tag as TagIcon,
} from "lucide-react";
import type { DealLossReason, Pipeline, Stage, TagWithCount } from "@persia/shared/crm";

import { CrmSettingsClient } from "./crm-settings-client";
import { LossReasonsManager } from "@/components/crm/loss-reasons-manager";
import { TagsPageClient } from "@/app/(dashboard)/tags/tags-client";
import { SegmentList } from "@/components/segments/segment-list";

type SettingsTab = "funis" | "etiquetas" | "motivos" | "segmentos";

const TABS: {
  key: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "funis", label: "Funis e etapas", icon: Kanban },
  { key: "etiquetas", label: "Etiquetas", icon: TagIcon },
  { key: "motivos", label: "Motivos de perda", icon: Ban },
  { key: "segmentos", label: "Segmentos", icon: FilterIcon },
];

interface SettingsShellProps {
  pipelines: Pipeline[];
  stages: Stage[];
  lossReasons: DealLossReason[];
  tags: TagWithCount[];
  segments: unknown[];
}

export function SettingsShell(props: SettingsShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") ?? "funis") as SettingsTab;
  const activeTab: SettingsTab = TABS.some((t) => t.key === tabParam)
    ? tabParam
    : "funis";

  const setTab = (next: SettingsTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "funis") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.push(qs ? `/crm/settings?${qs}` : "/crm/settings", {
      scroll: false,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header da pagina */}
      <SettingsPageHeader />

      {/* Sub-tabs */}
      <SettingsTabs active={activeTab} onChange={setTab} />

      {/* Conteudo da tab ativa */}
      {activeTab === "funis" && (
        <CrmSettingsClient
          pipelines={props.pipelines}
          stages={props.stages as never}
        />
      )}
      {activeTab === "etiquetas" && (
        <div className="max-w-5xl mx-auto">
          <TagsPageClient initialTags={props.tags as never} />
        </div>
      )}
      {activeTab === "motivos" && (
        <div className="max-w-3xl mx-auto">
          <LossReasonsManager initialReasons={props.lossReasons} />
        </div>
      )}
      {activeTab === "segmentos" && (
        <div className="max-w-5xl mx-auto">
          <SegmentList segments={props.segments as never} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Header da pagina /crm/settings — espelha o pattern do CRM Shell (PR-K5)
// ============================================================================

function SettingsPageHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Link
          href="/crm"
          aria-label="Voltar ao CRM"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <SettingsIcon className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-heading">
            Configurações do CRM
          </h1>
          <p className="text-sm text-muted-foreground">
            Personalize funis, etiquetas, motivos e segmentos
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-tabs (mesmo pattern visual das tabs do CRM shell — PR-K5)
// ============================================================================

function SettingsTabs({
  active,
  onChange,
}: {
  active: SettingsTab;
  onChange: (next: SettingsTab) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border overflow-x-auto">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-pressed={isActive}
            className={`relative inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            <span>{tab.label}</span>
            {isActive && (
              <span
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-t-full bg-primary"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
