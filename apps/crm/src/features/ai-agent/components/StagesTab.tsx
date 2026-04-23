"use client";

import * as React from "react";
import { GripVertical, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentStage, CreateStageInput, UpdateStageInput } from "@persia/shared/ai-agent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createStage, deleteStage, updateStage } from "@/actions/ai-agent/stages";
import { StageSheet } from "./StageSheet";

interface Props {
  configId: string;
  stages: AgentStage[];
  onChange: (next: AgentStage[]) => void;
}

export function StagesTab({ configId, stages, onChange }: Props) {
  const [editing, setEditing] = React.useState<AgentStage | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AgentStage | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const handleCreate = (input: CreateStageInput) => {
    startTransition(async () => {
      try {
        const created = await createStage(configId, {
          ...input,
          order_index: stages.length,
        });
        onChange([...stages, created]);
        setCreating(false);
        toast.success("Etapa criada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao criar etapa");
      }
    });
  };

  const handleUpdate = (stageId: string, input: UpdateStageInput) => {
    startTransition(async () => {
      try {
        const updated = await updateStage(stageId, input);
        onChange(stages.map((s) => (s.id === stageId ? updated : s)));
        setEditing(null);
        toast.success("Etapa atualizada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
      }
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      try {
        await deleteStage(target.id);
        onChange(stages.filter((s) => s.id !== target.id));
        setDeleteTarget(null);
        toast.success("Etapa removida");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      }
    });
  };

  const sorted = [...stages].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            O agente avanca pelas etapas conforme a conversa evolui. Cada etapa tem uma situacao, instrucao e dica de transicao.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" disabled title="Disponivel na PR8">
            <Wand2 className="size-4" />
            Gerar etapas com IA
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Nova etapa
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyStages onCreate={() => setCreating(true)} />
      ) : (
        <div className="space-y-3">
          {sorted.map((stage, index) => (
            <StageCard
              key={stage.id}
              stage={stage}
              order={index + 1}
              onEdit={() => setEditing(stage)}
              onDelete={() => setDeleteTarget(stage)}
            />
          ))}
        </div>
      )}

      <StageSheet
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        isPending={isPending}
        onSubmit={(input) => handleCreate(input as CreateStageInput)}
      />
      <StageSheet
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        mode="edit"
        stage={editing ?? undefined}
        isPending={isPending}
        onSubmit={(input) => editing && handleUpdate(editing.id, input)}
      />
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover etapa?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente nao vai mais passar por <strong>{deleteTarget?.situation}</strong>. Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StageCard({
  stage,
  order,
  onEdit,
  onDelete,
}: {
  stage: AgentStage;
  order: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <GripVertical className="size-4 text-muted-foreground/50" />
          <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
            {order}
          </span>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{stage.situation}</p>
            {stage.rag_enabled ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-700 dark:text-purple-400 font-medium uppercase tracking-wider">
                RAG
              </span>
            ) : null}
          </div>
          {stage.instruction ? (
            <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">
              {stage.instruction}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/60 italic">Sem instrucao</p>
          )}
          {stage.transition_hint ? (
            <p className="text-xs text-muted-foreground mt-1.5">
              <span className="font-medium">Transicao:</span> {stage.transition_hint}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Editar etapa ${stage.situation}`}>
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Remover etapa ${stage.situation}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyStages({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
          <Plus className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h3 className="font-semibold">Sem etapas ainda</h3>
          <p className="text-sm text-muted-foreground">
            Uma etapa descreve o que o agente faz em cada fase da conversa. Comece com algo como <em>Boas-vindas</em>.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Criar primeira etapa
        </Button>
      </CardContent>
    </Card>
  );
}
