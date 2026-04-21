export const metadata = { title: "Automações" };
import { Bot, Scissors, Webhook, FolderOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

const automationLinks = [
  {
    title: "Assistentes IA",
    description: "Crie assistentes especializados para apoiar agentes no atendimento",
    href: "/automations/assistant",
    icon: Bot,
  },
  {
    title: "Webhook IA",
    description: "Conecte sua IA externa via webhook (n8n, Make, custom)",
    href: "/automations/webhook",
    icon: Webhook,
  },
  {
    title: "Tools",
    description: "Banco de imagens, PDFs e documentos para enviar nas automações",
    href: "/automations/tools",
    icon: FolderOpen,
  },
  {
    title: "Picotador de Mensagens",
    description: "Divida respostas longas em mensagens curtas e naturais no WhatsApp",
    href: "/automations/splitter",
    icon: Scissors,
  },
];

export default function AutomationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure como seu sistema atende e responde automaticamente
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {automationLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-6 flex items-start gap-4">
                  <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{link.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{link.description}</p>
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
