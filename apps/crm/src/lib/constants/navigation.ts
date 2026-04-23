import {
  LayoutDashboard,
  MessageSquare,
  Users,
  UsersRound,
  Kanban,
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
  {
    label: "Leads",
    href: "/leads",
    icon: Users,
    children: [
      { label: "Base de Leads", href: "/leads" },
      { label: "Tags", href: "/tags" },
      { label: "Segmentacoes", href: "/segments" },
    ],
  },
  {
    label: "CRM",
    href: "/crm",
    icon: Kanban,
  },
  {
    label: "Automacao",
    href: "/automations",
    icon: Zap,
    minRole: "admin",
    children: [
      { label: "Agente IA Nativo", href: "/automations/agents" },
      { label: "Assistentes IA", href: "/automations/assistant" },
      { label: "Webhook IA", href: "/automations/webhook" },
      { label: "Tools", href: "/automations/tools" },
      { label: "Picotador", href: "/automations/splitter" },
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
