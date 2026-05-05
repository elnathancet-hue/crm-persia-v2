"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  ListChecks,
  Smartphone,
  Users,
  Webhook,
} from "lucide-react";

// PR-CRMOPS (mai/2026): tab "CRM" REMOVIDA. Configuracao do CRM voltou
// pra dentro do proprio modulo /crm — funis sao editados via drawer
// inline ("Editar estrutura"), tags e segmentos viraram tabs do CrmShell.
// O briefing do produto: o usuario nao deve sair do CRM pra mexer em
// nada do CRM. /settings/crm foi deletado junto.
//
// /settings/* fica reservado pra config DE NEGOCIO/SISTEMA (org,
// equipe, billing, integracoes). CRM nao se encaixa.
const tabs = [
  { label: "Organização", href: "/settings", icon: Building2 },
  { label: "Equipe", href: "/settings/team", icon: Users },
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
