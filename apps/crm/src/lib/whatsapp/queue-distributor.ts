// Motor de distribuição de conversas por fila.
// Chamado pelo incoming-pipeline após criar uma conversa nova.
// MVP: uma fila ativa por org (a mais antiga com is_active=true).
// Múltiplas filas com roteamento por tipo de lead = Phase 2.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DistributionResult {
  agentId: string | null;
  queueId: string | null;
  setLeadOwner: boolean;
}

export async function distributeToQueue(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
): Promise<DistributionResult> {
  // 1. Busca a fila ativa mais antiga da org
  const { data: queue } = await supabase
    .from("queues")
    .select("id, set_lead_owner")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!queue) return { agentId: null, queueId: null, setLeadOwner: false };

  // 2. Chama a função DB para escolher o agente com menos conversas ativas
  const { data: agentId } = await supabase.rpc("pick_agent_from_queue", {
    p_org_id: orgId,
    p_queue_id: queue.id,
  });

  if (!agentId) return { agentId: null, queueId: queue.id, setLeadOwner: false };

  // 3. Registra no log de distribuição para balanceamento futuro
  await supabase.from("queue_distribution_log").insert({
    organization_id: orgId,
    queue_id: queue.id,
    assigned_to: agentId,
    lead_id: leadId,
  });

  return {
    agentId,
    queueId: queue.id,
    setLeadOwner: queue.set_lead_owner ?? true,
  };
}
