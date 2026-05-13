"use client";

// PR-V1a (movido de apps/crm/src/lib/realtime, parte do S2):
// hook de realtime pros deals (cards do Kanban).
//
// Uso: chamado no KanbanBoard. Quando outro agente da mesma org
// cria/move/atualiza/deleta deal num pipeline, callback dispara e
// o board refetcha (ou recompõe a coluna afetada).
//
// Estrategia: filtra por pipeline_id pra nao receber broadcast de
// outros funis. Ainda assim, RLS de deals (migration 001) bloqueia
// org cruzada — defesa em camada.
//
// Pegadinhas tratadas:
//   - cleanup via removeChannel
//   - debounce externo (caller decide se faz refetch imediato ou agrupa)
//
// DI: recebe supabase como param.

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DealRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  dealId: string;
  stageId?: string | null;
};

export function useDealsRealtime(
  supabase: SupabaseClient | null,
  pipelineId: string | null,
  onEvent: (e: DealRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!supabase || !pipelineId) return;

    const channel = supabase
      .channel(`deals-${pipelineId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: { id?: string; stage_id?: string | null } | null;
          old: { id?: string; stage_id?: string | null } | null;
        }) => {
          const row =
            payload.eventType === "DELETE" ? payload.old : payload.new;
          if (!row?.id) return;
          onEvent({
            type: payload.eventType,
            dealId: row.id,
            stageId: row.stage_id ?? null,
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
