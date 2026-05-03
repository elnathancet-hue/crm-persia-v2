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
import { Tabs, TabsList, TabsTrigger } from "@persia/ui/tabs";

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

/**
 * Tabs controlado da Agenda. Wrappa <Tabs> do shadcn (que via base-ui).
 * O conteudo de cada tab eh renderizado FORA pelo parent (agenda-page-client)
 * — isso permite render condicional que nao re-monta panels invisiveis.
 */
export const AgendaTabs: React.FC<AgendaTabsProps> = ({
  active,
  onChange,
  hidden = [],
}) => {
  const visible = TABS.filter((t) => !hidden.includes(t.id));

  return (
    <Tabs value={active} onValueChange={(v) => onChange(v as AgendaTab)}>
      <TabsList className="flex flex-wrap">
        {visible.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="inline-flex items-center gap-2"
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
};
