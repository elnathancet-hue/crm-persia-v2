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
import * as React from "react";
import { useRouter } from "next/navigation";
import { KanbanBoard } from "@persia/crm-ui";
import type {
  LeadKanbanCard,
  Pipeline,
  Stage,
  TagRef,
} from "@persia/shared/crm";
import type { LeadUpcomingAppointment } from "@persia/shared/agenda";
import type { KanbanAgentSummary } from "@persia/shared/ai-agent";
import { useRole } from "@/lib/hooks/use-role";
import {
  useCurrentUser,
  useDealPresence,
  useDealsRealtime,
  useDebouncedCallback,
  useKanbanLeadsRealtime,
} from "@persia/leads-ui";
import { createClient } from "@/lib/supabase/client";

interface Props {
  pipelines: Pipeline[];
  stages: Stage[];
  /** PR-K-CENTRIC (mai/2026): leads sao a entidade do Kanban. */
  kanbanLeads: LeadKanbanCard[];
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
  /**
   * PR-KANBAN-UPCOMING (mai/2026): array de proximos agendamentos
   * (~48h) dos leads visiveis. Convertido em Map<leadId, ...> aqui
   * e passado pro KanbanBoard renderizar chip.
   */
  upcomingAppointments?: LeadUpcomingAppointment[];
  /**
   * PR-AGENT-INTEGRATION-6 (mai/2026): summaries do agente IA por lead.
   * Convertido em Map<leadId, ...> e passado pro KanbanBoard pra
   * renderizar badge "IA ativa/pausada" no card.
   */
  kanbanAgentSummaries?: KanbanAgentSummary[];
}

export function CrmClient({
  pipelines,
  stages,
  kanbanLeads,
  leads,
  tags = [],
  assignees = [],
  pipelineId,
  onPipelineChange,
  upcomingAppointments,
  kanbanAgentSummaries,
}: Props) {
  const { isAgent, isAdmin } = useRole();
  const router = useRouter();

  // PR-O Realtime: outro agente moveu/criou/deletou deal neste funil.
  // PR-P: debounce 200ms trailing — burst de drag-drop ou bulk move
  // dispara N eventos em <200ms; sem debounce o servidor refetcha N
  // vezes desnecessariamente. Com debounce, dispara 1x apos o burst.
  // RLS de deals + filtro pipeline_id no canal sao defesa em camada.
  // Admin tem seu proprio wrapper e nao recebe esse hook (compat).
  // PR-V1a: useDealsRealtime + useDealPresence agora vem de @persia/leads-ui
  // (parte do S2) e recebem supabase via DI.
  const supabase = createClient();
  const debouncedRefresh = useDebouncedCallback(() => router.refresh());
  // PR-K-CENTRIC realtime fix (mai/2026): apos refactor lead-centric,
  // o source-of-truth do Kanban e leads.stage_id. Drag-drop / AI Agent /
  // /api/crm / bulkMoveLeads atualizam leads, NAO deals — entao
  // useDealsRealtime sozinho perde 100% das mudancas pos-refactor.
  // Mantemos os 2 hooks: useDealsRealtime continua valido pra mudancas
  // na tab "Negocios" do drawer (criar/editar/excluir deal).
  useDealsRealtime(supabase, pipelineId ?? null, debouncedRefresh);
  useKanbanLeadsRealtime(supabase, pipelineId ?? null, debouncedRefresh);

  // PR-Q: presence-only do pipeline pra mostrar quem ta vendo cada card.
  // Canal proprio (`pipeline-presence-${pipelineId}`) — separa o concern
  // de presence (muito mais updates) do realtime de postgres_changes.
  const currentUser = useCurrentUser(supabase);
  const { watchersByDeal, setViewingDealId } = useDealPresence({
    supabase,
    pipelineId: pipelineId ?? null,
    currentUser,
  });

  // PR-J: importOpen/importTags/openImport REMOVIDOS — briefing user:
  // "tirar importar e exportar, deixar essa opcao somente em leads".
  // O ImportLeadsWizard continua acessivel via tab Leads (headerActions
  // do LeadsList em apps/crm/src/components/leads/lead-list.tsx).

  // PR-KANBAN-UPCOMING (mai/2026): converte array vindo do server em
  // Map<leadId, LeadUpcomingAppointment> pra lookup O(1) no Kanban.
  // useMemo evita reconstruir o Map a cada render quando a referencia
  // do array nao muda.
  const upcomingMap = React.useMemo(() => {
    const m = new Map<string, LeadUpcomingAppointment>();
    for (const item of upcomingAppointments ?? []) {
      m.set(item.lead_id, item);
    }
    return m;
  }, [upcomingAppointments]);

  // PR-AGENT-INTEGRATION-6: paridade com upcomingMap — Map<leadId,
  // KanbanAgentSummary> pra lookup O(1) no render do card.
  const agentSummariesMap = React.useMemo(() => {
    const m = new Map<string, KanbanAgentSummary>();
    for (const item of kanbanAgentSummaries ?? []) {
      m.set(item.lead_id, item);
    }
    return m;
  }, [kanbanAgentSummaries]);

  return (
    <KanbanBoard
      pipelines={pipelines}
      stages={stages}
      kanbanLeads={kanbanLeads}
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
      // PR-Q: presence — admin nao passa nada (compat)
      dealWatchers={watchersByDeal}
      onDealViewChange={setViewingDealId}
      // Frente B: botão "Ver lead" no card do Kanban abre o
      // LeadInfoDrawer via deeplink. Reusa o mesmo mecanismo da
      // tab Leads (?lead=UUID), garantindo UX consistente.
      onOpenLead={(leadId) => {
        router.push(`/crm?tab=leads&lead=${leadId}`);
      }}
      // PR-KANBAN-UPCOMING (mai/2026): chip "Em Xh"/"Amanhã HH:MM" no card
      upcomingAppointments={upcomingMap}
      // PR-AGENT-INTEGRATION-6 (mai/2026): badge "IA ativa/pausada"
      kanbanAgentSummaries={agentSummariesMap}
    />
  );
}
