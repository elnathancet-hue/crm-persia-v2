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
  },
  {
    label: "Grupos",
    href: "/groups",
    icon: UsersRound,
    minRole: "admin",
  },
  // PR-K5: item "Leads" foi removido — agora vive como tab dentro de /crm.
  // /tags e /segments continuam acessiveis via URL direta (e podem virar
  // sub-tabs no PR-K8, junto com a aba Ajustes).
  {
    label: "CRM",
    href: "/crm",
    icon: Kanban,
  },
  {
    label: "Agenda",
    href: "/agenda",
    icon: Calendar,
  },
  {
    label: "Automacao",
    href: "/automations",
    icon: Zap,
    minRole: "admin",
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
    ],
  },
  {
    label: "Campanha",
    href: "/campaigns",
    icon: Megaphone,
    minRole: "admin",
  },
  {
    label: "Relatorio",
    href: "/reports",
    icon: BarChart3,
  },
  {
    label: "Config",
    href: "/settings",
    icon: Settings,
    minRole: "admin",
  },
];
