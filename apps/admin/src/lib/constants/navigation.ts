import {
  LayoutDashboard,
  MessageSquare,
  UsersRound,
  Users,
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

export interface NavChild {
  label: string;
  href: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: boolean;
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
  { label: "Chat", href: "/chat", icon: MessageSquare, badge: true },
  { label: "Grupos", href: "/groups", icon: UsersRound },
  {
    label: "Leads",
    href: "/leads",
    icon: Users,
    children: [
      { label: "Base de Leads", href: "/leads" },
      { label: "Tags", href: "/tags" },
      { label: "Segmentacoes", href: "/segments" },
      { label: "Campos Custom", href: "/leads/fields" },
    ],
  },
  { label: "CRM", href: "/crm", icon: Kanban },
  { label: "Agenda", href: "/agenda", icon: Calendar },
  {
    label: "Automacao",
    href: "/automations",
    icon: Zap,
    children: [
      { label: "Agente IA Nativo", href: "/automations/agents" },
      { label: "Assistentes IA", href: "/automations/assistant" },
      { label: "Webhook IA", href: "/automations/webhook" },
      { label: "Tools", href: "/automations/tools" },
    ],
  },
  { label: "Campanhas", href: "/campaigns", icon: Megaphone },
  { label: "Relatorios", href: "/reports", icon: BarChart3 },
  { label: "Config", href: "/settings", icon: Settings },
];

export const clientMobileItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Leads", href: "/leads", icon: Users },
  { label: "CRM", href: "/crm", icon: Kanban },
];
