"use client";

// PR-CRMCFG: wrapper da aba "Funis" do /settings/crm.
//
// Aqui apenas injeta as actions do CRM via <KanbanProvider> e renderiza
// o `PipelineSettingsClient` compartilhado (master-detail) de
// @persia/crm-ui. A logica de UI vive 100% no shared.
//
// Mesma fonte de dados que o KanbanBoard usa (regra 9): pipelines +
// stages vem do mesmo loader RSC (settings/crm/page.tsx) que reusa
// queries do shared.

import { KanbanProvider } from "@persia/crm-ui";
import { PipelineSettingsClient } from "@persia/crm-ui";
import type { Pipeline, Stage } from "@persia/shared/crm";
import { crmKanbanActions } from "@/features/crm-kanban/crm-kanban-actions";

export function FunisTab({
  pipelines,
  stages,
  initialPipelineId,
}: {
  pipelines: Pipeline[];
  stages: Stage[];
  initialPipelineId?: string;
}) {
  return (
    <KanbanProvider actions={crmKanbanActions}>
      <PipelineSettingsClient
        pipelines={pipelines}
        stages={stages}
        initialPipelineId={initialPipelineId}
      />
    </KanbanProvider>
  );
}
