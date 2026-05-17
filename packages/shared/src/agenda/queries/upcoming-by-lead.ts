// Queries de "próximos agendamentos por lead" — usado pelo Kanban
// pra destacar visualmente leads que tem appointment proximo.
//
// PR-KANBAN-UPCOMING (mai/2026): auditoria identificou que Kanban
// nao mostrava sinal visual de "esse lead tem agendamento amanha"
// — agente abria card pra descobrir. Agora um chip "Em 2h" /
// "Amanha 14:00" aparece direto no card.

import type { AgendaQueryContext } from "./context";

export interface LeadUpcomingAppointment {
  lead_id: string;
  appointment_id: string;
  /** ISO. UI calcula relativo (Em Xh / Amanha HH:MM / DD/MM HH:MM). */
  start_at: string;
  title: string;
  /** Mantido pra UI saber se mostrar "aguardando confirmacao" diferente. */
  status: string;
}

/**
 * Busca o PRÓXIMO appointment de cada lead na lista, dentro de uma
 * janela `windowHours` a partir de agora. So conta:
 *   - kind = 'appointment' (event/block nao tem lead vinculado relevante)
 *   - status IN (confirmed, awaiting_confirmation)
 *   - start_at >= now
 *   - start_at < now + windowHours
 *   - deleted_at IS NULL
 *
 * Retorna UM appointment por lead (o mais proximo). Dedupe em JS
 * porque o set de leadIds e pequeno (max 1 pipeline = ~200 leads
 * visiveis) e Postgres `DISTINCT ON` requer order explicit que
 * limita filtros futuros.
 *
 * Empty leadIds -> []. Tolerante a leadIds vazio.
 */
export async function findUpcomingAppointmentsByLeads(
  ctx: AgendaQueryContext,
  leadIds: readonly string[],
  windowHours: number,
): Promise<LeadUpcomingAppointment[]> {
  if (leadIds.length === 0) return [];

  const { db, orgId } = ctx;
  const now = new Date();
  const max = new Date(now.getTime() + windowHours * 3600 * 1000);

  const { data, error } = await db
    .from("appointments")
    .select("id, lead_id, start_at, title, status")
    .eq("organization_id", orgId)
    .eq("kind", "appointment")
    .is("deleted_at", null)
    .in("status", ["confirmed", "awaiting_confirmation"])
    .in("lead_id", leadIds as string[])
    .gte("start_at", now.toISOString())
    .lt("start_at", max.toISOString())
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`findUpcomingAppointmentsByLeads: ${error.message}`);
  }

  // Dedupe: mantem o primeiro (mais proximo) por lead_id. `data` ja
  // vem ordenado por start_at ASC, entao o primeiro de cada lead e
  // o mais proximo.
  const seen = new Set<string>();
  const result: LeadUpcomingAppointment[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    lead_id: string | null;
    start_at: string;
    title: string;
    status: string;
  }>) {
    if (!row.lead_id || seen.has(row.lead_id)) continue;
    seen.add(row.lead_id);
    result.push({
      lead_id: row.lead_id,
      appointment_id: row.id,
      start_at: row.start_at,
      title: row.title,
      status: row.status,
    });
  }
  return result;
}
