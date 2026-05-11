"use client";

// PR-S2 (movido de apps/crm/src/lib/realtime): toast quando lead e
// atribuido AO user logado (transicao assigned_to -> currentUser).
//
// DI: recebe supabase + onNavigate como params.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useIsToastMuted } from "./use-toast-prefs";

export interface UseAssignmentToastOptions {
  supabase: SupabaseClient | null;
  orgId: string | null;
  currentUserId: string | null;
  onNavigate: (leadId: string) => void;
}

type LeadRowPartial = {
  id?: string;
  name?: string | null;
  assigned_to?: string | null;
};

export function useAssignmentToast({
  supabase,
  orgId,
  currentUserId,
  onNavigate,
}: UseAssignmentToastOptions) {
  const muted = useIsToastMuted();
  const mutedRef = useRef(muted);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase || !orgId || !currentUserId) return;
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

          if (mutedRef.current) return;

          const wasAssigned = oldRow?.assigned_to ?? null;
          const isAssigned = newRow.assigned_to ?? null;
          if (isAssigned !== currentUserId) return;
          if (wasAssigned === currentUserId) return;
          if (!newRow.id) return;

          if (seen.has(newRow.id)) return;
          seen.add(newRow.id);

          const leadName = newRow.name?.trim() || "novo lead";

          toast.success(`Você recebeu um novo lead: ${leadName}`, {
            description: 'Clique em "Ver" para abrir o card.',
            action: {
              label: "Ver",
              onClick: () => onNavigateRef.current(newRow.id!),
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
  }, [supabase, orgId, currentUserId]);
}
