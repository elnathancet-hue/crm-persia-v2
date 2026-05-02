"use client";

import * as React from "react";
import { CalendarPlus, X } from "lucide-react";
import type { AgendaService, AppointmentKind } from "@persia/shared/agenda";
import { useAgendaActions, useAgendaCallbacks } from "../context";
import type { LeadOption } from "../actions";
import {
  AppointmentForm,
  type AppointmentFormHandle,
  type AppointmentFormValues,
} from "./AppointmentForm";

interface CreateAppointmentDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fixed kind (vindo do dropdown 'Novo'). */
  initialKind?: AppointmentKind;
  /** Lead pre-selecionado (criacao a partir de /leads/[id] no futuro). */
  initialLead?: LeadOption | null;
  services: readonly AgendaService[];
  /** Slot pre-preenchido (vindo de click no calendar em horario vazio). */
  prefillSlot?: { start: Date; end: Date } | null;
}

function dateToLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Converte ISO local "2026-05-04T09:00" + timezone IANA → ISO UTC.
 * Helper duplicado de @persia/shared/agenda/availability mas mais simples
 * (so pra forms; nao tem DST roundtrip — consideramos negligible no MVP).
 */
function localToUtcIso(local: string, timezone: string): string {
  // Aproveita o getTimezoneOffsetMinutes do shared via Intl direto.
  const naive = new Date(`${local}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(naive);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  const offsetMin = Math.round((asUtc - naive.getTime()) / 60_000);
  return new Date(naive.getTime() - offsetMin * 60_000).toISOString();
}

export const CreateAppointmentDrawer: React.FC<CreateAppointmentDrawerProps> = ({
  open,
  onClose,
  initialKind = "appointment",
  initialLead = null,
  services,
  prefillSlot = null,
}) => {
  const actions = useAgendaActions();
  const callbacks = useAgendaCallbacks();
  const formRef = React.useRef<AppointmentFormHandle>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflictTitle, setConflictTitle] = React.useState<string | null>(null);

  // Re-key o form quando prefillSlot muda — garante que o initial value
  // refletir o slot novo (ja que o AppointmentForm usa initial=... so na 1a render).
  const formKey = React.useMemo(
    () => `${prefillSlot?.start.getTime() ?? 0}-${initialKind}`,
    [prefillSlot, initialKind],
  );

  const initialForm = React.useMemo<Partial<AppointmentFormValues>>(() => {
    const base: Partial<AppointmentFormValues> = {
      kind: initialKind,
      lead_id: initialLead?.id ?? null,
    };
    if (prefillSlot) {
      base.start_local = dateToLocalInput(prefillSlot.start);
      base.end_local = dateToLocalInput(prefillSlot.end);
    }
    return base;
  }, [prefillSlot, initialKind, initialLead]);

  if (!open) return null;

  const handleSubmit = async () => {
    setError(null);
    setConflictTitle(null);
    const v = formRef.current?.submit();
    if (!v) return;

    setSubmitting(true);
    try {
      const start_at = localToUtcIso(v.start_local, v.timezone);
      const end_at = localToUtcIso(v.end_local, v.timezone);
      const duration_minutes = Math.round(
        (new Date(end_at).getTime() - new Date(start_at).getTime()) / 60_000,
      );

      await actions.createAppointment({
        kind: v.kind,
        title: v.title.trim(),
        description: v.description.trim() || null,
        lead_id: v.kind === "appointment" ? v.lead_id : null,
        user_id: v.user_id,
        service_id: v.kind === "appointment" ? v.service_id : null,
        booking_page_id: null,
        start_at,
        end_at,
        duration_minutes,
        timezone: v.timezone,
        status: v.kind === "appointment" ? "awaiting_confirmation" : "confirmed",
        channel: v.channel || null,
        location: v.location.trim() || null,
        meeting_url: v.meeting_url.trim() || null,
      });
      callbacks.onAppointmentChange?.("created");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao criar agendamento";
      // Detecta erro de conflito (mensagem do AppointmentConflictError)
      if (msg.startsWith("Conflito com")) {
        setConflictTitle(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              <CalendarPlus size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Novo</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Adicionar à agenda
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <AppointmentForm
            key={formKey}
            ref={formRef}
            services={services}
            initialLead={initialLead}
            initial={initialForm}
          />

          {conflictTitle && (
            <div className="mt-5 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
              ⚠ {conflictTitle}. Ajuste o horário e tente de novo.
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 disabled:opacity-50"
          >
            <CalendarPlus size={14} />
            {submitting ? "Criando..." : "Criar"}
          </button>
        </footer>
      </aside>
    </div>
  );
};

// Pra reusar em outro componente (Reschedule), exportamos o helper.
export { localToUtcIso };

// Helper de tipo pro RescheduleDrawer
export type { AppointmentFormValues };
