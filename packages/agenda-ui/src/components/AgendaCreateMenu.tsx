"use client";

import * as React from "react";
import { Calendar, Coffee, Plus, Users } from "lucide-react";
import { Button } from "@persia/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import type { AppointmentKind } from "@persia/shared/agenda";
import { TONE_PILL_CLASSES, type AgendaTone } from "../lib/agenda-tones";

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
  const visible = OPTIONS.filter((o) => !hidden.includes(o.kind));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="default">
            <Plus className="size-4" data-icon="inline-start" />
            Novo
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72 p-1.5">
        <ul>
          {visible.map((opt) => {
            const Icon = opt.icon;
            return (
              <li key={opt.kind}>
                <button
                  type="button"
                  onClick={() => onSelect(opt.kind)}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
