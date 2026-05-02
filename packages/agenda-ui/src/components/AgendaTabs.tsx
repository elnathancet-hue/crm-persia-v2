"use client";

import * as React from "react";
import {
  CalendarDays,
  CheckSquare,
  Clock as ClockIcon,
  LayoutGrid,
  Link as LinkIcon,
  List as ListIcon,
  Settings as SettingsIcon,
} from "lucide-react";

export type AgendaTab =
  | "overview"
  | "calendar"
  | "list"
  | "availability"
  | "booking-pages"
  | "settings";

interface AgendaTabsProps {
  active: AgendaTab;
  onChange: (tab: AgendaTab) => void;
  /** Esconde tabs por flag — util pra MVP/feature flag por org. */
  hidden?: readonly AgendaTab[];
}

interface TabDef {
  id: AgendaTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const TABS: TabDef[] = [
  { id: "overview", label: "Visão geral", icon: LayoutGrid },
  { id: "calendar", label: "Calendário", icon: CalendarDays },
  { id: "list", label: "Lista", icon: ListIcon },
  { id: "availability", label: "Disponibilidade", icon: ClockIcon },
  { id: "booking-pages", label: "Páginas de agendamento", icon: LinkIcon },
  { id: "settings", label: "Ajustes", icon: SettingsIcon },
];

export const AgendaTabs: React.FC<AgendaTabsProps> = ({
  active,
  onChange,
  hidden = [],
}) => {
  const visible = TABS.filter((t) => !hidden.includes(t.id));

  return (
    <nav
      role="tablist"
      aria-label="Seções da Agenda"
      className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1"
    >
      {visible.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={[
              "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest transition",
              isActive
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-slate-500 hover:text-slate-900",
            ].join(" ")}
          >
            <Icon size={14} />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
