"use client";

import * as React from "react";
import { CalendarPlus } from "lucide-react";
import type { AgendaService, AppointmentKind } from "@persia/shared/agenda";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
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
  initialKind?: AppointmentKind;
  initialLead?: LeadOption | null;
  services: readonly AgendaService[];
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">Novo agendamento</DialogTitle>
          <DialogHero
            icon={<CalendarPlus className="size-5" />}
            title="Novo agendamento"
            tagline="Adicionar à agenda"
          />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          <AppointmentForm
            key={formKey}
            ref={formRef}
            services={services}
            initialLead={initialLead}
            initial={initialForm}
          />

          {conflictTitle && (
            <div className="mt-5 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
              ⚠ {conflictTitle}. Ajuste o horário e tente de novo.
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        {/* PR-NAVUI: footer padrao consistente (px-6 py-4 + gap-3). */}
        <DialogFooter className="border-t border-border bg-card px-6 py-4 flex-row justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            <CalendarPlus />
            {submitting ? "Criando..." : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { localToUtcIso };
export type { AppointmentFormValues };
