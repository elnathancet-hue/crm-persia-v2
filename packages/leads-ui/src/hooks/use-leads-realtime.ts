"use client";

// PR-V1a (movido de apps/crm/src/lib/realtime, parte do S2):
// hook de realtime pros leads (LeadsList).
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
//
// DI: recebe supabase como param (cada app passa seu client com auth
// adequada — CRM usa createClient(), admin usa getSupabaseBrowserClient()).

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  leadId: string;
};

export function useLeadsRealtime(
  supabase: SupabaseClient | null,
  orgId: string | null,
  onEvent: (e: LeadRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!supabase || !orgId) return;

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
  }, [supabase, orgId]);
}
