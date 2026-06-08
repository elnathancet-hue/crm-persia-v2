// AI Agent — handler `close_conversation`.
//
// Auditoria Automacoes (jun/2026): fecha a conversa atual (status='closed')
// sem encerrar o agente ou transferir pra humano. Lead continua ativo —
// um novo inbound cria uma nova conversa e o agente pode retomar.
//
// Diferença chave vs stop_agent:
//   stop_agent   → pausa o agent_conversation (is_active=false) + assign_to=null
//   close_conversation → muda conversations.status='closed'. Agente continua
//                        podendo rodar em conversas futuras.
//
// Use quando o fluxo termina naturalmente (lead agendou, comprou, recusou)
// mas o lead pode voltar e receber atendimento novo.

import type { NativeHandler } from "@persia/shared/ai-agent";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
  trimReason,
} from "./shared";

export const closeConversationHandler: NativeHandler = async (context, input) => {
  const reason = trimReason(input?.reason, "conversation_closed_by_agent");

  if (context.dry_run) {
    return successResult(
      {
        closed: false,
        simulated: true,
        reason,
      },
      ["would close current conversation (status='closed')"],
    );
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const { error } = await db
    .from("conversations")
    .update({ status: "closed" })
    .eq("id", context.crm_conversation_id)
    .eq("organization_id", context.organization_id);

  if (error) {
    return failureResult(`failed to close conversation: ${error.message}`);
  }

  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "conversation_closed",
    description: `Conversa encerrada pelo agente. Motivo: ${reason}`,
    metadata: {
      conversation_id: context.crm_conversation_id,
      agent_conversation_id: context.agent_conversation_id,
      run_id: context.run_id,
    },
  });

  return successResult(
    { closed: true, reason },
    ["closed current conversation (status='closed')", "added internal lead activity note"],
  );
};
