"use client";

import * as React from "react";
import { Clock, MapPin, User, Phone } from "lucide-react";
import {
  type Appointment,
  formatTimeRange,
} from "@persia/shared/agenda";
import { AppointmentStatusBadge } from "./AppointmentStatusBadge";
import { useAgendaCallbacks } from "../context";

interface AppointmentCardProps {
  appointment: Appointment;
  onClick?: (appointment: Appointment) => void;
  /** Mostra acoes inline (ex: link "Abrir lead"). Default true. */
  showActions?: boolean;
  className?: string;
}

export const AppointmentCard: React.FC<AppointmentCardProps> = ({
  appointment,
  onClick,
  showActions = true,
  className = "",
}) => {
  const { onOpenLead } = useAgendaCallbacks();
  const timeRange = formatTimeRange(
    appointment.start_at,
    appointment.end_at,
    appointment.timezone,
  );

  const handleClick = () => onClick?.(appointment);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={[
        "group flex w-full flex-col gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border shadow-sm transition hover:shadow-md hover:ring-primary/40",
        className,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-bold text-foreground">
            {appointment.title}
          </h4>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Clock size={12} className="shrink-0" />
            {timeRange}
          </p>
        </div>
        <AppointmentStatusBadge status={appointment.status} />
      </div>

      <div className="space-y-1.5 text-[11px] text-muted-foreground">
        {appointment.location && (
          <p className="flex items-center gap-1.5">
            <MapPin size={11} className="shrink-0 text-muted-foreground/70" />
            <span className="truncate">{appointment.location}</span>
          </p>
        )}
        {appointment.lead_id && showActions && onOpenLead && (
          <p className="flex items-center gap-1.5">
            <User size={11} className="shrink-0 text-muted-foreground/70" />
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onOpenLead(appointment.lead_id!);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onOpenLead(appointment.lead_id!);
                }
              }}
              className="font-semibold text-primary hover:underline focus:underline focus:outline-none"
            >
              Abrir lead
            </span>
          </p>
        )}
        {appointment.channel === "phone" && (
          <p className="flex items-center gap-1.5">
            <Phone size={11} className="shrink-0 text-muted-foreground/70" />
            <span>Telefone</span>
          </p>
        )}
      </div>
    </button>
  );
};
