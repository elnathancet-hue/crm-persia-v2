"use client";

import * as React from "react";
import { Calendar, Clock, MapPin } from "lucide-react";
import type { AvailableSlot } from "@persia/shared/agenda";
import type {
  BookingConfirmation as ConfirmationData,
  ResolvedPublicBookingPage,
} from "@/actions/agenda/public";
import { PublicSlotPicker } from "./components/PublicSlotPicker";
import { PublicLeadForm } from "./components/PublicLeadForm";
import { BookingConfirmation } from "./components/BookingConfirmation";

interface Props {
  resolved: ResolvedPublicBookingPage;
}

interface SelectedSlot {
  slot: AvailableSlot;
  timezone: string;
  /** "YYYY-MM-DDTHH:mm" no fuso do owner. */
  start_local: string;
}

function utcToLocalInput(iso: string, timezone: string): string {
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
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function BookingPagePublicClient({ resolved }: Props) {
  const { page, organization, hostName } = resolved;
  const [step, setStep] = React.useState<"pick" | "form" | "done">("pick");
  const [selected, setSelected] = React.useState<SelectedSlot | null>(null);
  const [confirmation, setConfirmation] = React.useState<ConfirmationData | null>(
    null,
  );

  const handleSelectSlot = (slot: AvailableSlot, timezone: string) => {
    setSelected({
      slot,
      timezone,
      start_local: utcToLocalInput(slot.start_at, timezone),
    });
    setStep("form");
  };

  const handleSuccess = (c: ConfirmationData) => {
    setConfirmation(c);
    setStep("done");
  };

  return (
    <div className="space-y-6">
      {/* Header da pagina */}
      <header className="rounded-3xl bg-white p-6 ring-1 ring-slate-200 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
          {organization.name}
        </p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">
          {page.title}
        </h1>
        {page.description && (
          <p className="mt-2 text-sm text-slate-600">{page.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} className="text-slate-400" />
            {page.duration_minutes} min
          </span>
          {page.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={12} className="text-slate-400" />
              {page.location}
            </span>
          )}
          {hostName && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={12} className="text-slate-400" />
              com {hostName}
            </span>
          )}
        </div>
      </header>

      {/* Body por etapa */}
      {step === "pick" && (
        <PublicSlotPicker
          pageId={page.id}
          lookaheadDays={page.lookahead_days}
          onSelectSlot={handleSelectSlot}
        />
      )}

      {step === "form" && selected && (
        <PublicLeadForm
          pageId={page.id}
          selectedStartLocal={selected.start_local}
          selectedStartUtc={selected.slot.start_at}
          selectedEndUtc={selected.slot.end_at}
          timezone={selected.timezone}
          onBack={() => {
            setSelected(null);
            setStep("pick");
          }}
          onSuccess={handleSuccess}
        />
      )}

      {step === "done" && confirmation && (
        <BookingConfirmation data={confirmation} />
      )}

      <footer className="pt-4 text-center text-[10px] text-slate-400">
        Agendamento processado por <strong>CRM Persia</strong>
      </footer>
    </div>
  );
}
