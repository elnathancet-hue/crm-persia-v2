"use client";

import { useCallback, useEffect, useState } from "react";
import { getConversationWindow, type ConversationWindow } from "@/actions/templates";

/**
 * Hook que retorna o estado da janela de 24h de uma conversa.
 *
 * Para UAZAPI: sempre `inWindow=true` (sem restricao).
 * Para Meta Cloud: derivado de `conversations.last_inbound_at`. Texto livre so
 * pode ser enviado se a ultima mensagem do lead tiver menos de 24h; fora disso,
 * a UI deve trocar o composer por um seletor de template.
 *
 * `refresh()` pode ser chamado apos uma mensagem inbound chegar (ex: via realtime).
 */
export function useConversationWindow(conversationId: string | null) {
  const [state, setState] = useState<ConversationWindow | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setState(null);
      return;
    }
    setLoading(true);
    try {
      const data = await getConversationWindow(conversationId);
      setState(data);
    } catch (err) {
      console.error("[useConversationWindow] error:", err instanceof Error ? err.message : String(err));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    window: state,
    loading,
    refresh,
    // derived: conveniencias
    inWindow: state?.inWindow ?? true,
    isMeta: state?.provider === "meta_cloud",
    hoursLeft: state?.hoursLeft ?? 24,
  };
}
