"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ListChecks,
  MessageCircle,
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
