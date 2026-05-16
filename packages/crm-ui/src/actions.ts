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

// PR-K-CENTRIC (mai/2026): inputs lead-centric.

export interface CreateLeadInPipelineInput {
  lead: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    source?: string;
    status?: string;
    channel?: string;
    expected_value?: number | null;
  };
  pipelineId: string;
  stageId: string;
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

  // ============================================================
  // LEAD-CENTRIC (PR-K-CENTRIC mai/2026)
  // ============================================================
  // Kanban opera em LEAD agora. Lead aparece 1x. Deals viram
  // subentidade gerenciada no drawer.

  /**
   * Cria lead diretamente em pipeline/stage. Sem deal automatico
   * (deal vira opt-in via drawer do lead).
   */
  createLeadInPipeline: (input: CreateLeadInPipelineInput) => Promise<{ lead: { id: string } }>;

  /**
   * Move o lead pra outra stage do MESMO pipeline + atualiza sort_order.
   * Trigger DB sincroniza lead.status com outcome do stage.
   */
  moveLeadStage: (leadId: string, stageId: string, sortOrder: number) => Promise<void>;

  /**
   * Troca o lead pra outro pipeline (resets sort_order pra 0).
   * Usado via drawer "Mudar funil".
   */
  moveLeadToPipeline?: (leadId: string, pipelineId: string, stageId: string) => Promise<void>;

  // ============================================================
  // Bulk lead operations (cap 200/chamada no shared)
  // ============================================================

  bulkMoveLeads?: (
    leadIds: string[],
    stageId: string,
  ) => Promise<ActionResult<{ updated_count: number }>>;

  bulkMarkLeadsAsWon?: (
    leadIds: string[],
  ) => Promise<ActionResult<{ updated_count: number }>>;

  bulkMarkLeadsAsLost?: (
    leadIds: string[],
    input: MarkAsLostInput,
  ) => Promise<ActionResult<{ updated_count: number }>>;

  bulkDeleteLeadsFromKanban?: (
    leadIds: string[],
  ) => Promise<ActionResult<{ deleted_count: number }>>;

  bulkApplyTagsToLeads?: (
    leadIds: string[],
    tagIds: string[],
  ) => Promise<ActionResult<{ links_count: number }>>;

  // ============================================================
  // DEAL-CENTRIC (DEPRECATED — mantido pra compat com legacy
  // callers; remover na Fase 5 do refactor lead-centric)
  // ============================================================

  /** @deprecated use createLeadInPipeline */
  createDeal: (input: CreateDealInput) => Promise<Deal>;
  /** @deprecated use createLeadInPipeline */
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
  /** @deprecated CRUD do deal (subentidade) sera movido pro drawer do lead na Fase 3 */
  updateDeal: (dealId: string, data: UpdateDealInput) => Promise<void>;
  /** @deprecated CRUD do deal sera movido pro drawer */
  deleteDeal: (dealId: string) => Promise<void>;

  /**
   * Loss tracking (PR-K3) — catalog de motivos de perda. Mantido
   * pos PR-K-CENTRIC cleanup Fase B: bulk loss vai por
   * `bulkMarkLeadsAsLost` (lead-centric). Individual loss usa
   * trigger DB `trg_lead_stage_status_sync` ao mover lead pra stage
   * com outcome=falha — entao markDealAsLost individual nao precisa
   * mais existir aqui.
   */
  getLossReasons?: () => Promise<DealLossReason[]>;

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
