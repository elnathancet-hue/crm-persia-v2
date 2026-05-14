// Dependency injection for Leads UI.
//
// Each app (crm, admin) constructs a concrete LeadsActions object pointing
// to its own server actions and passes it into <LeadsProvider>. The
// shared components never import server actions directly — they pull the
// bag through `useLeadsActions()`.

import type { ActionResult } from "@persia/ui";
import type {
  LeadActivity,
  LeadDetail,
  LeadFilters,
  LeadWithTags,
  UpdateLeadInput,
} from "@persia/shared/crm";

export interface PaginatedLeadsResult {
  leads: LeadWithTags[];
  total: number;
  page: number;
  totalPages: number;
}

export interface OrgTag {
  id: string;
  name: string;
  color: string;
  organization_id: string;
  created_at: string;
}

/**
 * PR-L5: shape do match de duplicidade. UI exibe banner com nome +
 * canal que bateu (phone ou email). Definido aqui pra evitar
 * dependencia cruzada (packages/leads-ui nao importa de apps/crm).
 */
export interface DuplicateMatch {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  matched_by: "phone" | "email";
}

/**
 * PR-U1: stats agregados do lead (3 cards do header do drawer).
 * Espelha LeadStats em apps/crm/src/actions/leads.ts. Definido aqui
 * pra evitar dep cruzada — pacote nao importa de apps/.
 */
export interface LeadStats {
  deals: {
    count: number;
    total_value: number;
    latest_status: string | null;
  };
  conversations: {
    count: number;
    last_message_at: string | null;
  };
  activities: {
    count: number;
    latest_description: string | null;
    latest_at: string | null;
  };
}

/**
 * PR-U1: item de deal listado no tab Negocios do drawer. Espelha
 * LeadDealItem em apps/crm/src/actions/leads.ts (signature exata).
 */
export interface LeadDealItem {
  id: string;
  title: string;
  value: number;
  status: string;
  pipeline_id: string;
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_outcome: "em_andamento" | "falha" | "bem_sucedido";
  created_at: string;
  updated_at: string | null;
}

/**
 * PR-U1: stages da pipeline pro popover de "trocar etapa" no header
 * do drawer. Embed simplificado pra evitar puxar mais types.
 */
export interface DrawerStageRef {
  id: string;
  name: string;
  color: string;
  outcome: "em_andamento" | "falha" | "bem_sucedido";
  sort_order: number;
}

/**
 * PR-U1: retorno de getLeadOpenDealWithStages — deal aberto do lead
 * + stages do mesmo pipeline (pra popover trocar etapa).
 */
export interface LeadOpenDealWithStages {
  deal: {
    id: string;
    pipeline_id: string;
    stage_id: string;
  };
  stages: DrawerStageRef[];
}

/**
 * PR-U1: definicao de campo customizado da org. Espelha
 * LeadCustomFieldDef em apps/crm/src/actions/custom-fields.ts.
 */
export interface LeadCustomFieldDef {
  id: string;
  name: string;
  field_key: string;
  field_type: string;
  options: string[];
  is_required: boolean;
  sort_order: number;
}

/**
 * PR-U1: valor de campo customizado por lead (def + valor atual TEXT).
 * Espelha LeadCustomFieldEntry em apps/crm/src/actions/custom-fields.ts.
 */
export interface LeadCustomFieldEntry {
  field: LeadCustomFieldDef;
  /** Valor TEXT do banco. Vazio = nao preenchido. */
  value: string;
}

/**
 * PR-U1: estado de handoff do agente AI por lead (banner "Reativar").
 */
export interface LeadAgentHandoffState {
  isPaused: boolean;
  pausedAt: string | null;
  reason: string | null;
  pausedConversationCount: number;
}

/**
 * PR-S1: shape de um comentario colaborativo no lead (espelho da
 * tabela `lead_comments`). Vivem no pacote pra evitar dependencia
 * cruzada (packages/leads-ui nao importa de apps/crm).
 */
export interface LeadComment {
  id: string;
  lead_id: string;
  organization_id: string;
  author_id: string;
  author_name: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface LeadsActions {
  /** Lista paginada com filtros (search/status/tags). */
  listLeads: (filters: LeadFilters) => Promise<PaginatedLeadsResult>;
  /** Cria lead a partir do FormData do <LeadForm>. */
  createLead: (formData: FormData) => Promise<{ id: string } | void>;
  /** Tags do org (pra filtros chip). */
  getOrgTags: () => Promise<OrgTag[]>;
  /**
   * PR-L5: lookup de duplicidade ao criar lead. Opcional pra
   * retro-compat — admin pode nao implementar (degrada graciosamente,
   * banner nao aparece).
   */
  findDuplicate?: (
    phone?: string | null,
    email?: string | null,
  ) => Promise<DuplicateMatch | null>;
  /**
   * PR-S1: comentarios colaborativos no lead. As 4 actions sao
   * opcionais — admin pode nao implementar todas (ex: read-only).
   * Componente LeadCommentsTab degrada graciosamente: se `createLeadComment`
   * for undefined, esconde o form de novo comentario.
   */
  getLeadComments?: (leadId: string) => Promise<LeadComment[]>;
  createLeadComment?: (leadId: string, content: string) => Promise<LeadComment>;
  updateLeadComment?: (
    commentId: string,
    content: string,
  ) => Promise<{ success: boolean }>;
  deleteLeadComment?: (commentId: string) => Promise<{ success: boolean }>;

  // ========================================================================
  // PR-U1: actions usadas pelo LeadInfoDrawer (extraido em PR-U2). Todas
  // opcionais pra retro-compat — quem ja consome LeadsList sem precisar
  // do drawer (cenarios futuros) nao quebra. Drawer degrada graciosamente
  // (botao "Editar" some, tab "Negocios" mostra empty, etc).
  //
  // CRM passa requireRole("agent"). Admin passa requireSuperadminForOrg.
  // Multi-tenant garantido em ambos via cookie/auth.
  // ========================================================================

  /** Busca lead completo + activities pro view/edit. */
  getLead?: (leadId: string) => Promise<{
    lead: LeadDetail;
    activities: LeadActivity[];
  }>;

  /**
   * Atualiza campos do lead (form do drawer).
   * Sprint 3b: contrato migrou pra ActionResult (antes era throw em erro).
   */
  updateLead?: (
    leadId: string,
    data: UpdateLeadInput,
  ) => Promise<ActionResult<{ id: string }>>;

  /**
   * Deleta lead (drawer ganha botao "Excluir" em PR-U2).
   * Sprint 3b: contrato migrou pra ActionResult.
   */
  deleteLead?: (leadId: string) => Promise<ActionResult<{ success: true }>>;

  /** Stats agregados (3 cards do header do drawer). */
  getLeadStats?: (leadId: string) => Promise<LeadStats>;

  /** Lista de deals do lead (tab Negocios). */
  getLeadDealsList?: (leadId: string) => Promise<LeadDealItem[]>;

  /** Deal aberto + stages do pipeline (popover "trocar etapa"). */
  getLeadOpenDealWithStages?: (
    leadId: string,
  ) => Promise<LeadOpenDealWithStages | null>;

  /** Move um deal pra outra stage (popover acao). */
  updateDealStage?: (dealId: string, stageId: string) => Promise<void>;

  /** Tags inline no drawer/detail (add/remove). */
  addTagToLead?: (leadId: string, tagId: string) => Promise<void>;
  removeTagFromLead?: (leadId: string, tagId: string) => Promise<void>;

  /** Campos personalizados por lead (tab Campos). */
  getLeadCustomFields?: (
    leadId: string,
  ) => Promise<LeadCustomFieldEntry[]>;
  /** Salva valor TEXT de campo custom. Vazio = remove. */
  setLeadCustomFieldValue?: (
    leadId: string,
    fieldId: string,
    value: string,
  ) => Promise<{ success: boolean }>;

  /** Cria ou encontra conversa do lead (botao "Abrir conversa"). */
  findOrCreateConversationByLead?: (
    leadId: string,
  ) => Promise<{ conversationId: string }>;

  /** Estado de handoff do agente AI (banner "Reativar"). */
  getLeadAgentHandoffState?: (
    leadId: string,
  ) => Promise<LeadAgentHandoffState>;

  /**
   * Reativa o agente AI no lead apos handoff. Retorna
   * `updatedCount` = conversas reativadas (pode ser 0 se nenhuma
   * estava pausada).
   */
  reactivateLeadAgent?: (
    leadId: string,
  ) => Promise<{ updatedCount: number }>;
}
