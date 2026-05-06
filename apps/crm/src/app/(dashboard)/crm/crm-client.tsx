"use client";

// Thin wrapper: o KanbanBoard real vive em @persia/crm-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + revalidacao
// (router.refresh) + botao Importar (PR-K1, CRM-only).
//
// PR-CRMOPS2: KanbanProvider subiu pro CrmShell — pra o botao "Criar
// novo funil" do header poder usar useKanbanActions. CrmClient agora
// assume estar dentro do provider.
//
// PR-CRMOPS2: aceita props `pipelineId` (controlled, vem do CrmShell).
// PR-PIPETOOLS: trocou `onBack` (que voltava pra biblioteca, agora
// removida) por `onPipelineChange` — KanbanBoard usa pra trocar de
// funil via dropdown. CrmShell sincroniza com URL.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  KanbanBoard,
  ImportLeadsWizard,
  type ImportTag,
} from "@persia/crm-ui";
import { Button } from "@persia/ui/button";
import { Upload } from "lucide-react";
import type {
  DealWithLead,
  Pipeline,
  Stage,
  TagRef,
} from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { importLeads } from "@/actions/leads-import";
import { getOrgTags } from "@/actions/leads";

interface Props {
  pipelines: Pipeline[];
  stages: Stage[];
  deals: DealWithLead[];
  leads: { id: string; name: string; phone: string | null; email: string | null }[];
  /** Tags da org pra filtros + bulk apply (PR-K2). */
  tags?: TagRef[];
  /** Responsaveis pra filtro 'Atribuido a' (PR-K2). */
  assignees?: { id: string; name: string }[];
  /** PR-CRMOPS2: funil controlado externamente pelo CrmShell. */
  pipelineId?: string;
  /** PR-PIPETOOLS: callback pra trocar de funil via dropdown da
   * toolbar. CrmShell sincroniza com URL (?pipeline={id}). */
  onPipelineChange?: (newPipelineId: string) => void;
}

export function CrmClient({
  pipelines,
  stages,
  deals,
  leads,
  tags = [],
  assignees = [],
  pipelineId,
  onPipelineChange,
}: Props) {
  const { isAgent, isAdmin } = useRole();
  const router = useRouter();

  const [importOpen, setImportOpen] = React.useState(false);
  const [importTags, setImportTags] = React.useState<ImportTag[]>([]);

  const openImport = React.useCallback(async () => {
    try {
      const tags = await getOrgTags();
      setImportTags(
        tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      );
    } catch {
      setImportTags([]);
    }
    setImportOpen(true);
  }, []);

  return (
    <>
      <KanbanBoard
        pipelines={pipelines}
        stages={stages}
        deals={deals}
        leads={leads}
        canEdit={isAgent}
        canManagePipelines={isAdmin}
        // PR-CRMOPS2: "Criar novo funil" foi pro header do CrmShell.
        // Aqui desligamos pra evitar duplicar o botao na toolbar.
        canCreateKanban={false}
        canEditStages={isAdmin}
        onChange={() => router.refresh()}
        goalsStorageKey="crm-kanban-goals-v1"
        tags={tags}
        assignees={assignees}
        pipelineId={pipelineId}
        onPipelineChange={onPipelineChange}
        toolbarExtras={
          isAgent ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-md px-2.5"
              onClick={openImport}
              title="Importar leads"
            >
              <Upload className="size-3.5" />
              Importar
            </Button>
          ) : undefined
        }
      />

      <ImportLeadsWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        tags={importTags}
        onImport={importLeads}
        onImported={() => router.refresh()}
        segmentsBasePath="/segments"
      />
    </>
  );
}
