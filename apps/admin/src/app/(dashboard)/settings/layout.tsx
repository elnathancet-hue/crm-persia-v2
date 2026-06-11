"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Calendar,
  Code2,
  CreditCard,
  Key,
  ListChecks,
  MessageCircle,
  Radio,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import { useShellContext } from "@/lib/shell-context";

const clientTabs = [
  { label: "Organização", href: "/settings", icon: Building2 },
  { label: "Equipe", href: "/settings/team", icon: Users },
  { label: "Filas", href: "/settings/queues", icon: ListChecks },
  { label: "Webhooks", href: "/settings/webhooks", icon: Webhook },
  { label: "WhatsApp", href: "/settings/whatsapp", icon: MessageCircle },
  { label: "Chaves de API", href: "/settings/api-keys", icon: Key },
  { label: "Google Agenda", href: "/settings/google-calendar", icon: Calendar },
  { label: "Servidores MCP", href: "/settings/mcp-servers", icon: Code2 },
  { label: "Origens de Captura", href: "/settings/capture-sources", icon: Radio },
  { label: "Plano", href: "/settings/billing", icon: CreditCard },
];

const adminTabs = [
  { label: "Admin", href: "/settings/admin", icon: ShieldCheck },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode } = useShellContext();
  const tabs = mode === "client" ? clientTabs : adminTabs;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground">Configurações</h1>

      <div className="flex gap-1 overflow-x-auto border-b border-border pb-px">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap rounded-t-lg transition-colors ${
                isActive
                  ? "text-primary border-b-2 border-primary bg-card"
                  : "text-muted-foreground hover:text-foreground hover:bg-card"
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
