"use client";

// PR-P: hook global pra disparar toast quando outro agente comenta
// num lead onde o user logado e o responsavel.
//
// Por que scoped (assigned_to)? Toast global pra TODA org cria spam:
// 100 leads x 5 comentarios/dia = 500 toasts. User mute. Perde sinal.
// Scoped = so leads que o user atende. Sinal alto, ruido baixo.
//
// Pegadinhas tratadas:
//   - Skip se autor = user logado (nao toast por proprio comentario)
//   - Cap 60s por lead (Map<leadId, lastToastAt>) — varias mensagens
//     em sequencia geram 1 toast so. Reset proativo na unmount.
//   - Toast NAO mostra texto do comentario (privacy: PII em popup)
//   - Click do toast vai pra /crm?tab=leads&leadId=... (abre drawer)
//   - Se rede oscilar, perde event — aceito v1 (proximo F5 mostra)
//
// Custo de rede: 1 query SELECT por evento que passou no cap. Cap 60s
// por lead garante <60 queries/min mesmo em burst.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useIsToastMuted } from "./use-toast-prefs";

const TOAST_CAP_MS = 60_000; // 1 toast por lead a cada 60s

export interface UseCommentToastOptions {
  /** organization_id do user logado — filtra broadcast no servidor */
  orgId: string | null;
  /** user_id do user logado — pra skip de eco + scope assigned_to */
  currentUserId: string | null;
}

export function useCommentToast({
  orgId,
  currentUserId,
}: UseCommentToastOptions) {
  const router = useRouter();
  const muted = useIsToastMuted();
  // capRef sobrevive entre eventos sem re-render.
  const capRef = useRef<Map<string, number>>(new Map());
  // mutedRef: leitura no momento do evento (sem reconectar canal a
  // cada toggle de mute). Re-render do hook por causa do muted state
  // nao recria o useEffect (deps nao incluem muted).
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!orgId || !currentUserId) return;
    const supabase = createClient();
    const cap = capRef.current;

    const channel = supabase
      .channel(`lead-comments-toast-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_comments",
          filter: `organization_id=eq.${orgId}`,
        },
        async (payload: {
          new: {
            id?: string;
            lead_id?: string;
            author_id?: string;
            organization_id?: string;
          } | null;
        }) => {
          const row = payload.new;
          if (!row?.lead_id || !row.author_id) return;

          // PR-Q: respeita mute global do user (toggle no header).
          if (mutedRef.current) return;

          // Skip eco do proprio user
          if (row.author_id === currentUserId) return;

          // Cap por lead (60s)
          const now = Date.now();
          const lastAt = cap.get(row.lead_id) ?? 0;
          if (now - lastAt < TOAST_CAP_MS) return;

          // Fetch lead + author. RLS de leads + profiles (PR-L1)
          // garante mesma org. Se RLS bloquear, fica null e abortamos.
          // Cast soft: Database type ainda nao tem assigned_to (migration
          // 033 — pendente regen) mas a coluna existe em prod.
          type LooseSupabase = {
            from: (table: string) => {
              select: (cols: string) => {
                eq: (
                  col: string,
                  val: string,
                ) => { maybeSingle: () => Promise<{ data: unknown }> };
              };
            };
          };
          const looseDb = supabase as unknown as LooseSupabase;

          const [leadRes, authorRes] = await Promise.all([
            looseDb
              .from("leads")
              .select("id, name, assigned_to")
              .eq("id", row.lead_id)
              .maybeSingle(),
            looseDb
              .from("profiles")
              .select("full_name")
              .eq("id", row.author_id)
              .maybeSingle(),
          ]);

          const lead = leadRes.data as
            | { id: string; name: string | null; assigned_to: string | null }
            | null;
          const author = authorRes.data as
            | { full_name: string | null }
            | null;

          if (!lead) return;

          // Scope: so dispara toast pra leads atribuidos ao user logado.
          // Sem isso vira spam global. Adiar "ja comentou antes" pra v2
          // (exigiria 1 query extra por evento).
          if (lead.assigned_to !== currentUserId) return;

          cap.set(row.lead_id, now);

          const authorName =
            (author?.full_name as string | null | undefined)?.trim() ||
            "Alguém";
          const leadName = lead.name?.trim() || "lead";

          toast.info(`${authorName} comentou em ${leadName}`, {
            description: "Clique para ver o comentário",
            action: {
              label: "Ver",
              onClick: () => {
                router.push(
                  `/crm?tab=leads&leadId=${encodeURIComponent(lead.id)}`,
                );
              },
            },
            duration: 6000,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      // Limpa cap pra liberar memoria (cap volta no proximo mount).
      cap.clear();
    };
  }, [orgId, currentUserId, router]);
}
