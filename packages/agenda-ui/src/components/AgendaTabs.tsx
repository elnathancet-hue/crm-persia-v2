"use client";

import * as React from "react";
import {
  CalendarDays,
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
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: "overview", label: "Visão geral", icon: LayoutGrid },
  { id: "calendar", label: "Calendário", icon: CalendarDays },
  { id: "list", label: "Lista", icon: ListIcon },
  { id: "availability", label: "Disponibilidade", icon: ClockIcon },
  { id: "booking-pages", label: "Páginas de agendamento", icon: LinkIcon },
  { id: "settings", label: "Ajustes", icon: SettingsIcon },
];

/**
 * Tabs da Agenda — padrao visual identico ao CrmTabs (PR-AGENDA-VISUAL
 * mai/2026): underline azul + icone + label + bg-primary/5 quando ativa.
 * Antes usava shadcn `<Tabs>` pill — driftava do resto do produto.
 *
 * Conteudo de cada tab eh renderizado FORA pelo parent (agenda-page-client)
 * — esse componente eh so o sub-nav, sem TabsContent.
 */
export const AgendaTabs: React.FC<AgendaTabsProps> = ({
  active,
  onChange,
  hidden = [],
}) => {
  const visible = TABS.filter((t) => !hidden.includes(t.id));

  return (
    <div className="flex gap-0.5 border-b border-border overflow-x-auto">
      {visible.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={isActive}
            className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-3 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isActive
                ? "text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className={`size-4 ${isActive ? "text-primary" : ""}`} />
            <span>{tab.label}</span>
            {isActive && (
              <span
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-t-full bg-primary"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
