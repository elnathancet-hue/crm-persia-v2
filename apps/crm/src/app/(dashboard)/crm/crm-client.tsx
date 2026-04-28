"use client";

// Thin wrapper: o KanbanBoard real vive em @persia/crm-ui (compartilhado
// com apps/admin). Aqui resolvemos role (useRole) + revalidacao
// (router.refresh) e injetamos as server actions via <KanbanProvider>.

import { useRouter } from "next/navigation";
import { KanbanBoard, KanbanProvider } from "@persia/crm-ui";
import type {
  DealWithLead,
  Pipeline,
  Stage,
} from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";
import { crmKanbanActions } from "@/features/crm-kanban/crm-kanban-actions";

interface Props {
  pipelines: Pipeline[];
  stages: Stage[];
  deals: DealWithLead[];
  leads: { id: string; name: string; phone: string | null; email: string | null }[];
}

export function CrmClient({ pipelines, stages, deals, leads }: Props) {
  const { isAgent, isAdmin } = useRole();
  const router = useRouter();

  return (
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
      />
    </KanbanProvider>
  );
}
