"use client";

// PR-CRMCFG: editor master-detail de funis e etapas.
//
// Substitui em definitivo:
//   - O modal "Configurar funis" (PipelineConfigDrawer) que ficava na
//     toolbar do Kanban — REMOVIDO.
//   - A pagina vertical antiga em /crm/settings/funis (CrmSettingsClient)
//     — REMOVIDA da rota nova /settings/crm.
//
// Layout:
//   - Esquerda (lista, ~280px): cards de funis. Click seleciona. Botao
//     "+ Novo funil" no fim. Selected highlight.
//   - Direita (editor, flex-1): header (nome editavel + delete + "+ etapa") +
//     3 secoes coloridas (em_andamento / falha / bem_sucedido) com etapas.
//   - Cada etapa: bolinha de cor + nome inline-editable + setas reorder +
//     botao expandir (cor + regra IA) + delete.
//   - Drag-drop entre secoes muda outcome (bucket).
//
// Compartilhado entre apps/crm e apps/admin via @persia/crm-ui.
// Cada app injeta suas actions via <KanbanProvider> (mesmo provider do
// KanbanBoard — reusa).
//
// Reuso (regra "nao criar logica paralela"):
//   - createPipeline / updatePipelineName / deletePipeline (KanbanActions)
//   - createStage / updateStage (com color, description, sortOrder, outcome)
//   - deleteStage / reorderStages
//   Tudo passa pelo mesmo @persia/shared/crm/mutations que o Kanban usa.

import * as React from "react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  ChevronDown,
  ChevronUp,
  Kanban as KanbanIcon,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { Pipeline, Stage, StageOutcome } from "@persia/shared/crm";
import { DialogHero } from "./DialogHero";
import { useKanbanActions } from "../context";

// ============ CONSTANTES ============

const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f59e0b", "#f97316", "#22c55e",
  "#14b8a6", "#06b6d4", "#64748b", "#1e293b",
];

const OUTCOME_BUCKETS: ReadonlyArray<{
  key: StageOutcome;
  label: string;
  helper: string;
  ringClass: string;
  bgClass: string;
  textClass: string;
}> = [
  {
    key: "em_andamento",
    label: "Em andamento",
    helper: "O lead ainda esta sendo trabalhado",
    ringClass: "ring-blue-200",
    bgClass: "bg-blue-50/40",
    textClass: "text-blue-700",
  },
  {
    key: "falha",
    label: "Falha",
    helper: "O lead foi perdido / recusou",
    ringClass: "ring-red-200",
    bgClass: "bg-red-50/40",
    textClass: "text-red-700",
  },
  {
    key: "bem_sucedido",
    label: "Bem-sucedido",
    helper: "O lead virou cliente / fechou",
    ringClass: "ring-emerald-200",
    bgClass: "bg-emerald-50/40",
    textClass: "text-emerald-700",
  },
];

function getContrastColor(hex: string): string {
  const c = (hex || "").replace("#", "");
  if (c.length !== 6) return "#ffffff";
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1A1A1A" : "#FFFFFF";
}

// ============ MAIN ============

export interface PipelineSettingsClientProps {
  pipelines: Pipeline[];
  stages: Stage[];
  /** Funil pre-selecionado (deep-link via ?pipeline=...). Default: primeiro. */
  initialPipelineId?: string;
}

export function PipelineSettingsClient({
  pipelines: initialPipelines,
  stages: initialStages,
  initialPipelineId,
}: PipelineSettingsClientProps) {
  const actions = useKanbanActions();

  const [pipelines, setPipelines] = React.useState(initialPipelines);
  const [stages, setStages] = React.useState(initialStages);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialPipelineId ?? initialPipelines[0]?.id ?? null,
  );
  const [isPending, startTransition] = React.useTransition();

  const stagesForSelected = React.useMemo(() => {
    if (!selectedId) return [];
    return stages
      .filter((s) => s.pipeline_id === selectedId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [stages, selectedId]);

  const selected = pipelines.find((p) => p.id === selectedId) ?? null;

  // ============ Pipeline handlers ============

  const handleCreatePipeline = (name: string) => {
    startTransition(async () => {
      try {
        const created = await actions.createPipeline(name);
        setPipelines((prev) => [...prev, created]);
        setSelectedId(created.id);
        // Default stages sao criadas pelo backend; refletir otimisticamente
        // seria duplicar a logica. Em vez disso, sinalizamos pro user via
        // onChange (o RSC parent pode re-fetchar) — aqui nao temos acesso,
        // entao deixamos o backend popular e o user vai ver no proximo
        // refresh ou adicionando manualmente. Idempotency garantida no shared.
      } catch (err) {
        console.error("[PipelineSettings] createPipeline:", err);
      }
    });
  };

  const handleUpdatePipelineName = (pipelineId: string, name: string) => {
    setPipelines((prev) =>
      prev.map((p) => (p.id === pipelineId ? { ...p, name } : p)),
    );
    startTransition(async () => {
      try {
        await actions.updatePipelineName(pipelineId, name);
      } catch (err) {
        console.error("[PipelineSettings] updatePipelineName:", err);
      }
    });
  };

  const handleDeletePipeline = (pipelineId: string) => {
    setPipelines((prev) => prev.filter((p) => p.id !== pipelineId));
    setStages((prev) => prev.filter((s) => s.pipeline_id !== pipelineId));
    if (selectedId === pipelineId) {
      const remaining = pipelines.filter((p) => p.id !== pipelineId);
      setSelectedId(remaining[0]?.id ?? null);
    }
    startTransition(async () => {
      try {
        await actions.deletePipeline(pipelineId);
      } catch (err) {
        console.error("[PipelineSettings] deletePipeline:", err);
      }
    });
  };

  // ============ Stage handlers ============

  const handleCreateStage = (
    name: string,
    color: string,
    outcome: StageOutcome,
  ) => {
    if (!selectedId) return;
    const pStages = stagesForSelected;
    const maxOrder = pStages.length > 0
      ? Math.max(...pStages.map((s) => s.sort_order))
      : -1;
    const sortOrder = maxOrder + 1;

    startTransition(async () => {
      try {
        const created = await actions.createStage({
          pipelineId: selectedId,
          name,
          sortOrder,
          outcome,
        });
        // Refletir cor + outcome localmente (o create do shared aceita
        // outcome mas precisa de update separado pra cor nas signaturas
        // antigas). Atualiza inline pra UX consistente.
        setStages((prev) => [...prev, { ...created, color }]);
        if (color !== created.color) {
          await actions.updateStage(created.id, { color });
        }
      } catch (err) {
        console.error("[PipelineSettings] createStage:", err);
      }
    });
  };

  const handleUpdateStage = (
    stageId: string,
    data: { name?: string; color?: string; description?: string | null; outcome?: StageOutcome },
  ) => {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, ...data } : s)));
    startTransition(async () => {
      try {
        await actions.updateStage(stageId, data);
      } catch (err) {
        console.error("[PipelineSettings] updateStage:", err);
      }
    });
  };

  const handleDeleteStage = (stageId: string) => {
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    startTransition(async () => {
      try {
        await actions.deleteStage(stageId);
      } catch (err) {
        console.error("[PipelineSettings] deleteStage:", err);
      }
    });
  };

  const handleMoveStage = (stageId: string, direction: "up" | "down") => {
    const list = stagesForSelected;
    const idx = list.findIndex((s) => s.id === stageId);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === list.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const a = list[idx];
    const b = list[swapIdx];

    setStages((prev) =>
      prev.map((s) => {
        if (s.id === a.id) return { ...s, sort_order: b.sort_order };
        if (s.id === b.id) return { ...s, sort_order: a.sort_order };
        return s;
      }),
    );

    startTransition(async () => {
      try {
        if (actions.reorderStages) {
          await actions.reorderStages([
            { id: a.id, position: b.sort_order },
            { id: b.id, position: a.sort_order },
          ]);
        } else {
          // Fallback: 2 updateStage individuais (compat com adapters antigos)
          await Promise.all([
            actions.updateStage(a.id, { sortOrder: b.sort_order }),
            actions.updateStage(b.id, { sortOrder: a.sort_order }),
          ]);
        }
      } catch (err) {
        console.error("[PipelineSettings] reorderStages:", err);
      }
    });
  };

  // ============ Drag-drop entre buckets (outcome) ============

  const [dragStageId, setDragStageId] = React.useState<string | null>(null);
  const [dragOverBucket, setDragOverBucket] = React.useState<StageOutcome | null>(null);

  const handleDragStart = (e: React.DragEvent, stageId: string) => {
    setDragStageId(stageId);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, bucket: StageOutcome) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverBucket(bucket);
  };
  const handleDragLeave = () => setDragOverBucket(null);
  const handleDrop = (bucket: StageOutcome) => {
    setDragOverBucket(null);
    if (!dragStageId) return;
    const stage = stages.find((s) => s.id === dragStageId);
    setDragStageId(null);
    if (!stage || stage.outcome === bucket) return;
    handleUpdateStage(dragStageId, { outcome: bucket });
  };

  // ============ Render ============

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      {/* ====== LEFT — Pipeline list ====== */}
      <aside className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2">
          Funis ({pipelines.length})
        </h2>
        <div className="space-y-1">
          {pipelines.map((p) => {
            const isActive = p.id === selectedId;
            const count = stages.filter((s) => s.pipeline_id === p.id).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <AddPipelineDialog onCreated={handleCreatePipeline} disabled={isPending} />
      </aside>

      {/* ====== RIGHT — Editor ====== */}
      <section className="min-w-0">
        {selected ? (
          <PipelineEditor
            pipeline={selected}
            stages={stagesForSelected}
            allStagesCount={stagesForSelected.length}
            isPending={isPending}
            canDelete={pipelines.length > 1}
            dragStageId={dragStageId}
            dragOverBucket={dragOverBucket}
            onUpdateName={(name) => handleUpdatePipelineName(selected.id, name)}
            onDelete={() => handleDeletePipeline(selected.id)}
            onCreateStage={handleCreateStage}
            onUpdateStage={handleUpdateStage}
            onDeleteStage={handleDeleteStage}
            onMoveStage={handleMoveStage}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center">
            <KanbanIcon className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <h3 className="mt-3 text-base font-semibold">Nenhum funil ainda</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie seu primeiro funil pra organizar os negocios do CRM.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ============ EDITOR ============

interface EditorProps {
  pipeline: Pipeline;
  stages: Stage[];
  allStagesCount: number;
  isPending: boolean;
  canDelete: boolean;
  dragStageId: string | null;
  dragOverBucket: StageOutcome | null;
  onUpdateName: (name: string) => void;
  onDelete: () => void;
  onCreateStage: (name: string, color: string, outcome: StageOutcome) => void;
  onUpdateStage: (
    stageId: string,
    data: { name?: string; color?: string; description?: string | null; outcome?: StageOutcome },
  ) => void;
  onDeleteStage: (stageId: string) => void;
  onMoveStage: (stageId: string, direction: "up" | "down") => void;
  onDragStart: (e: React.DragEvent, stageId: string) => void;
  onDragOver: (e: React.DragEvent, bucket: StageOutcome) => void;
  onDragLeave: () => void;
  onDrop: (bucket: StageOutcome) => void;
}

function PipelineEditor(props: EditorProps) {
  const { pipeline, stages, isPending, canDelete } = props;
  const stagesByBucket = React.useMemo(() => {
    const map: Record<StageOutcome, Stage[]> = {
      em_andamento: [],
      falha: [],
      bem_sucedido: [],
    };
    for (const s of stages) {
      const k = (s.outcome ?? "em_andamento") as StageOutcome;
      map[k].push(s);
    }
    return map;
  }, [stages]);

  return (
    <div className="space-y-5">
      {/* Header do funil */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xl font-bold tracking-tight truncate">
            {pipeline.name}
          </h2>
          <RenameDialog
            currentName={pipeline.name}
            onSave={props.onUpdateName}
            disabled={isPending}
          />
        </div>
        <DeletePipelineDialog
          name={pipeline.name}
          onConfirm={props.onDelete}
          disabled={isPending || !canDelete}
        />
      </div>

      <p className="text-xs text-muted-foreground -mt-3">
        Arraste etapas entre as colunas pra mudar o resultado final do negocio.
      </p>

      {/* 3 colunas de buckets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {OUTCOME_BUCKETS.map((bucket) => {
          const bucketStages = stagesByBucket[bucket.key];
          const isDragOver = props.dragOverBucket === bucket.key;
          return (
            <div
              key={bucket.key}
              onDragOver={(e) => props.onDragOver(e, bucket.key)}
              onDragLeave={props.onDragLeave}
              onDrop={() => props.onDrop(bucket.key)}
              className={`rounded-xl border p-3 transition-colors ${
                isDragOver
                  ? `${bucket.ringClass} ring-2 border-transparent`
                  : "border-border"
              } ${bucket.bgClass}`}
            >
              <div className="flex items-baseline justify-between mb-3 px-1">
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${bucket.textClass}`}>
                  {bucket.label}
                </h3>
                <CreateStageDialog
                  outcome={bucket.key}
                  onCreated={(name, color) => props.onCreateStage(name, color, bucket.key)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5 min-h-[40px]">
                {bucketStages.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 italic px-2 py-3 text-center">
                    Arraste uma etapa aqui
                  </p>
                ) : (
                  bucketStages.map((stage, idx) => (
                    <StageRow
                      key={stage.id}
                      stage={stage}
                      index={idx}
                      total={bucketStages.length}
                      isDragging={props.dragStageId === stage.id}
                      onDragStart={(e) => props.onDragStart(e, stage.id)}
                      onUpdate={(data) => props.onUpdateStage(stage.id, data)}
                      onDelete={() => props.onDeleteStage(stage.id)}
                      onMove={(dir) => props.onMoveStage(stage.id, dir)}
                      disabled={isPending}
                    />
                  ))
                )}
              </div>
              <p className={`mt-2 text-[11px] ${bucket.textClass} opacity-70 px-1`}>
                {bucket.helper}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ STAGE ROW ============

interface StageRowProps {
  stage: Stage;
  index: number;
  total: number;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onUpdate: (data: { name?: string; color?: string; description?: string | null }) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  disabled: boolean;
}

function StageRow({
  stage, index, total, isDragging,
  onDragStart, onUpdate, onDelete, onMove, disabled,
}: StageRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(stage.name);

  React.useEffect(() => setNameDraft(stage.name), [stage.name]);

  const color = stage.color || "#6366f1";
  const fg = getContrastColor(color);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== stage.name) onUpdate({ name: next });
    else setNameDraft(stage.name);
    setEditingName(false);
  };

  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      className={`group rounded-md border bg-card transition-opacity ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2 p-2">
        {/* Reorder controls */}
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={disabled || index === 0}
            aria-label="Mover etapa pra cima"
            className="size-4 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={disabled || index === total - 1}
            aria-label="Mover etapa pra baixo"
            className="size-4 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>

        {/* Color chip */}
        <span
          aria-hidden
          className="inline-block size-3.5 rounded-full shrink-0 ring-1 ring-black/5"
          style={{ backgroundColor: color }}
        />

        {/* Name (inline editavel) */}
        {editingName ? (
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(stage.name);
                setEditingName(false);
              }
            }}
            autoFocus
            className="h-6 px-2 py-0 text-sm flex-1"
            maxLength={60}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="text-sm font-medium flex-1 text-left truncate hover:text-primary"
            title="Clique para renomear"
          >
            {stage.name}
          </button>
        )}

        {/* Actions */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Recolher etapa" : "Expandir etapa"}
          className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>

        <DeleteStageButton stageName={stage.name} onConfirm={onDelete} disabled={disabled} />
      </div>

      {/* Expanded: cor + regra IA */}
      {expanded && (
        <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-3">
          {/* Cor */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cor</Label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdate({ color: c })}
                  aria-label={`Cor ${c}`}
                  className={`size-6 rounded-md ring-1 transition-transform ${
                    c === color ? "ring-foreground scale-110" : "ring-black/10"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Regra IA */}
          <div className="space-y-1.5">
            <Label htmlFor={`stage-desc-${stage.id}`} className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Sparkles className="size-3" /> Regra para IA <span className="text-muted-foreground/60 font-normal">(opcional)</span>
            </Label>
            <Textarea
              id={`stage-desc-${stage.id}`}
              defaultValue={(stage as Stage & { description?: string | null }).description ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                onUpdate({ description: v.length > 0 ? v : null });
              }}
              placeholder="Ex: Lead respondeu ao primeiro contato; aguardando confirmar interesse."
              className="text-xs min-h-16"
              rows={2}
            />
            <p className="text-[10px] text-muted-foreground/70">
              Usado pelo agente IA pra decidir quando avancar pra esta etapa.
            </p>
          </div>

          {/* Preview do chip colorido */}
          <div>
            <Label className="text-xs text-muted-foreground">Preview</Label>
            <div className="mt-1.5">
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold"
                style={{ backgroundColor: color, color: fg }}
              >
                {stage.name}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ DIALOGS / BOTOES ============

function AddPipelineDialog({
  onCreated,
  disabled,
}: {
  onCreated: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  const handle = () => {
    if (!name.trim()) return;
    onCreated(name.trim());
    setName("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="w-full mt-3 gap-2" disabled={disabled}>
            <Plus className="size-4" />
            Novo funil
          </Button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Novo funil</DialogTitle>
          <DialogHero
            icon={<KanbanIcon className="size-5" />}
            title="Novo funil"
            tagline="Crie um novo funil de vendas"
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome do funil</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Funil de Vendas B2B"
              maxLength={60}
              onKeyDown={(e) => e.key === "Enter" && handle()}
              autoFocus
            />
          </div>
          <Button
            onClick={handle}
            disabled={!name.trim()}
            className="w-full h-11 font-medium rounded-md"
          >
            Criar funil
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  currentName,
  onSave,
  disabled,
}: {
  currentName: string;
  onSave: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(currentName);
  React.useEffect(() => setName(currentName), [currentName]);

  const handle = () => {
    const next = name.trim();
    if (!next || next === currentName) {
      setOpen(false);
      return;
    }
    onSave(next);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label="Renomear funil"
            className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="size-3.5" />
          </button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Renomear funil</DialogTitle>
          <DialogHero
            icon={<Pencil className="size-5" />}
            title="Renomear funil"
            tagline="Atualize o nome do funil"
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              onKeyDown={(e) => e.key === "Enter" && handle()}
              autoFocus
            />
          </div>
          <Button
            onClick={handle}
            className="w-full h-11 font-medium rounded-md"
            disabled={!name.trim()}
          >
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeletePipelineDialog({
  name,
  onConfirm,
  disabled,
}: {
  name: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label="Excluir funil"
            className="size-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:cursor-default"
          >
            <Trash2 className="size-4" />
          </button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir funil</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja excluir &quot;{name}&quot;? Todos os
            negocios e etapas deste funil serao removidos. Esta acao nao
            pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateStageDialog({
  outcome,
  onCreated,
  disabled,
}: {
  outcome: StageOutcome;
  onCreated: (name: string, color: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(PRESET_COLORS[0]);

  const handle = () => {
    if (!name.trim()) return;
    onCreated(name.trim(), color);
    setName("");
    setColor(PRESET_COLORS[0]);
    setOpen(false);
  };

  const bucketLabel =
    outcome === "em_andamento" ? "Em andamento" :
    outcome === "falha" ? "Falha" : "Bem-sucedido";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={`Adicionar etapa em ${bucketLabel}`}
            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Plus className="size-3.5" />
          </button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Nova etapa</DialogTitle>
          <DialogHero
            icon={<Plus className="size-5" />}
            title="Nova etapa"
            tagline={`Sera criada em "${bucketLabel}"`}
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Nome da etapa</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Qualificado"
              maxLength={60}
              onKeyDown={(e) => e.key === "Enter" && handle()}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Cor</Label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Cor ${c}`}
                  className={`size-7 rounded-md ring-1 transition-transform ${
                    c === color ? "ring-foreground scale-110" : "ring-black/10"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <Button
            onClick={handle}
            disabled={!name.trim()}
            className="w-full h-11 font-medium rounded-md"
          >
            Criar etapa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStageButton({
  stageName,
  onConfirm,
  disabled,
}: {
  stageName: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={`Excluir etapa ${stageName}`}
            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="size-3" />
          </button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir etapa</AlertDialogTitle>
          <AlertDialogDescription>
            Excluir &quot;{stageName}&quot;? Todos os negocios desta
            etapa serao removidos junto. Acao nao pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
