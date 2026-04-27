"use client";

// Drawer "Configurar funis" — abre dentro do /crm sem sair da pagina.
// Espelha o design da referencia: cada funil eh um card com 3 colunas
// (EM ANDAMENTO / FALHA / BEM-SUCEDIDO), stages categorizadas pelo
// outcome, drag-drop entre colunas atualiza outcome via mutation
// updateStage. CRUD basico (criar funil/stage, editar nome, deletar).
//
// Pra editar configuracoes detalhadas (cor, descricao), o link "Editar
// avancado" leva pra /crm/settings (pagina dedicada existente).

import * as React from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Pipeline, Stage, StageOutcome } from "@persia/shared/crm";
import { Button } from "@persia/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
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
import {
  createPipeline,
  createStage,
  deletePipeline,
  deleteStage,
  updatePipelineName,
  updateStage,
} from "@/actions/crm";

// Layout dos 3 buckets (mesma ordem da Fase 1 — em_andamento/falha/bem_sucedido).
// Cores espelham as pills do filtro do Kanban pra coerencia visual.
interface BucketDef {
  outcome: StageOutcome;
  label: string;
  /** Cor do header de coluna (texto + accent). */
  headerColor: string;
  /** Cor de fundo do card de stage (claro). */
  bgColor: string;
}

const BUCKETS: BucketDef[] = [
  {
    outcome: "em_andamento",
    label: "EM ANDAMENTO",
    headerColor: "text-purple-700",
    bgColor: "bg-blue-50 hover:bg-blue-100",
  },
  {
    outcome: "falha",
    label: "FALHA",
    headerColor: "text-red-600",
    bgColor: "bg-red-50 hover:bg-red-100",
  },
  {
    outcome: "bem_sucedido",
    label: "BEM-SUCEDIDO",
    headerColor: "text-emerald-600",
    bgColor: "bg-emerald-50 hover:bg-emerald-100",
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  stages: Stage[];
  /** Callback quando algo muda, pra o pai sincronizar state local. */
  onChange?: () => void;
}

export function PipelineConfigDrawer({
  open,
  onOpenChange,
  pipelines: initialPipelines,
  stages: initialStages,
  onChange,
}: Props) {
  // Estado local pra updates otimistas (UI responsiva enquanto o
  // server confirma). Sync com props quando o drawer reabre.
  const [pipelines, setPipelines] = React.useState(initialPipelines);
  const [stages, setStages] = React.useState(initialStages);
  const [isPending, startTransition] = React.useTransition();
  const [stagedDelete, setStagedDelete] = React.useState<
    | { type: "pipeline"; id: string; name: string }
    | { type: "stage"; id: string; name: string }
    | null
  >(null);
  const [draggedStageId, setDraggedStageId] = React.useState<string | null>(
    null,
  );
  const [dragOverBucket, setDragOverBucket] = React.useState<{
    pipelineId: string;
    outcome: StageOutcome;
  } | null>(null);

  // Re-hidrata quando reabrir (caso parent tenha refetched).
  React.useEffect(() => {
    if (open) {
      setPipelines(initialPipelines);
      setStages(initialStages);
    }
  }, [open, initialPipelines, initialStages]);

  function notify() {
    onChange?.();
  }

  // ============================================================
  // Handlers
  // ============================================================

  function handleCreatePipeline() {
    const name = window.prompt("Nome do novo funil:", "Novo funil");
    if (!name?.trim()) return;
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("name", name.trim());
        const created = await createPipeline(formData);
        if (created) {
          // Server retorna pipeline + cria stages padrao. Pega tudo
          // novamente via callback do parent (recarrega via revalidatePath).
          notify();
          toast.success("Funil criado");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao criar funil");
      }
    });
  }

  function handleRenamePipeline(p: Pipeline) {
    const next = window.prompt("Renomear funil:", p.name);
    if (!next?.trim() || next.trim() === p.name) return;
    const trimmed = next.trim();

    setPipelines((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, name: trimmed } : x)),
    );

    startTransition(async () => {
      try {
        await updatePipelineName(p.id, trimmed);
        toast.success("Funil renomeado");
        notify();
      } catch (err) {
        // Reverte
        setPipelines((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, name: p.name } : x)),
        );
        toast.error(err instanceof Error ? err.message : "Erro ao renomear");
      }
    });
  }

  function handleDeletePipeline() {
    if (stagedDelete?.type !== "pipeline") return;
    const target = stagedDelete;
    setStagedDelete(null);

    setPipelines((prev) => prev.filter((p) => p.id !== target.id));
    setStages((prev) => prev.filter((s) => s.pipeline_id !== target.id));

    startTransition(async () => {
      try {
        await deletePipeline(target.id);
        toast.success("Funil removido");
        notify();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao remover");
        notify(); // re-fetch pra reverter
      }
    });
  }

  function handleCreateStage(pipelineId: string, outcome: StageOutcome) {
    const name = window.prompt("Nome da nova etapa:");
    if (!name?.trim()) return;

    const pipelineStages = stages.filter((s) => s.pipeline_id === pipelineId);
    const sortOrder = pipelineStages.length;

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("pipeline_id", pipelineId);
        formData.set("name", name.trim());
        formData.set("sort_order", String(sortOrder));
        // createStage do wrapper usa outcome=em_andamento por default.
        // Se a coluna alvo for diferente, atualiza logo apos criar.
        const created = await createStage(formData);
        if (created && outcome !== "em_andamento") {
          await updateStage(
            (created as { id: string }).id,
            { outcome },
          );
        }
        notify();
        toast.success("Etapa criada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao criar etapa");
      }
    });
  }

  function handleRenameStage(s: Stage) {
    const next = window.prompt("Renomear etapa:", s.name);
    if (!next?.trim() || next.trim() === s.name) return;
    const trimmed = next.trim();

    setStages((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, name: trimmed } : x)),
    );

    startTransition(async () => {
      try {
        await updateStage(s.id, { name: trimmed });
        toast.success("Etapa renomeada");
        notify();
      } catch (err) {
        setStages((prev) =>
          prev.map((x) => (x.id === s.id ? { ...x, name: s.name } : x)),
        );
        toast.error(err instanceof Error ? err.message : "Erro ao renomear");
      }
    });
  }

  function handleDeleteStage() {
    if (stagedDelete?.type !== "stage") return;
    const target = stagedDelete;
    setStagedDelete(null);

    setStages((prev) => prev.filter((s) => s.id !== target.id));

    startTransition(async () => {
      try {
        await deleteStage(target.id);
        toast.success("Etapa removida");
        notify();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao remover");
        notify();
      }
    });
  }

  function handleMoveStageBetweenBuckets(
    stageId: string,
    targetOutcome: StageOutcome,
  ) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || stage.outcome === targetOutcome) return;

    // Optimistic update
    const previousOutcome = stage.outcome;
    setStages((prev) =>
      prev.map((s) =>
        s.id === stageId ? { ...s, outcome: targetOutcome } : s,
      ),
    );

    startTransition(async () => {
      try {
        await updateStage(stageId, { outcome: targetOutcome });
        toast.success("Etapa movida");
        notify();
      } catch (err) {
        // Reverte
        setStages((prev) =>
          prev.map((s) =>
            s.id === stageId ? { ...s, outcome: previousOutcome } : s,
          ),
        );
        toast.error(err instanceof Error ? err.message : "Erro ao mover");
      }
    });
  }

  // ============================================================
  // Drag handlers
  // ============================================================

  function handleDragStart(e: React.DragEvent, stageId: string) {
    setDraggedStageId(stageId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(
    e: React.DragEvent,
    pipelineId: string,
    outcome: StageOutcome,
  ) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverBucket({ pipelineId, outcome });
  }

  function handleDragLeave() {
    setDragOverBucket(null);
  }

  function handleDrop(pipelineId: string, outcome: StageOutcome) {
    setDragOverBucket(null);
    if (!draggedStageId) return;

    const stage = stages.find((s) => s.id === draggedStageId);
    setDraggedStageId(null);
    if (!stage || stage.pipeline_id !== pipelineId) return;
    handleMoveStageBetweenBuckets(stage.id, outcome);
  }

  // ============================================================
  // Render helpers
  // ============================================================

  function stagesForPipelineBucket(
    pipelineId: string,
    outcome: StageOutcome,
  ): Stage[] {
    return stages
      .filter((s) => s.pipeline_id === pipelineId && s.outcome === outcome)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-3xl overflow-y-auto"
        >
          <SheetHeader>
            <div className="flex items-center justify-between gap-3 pr-8">
              <SheetTitle>Configurar funis</SheetTitle>
              <Button
                size="sm"
                onClick={handleCreatePipeline}
                disabled={isPending}
              >
                <Plus className="size-4" />
                Novo funil
              </Button>
            </div>
            <SheetDescription>
              Arraste as etapas entre as colunas pra reclassificá-las. Para
              editar cor e descrição,{" "}
              <Link
                href="/crm/settings"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                abrir configurações avançadas
                <ExternalLink className="size-3" />
              </Link>
              .
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4 pb-6">
            {pipelines.length === 0 ? (
              <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                Nenhum funil ainda. Clique em &ldquo;Novo funil&rdquo; pra
                começar.
              </div>
            ) : (
              pipelines.map((pipeline) => (
                <PipelineCard
                  key={pipeline.id}
                  pipeline={pipeline}
                  stagesForBucket={(outcome) =>
                    stagesForPipelineBucket(pipeline.id, outcome)
                  }
                  isPending={isPending}
                  onRename={() => handleRenamePipeline(pipeline)}
                  onAskDelete={() =>
                    setStagedDelete({
                      type: "pipeline",
                      id: pipeline.id,
                      name: pipeline.name,
                    })
                  }
                  onCreateStage={(outcome) =>
                    handleCreateStage(pipeline.id, outcome)
                  }
                  onRenameStage={handleRenameStage}
                  onAskDeleteStage={(s) =>
                    setStagedDelete({ type: "stage", id: s.id, name: s.name })
                  }
                  onDragStart={handleDragStart}
                  onDragOver={(e, outcome) =>
                    handleDragOver(e, pipeline.id, outcome)
                  }
                  onDragLeave={handleDragLeave}
                  onDrop={(outcome) => handleDrop(pipeline.id, outcome)}
                  dragOverOutcome={
                    dragOverBucket?.pipelineId === pipeline.id
                      ? dragOverBucket.outcome
                      : null
                  }
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={stagedDelete !== null}
        onOpenChange={(o) => {
          if (!o) setStagedDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stagedDelete?.type === "pipeline"
                ? `Remover funil "${stagedDelete.name}"?`
                : `Remover etapa "${stagedDelete?.name ?? ""}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {stagedDelete?.type === "pipeline"
                ? "Todos os negócios e etapas deste funil serão removidos. Esta ação não pode ser desfeita."
                : "Os negócios desta etapa serão removidos. Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={
                stagedDelete?.type === "pipeline"
                  ? handleDeletePipeline
                  : handleDeleteStage
              }
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================
// PipelineCard — um funil com 3 colunas
// ============================================================

function PipelineCard({
  pipeline,
  stagesForBucket,
  isPending,
  onRename,
  onAskDelete,
  onCreateStage,
  onRenameStage,
  onAskDeleteStage,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverOutcome,
}: {
  pipeline: Pipeline;
  stagesForBucket: (outcome: StageOutcome) => Stage[];
  isPending: boolean;
  onRename: () => void;
  onAskDelete: () => void;
  onCreateStage: (outcome: StageOutcome) => void;
  onRenameStage: (s: Stage) => void;
  onAskDeleteStage: (s: Stage) => void;
  onDragStart: (e: React.DragEvent, stageId: string) => void;
  onDragOver: (e: React.DragEvent, outcome: StageOutcome) => void;
  onDragLeave: () => void;
  onDrop: (outcome: StageOutcome) => void;
  dragOverOutcome: StageOutcome | null;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-base font-semibold tracking-tight">
          {pipeline.name}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRename}
            disabled={isPending}
            title="Renomear funil"
          >
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onAskDelete}
            disabled={isPending}
            title="Remover funil"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
        {BUCKETS.map((bucket) => {
          const bucketStages = stagesForBucket(bucket.outcome);
          const isDropTarget = dragOverOutcome === bucket.outcome;
          return (
            <div
              key={bucket.outcome}
              onDragOver={(e) => onDragOver(e, bucket.outcome)}
              onDragLeave={onDragLeave}
              onDrop={() => onDrop(bucket.outcome)}
              className={`flex flex-col gap-2 rounded-lg p-2 transition-colors ${
                isDropTarget ? "bg-muted/40 ring-2 ring-primary/30" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2 px-1">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${bucket.headerColor}`}
                >
                  {bucket.label}
                </span>
                {bucket.outcome === "em_andamento" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onCreateStage(bucket.outcome)}
                    disabled={isPending}
                    title="Nova etapa neste bucket"
                    className="size-6"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2 min-h-[60px]">
                {bucketStages.map((stage) => (
                  <StagePill
                    key={stage.id}
                    stage={stage}
                    bgColor={bucket.bgColor}
                    onDragStart={onDragStart}
                    onRename={() => onRenameStage(stage)}
                    onAskDelete={() => onAskDeleteStage(stage)}
                    disabled={isPending}
                  />
                ))}
                {bucketStages.length === 0 ? (
                  <div className="rounded-md border border-dashed border-muted-foreground/20 p-3 text-center text-[11px] text-muted-foreground/60">
                    Arraste uma etapa aqui
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// StagePill — uma etapa arrastavel
// ============================================================

function StagePill({
  stage,
  bgColor,
  onDragStart,
  onRename,
  onAskDelete,
  disabled,
}: {
  stage: Stage;
  bgColor: string;
  onDragStart: (e: React.DragEvent, stageId: string) => void;
  onRename: () => void;
  onAskDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, stage.id)}
      className={`group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${bgColor} cursor-grab active:cursor-grabbing`}
    >
      <span className="line-clamp-1 flex-1 font-medium text-foreground/90">
        {stage.name}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          disabled={disabled}
          className="rounded p-0.5 hover:bg-foreground/5"
          title="Renomear"
        >
          <Pencil className="size-3 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAskDelete();
          }}
          disabled={disabled}
          className="rounded p-0.5 hover:bg-destructive/10"
          title="Remover"
        >
          <Trash2 className="size-3 text-destructive/70" />
        </button>
      </div>
    </div>
  );
}

