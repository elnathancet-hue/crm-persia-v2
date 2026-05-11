"use client";

// PR-S2 (movido de apps/crm/src/lib/realtime): hook de realtime pros
// leads scoped por organization_id.
//
// DI: recebe `supabase` como param em vez de chamar createClient()
// interno. Cada app injeta seu proprio client (CRM: createBrowserClient
// com cookies; admin: getRealtimeClient com ANON_KEY).
//
// Pegadinhas tratadas: cleanup via removeChannel, re-subscribe quando
// orgId muda.

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
