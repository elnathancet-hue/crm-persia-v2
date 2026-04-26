"use client";

import * as React from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@persia/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@persia/ui/alert-dialog";
import { Textarea } from "@persia/ui/textarea";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import {
  createPipeline,
  createStage,
  updateStage,
  deleteStage,
  updatePipelineName,
  deletePipeline,
  updateStageOrder,
} from "@/actions/crm";

// ============ TYPES ============

import type { Pipeline, Stage } from "@persia/shared/crm";

// ============ PRESET COLORS ============

const PRESET_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f59e0b",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#64748b",
  "#1e293b",
];

// ============ HELPERS ============

function getContrastColor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1A1A1A" : "#FFFFFF";
}

// ============ MAIN COMPONENT ============

export function CrmSettingsClient({
  pipelines: initialPipelines,
  stages: initialStages,
}: {
  pipelines: Pipeline[];
  stages: Stage[];
}) {
  const [pipelines, setPipelines] = React.useState(initialPipelines);
  const [stages, setStages] = React.useState(initialStages);
  const [isPending, startTransition] = React.useTransition();

  function stagesForPipeline(pipelineId: string) {
    return stages
      .filter((s) => s.pipeline_id === pipelineId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  // ---- CREATE PIPELINE ----
  function handleCreatePipeline(name: string) {
    const formData = new FormData();
    formData.set("name", name);

    startTransition(async () => {
      try {
        const result = await createPipeline(formData);
        if (result) {
          setPipelines((prev) => [...prev, result]);
          // Add default stages locally
          const defaultStages = [
            { name: "Novo", color: "#3b82f6" },
            { name: "Contato", color: "#f59e0b" },
            { name: "Qualificado", color: "#8b5cf6" },
            { name: "Proposta", color: "#ef4444" },
            { name: "Fechado", color: "#22c55e" },
          ];
          // Refetch stages from server would be ideal but let's add optimistic
          const newStages = defaultStages.map((s, i) => ({
            id: `temp-${Date.now()}-${i}`,
            pipeline_id: result.id,
            name: s.name,
            color: s.color,
            sort_order: i,
          }));
          setStages((prev) => [...prev, ...newStages]);
        }
      } catch (err) {
        console.error("Erro ao criar pipeline:", err);
      }
    });
  }

  // ---- DELETE PIPELINE ----
  function handleDeletePipeline(pipelineId: string) {
    setPipelines((prev) => prev.filter((p) => p.id !== pipelineId));
    setStages((prev) => prev.filter((s) => s.pipeline_id !== pipelineId));

    startTransition(async () => {
      try {
        await deletePipeline(pipelineId);
      } catch (err) {
        console.error("Erro ao excluir pipeline:", err);
      }
    });
  }

  // ---- UPDATE PIPELINE NAME ----
  function handleUpdatePipelineName(pipelineId: string, name: string) {
    setPipelines((prev) =>
      prev.map((p) => (p.id === pipelineId ? { ...p, name } : p))
    );

    startTransition(async () => {
      try {
        await updatePipelineName(pipelineId, name);
      } catch (err) {
        console.error("Erro ao renomear pipeline:", err);
      }
    });
  }

  // ---- CREATE STAGE ----
  function handleCreateStage(pipelineId: string, name: string, color: string) {
    const pipelineStages = stagesForPipeline(pipelineId);
    const maxOrder = pipelineStages.length > 0
      ? Math.max(...pipelineStages.map((s) => s.sort_order))
      : -1;
    const newOrder = maxOrder + 1;

    const formData = new FormData();
    formData.set("pipeline_id", pipelineId);
    formData.set("name", name);
    formData.set("sort_order", String(newOrder));
    formData.set("color", color);

    startTransition(async () => {
      try {
        const result = await createStage(formData);
        if (result) {
          setStages((prev) => [...prev, result as never]);
        }
      } catch (err) {
        console.error("Erro ao criar etapa:", err);
      }
    });
  }

  // ---- UPDATE STAGE ----
  function handleUpdateStage(stageId: string, data: { name?: string; color?: string; description?: string | null }) {
    setStages((prev) =>
      prev.map((s) => (s.id === stageId ? { ...s, ...data } : s))
    );

    startTransition(async () => {
      try {
        await updateStage(stageId, data);
      } catch (err) {
        console.error("Erro ao atualizar etapa:", err);
      }
    });
  }

  // ---- DELETE STAGE ----
  function handleDeleteStage(stageId: string) {
    setStages((prev) => prev.filter((s) => s.id !== stageId));

    startTransition(async () => {
      try {
        await deleteStage(stageId);
      } catch (err) {
        console.error("Erro ao excluir etapa:", err);
      }
    });
  }

  // ---- REORDER STAGES ----
  function handleMoveStage(pipelineId: string, stageId: string, direction: "up" | "down") {
    const pipelineStages = stagesForPipeline(pipelineId);
    const idx = pipelineStages.findIndex((s) => s.id === stageId);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === pipelineStages.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const currentOrder = pipelineStages[idx].sort_order;
    const swapOrder = pipelineStages[swapIdx].sort_order;

    // Optimistic
    setStages((prev) =>
      prev.map((s) => {
        if (s.id === pipelineStages[idx].id) return { ...s, sort_order: swapOrder };
        if (s.id === pipelineStages[swapIdx].id) return { ...s, sort_order: currentOrder };
        return s;
      })
    );

    startTransition(async () => {
      try {
        await updateStageOrder([
          { id: pipelineStages[idx].id, position: swapOrder },
          { id: pipelineStages[swapIdx].id, position: currentOrder },
        ]);
      } catch (err) {
        console.error("Erro ao reordenar:", err);
      }
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/crm">
          <Button variant="ghost" size="icon-sm" className="size-8 rounded-md">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight font-heading">Configurar Negócios</h1>
      </div>

      {/* Pipeline list */}
      <div className="space-y-6">
        {pipelines.map((pipeline) => {
          const pStages = stagesForPipeline(pipeline.id);
          return (
            <PipelineSection
              key={pipeline.id}
              pipeline={pipeline}
              stages={pStages}
              canDelete={pipelines.length > 1}
              onUpdateName={(name) =>
                handleUpdatePipelineName(pipeline.id, name)
              }
              onDelete={() => handleDeletePipeline(pipeline.id)}
              onCreateStage={(name, color) =>
                handleCreateStage(pipeline.id, name, color)
              }
              onUpdateStage={handleUpdateStage}
              onDeleteStage={handleDeleteStage}
              onMoveStage={(stageId, dir) =>
                handleMoveStage(pipeline.id, stageId, dir)
              }
              isPending={isPending}
            />
          );
        })}
      </div>

      {/* Add new pipeline */}
      <AddPipelineDialog onCreated={handleCreatePipeline} />
    </div>
  );
}

// ============ PIPELINE SECTION ============

function PipelineSection({
  pipeline,
  stages,
  canDelete,
  onUpdateName,
  onDelete,
  onCreateStage,
  onUpdateStage,
  onDeleteStage,
  onMoveStage,
  isPending,
}: {
  pipeline: Pipeline;
  stages: Stage[];
  canDelete: boolean;
  onUpdateName: (name: string) => void;
  onDelete: () => void;
  onCreateStage: (name: string, color: string) => void;
  onUpdateStage: (stageId: string, data: { name?: string; color?: string; description?: string | null }) => void;
  onDeleteStage: (stageId: string) => void;
  onMoveStage: (stageId: string, direction: "up" | "down") => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      {/* Pipeline header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{pipeline.name}</h2>
          <EditPipelineNameDialog
            currentName={pipeline.name}
            onSave={onUpdateName}
          />
        </div>
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md"
                >
                  <Trash2 className="size-4" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir pipeline</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja excluir &quot;{pipeline.name}&quot;? Todos os
                  negócios e etapas serão removidos permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Stages */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Etapas do funil
        </p>
        <div className="space-y-1.5">
          {stages.map((stage, idx) => (
            <StageRow
              key={stage.id}
              stage={stage}
              isFirst={idx === 0}
              isLast={idx === stages.length - 1}
              onUpdate={(data) => onUpdateStage(stage.id, data)}
              onDelete={() => onDeleteStage(stage.id)}
              onMoveUp={() => onMoveStage(stage.id, "up")}
              onMoveDown={() => onMoveStage(stage.id, "down")}
            />
          ))}
        </div>
      </div>

      {/* Add stage */}
      <AddStageDialog onCreated={onCreateStage} />
    </div>
  );
}

// ============ STAGE ROW ============

function StageRow({
  stage,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (data: { name?: string; color?: string; description?: string | null }) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const textColor = getContrastColor(stage.color);

  return (
    <div className="flex items-center gap-2 group">
      {/* Drag handle / reorder buttons */}
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
          title="Mover para cima"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 3L2 7h8L6 3z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
          title="Mover para baixo"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 9L2 5h8L6 9z" fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* Stage pill + description */}
      <div className="flex-1 min-w-0">
        <span
          className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium min-w-[120px]"
          style={{ backgroundColor: stage.color, color: textColor }}
        >
          {stage.name}
        </span>
        {stage.description && (
          <p className="text-xs text-muted-foreground mt-1 ml-1 truncate max-w-md">
            Regra IA: {stage.description}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <EditStageDialog
          stage={stage}
          onSave={onUpdate}
        />
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md"
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir etapa</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir &quot;{stage.name}&quot;? Os negócios
                nesta etapa serão removidos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ============ COLOR PICKER ============

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`size-8 rounded-md border-2 transition-all ${
            value === color
              ? "border-foreground scale-110"
              : "border-transparent hover:scale-105"
          }`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

// ============ EDIT PIPELINE NAME DIALOG ============

function EditPipelineNameDialog({
  currentName,
  onSave,
}: {
  currentName: string;
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(currentName);

  React.useEffect(() => {
    setName(currentName);
  }, [currentName]);

  function handleSave() {
    if (name.trim()) {
      onSave(name.trim());
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-md"
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Renomear Pipeline</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-md"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="flex justify-end gap-3">
            <DialogClose
              render={
                <Button variant="outline" className="rounded-md">
                  Cancelar
                </Button>
              }
            />
            <Button onClick={handleSave} className="rounded-md">
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ EDIT STAGE DIALOG ============

function EditStageDialog({
  stage,
  onSave,
}: {
  stage: Stage;
  onSave: (data: { name?: string; color?: string; description?: string | null }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(stage.name);
  const [color, setColor] = React.useState(stage.color);
  const [description, setDescription] = React.useState(stage.description || "");

  React.useEffect(() => {
    setName(stage.name);
    setColor(stage.color);
    setDescription(stage.description || "");
  }, [stage.name, stage.color, stage.description]);

  function handleSave() {
    if (name.trim()) {
      onSave({ name: name.trim(), color, description: description.trim() || null });
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-md"
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Editar Etapa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-md"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Cor</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Regra para IA</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Mover para esta etapa quando o lead pedir preço ou condições de pagamento"
              className="min-h-[60px] rounded-md text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Instrução para a IA saber quando mover um lead para esta etapa
            </p>
          </div>
          {/* Preview */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Pré-visualização
            </Label>
            <span
              className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium"
              style={{
                backgroundColor: color,
                color: getContrastColor(color),
              }}
            >
              {name || "Etapa"}
            </span>
          </div>
          <div className="flex justify-end gap-3">
            <DialogClose
              render={
                <Button variant="outline" className="rounded-md">
                  Cancelar
                </Button>
              }
            />
            <Button onClick={handleSave} className="rounded-md">
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ ADD STAGE DIALOG ============

function AddStageDialog({
  onCreated,
}: {
  onCreated: (name: string, color: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#3b82f6");

  function handleCreate() {
    if (name.trim()) {
      onCreated(name.trim(), color);
      setName("");
      setColor("#3b82f6");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="rounded-md gap-1.5">
            <Plus className="size-4" />
            Adicionar Etapa
          </Button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Nova Etapa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome da etapa</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Negociação"
              className="h-10 rounded-md"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Cor</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          {/* Preview */}
          {name.trim() && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Pré-visualização
              </Label>
              <span
                className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium"
                style={{
                  backgroundColor: color,
                  color: getContrastColor(color),
                }}
              >
                {name}
              </span>
            </div>
          )}
          <Button
            onClick={handleCreate}
            className="w-full h-11 font-medium rounded-md"
          >
            Criar Etapa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ ADD PIPELINE DIALOG ============

function AddPipelineDialog({
  onCreated,
}: {
  onCreated: (name: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  function handleCreate() {
    if (name.trim()) {
      onCreated(name.trim());
      setName("");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="rounded-md gap-2">
            <Plus className="size-4" />
            Adicionar Novo Kanban
          </Button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Novo Pipeline</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome do pipeline</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Funil de Vendas B2B"
              className="h-10 rounded-md"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <Button
            onClick={handleCreate}
            className="w-full h-11 font-medium rounded-md"
          >
            Criar Pipeline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
