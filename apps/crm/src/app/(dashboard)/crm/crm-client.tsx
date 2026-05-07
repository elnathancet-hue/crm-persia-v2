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

// PR-J: imports de Importar/Export removidos (Button, Upload,
// ImportLeadsWizard, ImportTag, importLeads, getOrgTags). Acao de
// importar moved-only pra tab Leads (LeadsList headerActions).
import { useRouter } from "next/navigation";
import { KanbanBoard } from "@persia/crm-ui";
import type {
  DealWithLead,
  Pipeline,
  Stage,
  TagRef,
} from "@persia/shared/crm";
import { useRole } from "@/lib/hooks/use-role";

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

  // PR-J: importOpen/importTags/openImport REMOVIDOS — briefing user:
  // "tirar importar e exportar, deixar essa opcao somente em leads".
  // O ImportLeadsWizard continua acessivel via tab Leads (headerActions
  // do LeadsList em apps/crm/src/components/leads/lead-list.tsx).

  return (
    <KanbanBoard
      pipelines={pipelines}
      stages={stages}
      deals={deals}
      leads={leads}
      canEdit={isAgent}
      canManagePipelines={isAdmin}
      canCreateKanban={false}
      canEditStages={isAdmin}
      onChange={() => router.refresh()}
      goalsStorageKey="crm-kanban-goals-v1"
      tags={tags}
      assignees={assignees}
      pipelineId={pipelineId}
      onPipelineChange={onPipelineChange}
    />
  );
}
