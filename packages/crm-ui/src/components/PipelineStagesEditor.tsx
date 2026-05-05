"use client";

// PR-CRMOPS: editor de etapas de UM funil ativo.
//
// Design (DesignFlow Kit aplicado):
//   - 3 colunas coloridas por outcome (Em andamento / Falha / Bem-sucedido)
//   - bg-{cor}-50/60 light / {cor}-950/30 dark — flat, alpha pra nao pesar
//   - Drag entre colunas muda outcome (HTML5 drag, mesmo pattern do KanbanBoard)
//   - Reorder dentro da coluna via setas (denso, sem drag — drag fica reservado pro outcome change)
//   - Inline edit de nome (clica → input)
//   - Expander por etapa: cor (12 presets) + textarea regra IA
//
// Uso pretendido: dentro do EditPipelineDrawer (Sheet lateral 720px).
// SEM lista de funis — drawer edita SO o pipeline ativo (decisao do
// briefing PR-CRMOPS: "Para trocar de Kanban, o usuario usa o select").
//
// Compartilhado entre apps/crm e apps/admin via @persia/crm-ui.
// Cada app injeta actions via <KanbanProvider> (mesmo provider do
// KanbanBoard — reusa, regra 11 do briefing).

import * as React from "react";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
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
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { Stage, StageOutcome } from "@persia/shared/crm";
import { useKanbanActions } from "../context";

// ============ TOKENS ============

const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f59e0b", "#f97316", "#22c55e",
  "#14b8a6", "#06b6d4", "#64748b", "#1e293b",
];

// DesignFlow Kit: cores por outcome usando os Chart Colors do kit
// (mesmas que aparecem nos graficos do dashboard) com alpha pra ficar
// flat/borderless. Dark mode tem contrapartida explicita (regra 8 do
// kit: dark mode first).
const OUTCOME_BUCKETS: ReadonlyArray<{
  key: StageOutcome;
  label: string;
  helper: string;
  bgClass: string;
  textClass: string;
  ringClass: string;
}> = [
  {
    key: "em_andamento",
    label: "Em andamento",
    helper: "O lead ainda esta sendo trabalhado",
    bgClass: "bg-blue-50/60 dark:bg-blue-950/30",
    textClass: "text-blue-700 dark:text-blue-300",
    ringClass: "ring-blue-300 dark:ring-blue-700",
  },
  {
    key: "falha",
    label: "Falha",
    helper: "O lead foi perdido / recusou",
    bgClass: "bg-red-50/60 dark:bg-red-950/30",
    textClass: "text-red-700 dark:text-red-300",
    ringClass: "ring-red-300 dark:ring-red-700",
  },
  {
    key: "bem_sucedido",
    label: "Bem-sucedido",
    helper: "O lead virou cliente / fechou",
    bgClass: "bg-emerald-50/60 dark:bg-emerald-950/30",
    textClass: "text-emerald-700 dark:text-emerald-300",
    ringClass: "ring-emerald-300 dark:ring-emerald-700",
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

// ============ PROPS ============

export interface PipelineStagesEditorProps {
  pipelineId: string;
  /** Etapas ja filtradas pelo pipelineId. Caller controla. */
  stages: Stage[];
  /** Disparado depois de qualquer mutation bem-sucedida — pra o pai
   * re-fetchar dados (router.refresh no CRM, reload state no admin). */
  onChange?: () => void;
}

// ============ COMPONENT ============

export function PipelineStagesEditor({
  pipelineId,
  stages: initialStages,
  onChange,
}: PipelineStagesEditorProps) {
  const actions = useKanbanActions();
  const [stages, setStages] = React.useState(initialStages);
  const [isPending, startTransition] = React.useTransition();

  // Sincroniza quando o caller (drawer) muda o pipelineId ou re-fetcha
  React.useEffect(() => {
    setStages(initialStages);
  }, [initialStages]);

  const sortedStages = React.useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages],
  );

  const stagesByBucket = React.useMemo(() => {
    const map: Record<StageOutcome, Stage[]> = {
      em_andamento: [],
      falha: [],
      bem_sucedido: [],
    };
    for (const s of sortedStages) {
      const k = (s.outcome ?? "em_andamento") as StageOutcome;
      map[k].push(s);
    }
    return map;
  }, [sortedStages]);

  // ============ Stage handlers ============

  const handleCreateStage = (
    name: string,
    color: string,
    outcome: StageOutcome,
  ) => {
    const maxOrder = sortedStages.length > 0
      ? Math.max(...sortedStages.map((s) => s.sort_order))
      : -1;
    const sortOrder = maxOrder + 1;

    startTransition(async () => {
      try {
        const created = await actions.createStage({
          pipelineId,
          name,
          sortOrder,
          outcome,
        });
        // Color pode precisar de update separado se o adapter nao
        // suportar no create (compat). Tenta ja com o create, fallback
        // pra updateStage.
        setStages((prev) => [...prev, { ...created, color }]);
        if (color !== created.color) {
          await actions.updateStage(created.id, { color });
        }
        onChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PipelineStagesEditor] createStage:", err);
      }
    });
  };

  const handleUpdateStage = (
    stageId: string,
    data: { name?: string; color?: string; description?: string | null; outcome?: StageOutcome; sortOrder?: number },
  ) => {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, ...data } : s)));
    startTransition(async () => {
      try {
        await actions.updateStage(stageId, data);
        onChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PipelineStagesEditor] updateStage:", err);
      }
    });
  };

  const handleDeleteStage = (stageId: string) => {
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    startTransition(async () => {
      try {
        await actions.deleteStage(stageId);
        onChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PipelineStagesEditor] deleteStage:", err);
      }
    });
  };

  const handleMoveStage = (stageId: string, direction: "up" | "down") => {
    // Reorder dentro da MESMA coluna (mesmo outcome). Drag handle muda
    // o outcome — setas so reordenam dentro do bucket.
    const current = sortedStages.find((s) => s.id === stageId);
    if (!current) return;
    const sameBucket = sortedStages.filter(
      (s) => (s.outcome ?? "em_andamento") === (current.outcome ?? "em_andamento"),
    );
    const idx = sameBucket.findIndex((s) => s.id === stageId);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === sameBucket.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const a = sameBucket[idx];
    const b = sameBucket[swapIdx];

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
          // Fallback pra adapters antigos (compat).
          await Promise.all([
            actions.updateStage(a.id, { sortOrder: b.sort_order }),
            actions.updateStage(b.id, { sortOrder: a.sort_order }),
          ]);
        }
        onChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[PipelineStagesEditor] reorderStages:", err);
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
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Arraste etapas entre as colunas pra mudar o resultado final
          do negocio. Use as setas pra reordenar dentro de cada coluna.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {OUTCOME_BUCKETS.map((bucket) => {
          const bucketStages = stagesByBucket[bucket.key];
          const isDragOver = dragOverBucket === bucket.key;
          return (
            <div
              key={bucket.key}
              onDragOver={(e) => handleDragOver(e, bucket.key)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(bucket.key)}
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
                <CreateStageInlineButton
                  outcome={bucket.key}
                  onCreate={(name, color) => handleCreateStage(name, color, bucket.key)}
                  disabled={isPending}
                  textClass={bucket.textClass}
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
                      isDragging={dragStageId === stage.id}
                      onDragStart={(e) => handleDragStart(e, stage.id)}
                      onUpdate={(data) => handleUpdateStage(stage.id, data)}
                      onDelete={() => handleDeleteStage(stage.id)}
                      onMove={(dir) => handleMoveStage(stage.id, dir)}
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
        {/* Reorder controls (DesignFlow: minimal, denso, opacity 50% no idle) */}
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={disabled || index === 0}
            aria-label="Mover etapa pra cima"
            className="size-4 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={disabled || index === total - 1}
            aria-label="Mover etapa pra baixo"
            className="size-4 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>

        {/* Color chip (drag handle visual implicito) */}
        <span
          aria-hidden
          className="inline-block size-3.5 rounded-full shrink-0 ring-1 ring-black/5 cursor-grab active:cursor-grabbing"
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

        {/* Expand (cor + IA) */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Recolher etapa" : "Expandir etapa"}
          aria-expanded={expanded}
          className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>

        <DeleteStageButton stageName={stage.name} onConfirm={onDelete} disabled={disabled} />
      </div>

      {/* Expanded: cor + regra IA */}
      {expanded && (
        <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-3">
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

// ============ CREATE STAGE INLINE BUTTON ============
//
// Botao "+" pequeno no header de cada bucket. Abre popover-like inline
// (input simples). Mais leve que o Dialog completo do componente antigo
// — caso de uso e fluxo rapido, nao formulario rico.

function CreateStageInlineButton({
  outcome,
  onCreate,
  disabled,
  textClass,
}: {
  outcome: StageOutcome;
  onCreate: (name: string, color: string) => void;
  disabled: boolean;
  textClass: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Cor default por outcome (sentido visual)
    const defaultColor =
      outcome === "em_andamento" ? "#3b82f6" :
      outcome === "falha" ? "#ef4444" : "#22c55e";
    onCreate(trimmed, defaultColor);
    setName("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Adicionar etapa"
        className={`size-5 inline-flex items-center justify-center rounded ${textClass} hover:bg-card disabled:opacity-30`}
      >
        <Plus className="size-3.5" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!name.trim()) setOpen(false);
          else submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setName("");
            setOpen(false);
          }
        }}
        placeholder="Nome da etapa"
        className="h-6 px-2 py-0 text-xs w-32"
        maxLength={60}
      />
    </div>
  );
}

// ============ DELETE STAGE BUTTON ============

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
