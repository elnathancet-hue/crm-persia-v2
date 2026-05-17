export const metadata = { title: "Automações" };
import { FolderOpen, Sparkles } from "lucide-react";
import { Card, CardContent } from "@persia/ui/card";
import Link from "next/link";

// PR-AUTOMATIONS-CLEANUP (mai/2026): hub reduzido de 5 cards pra 2.
// Assistentes IA, Webhook IA e Picotador (sistema legacy pre Agente
// Nativo) escondidos do hub — rotas continuam acessiveis por URL
// direta pra compatibilidade do pipeline (modes n8n + OpenAI fallback
// ainda leem essas configs).
const automationLinks = [
  {
    title: "Agente IA",
    description:
      "Configure um agente que responde no WhatsApp seguindo etapas, ferramentas e sua base de conhecimento.",
    href: "/automations/agents",
    icon: Sparkles,
  },
  {
    title: "Biblioteca de mídia",
    description:
      "Banco de imagens, PDFs, vídeos e documentos pra reaproveitar nas automações.",
    href: "/automations/tools",
    icon: FolderOpen,
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
                  <div className="flex-1 min-w-0">
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
