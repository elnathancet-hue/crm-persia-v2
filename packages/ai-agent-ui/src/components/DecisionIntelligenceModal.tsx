"use client";

import * as React from "react";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentTool,
  NativeToolPreset,
  ToolCategory,
} from "@persia/shared/ai-agent";
import { NATIVE_TOOL_PRESETS } from "@persia/shared/ai-agent";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Badge } from "@persia/ui/badge";
import { cn } from "@persia/ui/utils";
import { useAgentActions } from "../context";
import { renderToolIcon } from "../icon-map";

interface Props {
  configId: string;
  existingTools: AgentTool[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (tool: AgentTool) => void;
}

const SHIPPED_PRS = new Set<NativeToolPreset["shipped_in_pr"]>(["PR1", "PR3", "PR7", "PR8"]);

// Display order + label PT-BR pra cada categoria. Ordem reflete o fluxo
// tipico de uso: comunicacao primeiro, atribuicao depois, midia/auxiliares
// no fim.
const CATEGORY_ORDER: ReadonlyArray<{ id: ToolCategory; label: string }> = [
  // PR-H: terminologia user-facing — "Funil" no lugar de "Kanban"
  { id: "kanban", label: "CRM (Funil)" },
  { id: "transfer", label: "Transferência" },
  { id: "handoff", label: "Encerramento" },
  { id: "tag", label: "Tags" },
  { id: "assignment", label: "Atribuição" },
  { id: "routing", label: "Distribuição" },
  { id: "notification", label: "Notificações" },
  { id: "scheduling", label: "Agendamento" },
  { id: "audio", label: "Mídia" },
];

export function DecisionIntelligenceModal({
  configId,
  existingTools,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const { createToolFromPreset } = useAgentActions();
  const [isPending, startTransition] = React.useTransition();
  const [pendingHandler, setPendingHandler] = React.useState<string | null>(null);

  const existingByHandler = React.useMemo(() => {
    const set = new Set<string>();
    for (const tool of existingTools) {
      if (tool.native_handler) set.add(tool.native_handler);
    }
    return set;
  }, [existingTools]);

  const handleAdd = (preset: NativeToolPreset) => {
    if (!SHIPPED_PRS.has(preset.shipped_in_pr)) return;
    if (existingByHandler.has(preset.handler)) return;
    setPendingHandler(preset.handler);
    startTransition(async () => {
      try {
        const created = await createToolFromPreset({
          config_id: configId,
          handler: preset.handler,
        });
        onCreated(created);
        toast.success(`Ferramenta '${preset.display_name}' habilitada`);
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao adicionar ferramenta");
      } finally {
        setPendingHandler(null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="size-4 text-white" />
            </div>
            <DialogTitle>Adicionar Decisão Inteligente</DialogTitle>
          </div>
          <DialogDescription>
            Cada decisão vira uma ferramenta que o agente pode chamar quando a situação pedir. Depois você controla em quais etapas ela está disponível.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {CATEGORY_ORDER.map(({ id, label }) => {
            const presetsInCategory = NATIVE_TOOL_PRESETS.filter(
              (p) =>
                p.category === id &&
                // trigger_notification eh registrada implicitamente por
                // cada template em "Notificacoes" — esconder do modal pra
                // nao induzir o admin a criar uma tool orfa.
                p.handler !== "trigger_notification",
            );
            if (presetsInCategory.length === 0) return null;
            return (
              <section key={id} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {presetsInCategory.map((preset) => (
                    <PresetCard
                      key={preset.handler}
                      preset={preset}
                      already={existingByHandler.has(preset.handler)}
                      pending={pendingHandler === preset.handler && isPending}
                      onAdd={() => handleAdd(preset)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PresetCard({
  preset,
  already,
  pending,
  onAdd,
}: {
  preset: NativeToolPreset;
  already: boolean;
  pending: boolean;
  onAdd: () => void;
}) {
  const shipped = SHIPPED_PRS.has(preset.shipped_in_pr);
  const disabled = !shipped || already || pending;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      className={cn(
        "group text-left rounded-xl border bg-card p-4 transition-all",
        "flex items-start gap-3 min-h-[92px]",
        !disabled && "hover:border-primary/50 hover:shadow-sm cursor-pointer",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <div
        className={cn(
          "size-10 rounded-lg flex items-center justify-center shrink-0 transition-colors",
          shipped ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {pending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : !shipped ? (
          <Lock className="size-4" />
        ) : (
          renderToolIcon(preset.icon_name, { className: "size-5" })
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{preset.display_name}</p>
          {already ? (
            <Badge variant="secondary" className="text-[10px]">
              Já adicionada
            </Badge>
          ) : !shipped ? (
            <Badge variant="outline" className="text-[10px]">
              Em breve
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {preset.ui_description}
        </p>
      </div>
    </button>
  );
}
