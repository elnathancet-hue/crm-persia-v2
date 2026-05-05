"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";
import { type Appointment, formatTimeRange } from "@persia/shared/agenda";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { useAgendaActions, useAgendaCallbacks } from "../context";
import { localToUtcIso } from "./CreateAppointmentDrawer";

interface RescheduleAppointmentDrawerProps {
  appointment: Appointment | null;
  onClose: () => void;
}

function isoToLocalInput(iso: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export const RescheduleAppointmentDrawer: React.FC<
  RescheduleAppointmentDrawerProps
> = ({ appointment, onClose }) => {
  const actions = useAgendaActions();
  const { agendaUsers = [], onAppointmentChange } = useAgendaCallbacks();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<string | null>(null);

  const tz = appointment?.timezone ?? "America/Sao_Paulo";
  const initialStart = appointment ? isoToLocalInput(appointment.start_at, tz) : "";
  const initialEnd = appointment ? isoToLocalInput(appointment.end_at, tz) : "";

  const [startLocal, setStartLocal] = React.useState(initialStart);
  const [endLocal, setEndLocal] = React.useState(initialEnd);
  const [userId, setUserId] = React.useState(appointment?.user_id ?? "");

  React.useEffect(() => {
    if (appointment) {
      setStartLocal(isoToLocalInput(appointment.start_at, tz));
      setEndLocal(isoToLocalInput(appointment.end_at, tz));
      setUserId(appointment.user_id);
      setError(null);
      setConflict(null);
    }
  }, [appointment, tz]);

  const open = appointment !== null;

  const formError = (() => {
    if (!appointment) return null;
    if (!startLocal || !endLocal) return "Início e término obrigatórios";
    if (new Date(endLocal).getTime() <= new Date(startLocal).getTime())
      return "Término deve ser após o início";
    return null;
  })();

  const sameAsCurrent =
    appointment !== null &&
    startLocal === initialStart &&
    endLocal === initialEnd &&
    userId === appointment.user_id;

  const handleSubmit = async () => {
    if (!appointment) return;
    setError(null);
    setConflict(null);
    if (formError) {
      setError(formError);
      return;
    }
    setSubmitting(true);
    try {
      const new_start_at = localToUtcIso(startLocal, tz);
      const new_end_at = localToUtcIso(endLocal, tz);
      await actions.rescheduleAppointment(appointment.id, {
        new_start_at,
        new_end_at,
        new_user_id: userId !== appointment.user_id ? userId : undefined,
      });
      onAppointmentChange?.(appointment.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao reagendar";
      if (msg.startsWith("Conflito com")) {
        setConflict(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">Reagendar</DialogTitle>
          <DialogHero
            icon={<CalendarClock className="size-5" />}
            title="Reagendar"
            tagline={appointment?.title ?? "Selecione novo horário"}
            tone="warning"
          />
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {appointment && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">
                Horário atual
              </p>
              <p className="mt-0.5 font-medium text-foreground">
                {formatTimeRange(appointment.start_at, appointment.end_at, tz)}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reschedule-start">Novo início</Label>
            <Input
              id="reschedule-start"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reschedule-end">Novo término</Label>
            <Input
              id="reschedule-end"
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
          </div>

          {agendaUsers.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="reschedule-user">Responsável</Label>
              <Select
                value={userId}
                onValueChange={(v) => setUserId(v ?? "")}
              >
                <SelectTrigger id="reschedule-user" className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {agendaUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="rounded-md bg-primary/10 p-3 text-sm text-primary ring-1 ring-primary/30">
            <strong>Como funciona:</strong> o agendamento atual fica marcado
            como &quot;Reagendado&quot; (audit) e um novo é criado no horário
            escolhido, esperando confirmação.
          </p>

          {conflict && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
              ⚠ {conflict}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        {/* PR-NAVUI: footer padrao consistente (px-6 py-4 + gap-3). */}
        <DialogFooter className="mx-0 mb-0 border-t border-border bg-card px-6 py-4 flex-row justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || sameAsCurrent || Boolean(formError)}
          >
            <CalendarClock />
            {submitting ? "Reagendando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
