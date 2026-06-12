import type React from "react";
import { Bot, CalendarClock, FolderOpen, Sparkles, Webhook } from "lucide-react";
import { Badge } from "@persia/ui/badge";
import { Card, CardContent } from "@persia/ui/card";
import Link from "next/link";

export const metadata = { title: "Automações" };

const automationLinks: Array<{
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string | null;
}> = [
  {
    title: "Agente IA",
    description: "Configure etapas, regras, limites e ferramentas do agente nativo para a conta selecionada",
    href: "/automations/agents",
    icon: Sparkles,
    badge: null,
  },
  {
    title: "Tipos de Agendamento",
    description: "Cadastre serviços que o agente IA pode agendar — nome, duração e canal padrão",
    href: "/automations/appointments",
    icon: CalendarClock,
    badge: null,
  },
  {
    title: "Arquivos",
    description: "Banco de imagens, PDFs e documentos para enviar nas automações",
    href: "/automations/tools",
    icon: FolderOpen,
    badge: null,
  },
  {
    title: "Assistentes IA",
    description: "Sistema legado — use o Agente IA para novos projetos",
    href: "/automations/assistant",
    icon: Bot,
    badge: "Legado",
  },
  {
    title: "Webhook IA",
    description: "Sistema legado — conecta IA externa via webhook (n8n)",
    href: "/automations/webhook",
    icon: Webhook,
    badge: "Legado",
  },
];

export default function AutomationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure como cada conta será atendida e automatizada dentro do Admin
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {automationLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="h-full cursor-pointer transition-colors hover:border-primary/50">
                <CardContent className="flex items-start gap-4 p-6">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{link.title}</p>
                      {link.badge ? (
                        <Badge variant="secondary" className="text-xs">
                          {link.badge}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{link.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
