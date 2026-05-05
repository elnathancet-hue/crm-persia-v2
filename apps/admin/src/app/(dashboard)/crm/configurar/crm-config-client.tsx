"use client";

// PR-CRMCFG: client de configuracao de funis no admin.
//
// Mesmo padrao da crm-page.tsx do admin: useActiveOrg + reload state +
// loader. A diferenca e que aqui renderizamos `PipelineSettingsClient`
// em vez do `KanbanBoard`. Mesmo provider (KanbanProvider + actions).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  KanbanProvider,
  PipelineSettingsClient,
} from "@persia/crm-ui";
import type { Pipeline, Stage } from "@persia/shared/crm";
import { useActiveOrg } from "@/lib/stores/client-store";
import { NoContextFallback } from "@/components/no-context-fallback";
import {
  ensureDefaultPipeline,
  getPipelines,
  getStagesForOrg,
} from "@/actions/pipelines";
import { adminKanbanActions } from "@/features/crm-kanban/admin-kanban-actions";

export function CrmConfigClient() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    let basePipelines = (await getPipelines()) as Pipeline[];
    if (basePipelines.length === 0) {
      const ensured = await ensureDefaultPipeline();
      if (ensured) {
        basePipelines = (await getPipelines()) as Pipeline[];
      }
    }
    const stagesData = await getStagesForOrg();
    setPipelines(basePipelines);
    // Cast intencional: types autogerados nao incluem `outcome`
    // (mesma justificativa da crm-page.tsx).
    setStages(stagesData as unknown as Stage[]);
  }

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    reload()
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar funis",
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/crm"
          aria-label="Voltar ao CRM"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-heading">
            Configurar funis
          </h1>
          <p className="text-sm text-muted-foreground">
            Funis e etapas do CRM (admin)
          </p>
        </div>
      </div>

      <KanbanProvider actions={adminKanbanActions}>
        <PipelineSettingsClient pipelines={pipelines} stages={stages} />
      </KanbanProvider>
    </div>
  );
}
