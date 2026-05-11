"use client";

// PR-S2 (movido de apps/crm/src/lib/realtime): hook de realtime pros
// deals (Kanban) scoped por pipeline_id.
//
// DI: recebe `supabase` como param. Caller debouncea o onEvent
// se quiser agrupar bursts (drag-drop de bulk move).

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
