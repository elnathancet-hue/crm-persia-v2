import "server-only";

import { type AgentDb, nowIso } from "./db";

// PR1 #4 (mai/2026): helper unificado pra pausar o agente em uma
// agent_conversation. Antes desta sessao o UPDATE em human_handoff_at
// vivia inline em 2 lugares (`stop_agent` tool + futuro `transfer_to_user`).
//
// Centralizar serve a 2 objetivos:
//   1. Garantir que sempre que um humano "assume" o atendimento (via
//      stop_agent, transfer_to_user, ou flows futuros), o agente trava
//      atomicamente — sem janela onde a IA continua respondendo enquanto
//      o humano tambem responde.
//   2. Padronizar shape (human_handoff_at, human_handoff_reason,
//      updated_at) num unico lugar pra futuras colunas (ex: paused_by_user_id).
//
// O helper NAO escreve em lead_activities — auditoria fica a cargo do
// caller, que sabe se foi handoff explicito (stop_agent) ou indireto
// (transfer_to_user marca como `assigned` + pausa silenciosa).

export interface PauseAgentParams {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
  reason: string;
}

export interface PauseAgentResult {
  paused: boolean;
  error: string | null;
}

export async function pauseAgent(params: PauseAgentParams): Promise<PauseAgentResult> {
  const { db, orgId, agentConversationId, reason } = params;
  const now = nowIso();
  const { error } = await db
    .from("agent_conversations")
    .update({
      human_handoff_at: now,
      human_handoff_reason: reason,
      updated_at: now,
    })
    .eq("id", agentConversationId)
    .eq("organization_id", orgId);

  return {
    paused: !error,
    error: error?.message ?? null,
  };
}
