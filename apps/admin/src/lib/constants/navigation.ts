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
  Building2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ProductServiceKey } from "@persia/shared";

export interface NavChild {
  label: string;
  href: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: boolean;
  serviceKey?: ProductServiceKey;
  children?: NavChild[];
}

// --- Admin Global Mode (short sidebar) ---

export const adminNavigation: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Clientes", href: "/clients", icon: Building2 },
  { label: "Relatorios", href: "/reports", icon: BarChart3 },
  { label: "Auditoria", href: "/audit", icon: ShieldCheck },
  { label: "Config", href: "/settings/admin", icon: Settings },
];

export const adminMobileItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Clientes", href: "/clients", icon: Building2 },
  { label: "Relatorios", href: "/reports", icon: BarChart3 },
];

// --- Client/Account Mode (full CRM sidebar) ---

export const clientNavigation: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Chat", href: "/chat", icon: MessageSquare, badge: true, serviceKey: "chat" },
  { label: "Grupos", href: "/groups", icon: UsersRound, serviceKey: "groups" },
  { label: "CRM", href: "/crm", icon: Kanban, serviceKey: "crm" },
  { label: "Agenda", href: "/agenda", icon: Calendar, serviceKey: "agenda" },
  {
    label: "Automacao",
    href: "/automations",
    icon: Zap,
    serviceKey: "automations",
    children: [
      { label: "Agente IA", href: "/automations/agents" },
      { label: "Biblioteca de mídia", href: "/automations/tools" },
      { label: "Tipos de agendamento", href: "/automations/appointments" },
    ],
  },
  { label: "Campanha", href: "/campaigns", icon: Megaphone, serviceKey: "campaigns" },
  { label: "Relatorios", href: "/reports", icon: BarChart3, serviceKey: "reports" },
  { label: "Config", href: "/settings", icon: Settings },
];

export const clientMobileItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Grupos", href: "/groups", icon: UsersRound },
  { label: "CRM", href: "/crm", icon: Kanban },
];
