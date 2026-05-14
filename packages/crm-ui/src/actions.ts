// Dependency injection for the Kanban UI.
//
// Both apps (crm, admin) construct a concrete KanbanActions object pointing
// to their own server actions and pass it into <KanbanProvider>. The
// shared components never import server actions directly — they pull the
// bag through `useKanbanActions()`.
//
// CRM wraps requireRole() actions; admin wraps requireSuperadminForOrg()
// actions. The package itself stays auth-agnostic.

import type { ActionResult } from "@persia/ui";
import type {
  Deal,
  DealLossReason,
  Pipeline,
  Stage,
  StageOutcome,
} from "@persia/shared/crm";

export interface MarkAsLostInput {
  loss_reason: string;
  competitor?: string | null;
  loss_note?: string | null;
}

export interface CreateStageInput {
  pipelineId: string;
  name: string;
  sortOrder: number;
  /** Default em_andamento. */
  outcome?: StageOutcome;
}

export interface CreateDealInput {
  pipelineId: string;
  stageId: string;
  title: string;
  value: number;
  leadId?: string | null;
}

export interface UpdateDealInput {
  title?: string;
  value?: number;
}

export interface UpdateStageInput {
  name?: string;
  outcome?: StageOutcome;
  /** PR-CRMCFG: campos extras pra editor de configuracao. */
  color?: string;
  description?: string | null;
  sortOrder?: number;
}

/** PR-CRMCFG: reorder em batch usado pelo PipelineSettingsClient. */
export interface ReorderStageInput {
  id: string;
  position: number;
}

export interface KanbanActions {
  // Pipelines
  createPipeline: (name: string) => Promise<Pipeline>;
  /**
   * Sprint 3e: migrado pra ActionResult.
   */
  updatePipelineName: (
    pipelineId: string,
    name: string,
  ) => Promise<ActionResult<void>>;
  /**
   * Sprint 3e: migrado pra ActionResult.
   */
  deletePipeline: (pipelineId: string) => Promise<ActionResult<void>>;

  // Stages
  /**
   * Sprint 3e: migrado pra ActionResult<Stage>.
   */
  createStage: (input: CreateStageInput) => Promise<ActionResult<Stage>>;
  /**
   * Sprint 3e: migrado pra ActionResult.
   */
  updateStage: (
    stageId: string,
    data: UpdateStageInput,
  ) => Promise<ActionResult<void>>;
  /**
   * Sprint 3e: migrado pra ActionResult.
   */
  deleteStage: (stageId: string) => Promise<ActionResult<void>>;
  /**
   * PR-CRMCFG: reorder em batch (drag-drop ou setas no editor de
   * configuracao). Opcional pra retro-compat com adapters antigos
   * que ainda nao implementam — UI degrada pra "1 update por etapa"
   * ao invez de batch nesse caso.
   * Sprint 3e: migrado pra ActionResult.
   */
  reorderStages?: (
    stages: ReorderStageInput[],
  ) => Promise<ActionResult<void>>;

  // Deals
  createDeal: (input: CreateDealInput) => Promise<Deal>;
  /**
   * PR-CRMOPS2: cria lead + deal vinculado de uma vez. Usado pelo "+"
   * das colunas do Kanban — briefing: o usuario nao adiciona "negocio"
   * direto, ele adiciona um LEAD que aparece como card no Pipeline.
   *
   * Opcional pra preservar compat com adapters antigos (admin nao
   * implementa por enquanto — la o "+" continua abrindo "Novo
   * negocio"). Quando setado, a UI usa esse fluxo.
   */
  createLeadWithDeal?: (input: {
    lead: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      source?: string;
      status?: string;
      channel?: string;
    };
    pipelineId: string;
    stageId: string;
    dealTitle?: string;
    dealValue?: number;
  }) => Promise<{ lead: { id: string }; deal: Deal }>;
  updateDeal: (dealId: string, data: UpdateDealInput) => Promise<void>;
  /**
   * Move a deal pra outra stage. CRM dispara activity log + onStageChanged
   * + sync UAZAPI (rich move); admin faz so o update de stage_id (light).
   * Cada app implementa conforme sua semantica.
   */
  moveDealStage: (dealId: string, stageId: string) => Promise<void>;
  deleteDeal: (dealId: string) => Promise<void>;

  /**
   * Bulk operations (PR-K2). Opcionais — admin pode nao implementar
   * (apenas CRM tem UI de selecao multipla por enquanto).
   * Cada metodo tem cap de 200 itens por chamada no shared.
   *
   * Sprint 7: migrados pra ActionResult — antes lancavam em erro,
   * causando tela branca quando bulk falhava por validacao (ex:
   * mais de 200 itens, deals fora do org, etc).
   */
  bulkMoveDeals?: (
    dealIds: string[],
    stageId: string,
  ) => Promise<ActionResult<{ moved_count: number }>>;
  bulkSetDealStatus?: (
    dealIds: string[],
    status: "open" | "won" | "lost",
  ) => Promise<ActionResult<{ updated_count: number }>>;
  bulkDeleteDeals?: (
    dealIds: string[],
  ) => Promise<ActionResult<{ deleted_count: number }>>;
  bulkApplyTagsToDeals?: (
    dealIds: string[],
    tagIds: string[],
  ) => Promise<ActionResult<{ leads_count: number; links_count: number }>>;

  /**
   * Loss tracking (PR-K3) — substitui setStatus(lost) capturando
   * motivo + concorrente + nota pra analytics. Opcional (admin nao
   * implementa por enquanto).
   * Sprint 7: markDealAsLost + bulkMarkDealsAsLost migrados pra ActionResult.
   */
  getLossReasons?: () => Promise<DealLossReason[]>;
  markDealAsLost?: (
    dealId: string,
    input: MarkAsLostInput,
  ) => Promise<ActionResult<void>>;
  bulkMarkDealsAsLost?: (
    dealIds: string[],
    input: MarkAsLostInput,
  ) => Promise<ActionResult<{ updated_count: number }>>;

  /**
   * PR-C: card connections — atribui responsavel + add/remove tag +
   * abrir conversa interna direto do card. Todas opcionais pra retro-
   * compat com adapters antigos (admin nao implementa por enquanto;
   * UI esconde o botao quando undefined).
   */
  assignLead?: (leadId: string, userId: string | null) => Promise<void>;
  addTagToLead?: (leadId: string, tagId: string) => Promise<void>;
  removeTagFromLead?: (leadId: string, tagId: string) => Promise<void>;
  /**
   * Find or create conversation by lead. Retorna o conversationId
   * (existente ou novo). UI usa pra navegar pro chat interno no
   * `/chat?id={conversationId}` em vez de abrir `wa.me/` externo.
   */
  findOrCreateConversationByLead?: (
    leadId: string,
  ) => Promise<{ conversationId: string; created: boolean }>;
}
