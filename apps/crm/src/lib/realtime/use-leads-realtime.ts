"use client";

// PR-O: hook de realtime pros leads (LeadsList).
//
// Uso: chamado no provider do LeadsList. Quando outro agente da
// mesma org cria/edita/deleta lead, callback dispara e a lista
// refetcha.
//
// Estrategia: filtra por organization_id. RLS de leads (migration 001)
// e camada extra — mesmo se filter falhar, broadcast cross-org nunca
// vaza pra cliente sem JWT do org.
//
// Pegadinhas tratadas:
//   - cleanup via removeChannel
//   - re-subscribe quando orgId muda

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export type LeadRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  leadId: string;
};

export function useLeadsRealtime(
  orgId: string | null,
  onEvent: (e: LeadRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`leads-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: { id?: string } | null;
          old: { id?: string } | null;
        }) => {
          const row =
            payload.eventType === "DELETE" ? payload.old : payload.new;
          if (!row?.id) return;
          onEvent({ type: payload.eventType, leadId: row.id });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
}
