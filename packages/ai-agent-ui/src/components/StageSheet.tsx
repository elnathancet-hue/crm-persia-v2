"use client";

import * as React from "react";
import { Loader2, Save, Wrench } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentStage,
  AgentStageTool,
  AgentTool,
  CreateStageInput,
  NativeToolPreset,
  UpdateStageInput,
} from "@persia/shared/ai-agent";
import {
  clampRagTopK,
  getPreset,
  RAG_TOP_K_DEFAULT,
  RAG_TOP_K_MAX,
  RAG_TOP_K_MIN,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { Layers } from "lucide-react";
import { useAgentActions } from "../context";
import { renderToolIcon } from "../icon-map";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  stage?: AgentStage;
  tools: AgentTool[];
  isPending: boolean;
  onSubmit: (input: CreateStageInput | UpdateStageInput) => void;
}

export function StageSheet({ open, onOpenChange, mode, stage, tools, isPending, onSubmit }: Props) {
  const [situation, setSituation] = React.useState("");
  const [instruction, setInstruction] = React.useState("");
  const [transitionHint, setTransitionHint] = React.useState("");
  const [ragEnabled, setRagEnabled] = React.useState(false);
  const [ragTopK, setRagTopK] = React.useState<number>(RAG_TOP_K_DEFAULT);

  React.useEffect(() => {
    if (open) {
      setSituation(stage?.situation ?? "");
      setInstruction(stage?.instruction ?? "");
      setTransitionHint(stage?.transition_hint ?? "");
      setRagEnabled(stage?.rag_enabled ?? false);
      setRagTopK(clampRagTopK(stage?.rag_top_k));
    }
  }, [open, stage]);

  const trimmedSituation = situation.trim();
  const trimmedInstruction = instruction.trim();
  const situationError = !trimmedSituation
    ? "Situação é obrigatória"
    : trimmedSituation.length < 2
      ? "Mínimo 2 caracteres"
      : null;
  const instructionError = !trimmedInstruction
    ? "Instrução é obrigatória"
    : null;
  const formInvalid = !!situationError || !!instructionError;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (formInvalid) return;
    onSubmit({
      situation: trimmedSituation,
      instruction: trimmedInstruction,
      transition_hint: transitionHint.trim() || undefined,
      rag_enabled: ragEnabled,
      rag_top_k: ragTopK,
    });
  };

  const dialogTitle = mode === "create" ? "Nova etapa" : "Editar etapa";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <DialogHero
            icon={<Layers className="size-5" />}
            title={dialogTitle}
            tagline="Situação específica da conversa + instrução do agente"
          />
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-5">
          <form onSubmit={handleSave} className="space-y-4" id="stage-form">
            <div className="space-y-2">
              <Label htmlFor="situation">Situação</Label>
              <Input
                id="situation"
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                placeholder="Ex: Boas-vindas, Qualificação, Apresentação da oferta"
                required
                autoFocus
                aria-invalid={!!situationError && situation.length > 0}
                className={situationError && situation.length > 0 ? "border-destructive focus-visible:ring-destructive/40" : undefined}
              />
              {situationError && situation.length > 0 ? (
                <p className="text-xs text-destructive">{situationError}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="instruction">Instrução do agente</Label>
              <Textarea
                id="instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="O que o agente deve fazer nesta etapa? Ex: Cumprimente o cliente pelo nome, se apresente brevemente, pergunte como pode ajudar."
                rows={8}
                aria-invalid={!!instructionError && instruction.length > 0}
                className={instructionError && instruction.length > 0 ? "border-destructive focus-visible:ring-destructive/40" : undefined}
              />
              {instructionError && instruction.length > 0 ? (
                <p className="text-xs text-destructive">{instructionError}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="transition_hint">Dica de transição</Label>
              <Textarea
                id="transition_hint"
                value={transitionHint}
                onChange={(e) => setTransitionHint(e.target.value)}
                placeholder="Quando avançar para a próxima etapa? Ex: Após o cliente responder o primeiro cumprimento."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Opcional. Ajuda o agente a decidir quando avançar no fluxo.
              </p>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <Label htmlFor="rag_enabled" className="cursor-pointer">
                    Consultar base de conhecimento
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Injeta FAQ e documentos relevantes antes de cada resposta nesta etapa. Configure o conteudo nas abas FAQ e Documentos.
                  </p>
                </div>
                <Switch
                  id="rag_enabled"
                  checked={ragEnabled}
                  onCheckedChange={(v) => setRagEnabled(Boolean(v))}
                />
              </div>
              {ragEnabled ? (
                <div className="space-y-1.5 pl-0">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="rag_top_k">Trechos recuperados</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {ragTopK}
                    </span>
                  </div>
                  <input
                    id="rag_top_k"
                    type="range"
                    min={RAG_TOP_K_MIN}
                    max={RAG_TOP_K_MAX}
                    step={1}
                    value={ragTopK}
                    onChange={(e) => setRagTopK(clampRagTopK(Number(e.target.value)))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
                    <span>{RAG_TOP_K_MIN}</span>
                    <span>Padrao {RAG_TOP_K_DEFAULT}</span>
                    <span>{RAG_TOP_K_MAX}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Quantos trechos mais relevantes injetar no prompt. Valores altos adicionam contexto, mas custam mais tokens.
                  </p>
                </div>
              ) : null}
            </div>
          </form>

          {mode === "edit" && stage ? (
            <div className="pt-4 mt-4 border-t border-border">
              <StageToolsAllowlist stageId={stage.id} tools={tools} />
            </div>
          ) : null}
        </div>
        {/* PR-CRMUI: footer respiravel — px-6 py-4 + gap-3 + min-w. */}
        <DialogFooter className="border-t border-border bg-card px-6 py-4 flex-row justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="min-w-24"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="stage-form"
            disabled={isPending || formInvalid}
            className="min-w-28"
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {mode === "create" ? "Criar etapa" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StageToolsAllowlist({ stageId, tools }: { stageId: string; tools: AgentTool[] }) {
  const { listStageTools, setStageTool } = useAgentActions();
  const [allowlist, setAllowlist] = React.useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [pendingToolId, setPendingToolId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listStageTools(stageId)
      .then((rows: AgentStageTool[]) => {
        if (cancelled) return;
        const map = new Map<string, boolean>();
        for (const row of rows) {
          map.set(row.tool_id, row.is_enabled);
        }
        setAllowlist(map);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Falha ao carregar ferramentas");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stageId, listStageTools]);

  const handleToggle = (toolId: string, nextEnabled: boolean) => {
    setPendingToolId(toolId);
    setStageTool({ stage_id: stageId, tool_id: toolId, is_enabled: nextEnabled })
      .then(() => {
        setAllowlist((prev) => new Map(prev).set(toolId, nextEnabled));
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Falha ao salvar permissão");
      })
      .finally(() => {
        setPendingToolId(null);
      });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Wrench className="size-4 text-muted-foreground" />
        <Label className="font-medium">Ferramentas permitidas nesta etapa</Label>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        O agente so chama decisões que você habilitar aqui.
      </p>

      {tools.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center border rounded-md border-dashed">
          Nenhuma ferramenta configurada no agente. Adicione em <strong>Ferramentas</strong> primeiro.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="size-3 animate-spin" />
          Carregando...
        </div>
      ) : (
        <div className="space-y-1.5">
          {tools.map((tool) => (
            <StageToolRow
              key={tool.id}
              tool={tool}
              enabled={allowlist.get(tool.id) ?? false}
              pending={pendingToolId === tool.id}
              onToggle={(v) => handleToggle(tool.id, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StageToolRow({
  tool,
  enabled,
  pending,
  onToggle,
}: {
  tool: AgentTool;
  enabled: boolean;
  pending: boolean;
  onToggle: (v: boolean) => void;
}) {
  const preset: NativeToolPreset | undefined = tool.native_handler
    ? getPreset(tool.native_handler)
    : undefined;

  return (
    <div className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/40">
      <div className="size-7 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {renderToolIcon(preset?.icon_name ?? "HelpCircle", { className: "size-3.5" })}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {preset?.display_name ?? tool.name}
        </p>
      </div>
      {pending ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : null}
      <Switch
        checked={enabled}
        onCheckedChange={(v) => onToggle(Boolean(v))}
        disabled={pending || !tool.is_enabled}
        aria-label={`Permitir ${preset?.display_name ?? tool.name} nesta etapa`}
      />
    </div>
  );
}
