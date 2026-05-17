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
import type { LeadLastMessagePreview } from "@persia/shared/crm";
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
      "bg-success text-success-foreground hover:bg-success/90",
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

              {/* PR-AGENDA-LAST-MSG (mai/2026): preview da ultima
                  mensagem trocada com o lead. Antes, agente abria
                  appointment, precisava clicar "Chat" pra ver contexto.
                  Agora aparece inline — abrir chat continua opcao via
                  botao acima. So renderiza quando appointment.lead_id
                  existe e action wired (admin pode nao implementar). */}
              {appointment.lead_id && (
                <LastMessageSection
                  leadId={appointment.lead_id}
                  drawerOpen={open}
                />
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

// ============================================================================
// LastMessageSection — preview inline da ultima mensagem do lead
// ----------------------------------------------------------------------------
// PR-AGENDA-LAST-MSG (mai/2026): fecha o loop CRM<->Agenda no plano
// "contexto sem trocar de tela". Antes, agente abria appointment,
// precisava clicar Chat pra ver o que o lead falou. Agora ve o snippet
// inline e decide se abre o chat completo.
//
// Carrega lazy quando drawer abre + tem lead_id + actions.getLeadLastMessage
// existe (admin pode nao implementar — secao some).
// ============================================================================

function LastMessageSection({
  leadId,
  drawerOpen,
}: {
  leadId: string;
  drawerOpen: boolean;
}) {
  const actions = useAgendaActions();
  const [message, setMessage] = React.useState<LeadLastMessagePreview | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!drawerOpen) return;
    if (!actions.getLeadLastMessage) return;
    let cancelled = false;
    setLoading(true);
    actions
      .getLeadLastMessage(leadId)
      .then((res) => {
        if (!cancelled) {
          setMessage(res);
          setLoaded(true);
        }
      })
      .catch((err) => {
        console.error("[LastMessageSection] failed:", err);
        if (!cancelled) {
          setMessage(null);
          setLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, leadId, actions]);

  // Action nao wired (admin sem implementacao) — esconde secao silencioso.
  if (!actions.getLeadLastMessage) return null;

  // Loading: skeleton minimo (1 linha alta).
  if (loading && !loaded) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Última mensagem
        </h3>
        <div className="h-14 w-full bg-muted rounded-md animate-pulse" />
      </section>
    );
  }

  // Sem mensagens (lead frio) — mostra hint discreto.
  if (!message) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Última mensagem
        </h3>
        <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground italic">
          Sem mensagens trocadas com este lead ainda.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Última mensagem
      </h3>
      <LastMessagePreview message={message} />
    </section>
  );
}

function LastMessagePreview({
  message,
}: {
  message: LeadLastMessagePreview;
}) {
  const isInbound = message.direction === "inbound";
  // Type label pra mensagens nao-text (imagem, audio, etc). Cobre os
  // tipos comuns; default "Mensagem" pra unknown.
  const typeLabel: Record<string, string> = {
    image: "📷 Imagem",
    audio: "🎙️ Áudio",
    video: "🎥 Vídeo",
    document: "📄 Documento",
    sticker: "🧩 Figurinha",
    location: "📍 Localização",
    contact: "👤 Contato",
  };
  const isText = !message.type || message.type === "text";
  const fallback = message.type ? typeLabel[message.type] ?? "Mensagem" : "Mensagem";
  const content = isText
    ? message.content?.trim() || "(sem texto)"
    : fallback;

  // Formato relativo simples (Intl ja resolve pt-BR). Pra ficar enxuto
  // sem add dep, calculo difference em horas e formato como minutos/h/dias.
  const relativeTime = formatRelativeShortPtBR(message.created_at);

  return (
    <div
      className={`rounded-md border bg-card px-3 py-2.5 text-sm ${
        isInbound ? "border-primary/30" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
            isInbound ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {isInbound ? "Lead" : "Você"}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {relativeTime}
        </span>
      </div>
      <p className="text-sm text-foreground line-clamp-2 break-words">
        {content}
      </p>
    </div>
  );
}

/**
 * Format relativo curto em pt-BR sem dependencia externa. Cobre os
 * casos comuns ("agora", "5 min", "2 h", "3 d", senao data abreviada).
 *
 * Inline aqui em vez de import de outro pacote pra evitar ciclo
 * agenda-ui <-> ui (formatRelativeShortPtBR ja existe em @persia/ui
 * mas adiciona dep pesada pro caso simples desta secao).
 */
function formatRelativeShortPtBR(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} d`;
  return new Date(then).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}
