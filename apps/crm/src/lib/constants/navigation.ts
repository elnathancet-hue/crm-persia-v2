import {
  LayoutDashboard,
  MessageSquare,
  UsersRound,
  Kanban,
  Calendar,
  Zap,
  Megaphone,
  BarChart3,
  Settings,
} from "lucide-react";
import type { OrgRole } from "@/lib/hooks/use-role";
import type { PermissionModule } from "@/lib/permissions";

export interface NavChild {
  label: string;
  href: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  badge?: boolean;
  minRole?: OrgRole;
  /** Módulo de permissão JSONB. undefined = sempre visível. */
  module?: PermissionModule;
  children?: NavChild[];
}

export const navigation: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Chat",
    href: "/chat",
    icon: MessageSquare,
    badge: true,
    module: "chat",
  },
  {
    label: "Grupos",
    href: "/groups",
    icon: UsersRound,
    minRole: "admin",
    module: "groups",
  },
  // PR-K5: item "Leads" foi removido — agora vive como tab dentro de /crm.
  // /tags e /segments continuam acessiveis via URL direta (e podem virar
  // sub-tabs no PR-K8, junto com a aba Ajustes).
  {
    label: "CRM",
    href: "/crm",
    icon: Kanban,
    module: "crm",
  },
  {
    label: "Agenda",
    href: "/agenda",
    icon: Calendar,
    module: "agenda",
  },
  {
    label: "Automação",
    href: "/automations",
    icon: Zap,
    minRole: "admin",
    module: "automations",
    // PR-AUTOMATIONS-CLEANUP (mai/2026): menu reduzido de 5 itens flat
    // pra 2. Assistentes IA, Webhook IA e Picotador eram do sistema
    // legacy (pre Agente Nativo) e ficam escondidos do menu — codigo
    // permanece em /automations/{assistant,webhook,splitter} pra
    // compatibilidade do pipeline (modes n8n + OpenAI fallback ainda
    // leem essas configs). Quando legacy for ripado de vez, deletar
    // as rotas tambem.
    children: [
      { label: "Agente IA", href: "/automations/agents" },
      { label: "Biblioteca de mídia", href: "/automations/tools" },
      { label: "Tipos de agendamento", href: "/automations/appointments" },
    ],
  },
  {
    label: "Campanha",
    href: "/campaigns",
    icon: Megaphone,
    minRole: "admin",
    module: "campaigns",
  },
  {
    label: "Relatório",
    href: "/reports",
    icon: BarChart3,
    module: "reports",
  },
  {
    label: "Config",
    href: "/settings",
    icon: Settings,
    minRole: "admin",
    module: "settings",
  },
];
