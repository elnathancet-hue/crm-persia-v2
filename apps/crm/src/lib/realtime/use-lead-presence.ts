"use client";

// PR-P: hook combinado pra presence + comments num lead.
//
// Substitui o use-lead-comments-realtime: consolidamos em UM unico
// canal `lead-${leadId}` que carrega 2 coisas:
//   1. Presence — quem esta vendo o lead agora (track/sync/leave)
//   2. postgres_changes em lead_comments filtrado por lead_id
//
// Por que combinar? Cada canal Supabase = 1 WebSocket. Limitar
// canais por user e critico pra escalar (free tier 200, pro 500).
// Mesmo lead, mesmo escopo — 1 canal so.
//
// Pegadinhas tratadas:
//   - dedupe por user_id no presence (multi-tab do mesmo user)
//   - cleanup obrigatorio: untrack() antes de removeChannel
//   - ghost users: aceito v1 (Supabase derruba apos ~30s sem heartbeat)
//   - rejoin storm: render de presence sai de 'sync' (ja agregado pelo SDK)

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type PresenceUser = {
  user_id: string;
  full_name: string;
};

export type LeadCommentRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  commentId: string;
};

export interface UseLeadPresenceOptions {
  leadId: string | null;
  /** Identificacao do user logado pra track/exibir */
  currentUser: PresenceUser | null;
  /** Callback pra eventos de comentario (INSERT/UPDATE/DELETE) */
  onCommentEvent?: (e: LeadCommentRealtimeEvent) => void;
}

export interface UseLeadPresenceResult {
  /** Lista de users vendo o lead, dedupada por user_id */
  watchers: PresenceUser[];
  /** Numero de users distintos (excluindo o proprio) */
  othersCount: number;
}

export function useLeadPresence({
  leadId,
  currentUser,
  onCommentEvent,
}: UseLeadPresenceOptions): UseLeadPresenceResult {
  const [watchers, setWatchers] = useState<PresenceUser[]>([]);
  // useRef pra callback estavel — evita reconectar canal a cada render
  const onCommentEventRef = useRef(onCommentEvent);
  useEffect(() => {
    onCommentEventRef.current = onCommentEvent;
  }, [onCommentEvent]);

  useEffect(() => {
    if (!leadId || !currentUser) {
      setWatchers([]);
      return;
    }
    const supabase = createClient();
    const channel: RealtimeChannel = supabase.channel(`lead-${leadId}`, {
      config: {
        // presence.key: dedupe interna do Supabase. user_id como key
        // garante que multi-tab do mesmo user conta como 1 presenca
        // (ou pelo menos agrega no .presenceState()[user_id]).
        presence: { key: currentUser.user_id },
      },
    });

    // 1. Comments — postgres_changes filtrado por lead_id
    channel.on(
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
        onCommentEventRef.current?.({
          type: payload.eventType,
          commentId,
        });
      },
    );

    // 2. Presence — sync agregado dispara em joins/leaves/initial
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceUser>();
      // state e Record<key, PresenceUser[]>; cada key e um user_id (multi-tab
      // do mesmo user vira array com N entradas iguais). Pegamos a primeira
      // de cada bucket pra dedupar.
      const distinct: PresenceUser[] = [];
      for (const key of Object.keys(state)) {
        const entries = state[key];
        if (entries && entries.length > 0) {
          const first = entries[0];
          distinct.push({
            user_id: first.user_id,
            full_name: first.full_name,
          });
        }
      }
      setWatchers(distinct);
    });

    // 3. Subscribe + track presenca apos confirmacao
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        // track payload e o que aparece no presenceState
        await channel.track({
          user_id: currentUser.user_id,
          full_name: currentUser.full_name,
        });
      }
    });

    return () => {
      // Cleanup ordem importa: untrack primeiro, depois removeChannel.
      // Sem untrack, o servidor leva ~30s pra dropar a presenca por
      // heartbeat — aparece como "ghost" pros outros agentes.
      void channel.untrack().finally(() => {
        supabase.removeChannel(channel);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, currentUser?.user_id, currentUser?.full_name]);

  // othersCount — exclui o proprio user. Util pra "Voce + 2 outros vendo".
  const othersCount = currentUser
    ? watchers.filter((w) => w.user_id !== currentUser.user_id).length
    : watchers.length;

  return { watchers, othersCount };
}
