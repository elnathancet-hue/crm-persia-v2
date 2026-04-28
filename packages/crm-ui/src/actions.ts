// Dependency injection for the Kanban UI.
//
// Both apps (crm, admin) construct a concrete KanbanActions object pointing
// to their own server actions and pass it into <KanbanProvider>. The
// shared components never import server actions directly — they pull the
// bag through `useKanbanActions()`.
//
// CRM wraps requireRole() actions; admin wraps requireSuperadminForOrg()
// actions. The package itself stays auth-agnostic.

import type {
  Deal,
  Pipeline,
  Stage,
  StageOutcome,
} from "@persia/shared/crm";

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
}

export interface KanbanActions {
  // Pipelines
  createPipeline: (name: string) => Promise<Pipeline>;
  updatePipelineName: (pipelineId: string, name: string) => Promise<void>;
  deletePipeline: (pipelineId: string) => Promise<void>;

  // Stages
  createStage: (input: CreateStageInput) => Promise<Stage>;
  updateStage: (stageId: string, data: UpdateStageInput) => Promise<void>;
  deleteStage: (stageId: string) => Promise<void>;

  // Deals
  createDeal: (input: CreateDealInput) => Promise<Deal>;
  updateDeal: (dealId: string, data: UpdateDealInput) => Promise<void>;
  /**
   * Move a deal pra outra stage. CRM dispara activity log + onStageChanged
   * + sync UAZAPI (rich move); admin faz so o update de stage_id (light).
   * Cada app implementa conforme sua semantica.
   */
  moveDealStage: (dealId: string, stageId: string) => Promise<void>;
  deleteDeal: (dealId: string) => Promise<void>;
}
