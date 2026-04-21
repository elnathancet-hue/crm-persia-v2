"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Users, ListChecks, Webhook, Bot, MessageCircle, FileText, ShieldCheck } from "lucide-react";

const tabs = [
  { label: "Organização", href: "/settings", icon: Building2 },
  { label: "Equipe", href: "/settings/team", icon: Users },
  { label: "Filas", href: "/settings/queues", icon: ListChecks },
  { label: "Webhooks", href: "/settings/webhooks", icon: Webhook },
  { label: "IA", href: "/settings/ai", icon: Bot },
  { label: "WhatsApp", href: "/settings/whatsapp", icon: MessageCircle },
  { label: "Templates", href: "/settings/templates", icon: FileText },
  { label: "Admin", href: "/settings/admin", icon: ShieldCheck },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground">Configurações</h1>

      {/* Tabs */}
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

      {/* Content */}
      {children}
    </div>
  );
}
