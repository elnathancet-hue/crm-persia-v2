"use client";

import * as React from "react";
import {
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquare,
  Phone,
  User as UserIcon,
  XCircle,
} from "lucide-react";
import {
  type Appointment,
  type AppointmentStatus,
  APPOINTMENT_CHANNEL_LABELS,
  APPOINTMENT_KIND_LABELS,
  formatDate,
  formatTimeRange,
  formatWeekday,
} from "@persia/shared/agenda";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { AppointmentStatusBadge } from "./AppointmentStatusBadge";
import { useAgendaActions, useAgendaCallbacks } from "../context";

interface AppointmentDrawerProps {
  appointment: Appointment | null;
  onClose: () => void;
  /** Quando true, esconde botoes de acao (ex: visualizacao publica). */
  readOnly?: boolean;
  /** Callback do botao 'Reagendar'. Parent abre seu RescheduleAppointmentDrawer. */
  onReschedule?: (appointment: Appointment) => void;
}

interface ActionDef {
  status: AppointmentStatus;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  variant: "default" | "outline" | "secondary";
  className?: string;
}

const ACTION_BUTTONS: ActionDef[] = [
  {
    status: "confirmed",
    label: "Confirmar",
    icon: Check,
    variant: "default",
    className:
      "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/30",
  },
  {
    status: "completed",
    label: "Marcar como realizado",
    icon: Check,
    variant: "default",
  },
  {
    status: "no_show",
    label: "Não compareceu",
    icon: XCircle,
    variant: "secondary",
  },
];

export const AppointmentDrawer: React.FC<AppointmentDrawerProps> = ({
  appointment,
  onClose,
  readOnly = false,
  onReschedule,
}) => {
  const actions = useAgendaActions();
  const { onOpenLead, onOpenChat, onAppointmentChange } = useAgendaCallbacks();
  const [busyAction, setBusyAction] = React.useState<
    AppointmentStatus | "cancel" | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  const open = appointment !== null;
  const tz = appointment?.timezone || "America/Sao_Paulo";

  const handleStatus = async (status: AppointmentStatus) => {
    if (!appointment) return;
    setBusyAction(status);
    setError(null);
    try {
      await actions.updateAppointmentStatus(appointment.id, status);
      onAppointmentChange?.(appointment.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar status");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = async () => {
    if (!appointment) return;
    if (!confirm("Cancelar este agendamento? Você poderá registrar o motivo depois.")) return;
    setBusyAction("cancel");
    setError(null);
    try {
      await actions.cancelAppointment(appointment.id, {
        cancelled_by_role: "agent",
      });
      onAppointmentChange?.(appointment.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cancelar");
    } finally {
      setBusyAction(null);
    }
  };

  const isMutating = busyAction !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {appointment && (
          <>
            <DialogHeader className="border-b border-border bg-card p-5">
              <DialogTitle className="sr-only">
                {appointment.title}
              </DialogTitle>
              <DialogHero
                icon={<CalendarDays className="size-5" />}
                title={appointment.title}
                tagline={APPOINTMENT_KIND_LABELS[appointment.kind]}
                trailing={<AppointmentStatusBadge status={appointment.status} />}
              />
            </DialogHeader>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {appointment.description && (
                <p className="rounded-md bg-muted/40 p-3 text-sm text-foreground">
                  {appointment.description}
                </p>
              )}

              {/* Data e horario */}
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Data e horário
                </h3>
                <div className="space-y-2 rounded-md border bg-card p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CalendarDays size={14} className="text-muted-foreground" />
                    <span className="capitalize">
                      {formatWeekday(appointment.start_at, tz)}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span>{formatDate(appointment.start_at, tz)}</span>
                  </p>
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <Clock size={14} className="text-muted-foreground" />
                    {formatTimeRange(
                      appointment.start_at,
                      appointment.end_at,
                      tz,
                    )}
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {appointment.duration_minutes} min
                    </span>
                  </p>
                </div>
              </section>

              {(appointment.location ||
                appointment.channel ||
                appointment.meeting_url) && (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Local e canal
                  </h3>
                  <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
                    {appointment.channel && (
                      <p className="flex items-center gap-2">
                        {appointment.channel === "phone" && (
                          <Phone size={14} className="text-muted-foreground" />
                        )}
                        {appointment.channel === "whatsapp" && (
                          <MessageSquare size={14} className="text-muted-foreground" />
                        )}
                        {appointment.channel === "online" && (
                          <ExternalLink size={14} className="text-muted-foreground" />
                        )}
                        {appointment.channel === "in_person" && (
                          <MapPin size={14} className="text-muted-foreground" />
                        )}
                        <span className="font-medium">
                          {APPOINTMENT_CHANNEL_LABELS[appointment.channel]}
                        </span>
                      </p>
                    )}
                    {appointment.location && (
                      <p className="flex items-start gap-2">
                        <MapPin
                          size={14}
                          className="mt-0.5 shrink-0 text-muted-foreground"
                        />
                        {appointment.location}
                      </p>
                    )}
                    {appointment.meeting_url && (
                      <a
                        href={appointment.meeting_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 break-all font-medium text-primary hover:underline"
                      >
                        <ExternalLink size={14} className="shrink-0" />
                        {appointment.meeting_url}
                      </a>
                    )}
                  </div>
                </section>
              )}

              {appointment.lead_id && (onOpenLead || onOpenChat) && (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Lead
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {onOpenLead && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenLead(appointment.lead_id!)}
                      >
                        <UserIcon />
                        Abrir lead
                      </Button>
                    )}
                    {onOpenChat && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChat(appointment.lead_id!)}
                      >
                        <MessageSquare />
                        Chat
                      </Button>
                    )}
                  </div>
                </section>
              )}

              {appointment.status === "cancelled" && (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Cancelamento
                  </h3>
                  <div className="space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
                    {appointment.cancelled_at && (
                      <p>
                        <strong>Em:</strong>{" "}
                        {formatDate(appointment.cancelled_at, tz)}
                      </p>
                    )}
                    {appointment.cancellation_reason && (
                      <p>
                        <strong>Motivo:</strong>{" "}
                        {appointment.cancellation_reason}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {error && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive ring-1 ring-destructive/30">
                  {error}
                </p>
              )}
            </div>

            {!readOnly && appointment.kind === "appointment" && (
              <DialogFooter className="border-t border-border bg-card p-4 gap-2 flex-col sm:flex-col sm:items-stretch sm:space-x-0">
                {ACTION_BUTTONS.filter((b) => b.status !== appointment.status).map(
                  (b) => {
                    const Icon = b.icon;
                    return (
                      <Button
                        key={b.status}
                        type="button"
                        variant={b.variant}
                        disabled={isMutating}
                        onClick={() => handleStatus(b.status)}
                        className={["w-full", b.className ?? ""].join(" ")}
                      >
                        <Icon />
                        {busyAction === b.status ? "Aguarde..." : b.label}
                      </Button>
                    );
                  },
                )}

                {onReschedule &&
                  appointment.status !== "cancelled" &&
                  appointment.status !== "completed" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isMutating}
                      onClick={() => onReschedule(appointment)}
                      className="w-full"
                    >
                      <CalendarClock />
                      Reagendar
                    </Button>
                  )}

                {appointment.status !== "cancelled" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isMutating}
                    onClick={handleCancel}
                    className="w-full text-destructive ring-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <XCircle />
                    {busyAction === "cancel"
                      ? "Cancelando..."
                      : "Cancelar agendamento"}
                  </Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
