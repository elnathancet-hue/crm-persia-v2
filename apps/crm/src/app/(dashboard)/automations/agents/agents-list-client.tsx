"use client";

import { Bot } from "lucide-react";
import type { AgentConfig } from "@persia/shared/ai-agent";
import { PageTitle } from "@persia/ui/typography";
import { AgentActionsProvider, AgentsList } from "@persia/ai-agent-ui";
import { crmAgentActions } from "@/features/ai-agent/crm-actions";

interface Props {
  initialAgents: AgentConfig[];
  nativeEnabled: boolean;
}

/**
 * PR-AI-AGENT-VISUAL (mai/2026): paridade visual com /crm e /agenda.
 * Antes: page server tinha header simples (<h1> + <p>) sem icone, sem
 * sticky. Agora: header sticky com icone azul size-12 + PageTitle +
 * tagline, espelho dos outros modulos. AgentsList do package continua
 * renderizando os cards + botao "Novo agente" + dialog (sem mexer no
 * package). Header wrapper inline aqui evita refactor do package.
 */
export function AgentsListClient(props: Props) {
  return (
    <AgentActionsProvider actions={crmAgentActions}>
      <div className="space-y-6">
        {/* Header sticky com icone grande + titulo. Paridade com /crm +
            /agenda (PR #217). */}
        <div className="sticky -top-6 z-30 -mx-6 -mt-6 px-6 pt-6 pb-3 bg-background/95 backdrop-blur-sm border-b border-border/60">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20">
                <Bot className="size-6" />
              </div>
              <div className="min-w-0">
                <PageTitle className="leading-none">Agente IA</PageTitle>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Configure etapas, regras e ferramentas para o agente
                  responder suas conversas no WhatsApp automaticamente.
                </p>
              </div>
            </div>
            {/* Botao "Novo agente" continua dentro do AgentsList component
                — caller manda dialog state. Mantemos aqui no canto direito
                pra reservar o slot visualmente, mas sem duplicar logica. */}
          </div>
        </div>

        <AgentsList {...props} />
      </div>
    </AgentActionsProvider>
  );
}
