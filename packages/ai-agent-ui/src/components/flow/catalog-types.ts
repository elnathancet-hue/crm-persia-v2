// AI Agent — tipos compartilhados dos catálogos do FlowCanvas.
//
// PR-FLOW-PIVOT PR 4 (mai/2026): a server action `getFlowCatalogs`
// (implementada em apps/crm + apps/admin) retorna esses shapes.
// Centralizado aqui pra que UI + ambos apps consumam de 1 lugar
// sem cross-import.

export interface FlowCatalogTag {
  id: string;
  name: string;
  color: string | null;
}

export interface FlowCatalogPipelineStage {
  id: string;
  name: string;
  pipeline_id: string;
  /** Nome do pipeline pai. Vazio em V1 — UI usa só `name` da stage. */
  pipeline_name: string;
}

export interface FlowCatalogNotificationTemplate {
  id: string;
  name: string;
}

export interface FlowCatalogAgendaService {
  id: string;
  name: string;
  slug: string;
  duration_minutes: number;
}

export interface FlowCatalogMember {
  user_id: string;
  name: string;
  email: string | null;
}

export interface FlowCatalogAgent {
  id: string;
  name: string;
}

export interface FlowCatalogSegment {
  id: string;
  name: string;
}

export interface FlowCatalogCustomField {
  id: string;
  name: string;
  field_key: string;
  field_type: string;
}

/**
 * mai/2026: itens da Biblioteca de midia (automation_tools). Action
 * "Enviar midia" usa pra cliente escolher o arquivo da lista em vez
 * de digitar slug livre. Bug observado em prod: cliente colava a URL
 * completa da API no campo slug — runtime nao encontrava + midia nao
 * era enviada. Picker resolve.
 *
 * Inclui campos pra UI mostrar nome amigavel + indicio do tipo:
 *   - slug: identificador real usado no runtime (campo persistido)
 *   - name: rotulo visivel
 *   - file_type: mime type (UI infere icone)
 *   - category: "imagem" | "video" | "documento" | "outro"
 */
export interface FlowCatalogMedia {
  id: string;
  slug: string;
  name: string;
  file_type: string;
  category: string;
}

export interface FlowCatalogs {
  tags: FlowCatalogTag[];
  pipeline_stages: FlowCatalogPipelineStage[];
  notification_templates: FlowCatalogNotificationTemplate[];
  agenda_services: FlowCatalogAgendaService[];
  members: FlowCatalogMember[];
  other_agents: FlowCatalogAgent[];
  /** PR-FLOW-PIVOT PR 5 (mai/2026): pra usar no condition node
   * "Verificar segmentação". Cliente seleciona segmento existente
   * em vez de digitar UUID. */
  segments: FlowCatalogSegment[];
  /** PR-FLOW-PIVOT PR 8 (mai/2026): custom fields da org. Action
   * node "Salvar dado do lead" + condition "Verificar campo
   * personalizado" usam pra picker. */
  custom_fields: FlowCatalogCustomField[];
  /** mai/2026: Biblioteca de midia (automation_tools). Action node
   * "Enviar midia" usa pra picker em vez de Input livre. */
  media_library: FlowCatalogMedia[];
}

export const EMPTY_FLOW_CATALOGS: FlowCatalogs = {
  tags: [],
  pipeline_stages: [],
  notification_templates: [],
  agenda_services: [],
  members: [],
  other_agents: [],
  segments: [],
  custom_fields: [],
  media_library: [],
};
