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
  X,
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

const ACTION_BUTTONS: { status: AppointmentStatus; label: string; icon: React.ComponentType<{ size?: number }>; tone: string }[] = [
  { status: "confirmed", label: "Confirmar", icon: Check, tone: "bg-emerald-600 hover:bg-emerald-700 text-white" },
  { status: "completed", label: "Marcar como realizado", icon: Check, tone: "bg-indigo-600 hover:bg-indigo-700 text-white" },
  { status: "no_show", label: "Não compareceu", icon: XCircle, tone: "bg-slate-600 hover:bg-slate-700 text-white" },
];

export const AppointmentDrawer: React.FC<AppointmentDrawerProps> = ({
  appointment,
  onClose,
  readOnly = false,
  onReschedule,
}) => {
  const actions = useAgendaActions();
  const { onOpenLead, onOpenChat, onAppointmentChange } = useAgendaCallbacks();
  const [busyAction, setBusyAction] = React.useState<AppointmentStatus | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!appointment) return null;

  const tz = appointment.timezone || "America/Sao_Paulo";

  const handleStatus = async (status: AppointmentStatus) => {
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
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Painel */}
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {APPOINTMENT_KIND_LABELS[appointment.kind]}
            </p>
            <h2 className="mt-1 truncate text-lg font-black text-slate-900">
              {appointment.title}
            </h2>
            <div className="mt-2">
              <AppointmentStatusBadge status={appointment.status} />
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

        {/* Conteudo */}
        <div className="flex-1 space-y-6 p-5">
          {appointment.description && (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              {appointment.description}
            </p>
          )}

          {/* Data e horario */}
          <section>
            <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Data e horário
            </h3>
            <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <CalendarDays size={14} className="text-slate-400" />
                <span className="capitalize">{formatWeekday(appointment.start_at, tz)}</span>
                <span className="text-slate-400">·</span>
                <span>{formatDate(appointment.start_at, tz)}</span>
              </p>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Clock size={14} className="text-slate-400" />
                {formatTimeRange(appointment.start_at, appointment.end_at, tz)}
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {appointment.duration_minutes} min
                </span>
              </p>
            </div>
          </section>

          {/* Local + canal */}
          {(appointment.location || appointment.channel || appointment.meeting_url) && (
            <section>
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Local e canal
              </h3>
              <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200 text-sm text-slate-700">
                {appointment.channel && (
                  <p className="flex items-center gap-2">
                    {appointment.channel === "phone" && <Phone size={14} className="text-slate-400" />}
                    {appointment.channel === "whatsapp" && <MessageSquare size={14} className="text-slate-400" />}
                    {appointment.channel === "online" && <ExternalLink size={14} className="text-slate-400" />}
                    {appointment.channel === "in_person" && <MapPin size={14} className="text-slate-400" />}
                    <span className="font-bold">
                      {APPOINTMENT_CHANNEL_LABELS[appointment.channel]}
                    </span>
                  </p>
                )}
                {appointment.location && (
                  <p className="flex items-start gap-2">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    {appointment.location}
                  </p>
                )}
                {appointment.meeting_url && (
                  <a
                    href={appointment.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 break-all font-semibold text-indigo-600 hover:underline"
                  >
                    <ExternalLink size={14} className="shrink-0" />
                    {appointment.meeting_url}
                  </a>
                )}
              </div>
            </section>
          )}

          {/* Lead */}
          {appointment.lead_id && (onOpenLead || onOpenChat) && (
            <section>
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Lead
              </h3>
              <div className="flex flex-wrap gap-2">
                {onOpenLead && (
                  <button
                    type="button"
                    onClick={() => onOpenLead(appointment.lead_id!)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-200"
                  >
                    <UserIcon size={12} />
                    Abrir lead
                  </button>
                )}
                {onOpenChat && (
                  <button
                    type="button"
                    onClick={() => onOpenChat(appointment.lead_id!)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-200"
                  >
                    <MessageSquare size={12} />
                    Chat
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Info de cancelamento */}
          {appointment.status === "cancelled" && (
            <section>
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Cancelamento
              </h3>
              <div className="space-y-1 rounded-2xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200">
                {appointment.cancelled_at && (
                  <p>
                    <strong>Em:</strong> {formatDate(appointment.cancelled_at, tz)}
                  </p>
                )}
                {appointment.cancellation_reason && (
                  <p>
                    <strong>Motivo:</strong> {appointment.cancellation_reason}
                  </p>
                )}
              </div>
            </section>
          )}

          {error && (
            <p className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
              {error}
            </p>
          )}
        </div>

        {/* Footer com acoes */}
        {!readOnly && appointment.kind === "appointment" && (
          <footer className="sticky bottom-0 space-y-2 border-t border-slate-200 bg-white p-5">
            {ACTION_BUTTONS.filter((b) => b.status !== appointment.status).map(
              (b) => {
                const Icon = b.icon;
                return (
                  <button
                    key={b.status}
                    type="button"
                    disabled={isMutating}
                    onClick={() => handleStatus(b.status)}
                    className={[
                      "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition disabled:opacity-50",
                      b.tone,
                    ].join(" ")}
                  >
                    <Icon size={14} />
                    {busyAction === b.status ? "Aguarde..." : b.label}
                  </button>
                );
              },
            )}

            {/* Reagendar — abre RescheduleAppointmentDrawer no parent */}
            {onReschedule &&
              appointment.status !== "cancelled" &&
              appointment.status !== "completed" && (
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={() => onReschedule(appointment)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 disabled:opacity-50"
                >
                  <CalendarClock size={14} />
                  Reagendar
                </button>
              )}

            {appointment.status !== "cancelled" && (
              <button
                type="button"
                disabled={isMutating}
                onClick={handleCancel}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
              >
                <XCircle size={14} />
                {busyAction === "cancel" ? "Cancelando..." : "Cancelar agendamento"}
              </button>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
};

