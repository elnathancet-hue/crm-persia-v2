"use client";

// Realtime pros APPOINTMENTS da Agenda.
//
// PR-AGENDA-REALTIME (mai/2026): antes do hook, agenda era pull-only.
// Se 2 agentes da mesma org tivessem `/agenda` aberto e um criasse/
// cancelasse/reagendasse um compromisso, o outro so via apos F5 ou
// navegar — risco de double-booking visivel ate o proximo fetch.
//
// Espelha o pattern de `useKanbanLeadsRealtime` (PR #213) e
// `useDealsRealtime` — filter por org_id no canal, debounce no
// caller via `useDebouncedCallback`.
//
// Por que filtrar por org_id (e nao por user_id):
//   - Agenda renderiza appointments de TODOS os agentes da org
//     (modelo atual: compartilhada, sem split por agent)
//   - Booking publico cria appointment sem user_id contexto (e
//     anonimo); precisamos pegar essa criacao tambem
//   - RLS ja filtra por org no nivel DB; realtime channel filter
//     e camada extra de defesa
//
// Pegadinhas:
//   - cleanup via removeChannel
//   - re-subscribe quando orgId muda (impersonacao admin)
//   - escuta INSERT/UPDATE/DELETE — UPDATE captura status_change
//     (confirmed → cancelled, etc), DELETE captura softDelete
//     (mesmo padrao do realtime do Kanban no PR #213)
//
// DI: recebe supabase como param. CRM injeta `createClient()`, admin
// injeta `getSupabaseBrowserClient()`.

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppointmentRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  appointmentId: string;
  status?: string | null;
  leadId?: string | null;
  userId?: string | null;
};

export function useAppointmentsRealtime(
  supabase: SupabaseClient | null,
  orgId: string | null,
  onEvent: (e: AppointmentRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!supabase || !orgId) return;

    const channel = supabase
      .channel(`appointments-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: {
            id?: string;
            status?: string | null;
            lead_id?: string | null;
            user_id?: string | null;
          } | null;
          old: {
            id?: string;
            status?: string | null;
            lead_id?: string | null;
            user_id?: string | null;
          } | null;
        }) => {
          const row =
            payload.eventType === "DELETE" ? payload.old : payload.new;
          if (!row?.id) return;
          onEvent({
            type: payload.eventType,
            appointmentId: row.id,
            status: row.status ?? null,
            leadId: row.lead_id ?? null,
            userId: row.user_id ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, orgId]);
}
