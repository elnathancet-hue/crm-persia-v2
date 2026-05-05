"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  Kanban,
  ListChecks,
  Smartphone,
  Users,
  Webhook,
} from "lucide-react";

// PR-CRMCFG: aba "CRM" inclui as 4 sub-tabs (Funis | Etiquetas | Motivos
// | Segmentos). Antes estavam em /crm/settings, atrelado visualmente ao
// Kanban via tab "Ajustes". Centralizado aqui pra ter 1 unico lugar
// onde se configura qualquer parte do sistema.
const tabs = [
  { label: "Organização", href: "/settings", icon: Building2 },
  { label: "Equipe", href: "/settings/team", icon: Users },
  { label: "CRM", href: "/settings/crm", icon: Kanban },
  { label: "Filas", href: "/settings/queues", icon: ListChecks },
  { label: "Webhooks", href: "/settings/webhooks", icon: Webhook },
  { label: "WhatsApp", href: "/settings/whatsapp", icon: Smartphone },
  { label: "Plano", href: "/settings/billing", icon: CreditCard },
];

export function SettingsNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight">Configurações</h1>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b pb-px">
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

      {/* Content */}
      {children}
    </div>
  );
}
