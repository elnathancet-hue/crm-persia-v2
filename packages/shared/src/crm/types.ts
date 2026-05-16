// CRM domain types — fonte unica pra apps/crm e apps/admin.
//
// Antes desse arquivo, tipos como Lead, Deal, Pipeline, Stage, Tag, Segment
// estavam definidos LOCALMENTE em cada app (apps/crm/src/actions/leads.ts,
// apps/admin/src/actions/leads.ts, e em vários components). Isso violava a
// regra do projeto "types Database vivem em packages/shared/" e gerava drift
// silencioso entre os dois apps.
//
// Estes tipos descrevem ROWS retornadas pelas queries do CRM (leads, deals,
// pipelines, etc) — não são os tipos `Tables<"leads">` autogerados do
// Supabase. Os autogerados ficam em `database.ts` e são usados em INSERTs/
// UPDATEs. Os daqui são pra views de leitura (joins, projeções).
//
// Convenção:
//   - Tipos base (sem nested relations) usam o nome curto (Lead, Deal, Stage)
//   - Tipos com relações usam sufixo (LeadWithTags, DealWithLead,
//     PipelineWithStages, StageWithDeals)

// ============================================================================
// Lead
// ============================================================================

export interface LeadFilters {
  search?: string;
  status?: string;
  tags?: string[];
  /**
   * PR-CRMOPS3: filtra por leads que batem nas regras do segmento
   * informado. Resolve via `findMatchingLeadIds` antes da query e
   * aplica como `.in('id', leadIds)`. Se segmento nao existe ou
   * tem 0 matches, retorna lista vazia.
   */
  segmentId?: string;
  page?: number;
  limit?: number;
  /**
   * PR-L4: ordenacao opcional. Default: `created_at DESC` (mais
   * recentes primeiro). Colunas suportadas (com index ou eficientes):
   *   - "created_at" (default)
   *   - "name"
   *   - "last_interaction_at"
   *   - "updated_at"
   * Direction: "asc" | "desc" (default desc).
   */
  orderBy?: {
    column: "created_at" | "name" | "last_interaction_at" | "updated_at";
    direction?: "asc" | "desc";
  };
  /**
   * Filtros de exportacao + filtros visiveis no header da lista.
   * Sao opcionais e combinaveis. Aplicados no shared `listLeads`
   * via .gte()/.lte() no Supabase.
   */
  /** ISO 8601 — leads criados >= dateFrom */
  dateFrom?: string;
  /** ISO 8601 — leads criados <= dateTo (inclusivo, end-of-day no caller) */
  dateTo?: string;
  /** ISO 8601 — leads com last_interaction_at >= */
  lastInteractionFrom?: string;
  /** ISO 8601 — leads com last_interaction_at <= (frios = data antiga) */
  lastInteractionTo?: string;
  /** UUIDs de responsaveis. Vazio = todos. ["__none__"] = sem responsavel. */
  assigneeIds?: string[];
  /** Origens (whatsapp, manual, import, etc). Vazio = todas. */
  sources?: string[];
}

/**
 * Lead com tags embed via .select join.
 *
 * Campos `whatsapp_id`, `opt_in` e `metadata` são opcionais porque o admin
 * historicamente não os seleciona em suas queries. Apps que precisam (CRM
 * client) selecionam explicitamente; apps que não precisam (admin) deixam
 * `undefined` sem quebrar tipos.
 *
 * Campos de endereço, notes, website e assigned_to são opcionais porque
 * foram adicionados pela migration 030 (drawer "Informações do lead") e
 * stages de migração podem nao ter esses dados.
 */
export interface LeadWithTags {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  source: string;
  status: string;
  score: number;
  channel: string;
  whatsapp_id?: string | null;
  opt_in?: boolean;
  metadata?: unknown;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
  // Campos do drawer "Informações do lead" (migration 030)
  website?: string | null;
  assigned_to?: string | null;
  address_country?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_complement?: string | null;
  notes?: string | null;
  lead_tags: {
    tag_id: string;
    tags: {
      id: string;
      name: string;
      color: string;
    };
  }[];
}

export interface LeadCustomFieldValue {
  id: string;
  custom_field_id: string;
  value: string;
  custom_fields: {
    id: string;
    name: string;
    field_type: string;
  };
}

export interface LeadDetail extends LeadWithTags {
  lead_custom_field_values: LeadCustomFieldValue[];
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  performed_by: string | null;
  type: string;
  description: string | null;
  metadata: unknown;
  created_at: string | null;
}

// ============================================================================
// Tag
// ============================================================================

/** Versão "ref" — usada em joins (lead_tags.tags). */
export interface TagRef {
  id: string;
  name: string;
  color: string;
}

/**
 * Tag completa — quando carregada via SELECT na tabela `tags`. Os
 * campos `organization_id` e `created_at` sao requireds aqui porque
 * sao colunas NOT NULL na tabela e queries diretas (select *) sempre
 * trazem. Use `TagRef` (id/name/color) pra projecoes em joins.
 */
export interface Tag extends TagRef {
  organization_id: string;
  created_at: string;
}

/** Tag com contagem agregada — view "lista de tags com totais". */
export interface TagWithCount extends Tag {
  lead_count: number;
}

export interface LeadTagJoin {
  tag_id: string;
  tags: TagRef | null;
}

// ============================================================================
// Pipeline + Stage + Deal
// ============================================================================

export interface Pipeline {
  id: string;
  name: string;
}

/**
 * Categoria terminal da stage no Kanban. Toda stage pertence a um destes
 * 3 buckets, refletido no header colorido do filtro principal:
 *   - em_andamento: leads ainda sendo trabalhados (azul/cyan/teal/mint)
 *   - falha: leads perdidos/descartados (vermelho)
 *   - bem_sucedido: leads convertidos/fechados (verde)
 */
export type StageOutcome = "em_andamento" | "falha" | "bem_sucedido";

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  sort_order: number;
  /** Categoria terminal — agrupa a stage no Kanban. Default em_andamento. */
  outcome: StageOutcome;
  /** Descrição opcional (config do CRM). */
  description?: string | null;
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  status: string;
  lead_id: string | null;
  pipeline_id: string;
  stage_id: string;
  sort_order: number;
  /** Timestamp da ultima alteracao do deal — usado pra filtro 'sem
   *  atividade ha N dias'. Opcional pra retro-compat com queries antigas. */
  updated_at?: string | null;
  created_at?: string | null;
  /** UUID do responsavel (auth.users.id). Opcional. */
  assigned_to?: string | null;
  /** Categoria do motivo de perda (PR-K3). Free-form com sugestoes
   *  vindas de deal_loss_reasons. So preenche quando status='lost'. */
  loss_reason?: string | null;
  /** Quando loss_reason indica concorrente, capturar qual. */
  competitor?: string | null;
  /** Notas longas de aprendizado / post-mortem. */
  loss_note?: string | null;
}

// ============================================================================
// Deal Loss Reasons (PR-K3) — catalogo cadastravel por org
// ============================================================================

export interface DealLossReason {
  id: string;
  organization_id: string;
  label: string;
  /** Se true, UI abre input "Qual concorrente?" ao escolher. */
  requires_competitor: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// PR-K-CENTRIC (mai/2026): Lead-centric Kanban card.
//
// Tipo do card renderizado em cada coluna do board apos refactor.
// 1 lead = 1 card. expected_value e o valor R$ esperado (informativo,
// nao agregado de deals). deals embed e opcional pra UI mostrar
// "lead tem 3 negocios abertos" como badge.
export interface LeadKanbanCard {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  source: string;
  status: string;
  score: number;
  channel: string;
  pipeline_id: string | null;
  stage_id: string | null;
  sort_order: number;
  expected_value: number | null;
  assigned_to: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
  /** Tags via lead_tags(tags(...)) embed. */
  lead_tags?: LeadTagJoin[];
  /** Profile do responsavel via join profiles!leads_assigned_to_fkey. */
  assignee?: {
    id: string;
    full_name: string | null;
  } | null;
  /** Deals embed (pra contagem + soma de valores no card). */
  deals?: Array<{
    id: string;
    status: "open" | "won" | "lost";
    value: number | null;
  }>;
}

/** Deal com lead embed — usado na página principal do CRM (legado, será removido na Fase 5). */
export interface DealWithLead extends Deal {
  leads: {
    name: string;
    phone: string | null;
    email: string | null;
    /** ID do responsavel (auth.users.id) — opcional pra compat. */
    assigned_to?: string | null;
    lead_tags?: LeadTagJoin[];
    /**
     * Profile do responsavel via join `profiles!leads_assigned_to_fkey`.
     * Renderizado na linha "Responsavel" do card do Kanban.
     */
    assignee?: {
      id: string;
      full_name: string | null;
    } | null;
  } | null;
}

/** Stage com deals — view do Kanban. */
export interface StageWithDeals extends Stage {
  deals: Deal[];
}

/** Pipeline com stages — config view. */
export interface PipelineWithStages extends Pipeline {
  pipeline_stages: Stage[];
}

/** Pipeline com stages e deals — view final do Kanban. */
export interface PipelineWithStagesAndDeals extends Pipeline {
  pipeline_stages: StageWithDeals[];
}

/** Metas agregadas do funil (revenue + won deals count). */
export interface PipelineGoal {
  revenue: number;
  won: number;
}

// ============================================================================
// Segment
// ============================================================================

/** Uma condição individual de filtro (formato livre — campos variam por tipo). */
export type SegmentCondition = Record<string, unknown>;

/**
 * Regras de segmentação — armazenadas em JSONB no banco. Reflete o shape
 * usado pelo `ConditionBuilder` no CRM. Campos opcionais porque o registro
 * pode ter vindo de versões antigas sem `conditions[]`.
 */
export interface SegmentRules {
  operator?: "AND" | "OR";
  conditions?: SegmentCondition[];
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  rules: SegmentRules;
  lead_count: number;
  created_at: string;
}
