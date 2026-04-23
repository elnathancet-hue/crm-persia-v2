"use client";

import * as React from "react";
import { Loader2, Save } from "lucide-react";
import type {
  AgentStage,
  CreateStageInput,
  UpdateStageInput,
} from "@persia/shared/ai-agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  stage?: AgentStage;
  isPending: boolean;
  onSubmit: (input: CreateStageInput | UpdateStageInput) => void;
}

export function StageSheet({ open, onOpenChange, mode, stage, isPending, onSubmit }: Props) {
  const [situation, setSituation] = React.useState("");
  const [instruction, setInstruction] = React.useState("");
  const [transitionHint, setTransitionHint] = React.useState("");
  const [ragEnabled, setRagEnabled] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSituation(stage?.situation ?? "");
      setInstruction(stage?.instruction ?? "");
      setTransitionHint(stage?.transition_hint ?? "");
      setRagEnabled(stage?.rag_enabled ?? false);
    }
  }, [open, stage]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSituation = situation.trim();
    if (!trimmedSituation) return;
    onSubmit({
      situation: trimmedSituation,
      instruction: instruction.trim(),
      transition_hint: transitionHint.trim() || undefined,
      rag_enabled: ragEnabled,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "Nova etapa" : "Editar etapa"}</SheetTitle>
          <SheetDescription>
            A etapa descreve uma situacao especifica da conversa. O agente segue a instrucao ate detectar a transicao.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto space-y-4 px-4" id="stage-form">
          <div className="space-y-2">
            <Label htmlFor="situation">Situacao</Label>
            <Input
              id="situation"
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              placeholder="Ex: Boas-vindas, Qualificacao, Apresentacao da oferta"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instruction">Instrucao do agente</Label>
            <Textarea
              id="instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="O que o agente deve fazer nesta etapa? Ex: Cumprimente o cliente pelo nome, se apresente brevemente, pergunte como pode ajudar."
              rows={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transition_hint">Dica de transicao</Label>
            <Textarea
              id="transition_hint"
              value={transitionHint}
              onChange={(e) => setTransitionHint(e.target.value)}
              placeholder="Quando avancar para a proxima etapa? Ex: Apos o cliente responder o primeiro cumprimento."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Opcional. Ajuda o agente a decidir quando avancar no fluxo.
            </p>
          </div>
          <div className="flex items-start justify-between gap-3 pt-2 border-t">
            <div className="flex-1 min-w-0">
              <Label htmlFor="rag_enabled" className="cursor-pointer">
                Consultar base de conhecimento
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Injeta FAQ e documentos relevantes antes de cada resposta nesta etapa. Requer Fase RAG (PR6).
              </p>
            </div>
            <Switch
              id="rag_enabled"
              checked={ragEnabled}
              onCheckedChange={(v) => setRagEnabled(Boolean(v))}
            />
          </div>
        </form>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="stage-form" disabled={isPending || !situation.trim()}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {mode === "create" ? "Criar etapa" : "Salvar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
