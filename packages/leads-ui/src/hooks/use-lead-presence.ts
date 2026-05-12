"use client";

// PR-U2 (movido de apps/crm/src/lib/realtime, subsume parte do PR-S2):
// hook combinado de presence + comments num lead. 1 canal
// `lead-${leadId}` so.
//
// DI: recebe supabase como param. Cleanup ordem: untrack ->
// removeChannel pra evitar ghost de 30s.

import { useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";

export type PresenceUser = {
  user_id: string;
  full_name: string;
};

export type LeadCommentRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  commentId: string;
};

export interface UseLeadPresenceOptions {
  supabase: SupabaseClient | null;
  leadId: string | null;
  currentUser: PresenceUser | null;
  onCommentEvent?: (e: LeadCommentRealtimeEvent) => void;
}

export interface UseLeadPresenceResult {
  watchers: PresenceUser[];
  othersCount: number;
}

export function useLeadPresence({
  supabase,
  leadId,
  currentUser,
  onCommentEvent,
}: UseLeadPresenceOptions): UseLeadPresenceResult {
  const [watchers, setWatchers] = useState<PresenceUser[]>([]);
  const onCommentEventRef = useRef(onCommentEvent);
  useEffect(() => {
    onCommentEventRef.current = onCommentEvent;
  }, [onCommentEvent]);

  useEffect(() => {
    if (!supabase || !leadId || !currentUser) {
      setWatchers([]);
      return;
    }
    const channel: RealtimeChannel = supabase.channel(`lead-${leadId}`, {
      config: {
        presence: { key: currentUser.user_id },
      },
    });

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

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceUser>();
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

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          user_id: currentUser.user_id,
          full_name: currentUser.full_name,
        });
      }
    });

    return () => {
      void channel.untrack().finally(() => {
        supabase.removeChannel(channel);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, leadId, currentUser?.user_id, currentUser?.full_name]);

  const othersCount = currentUser
    ? watchers.filter((w) => w.user_id !== currentUser.user_id).length
    : watchers.length;

  return { watchers, othersCount };
}
