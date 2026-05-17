"use client";

import * as React from "react";
import {
  Bell,
  CalendarPlus,
  Image as ImageIcon,
  Loader2,
  Tag,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import type { AgentTool, NativeHandlerName } from "@persia/shared/ai-agent";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Label } from "@persia/ui/label";
import { Switch } from "@persia/ui/switch";
import { useAgentActions } from "../context";

// PR-AGENT-INTEGRATION-2 (mai/2026): card visual de "ferramentas
// rapidas" em Regras. Antes, cliente leigo tinha que ir no ToolsTab
// interno + clicar "Adicionar preset" + selecionar handler — fluxo
// de 4 cliques pra cada feature simples. Agora: 1 toggle.
//
// Cobre as 5 acoes mais comuns. Tools mais raras (transfer_to_user,
// transfer_to_stage, transfer_to_agent, schedule_event) continuam no
// ToolsTab pra cliente avancado.
//
// stop_agent NAO aparece aqui — quem controla esse comportamento e o
// switch "Permitir transferir pra humano" no card pai.

interface QuickTool {
  handler: NativeHandlerName;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const QUICK_TOOLS: ReadonlyArray<QuickTool> = [
  {
    handler: "add_tag",
    label: "Etiquetar lead",
    description: "Agente adiciona tags pra organizar leads no CRM.",
    Icon: Tag,
  },
  {
    handler: "move_pipeline_stage",
    label: "Mover lead no funil",
    description: "Agente avança o lead entre etapas do Kanban.",
    Icon: Workflow,
  },
  {
    handler: "create_appointment",
    label: "Agendar reunião",
    description: "Agente marca reuniões direto na sua Agenda interna.",
    Icon: CalendarPlus,
  },
  {
    handler: "send_media",
    label: "Enviar mídia",
    description: "Agente envia imagens, PDFs e vídeos da Biblioteca.",
    Icon: ImageIcon,
  },
  {
    handler: "trigger_notification",
    label: "Notificar equipe",
    description: "Agente dispara templates pra equipe quando precisar.",
    Icon: Bell,
  },
];

interface Props {
  configId: string;
  tools: AgentTool[];
  onChange: (next: AgentTool[]) => void;
}

export function QuickToolsCard({ configId, tools, onChange }: Props) {
  const { setNativeToolEnabled } = useAgentActions();
  const [pending, setPending] = React.useState<NativeHandlerName | null>(null);

  function isEnabled(handler: NativeHandlerName): boolean {
    const tool = tools.find(
      (t) => t.native_handler === handler && t.execution_mode === "native",
    );
    return Boolean(tool?.is_enabled);
  }

  async function handleToggle(handler: NativeHandlerName, enabled: boolean) {
    setPending(handler);
    try {
      const result = await setNativeToolEnabled({
        config_id: configId,
        handler,
        enabled,
      });
      // Update local tools list: replace existing or append.
      const next = tools.some((t) => t.id === result.id)
        ? tools.map((t) => (t.id === result.id ? result : t))
        : [...tools, result];
      onChange(next);
      toast.success(
        enabled
          ? `Ferramenta ativada`
          : `Ferramenta desativada`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao atualizar ferramenta",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ferramentas do agente</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Habilite as ações que o agente pode executar durante a conversa.
          Você pode refinar permissões por etapa em <strong>Etapas</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {QUICK_TOOLS.map((qt) => {
          const enabled = isEnabled(qt.handler);
          const isLoading = pending === qt.handler;
          return (
            <div
              key={qt.handler}
              className="flex items-start justify-between gap-3 pb-3 last:pb-0 border-b last:border-b-0 border-border/40"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span
                  className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
                    enabled
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <qt.Icon className="size-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <Label
                    htmlFor={`quick-tool-${qt.handler}`}
                    className="cursor-pointer text-sm"
                  >
                    {qt.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {qt.description}
                  </p>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {isLoading ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : null}
                <Switch
                  id={`quick-tool-${qt.handler}`}
                  checked={enabled}
                  disabled={isLoading}
                  onCheckedChange={(v) => handleToggle(qt.handler, Boolean(v))}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
