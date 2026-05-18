"use client";

import * as React from "react";
import {
  ArrowDown,
  CircleCheck,
  CirclePlay,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentActionType,
  AgentStage,
  AgentTool,
  CreateStageInput,
  UpdateStageInput,
} from "@persia/shared/ai-agent";

// PR-AGENT-INTEGRATION-4: labels curtos pro badge no timeline. Versao
// reduzida de ACTION_LABELS do StageSheet (so o label, sem help).
const ACTION_TYPE_LABELS: Record<AgentActionType, string> = {
  qualify: "Qualificar",
  send_material: "Enviar material",
  schedule: "Agendar",
  add_tag: "Etiquetar",
  move_pipeline: "Mover funil",
  transfer: "Transferir",
  free_message: "Mensagem livre",
};
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";
import { cn } from "@persia/ui/utils";
import { useAgentActions } from "../context";
import { StageSheet } from "./StageSheet";

// PR-AI-AGENT-TIMELINE (mai/2026): substitui a dupla list/flow por uma
// unica timeline vertical rica. Razao:
// - Lista plana de cards (sem conectores) escondia a sequencia.
// - Fluxograma horizontal em <lg quebrava com 6+ etapas.
// - Timeline vertical e o pattern de assistant builders (Custom GPT
//   stages, Claude Projects, n8n vertical view) — escaneamento natural
//   top-down, suporta N etapas sem disputa de espaco.
//
// Layout: coluna esquerda com nucleo numerado em circulo (size-10) +
// linha vertical contínua descendo entre nucleos. Coluna direita com
// card de stage + botoes inline. Hint de transicao aparece na linha entre
// nucleos (pilula).

interface Props {
  configId: string;
  stages: AgentStage[];
  tools: AgentTool[];
  onChange: (next: AgentStage[]) => void;
  // PR-AGENT-INTEGRATION-4: define se etapas sao acoes tipadas
  // (mode='actions', wizard novo) ou sub-prompts (mode='stages', legado).
  behaviorMode?: "stages" | "actions";
}

export function StagesTab({ configId, stages, tools, onChange, behaviorMode }: Props) {
  const { createStage, updateStage, deleteStage } = useAgentActions();
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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">
            O agente avança pelas etapas conforme a conversa evolui. Cada etapa tem
            uma situação, instrução e dica de transição pra próxima.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" disabled title="Em breve">
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
        <StageTimeline
          stages={sorted}
          onEdit={(s) => setEditing(s)}
          onDelete={(s) => setDeleteTarget(s)}
          onAdd={() => setCreating(true)}
        />
      )}

      <StageSheet
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        tools={tools}
        isPending={isPending}
        onSubmit={(input) => handleCreate(input as CreateStageInput)}
        behaviorMode={behaviorMode}
      />
      <StageSheet
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        mode="edit"
        stage={editing ?? undefined}
        tools={tools}
        isPending={isPending}
        onSubmit={(input) => editing && handleUpdate(editing.id, input)}
        behaviorMode={behaviorMode}
      />
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover etapa?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente não vai mais passar por <strong>{deleteTarget?.situation}</strong>.
              Esta ação não pode ser desfeita.
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

interface TimelineProps {
  stages: AgentStage[];
  onEdit: (stage: AgentStage) => void;
  onDelete: (stage: AgentStage) => void;
  onAdd: () => void;
}

function StageTimeline({ stages, onEdit, onDelete, onAdd }: TimelineProps) {
  return (
    <div className="relative">
      {/* Linha vertical contínua atras dos nucleos. Posicionada em
          left-5 pra alinhar com o centro do circulo numerado (size-10).
          Vai de top-3 (logo abaixo do start marker) ate antes do "+ nova"
          via mascara nos elementos. */}
      <div
        aria-hidden
        className="absolute left-5 top-12 bottom-12 w-px bg-border"
      />

      <StartMarker />

      <div className="space-y-1">
        {stages.map((stage, index) => (
          <React.Fragment key={stage.id}>
            {index > 0 ? (
              <TransitionConnector
                hint={stages[index - 1]!.transition_hint}
                fromOrder={index}
                toOrder={index + 1}
              />
            ) : null}
            <StageRow
              stage={stage}
              order={index + 1}
              isLast={index === stages.length - 1}
              onEdit={() => onEdit(stage)}
              onDelete={() => onDelete(stage)}
            />
          </React.Fragment>
        ))}
      </div>

      <TransitionConnector
        hint={stages[stages.length - 1]!.transition_hint}
        fromOrder={stages.length}
        toOrder={stages.length + 1}
        terminal
      />

      <button
        type="button"
        onClick={onAdd}
        className="relative flex items-center gap-3 ml-0 mt-2 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/30 transition-colors group w-full py-3 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="size-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
          <Plus className="size-5" />
        </span>
        <span>
          <span className="block text-sm font-medium text-foreground/90 group-hover:text-foreground">
            Adicionar próxima etapa
          </span>
          <span className="block text-xs text-muted-foreground">
            Continue o fluxo do agente sem voltar pro topo.
          </span>
        </span>
      </button>
    </div>
  );
}

function StartMarker() {
  return (
    <div className="relative flex items-center gap-3 pb-1">
      <span className="size-10 rounded-full bg-success text-success-foreground flex items-center justify-center shrink-0 shadow-sm ring-4 ring-background">
        <CirclePlay className="size-5" />
      </span>
      <div>
        <p className="text-sm font-semibold tracking-tight">Início da conversa</p>
        <p className="text-xs text-muted-foreground">
          O agente entra pela primeira etapa quando o lead manda a primeira mensagem.
        </p>
      </div>
    </div>
  );
}

function TransitionConnector({
  hint,
  fromOrder,
  toOrder,
  terminal = false,
}: {
  hint: string | null;
  fromOrder: number;
  toOrder: number;
  terminal?: boolean;
}) {
  const hasHint = hint !== null && hint.trim() !== "";
  return (
    <div className="relative flex items-center gap-3 pl-12 py-1.5">
      {hasHint ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-[11px] text-muted-foreground italic max-w-md">
          <ArrowDown className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{hint}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning-soft text-warning-soft-foreground text-[11px] italic">
          <TriangleAlert className="size-3 shrink-0" aria-hidden />
          <span>
            {terminal
              ? "Sem dica do que fazer ao terminar"
              : `Sem dica de transição da etapa ${fromOrder} pra ${toOrder}`}
          </span>
        </div>
      )}
    </div>
  );
}

function StageRow({
  stage,
  order,
  isLast,
  onEdit,
  onDelete,
}: {
  stage: AgentStage;
  order: number;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative flex items-start gap-3 group">
      <span
        className={cn(
          "size-10 rounded-full text-sm font-bold font-mono flex items-center justify-center shrink-0 shadow-sm ring-4 ring-background z-10",
          isLast
            ? "bg-success-soft text-success-soft-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        {isLast ? <CircleCheck className="size-5" /> : order}
      </span>
      <Card
        className="flex-1 min-w-0 transition-shadow hover:shadow-md cursor-pointer"
        onClick={onEdit}
      >
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <p className="font-semibold tracking-tight truncate">{stage.situation}</p>
              {/* PR-AGENT-INTEGRATION-4: badge do tipo de acao (so quando
                  agente esta em behavior_mode='actions' E stage tem
                  action_type setado). */}
              {stage.action_type ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
                  title={`Tipo de ação: ${ACTION_TYPE_LABELS[stage.action_type]}`}
                >
                  {ACTION_TYPE_LABELS[stage.action_type]}
                </span>
              ) : null}
              {stage.rag_enabled ? (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-progress-soft text-progress-soft-foreground font-medium"
                  title="Esta etapa consulta seus documentos antes de responder."
                >
                  Consulta documentos
                </span>
              ) : null}
              {isLast ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-soft text-success-soft-foreground font-medium">
                  Última etapa
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                aria-label={`Editar etapa ${stage.situation}`}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label={`Remover etapa ${stage.situation}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          {stage.instruction ? (
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
              {stage.instruction}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60 italic">Sem instrução</p>
          )}
        </CardContent>
      </Card>
    </div>
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
          <h3 className="font-semibold tracking-tight">Comece desenhando o fluxo</h3>
          <p className="text-sm text-muted-foreground">
            Cada etapa diz como o agente se comporta numa fase da conversa.
            A primeira costuma ser <em>Boas-vindas</em> — você adiciona
            qualificação, oferta e fechamento depois.
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
