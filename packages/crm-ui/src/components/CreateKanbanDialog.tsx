"use client";

// PR-CRMOPS: Dialog simples pra "+ Criar novo Kanban".
//
// Briefing: "abrir um dialog simples: Nome do Kanban + Criar. Depois
// de criar, selecionar automaticamente o novo Kanban."
//
// Reusa createPipeline do KanbanActions (que ja existe). Nao cria
// logica paralela (regra 11 do briefing).

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";

import { useKanbanActions } from "../context";
import { DialogHero } from "./DialogHero";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disparado com o id do Kanban recem-criado pra o pai selecionar
   * automaticamente (briefing PR-CRMOPS). */
  onCreated: (newPipelineId: string) => void;
}

export function CreateKanbanDialog({ open, onOpenChange, onCreated }: Props) {
  const actions = useKanbanActions();
  const [name, setName] = React.useState("");
  const [isPending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      // Auto-focus pra fluxo rapido
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || isPending) return;
    startTransition(async () => {
      try {
        const created = await actions.createPipeline(trimmed);
        if (created?.id) {
          onCreated(created.id);
          onOpenChange(false);
          setName("");
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[CreateKanbanDialog] createPipeline:", err);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Novo Kanban</DialogTitle>
          <DialogHero
            icon={<Plus className="size-5" />}
            title="Novo Kanban"
            tagline="Crie um novo funil de vendas"
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kanban-name" className="text-sm font-medium">
              Nome do Kanban
            </Label>
            <Input
              id="kanban-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Funil de Vendas B2B"
              maxLength={60}
              disabled={isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || isPending}
            className="w-full h-11 font-medium rounded-md"
          >
            {isPending ? "Criando..." : "Criar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
