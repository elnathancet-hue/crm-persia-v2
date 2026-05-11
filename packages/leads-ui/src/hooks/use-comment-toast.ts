"use client";

// PR-S2 (movido de apps/crm/src/lib/realtime): toast global quando
// outro agente comenta num lead onde o user logado e o responsavel.
//
// DI: recebe supabase + onNavigate como params. CRM passa
// router.push; admin idem (mesma router do Next.js). Mute global
// respeitado via useIsToastMuted.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useIsToastMuted } from "./use-toast-prefs";

const TOAST_CAP_MS = 60_000;

export interface UseCommentToastOptions {
  supabase: SupabaseClient | null;
  orgId: string | null;
  currentUserId: string | null;
  /** Callback de navegacao quando user clica "Ver" no toast. */
  onNavigate: (leadId: string) => void;
}

export function useCommentToast({
  supabase,
  orgId,
  currentUserId,
  onNavigate,
}: UseCommentToastOptions) {
  const muted = useIsToastMuted();
  const capRef = useRef<Map<string, number>>(new Map());
  const mutedRef = useRef(muted);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    if (!supabase || !orgId || !currentUserId) return;
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

          if (mutedRef.current) return;
          if (row.author_id === currentUserId) return;

          const now = Date.now();
          const lastAt = cap.get(row.lead_id) ?? 0;
          if (now - lastAt < TOAST_CAP_MS) return;

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
              onClick: () => onNavigateRef.current(lead.id),
            },
            duration: 6000,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      cap.clear();
    };
  }, [supabase, orgId, currentUserId]);
}
