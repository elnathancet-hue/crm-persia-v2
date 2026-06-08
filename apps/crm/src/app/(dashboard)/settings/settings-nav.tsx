"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Calendar,
  CreditCard,
  Globe,
  KeyRound,
  ListChecks,
  Plug,
  Settings,
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
  { label: "API", href: "/settings/api-keys", icon: KeyRound },
  { label: "Origens", href: "/settings/capture-sources", icon: Globe },
  { label: "WhatsApp", href: "/settings/whatsapp", icon: Smartphone },
  { label: "Google Calendar", href: "/settings/google-calendar", icon: Calendar },
  { label: "Servidores MCP", href: "/settings/mcp-servers", icon: Plug },
  { label: "Plano", href: "/settings/billing", icon: CreditCard },
];

export function SettingsNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      {/* Header — ícone + título + subtítulo */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Settings className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground">
            Organização, equipe, billing e integrações
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap transition-colors relative ${
                isActive
                  ? "text-primary font-medium after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Content */}
      <div className="max-w-3xl">
        {children}
      </div>
    </div>
  );
}
