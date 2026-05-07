"use client";

// PR-O: hook de realtime pros comentarios do lead.
//
// Uso: chamado no LeadComentariosTab. Quando outro agente da mesma
// org cria/edita/deleta comentario nesse lead, o callback dispara
// e a tab refetcha (ou aplica delta).
//
// Pegadinhas tratadas:
//   - filter `lead_id=eq.${leadId}` no postgres_changes (servidor filtra,
//     economiza banda + evita receber comentario de outro lead).
//   - RLS de `lead_comments` (migration 037) garante que so org members
//     leem — mesmo se algum filter falhar, RLS bloqueia.
//   - cleanup obrigatorio via removeChannel (vaza WS sem isso).
//   - re-subscribe quando leadId muda (drawer abre outro lead sem
//     desmontar — improvavel hoje, mas resiliente).

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export type LeadCommentRealtimeEvent =
  | { type: "INSERT"; commentId: string }
  | { type: "UPDATE"; commentId: string }
  | { type: "DELETE"; commentId: string };

export function useLeadCommentsRealtime(
  leadId: string | null,
  onEvent: (e: LeadCommentRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!leadId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`lead-comments-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lead_comments",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: { id?: string } | null;
          old: { id?: string } | null;
        }) => {
          const commentId =
            payload.eventType === "DELETE"
              ? payload.old?.id
              : payload.new?.id;
          if (!commentId) return;
          onEvent({ type: payload.eventType, commentId });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);
}
