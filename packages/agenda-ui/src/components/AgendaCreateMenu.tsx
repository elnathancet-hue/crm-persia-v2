"use client";

import * as React from "react";
import { Calendar, Coffee, Plus, Users } from "lucide-react";
import { Button } from "@persia/ui/button";
import type { AppointmentKind } from "@persia/shared/agenda";
import { TONE_PILL_CLASSES, type AgendaTone } from "../lib/agenda-tones";

interface AgendaCreateMenuProps {
  onSelect: (kind: AppointmentKind) => void;
  /** Esconde opcoes (ex: hidden=['block'] em telas mais simples). */
  hidden?: readonly AppointmentKind[];
}

// PR9e: tons semanticos centralizados (agenda-tones). Antes cada
// option tinha sua classe Tailwind crua. Agora reusa o helper.
interface OptionDef {
  kind: AppointmentKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: Extract<AgendaTone, "brand" | "success" | "neutral">;
}

const OPTIONS: OptionDef[] = [
  {
    kind: "appointment",
    label: "Agendamento",
    description: "Compromisso com lead",
    icon: Calendar,
    tone: "brand",
  },
  {
    kind: "event",
    label: "Evento",
    description: "Reunião interna sem lead",
    icon: Users,
    tone: "success",
  },
  {
    kind: "block",
    label: "Bloqueio",
    description: "Folga, almoço ou indisponibilidade",
    icon: Coffee,
    tone: "neutral",
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
      <Button
        type="button"
        variant="default"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus className="size-4" data-icon="inline-start" />
        Novo
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          <ul className="p-1">
            {visible.map((opt) => {
              const Icon = opt.icon;
              return (
                <li key={opt.kind}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handlePick(opt.kind)}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <div
                      className={[
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        TONE_PILL_CLASSES[opt.tone],
                      ].join(" ")}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {opt.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
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
