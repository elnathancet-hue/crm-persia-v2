"use client";

// PR-Q: hook global pra disparar toast quando um lead e atribuido AO
// user logado (transicao assigned_to -> currentUser).
//
// Por que precisa? Atribuicao e o gatilho mais critico do CRM — agente
// recebe lead novo, precisa agir. Sem notificacao, vira tempo perdido
// olhando lista pra ver "ja foi pra mim?".
//
// Por que toast (e nao notification center)? V1 minimo. Notification
// center vira PR proprio depois.
//
// Pegadinhas tratadas:
//   - Sem cap por lead (atribuicao e rara — perder toast por cap e
//     pior que toast duplicado). Mas SIM cap por sessao de browser
//     (sem persistencia: se F5, pode toast 2x — aceitavel).
//   - Skip self-assign: se voce atribuiu lead a voce mesmo, nao toast
//     (compara modifier? nao tem essa info no payload — pulamos via
//     `old.assigned_to !== new.assigned_to`. Se voce moveu de outro
//     pra voce, recebe toast — aceitavel)
//   - Skip "ainda voce": old.assigned_to === currentUser && new === currentUser
//   - Toast e simples: "Voce recebeu um novo lead: João Silva"
//   - Mute global respeitado

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useIsToastMuted } from "./use-toast-prefs";

export interface UseAssignmentToastOptions {
  orgId: string | null;
  currentUserId: string | null;
}

type LeadRowPartial = {
  id?: string;
  name?: string | null;
  assigned_to?: string | null;
};

export function useAssignmentToast({
  orgId,
  currentUserId,
}: UseAssignmentToastOptions) {
  const router = useRouter();
  const muted = useIsToastMuted();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Set de lead ids ja notificados nesta sessao (anti-dup intra-sessao).
  // Sem persistencia: F5 reset. Aceitavel — assignment toast e raro.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!orgId || !currentUserId) return;
    const supabase = createClient();
    const seen = seenRef.current;

    const channel = supabase
      .channel(`leads-assignment-toast-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload: {
          new: LeadRowPartial | null;
          old: LeadRowPartial | null;
        }) => {
          const newRow = payload.new;
          const oldRow = payload.old;
          if (!newRow?.id) return;

          // Respeita mute
          if (mutedRef.current) return;

          // Detecta transicao PRA voce
          const wasAssigned = oldRow?.assigned_to ?? null;
          const isAssigned = newRow.assigned_to ?? null;
          if (isAssigned !== currentUserId) return; // nao e voce
          if (wasAssigned === currentUserId) return; // ja era voce
          if (!newRow.id) return;

          // Anti-dup intra-sessao
          if (seen.has(newRow.id)) return;
          seen.add(newRow.id);

          const leadName = newRow.name?.trim() || "novo lead";

          toast.success(`Você recebeu um novo lead: ${leadName}`, {
            description: "Clique em \"Ver\" para abrir o card.",
            action: {
              label: "Ver",
              onClick: () => {
                router.push(
                  `/crm?tab=leads&leadId=${encodeURIComponent(newRow.id!)}`,
                );
              },
            },
            duration: 8000,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      seen.clear();
    };
  }, [orgId, currentUserId, router]);
}
