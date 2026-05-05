"use client";

// Thin wrapper: o KanbanBoard real vive em @persia/crm-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + revalidacao
// (router.refresh) + botao Importar (PR-K1, CRM-only) e injetamos as
// server actions via <KanbanProvider>.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  KanbanBoard,
  KanbanProvider,
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
import { crmKanbanActions } from "@/features/crm-kanban/crm-kanban-actions";
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
}

export function CrmClient({
  pipelines,
  stages,
  deals,
  leads,
  tags = [],
  assignees = [],
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
      <KanbanProvider actions={crmKanbanActions}>
        <KanbanBoard
          pipelines={pipelines}
          stages={stages}
          deals={deals}
          leads={leads}
          canEdit={isAgent}
          canManagePipelines={isAdmin}
          onChange={() => router.refresh()}
          goalsStorageKey="crm-kanban-goals-v1"
          tags={tags}
          assignees={assignees}
          // PR-CRMOPS: configuracao volta pra inline (drawer + dialog
          // dentro do KanbanBoard). Defaults derivados de
          // canManagePipelines — admin manage = pode tudo.
          // canCreateKanban e canEditStages podem ser desativadas por
          // contexto (ex: usuario read-only).
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
      </KanbanProvider>

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
