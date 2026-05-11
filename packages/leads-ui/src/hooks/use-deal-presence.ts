"use client";

// PR-S2 (movido de apps/crm/src/lib/realtime): presence-only por
// pipeline pra mostrar quem ta vendo qual deal no Kanban.
//
// DI: recebe supabase como param.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";

export interface DealPresenceUser {
  user_id: string;
  full_name: string;
  viewing_deal_id: string | null;
}

export interface UseDealPresenceOptions {
  supabase: SupabaseClient | null;
  pipelineId: string | null;
  currentUser: { user_id: string; full_name: string } | null;
}

export interface UseDealPresenceResult {
  watchersByDeal: Map<string, DealPresenceUser[]>;
  setViewingDealId: (dealId: string | null) => void;
}

export function useDealPresence({
  supabase,
  pipelineId,
  currentUser,
}: UseDealPresenceOptions): UseDealPresenceResult {
  const [watchersByDeal, setWatchersByDeal] = useState<
    Map<string, DealPresenceUser[]>
  >(new Map());

  const channelRef = useRef<RealtimeChannel | null>(null);
  const viewingRef = useRef<string | null>(null);

  const setViewingDealId = useCallback(
    (dealId: string | null) => {
      viewingRef.current = dealId;
      const channel = channelRef.current;
      const user = currentUser;
      if (!channel || !user) return;
      void channel.track({
        user_id: user.user_id,
        full_name: user.full_name,
        viewing_deal_id: dealId,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [currentUser?.user_id, currentUser?.full_name],
  );

  useEffect(() => {
    if (!supabase || !pipelineId || !currentUser) {
      setWatchersByDeal(new Map());
      channelRef.current = null;
      return;
    }
    const channel = supabase.channel(`pipeline-presence-${pipelineId}`, {
      config: { presence: { key: currentUser.user_id } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<DealPresenceUser>();
      const next = new Map<string, DealPresenceUser[]>();
      for (const key of Object.keys(state)) {
        if (key === currentUser.user_id) continue;
        const entries = state[key];
        if (!entries || entries.length === 0) continue;
        const first = entries[0];
        if (!first.viewing_deal_id) continue;
        const arr = next.get(first.viewing_deal_id) ?? [];
        arr.push({
          user_id: first.user_id,
          full_name: first.full_name,
          viewing_deal_id: first.viewing_deal_id,
        });
        next.set(first.viewing_deal_id, arr);
      }
      setWatchersByDeal(next);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          user_id: currentUser.user_id,
          full_name: currentUser.full_name,
          viewing_deal_id: viewingRef.current,
        });
      }
    });

    return () => {
      void channel.untrack().finally(() => {
        supabase.removeChannel(channel);
      });
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, pipelineId, currentUser?.user_id, currentUser?.full_name]);

  return { watchersByDeal, setViewingDealId };
}
