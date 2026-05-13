"use client";

// PR-V1a (movido de apps/crm/src/lib/realtime, parte do S2):
// presence-only por pipeline pra mostrar quem ta vendo qual deal
// no Kanban. NAO combinado com deals-realtime — keep concerns
// separados (presence muda muito mais que postgres_changes).
//
// 1 canal por pipeline aberto = aceitavel: o user ve um pipeline por vez,
// e ao trocar de pipeline o canal antigo e descartado.
//
// Modelo: cada user faz track() com { user_id, full_name, viewing_deal_id }.
// Quando abre detalhe de um deal -> setViewingDealId(dealId) que chama
// channel.track() de novo (re-broadcasts). Quando fecha -> null.
//
// Retorno: Map<dealId, watchers[]> filtrado (excluindo o proprio user
// + so dealIds nao-null). O caller (Kanban) consome pra renderizar
// dots/avatares por card.
//
// Pegadinhas tratadas:
//   - Multi-tab dedupe via presence.key = user_id
//   - Untrack antes de removeChannel (sem ghost de 30s)
//   - setViewingDealId tem callback estavel (mesma ref) — evita
//     re-mount do canal quando o caller atualiza prop
//
// DI: recebe supabase como param.

import { useEffect, useRef, useState, useCallback } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

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
  /** Map<dealId, list of users vendo este deal (excluindo currentUser)>. */
  watchersByDeal: Map<string, DealPresenceUser[]>;
  /** Define qual deal o user logado esta vendo (re-broadcasts via track). */
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

  // Ref pro canal pra setViewingDealId chamar .track() sem re-mount
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Ref pro deal sendo visto pelo PROPRIO user, sobrevive entre eventos
  const viewingRef = useRef<string | null>(null);

  // Callback estavel — caller pode passar pro Drawer sem causar re-mount
  const setViewingDealId = useCallback((dealId: string | null) => {
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
  }, [currentUser?.user_id, currentUser?.full_name]);

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
      const state =
        channel.presenceState<DealPresenceUser>();
      // state: Record<user_id, DealPresenceUser[]>. Dedupe multi-tab
      // pegando a primeira entrada por bucket. Excluir proprio user.
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
