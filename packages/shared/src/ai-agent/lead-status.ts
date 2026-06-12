// AI Agent — visibilidade reversa pro LeadDrawer (PR 5/6 da serie
// "Costurar integracoes CRM/Agenda/Agente", mai/2026).
//
// Quando operador humano abre um lead no CRM, ele precisa ver o que
// a IA esta fazendo nessa conversa:
//   - Qual agente esta respondendo (config_name)
//   - Esta pausado? (human_handoff_at != null)
//   - Quando foi a ultima execucao
//   - Lista de runs recentes
//   - Trilha de lead_activities filtrada por source=ai_agent
//
// Plus: operador pode pausar/reativar o agente manualmente sem
// digitar PAUSAR/ATIVAR no WhatsApp.

export interface LeadAgentStatus {
  /** ID da agent_conversations row pra usar em pause/resume. */
  agent_conversation_id: string;
  /** ID do agente respondendo. */
  config_id: string;
  /** Nome user-friendly do agente. */
  config_name: string;
  /** ISO timestamp quando o handoff foi setado. null = ativo. */
  paused_at: string | null;
  /** ISO timestamp da ultima msg processada. */
  last_interaction_at: string | null;
  /** ID da conversa CRM (pra deeplink no chat). */
  crm_conversation_id: string;
}

// Subset de AgentRun pra render compacto no LeadDrawer. Evita puxar
// steps (cada AgentRunWithSteps tem N steps que nao precisamos aqui).
export interface AgentRunSummary {
  id: string;
  status: "succeeded" | "failed" | "fallback" | "running" | "pending" | "canceled";
  model: string;
  duration_ms: number;
  created_at: string;
  error_msg: string | null;
}

// Subset de lead_activities filtrado por source=ai_agent. Description
// vem em PT pronto (preenchido pelos handlers nos commits anteriores
// — add_tag, move_pipeline_stage, create_appointment, send_media,
// stop_agent).
export interface LeadAgentActivitySummary {
  id: string;
  type: string;
  description: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

// PR-AGENT-INTEGRATION-6 (mai/2026): subset compacto pra badge no
// Kanban card. Sem nada alem do necessario pra render rapido + tooltip.
export interface KanbanAgentSummary {
  lead_id: string;
  agent_conversation_id: string;
  config_id: string;
  config_name: string;
  paused: boolean;
}
