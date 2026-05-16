"use client";

// Realtime pros LEADS do Kanban (PR-K-CENTRIC mai/2026).
//
// Por que existe (separado de useLeadsRealtime):
//   - useLeadsRealtime escuta TODOS os leads da org — usado pelo
//     LeadsList (tab Leads renderiza leads org-wide).
//   - Kanban so precisa reagir a mudancas no PIPELINE ativo. Filtrar
//     por pipeline_id reduz drasticamente o volume de eventos em
//     orgs grandes (10k+ leads).
//   - Espelha o pattern de useDealsRealtime que ja filtra por
//     pipeline_id desde o S2.
//
// Por que e necessario:
//   - Pre PR-K-CENTRIC, Kanban renderizava deals → useDealsRealtime
//     pegava todas as mudancas (drag-drop atualizava deals.stage_id).
//   - Pos PR-K-CENTRIC, Kanban renderiza leads → drag-drop / AI Agent
//     / /api/crm atualizam leads.stage_id, NAO deals. Sem este hook,
//     outro agente da org so vê o card mover apos refresh manual.
//
// Pegadinhas tratadas:
//   - cleanup via removeChannel
//   - re-subscribe quando pipelineId muda (troca de funil)
//   - filter no canal (RLS de leads + filtro = defesa em camada)

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type KanbanLeadRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  leadId: string;
  stageId?: string | null;
  pipelineId?: string | null;
};

export function useKanbanLeadsRealtime(
  supabase: SupabaseClient | null,
  pipelineId: string | null,
  onEvent: (e: KanbanLeadRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!supabase || !pipelineId) return;

    const channel = supabase
      .channel(`kanban-leads-${pipelineId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: {
            id?: string;
            stage_id?: string | null;
            pipeline_id?: string | null;
          } | null;
          old: {
            id?: string;
            stage_id?: string | null;
            pipeline_id?: string | null;
          } | null;
        }) => {
          const row =
            payload.eventType === "DELETE" ? payload.old : payload.new;
          if (!row?.id) return;
          onEvent({
            type: payload.eventType,
            leadId: row.id,
            stageId: row.stage_id ?? null,
            pipelineId: row.pipeline_id ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, pipelineId]);
}
