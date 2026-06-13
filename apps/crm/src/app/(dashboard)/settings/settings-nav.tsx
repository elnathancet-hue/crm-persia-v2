"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Users,
  GitBranch,
  CreditCard,
  MessageSquare,
  Calendar,
  Webhook,
  Server,
  Key,
  Magnet,
  Settings,
} from "lucide-react";

// PR-CRMOPS (mai/2026): tab "CRM" REMOVIDA. Configuracao do CRM voltou
// pra dentro do proprio modulo /crm — funis sao editados via drawer
// inline ("Editar estrutura"), tags e segmentos viraram tabs do CrmShell.
// O briefing do produto: o usuario nao deve sair do CRM pra mexer em
// nada do CRM. /settings/crm foi deletado junto.
//
// /settings/* fica reservado pra config DE NEGOCIO/SISTEMA (org,
// equipe, billing, integracoes). CRM nao se encaixa.

const groups = [
  {
    label: "Empresa",
    items: [
      { label: "Configuração do Perfil", href: "/settings",          icon: Building2 },
      { label: "Gestão de usuários",     href: "/settings/team",     icon: Users },
      { label: "Filas",                  href: "/settings/queues",   icon: GitBranch },
      { label: "Plano",                  href: "/settings/billing",  icon: CreditCard },
    ],
  },
  {
    label: "Integração",
    items: [
      { label: "WhatsApp",       href: "/settings/whatsapp",         icon: MessageSquare },
      { label: "Google",         href: "/settings/google-calendar",  icon: Calendar },
      { label: "Webhook",        href: "/settings/webhooks",         icon: Webhook },
      { label: "Servidores API", href: "/settings/mcp-servers",      icon: Server },
      { label: "API",            href: "/settings/api-keys",         icon: Key },
      { label: "Formulário",     href: "/settings/capture-sources",  icon: Magnet },
    ],
  },
];

export function SettingsNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Settings className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground">Empresa, equipe e integrações</p>
        </div>
      </div>

      {/* Body — sidebar + content */}
      <div className="flex gap-8">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map(({ label, href, icon: Icon }) => {
                  const isActive = pathname === href;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <Icon className="size-4 shrink-0" />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1 max-w-3xl">
          {children}
        </div>
      </div>
    </div>
  );
}
