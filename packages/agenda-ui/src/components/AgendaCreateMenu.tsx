"use client";

import * as React from "react";
import { Calendar, Coffee, Plus, Users } from "lucide-react";
import type { AppointmentKind } from "@persia/shared/agenda";

interface AgendaCreateMenuProps {
  onSelect: (kind: AppointmentKind) => void;
  /** Esconde opcoes (ex: hidden=['block'] em telas mais simples). */
  hidden?: readonly AppointmentKind[];
}

interface OptionDef {
  kind: AppointmentKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: string;
}

const OPTIONS: OptionDef[] = [
  {
    kind: "appointment",
    label: "Agendamento",
    description: "Compromisso com lead",
    icon: Calendar,
    tone: "text-indigo-600 bg-indigo-50",
  },
  {
    kind: "event",
    label: "Evento",
    description: "Reunião interna sem lead",
    icon: Users,
    tone: "text-emerald-600 bg-emerald-50",
  },
  {
    kind: "block",
    label: "Bloqueio",
    description: "Folga, almoço ou indisponibilidade",
    icon: Coffee,
    tone: "text-slate-600 bg-slate-100",
  },
];

export const AgendaCreateMenu: React.FC<AgendaCreateMenuProps> = ({
  onSelect,
  hidden = [],
}) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const visible = OPTIONS.filter((o) => !hidden.includes(o.kind));

  const handlePick = (kind: AppointmentKind) => {
    setOpen(false);
    onSelect(kind);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700"
      >
        <Plus size={14} />
        Novo
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
        >
          <ul>
            {visible.map((opt) => {
              const Icon = opt.icon;
              return (
                <li key={opt.kind}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handlePick(opt.kind)}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
                  >
                    <div
                      className={[
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        opt.tone,
                      ].join(" ")}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900">
                        {opt.label}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {opt.description}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
