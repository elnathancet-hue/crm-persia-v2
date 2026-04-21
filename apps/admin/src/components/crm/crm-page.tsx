"use client";

import { useEffect, useState, useTransition } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import {
  getPipelines,
  createPipeline,
  createDeal,
  moveDeal,
  deleteDeal,
} from "@/actions/pipelines";
import {
  Kanban,
  Plus,
  GripVertical,
  DollarSign,
  Trash2,
  Loader2,
  Target,
  TrendingUp,
  Flag,
  Percent,
} from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

interface Deal {
  id: string;
  title: string;
  value: number;
  status: string;
  lead_id: string | null;
  sort_order: number;
}

interface Stage {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  deals: Deal[];
}

interface Pipeline {
  id: string;
  name: string;
  pipeline_stages: Stage[];
}

interface PipelineGoal {
  revenue: number;
  won: number;
}

function getStageMetrics(deals: Deal[]) {
  const total = deals.reduce((sum, deal) => sum + (deal.value || 0), 0);
  const average = deals.length > 0 ? total / deals.length : 0;

  return {
    count: deals.length,
    total,
    average,
  };
}

function getConversionRate(won: number, lost: number) {
  const closed = won + lost;
  if (closed === 0) return 0;
  return (won / closed) * 100;
}

const GOALS_STORAGE_KEY = "admin-kanban-goals-v1";
const DEFAULT_PIPELINE_GOAL: PipelineGoal = { revenue: 0, won: 0 };

export function CrmPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showPipelineForm, setShowPipelineForm] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const [pipelineErrors, setPipelineErrors] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getPipelines().then((data) => {
      setPipelines(data as Pipeline[]);
      setLoading(false);
    });
  }, [activeOrgId, isManagingClient]);

  async function handleCreatePipeline() {
    if (!pipelineName.trim()) {
      setPipelineErrors({ name: "Campo obrigatorio" });
      return;
    }

    setPipelineErrors({});
    setCreating(true);
    const pipeline = await createPipeline(pipelineName.trim());

    if (pipeline) {
      const data = await getPipelines();
      setPipelines(data as Pipeline[]);
      toast.success("Pipeline criado");
    }

    setPipelineName("");
    setShowPipelineForm(false);
    setCreating(false);
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">CRM</h1>
        <button
          onClick={() => {
            setPipelineName("");
            setPipelineErrors({});
            setShowPipelineForm(true);
          }}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}{" "}
          Novo Pipeline
        </button>
      </div>

      {showPipelineForm && (
        <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">
              Nome do Pipeline *
            </label>
            <input
              value={pipelineName}
              onChange={(e) => {
                setPipelineName(e.target.value);
                setPipelineErrors({});
              }}
              onBlur={() => {
                if (!pipelineName.trim()) {
                  setPipelineErrors({ name: "Campo obrigatorio" });
                }
              }}
              placeholder="Ex: Vendas B2B"
              className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary ${
                pipelineErrors.name ? "border-red-500" : "border-border"
              }`}
              autoFocus
            />
            {pipelineErrors.name && (
              <p className="text-xs text-red-500 mt-1">{pipelineErrors.name}</p>
            )}
          </div>
          <div className="flex gap-2 mt-5">
            <button
              onClick={handleCreatePipeline}
              disabled={creating}
              className="px-3 py-2 text-sm bg-primary hover:bg-primary/80 text-white rounded-lg disabled:opacity-50"
            >
              {creating ? "Criando..." : "Criar"}
            </button>
            <button
              onClick={() => setShowPipelineForm(false)}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Kanban className="size-10 mb-2 text-muted-foreground/30" />
          <p>Nenhum pipeline encontrado</p>
          <p className="text-xs mt-1">Crie um pipeline para comecar</p>
        </div>
      ) : (
        pipelines.map((pipeline) => (
          <KanbanBoard
            key={pipeline.id}
            pipeline={pipeline}
            onRefresh={async () => {
              const data = await getPipelines();
              setPipelines(data as Pipeline[]);
            }}
          />
        ))
      )}
    </div>
  );
}

function KanbanBoard({
  pipeline,
  onRefresh,
}: {
  pipeline: Pipeline;
  onRefresh: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [showCreateDeal, setShowCreateDeal] = useState<string | null>(null);
  const [newDealTitle, setNewDealTitle] = useState("");
  const [newDealValue, setNewDealValue] = useState("");
  const [dealErrors, setDealErrors] = useState<Record<string, string>>({});
  const [showGoalsEditor, setShowGoalsEditor] = useState(false);
  const [pipelineGoal, setPipelineGoal] = useState<PipelineGoal>(DEFAULT_PIPELINE_GOAL);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GOALS_STORAGE_KEY);
      if (!raw) {
        setPipelineGoal(DEFAULT_PIPELINE_GOAL);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, Partial<PipelineGoal>>;
      const goal = parsed[pipeline.id] || DEFAULT_PIPELINE_GOAL;
      setPipelineGoal({
        revenue: Math.max(0, Number(goal.revenue) || 0),
        won: Math.max(0, Number(goal.won) || 0),
      });
    } catch {
      setPipelineGoal(DEFAULT_PIPELINE_GOAL);
    }
  }, [pipeline.id]);

  const stages = (pipeline.pipeline_stages || []).sort(
    (a, b) => a.sort_order - b.sort_order
  );

  function updatePipelineGoal(field: keyof PipelineGoal, value: number) {
    const nextGoal = {
      ...pipelineGoal,
      [field]: Math.max(0, value),
    };
    setPipelineGoal(nextGoal);
    try {
      const raw = window.localStorage.getItem(GOALS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, PipelineGoal>) : {};
      parsed[pipeline.id] = nextGoal;
      window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      // ignore persistence errors
    }
  }

  function handleDrop(stageId: string) {
    setDragOverStageId(null);
    if (!draggedDeal) return;
    startTransition(async () => {
      await moveDeal(draggedDeal, stageId, 0);
      onRefresh();
    });
    setDraggedDeal(null);
  }

  async function handleCreateDeal(stageId: string) {
    if (!newDealTitle.trim()) {
      setDealErrors({ title: "Campo obrigatorio" });
      return;
    }

    setDealErrors({});
    await createDeal({
      pipeline_id: pipeline.id,
      stage_id: stageId,
      title: newDealTitle,
      value: parseFloat(newDealValue) || 0,
    });
    setNewDealTitle("");
    setNewDealValue("");
    setShowCreateDeal(null);
    onRefresh();
    toast.success("Negocio criado");
  }

  function handleDeleteDeal(dealId: string) {
    if (!confirm("Excluir este negocio?")) return;
    startTransition(async () => {
      const { error } = await deleteDeal(dealId);
      if (error) {
        toast.error(`Falha ao excluir: ${error}`);
        return;
      }
      onRefresh();
      toast.success("Negocio excluido");
    });
  }

  const totalValue = stages.reduce(
    (sum, stage) =>
      sum + (stage.deals || []).reduce((acc, deal) => acc + (deal.value || 0), 0),
    0
  );
  const totalDeals = stages.reduce((sum, stage) => sum + (stage.deals?.length || 0), 0);
  const wonDeals = stages.reduce(
    (sum, stage) =>
      sum + (stage.deals || []).filter((deal) => deal.status === "won").length,
    0
  );
  const lostDeals = stages.reduce(
    (sum, stage) =>
      sum + (stage.deals || []).filter((deal) => deal.status === "lost").length,
    0
  );
  const conversionRate = getConversionRate(wonDeals, lostDeals);
  const revenueProgress =
    pipelineGoal.revenue > 0
      ? Math.min((totalValue / pipelineGoal.revenue) * 100, 100)
      : 0;
  const wonProgress =
    pipelineGoal.won > 0 ? Math.min((wonDeals / pipelineGoal.won) * 100, 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="text-lg font-semibold text-foreground">{pipeline.name}</h2>
        <span className="text-xs text-muted-foreground bg-card px-2 py-1 rounded-full flex items-center gap-1">
          <DollarSign className="size-3" />
          R$ {totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
        <span className="text-xs text-muted-foreground bg-card px-2 py-1 rounded-full flex items-center gap-1">
          <Target className="size-3" />
          {totalDeals} negocios
        </span>
        <span className="text-xs text-muted-foreground bg-card px-2 py-1 rounded-full flex items-center gap-1">
          <TrendingUp className="size-3" />
          {wonDeals} ganhos
        </span>
        <span className="text-xs text-muted-foreground bg-card px-2 py-1 rounded-full flex items-center gap-1">
          <Percent className="size-3" />
          {conversionRate.toFixed(1)}% conv.
        </span>
        <button
          onClick={() => setShowGoalsEditor((prev) => !prev)}
          className="text-xs text-muted-foreground bg-card px-2 py-1 rounded-full flex items-center gap-1 hover:text-foreground"
        >
          <Flag className="size-3" />
          Metas
        </button>
      </div>

      {showGoalsEditor && (
        <div className="border border-border rounded-xl bg-card p-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Meta de receita (R$)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={pipelineGoal.revenue === 0 ? "" : String(pipelineGoal.revenue)}
              onChange={(e) => updatePipelineGoal("revenue", Number(e.target.value))}
              placeholder="Ex: 50000"
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
            />
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${revenueProgress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {pipelineGoal.revenue > 0
                ? `${revenueProgress.toFixed(1)}% da meta`
                : "Defina uma meta para acompanhar o progresso"}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Meta de negocios ganhos</label>
            <input
              type="number"
              min={0}
              step="1"
              value={pipelineGoal.won === 0 ? "" : String(pipelineGoal.won)}
              onChange={(e) => updatePipelineGoal("won", Number(e.target.value))}
              placeholder="Ex: 25"
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground outline-none focus:border-primary"
            />
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${wonProgress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {pipelineGoal.won > 0
                ? `${wonProgress.toFixed(1)}% da meta`
                : "Defina uma meta para acompanhar os ganhos"}
            </p>
          </div>
        </div>
      )}

      <div className={`flex gap-3 overflow-x-auto pb-4 ${isPending ? "opacity-90" : ""}`}>
        {stages.map((stage, index) => {
          const metrics = getStageMetrics(stage.deals || []);
          const previousCount =
            index === 0 ? metrics.count : (stages[index - 1]?.deals?.length || 0);
          const stageConversion =
            index === 0 ? 100 : previousCount > 0 ? (metrics.count / previousCount) * 100 : 0;
          const isOver = dragOverStageId === stage.id;

          return (
            <div
              key={stage.id}
              className={`min-w-[240px] flex-1 bg-card border border-border rounded-xl overflow-hidden transition-all duration-200 ${
                isOver ? "ring-2 ring-primary/40 -translate-y-0.5 bg-primary/5" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStageId(stage.id);
              }}
              onDragLeave={() => setDragOverStageId(null)}
              onDrop={() => handleDrop(stage.id)}
            >
              <div
                className="px-3 py-2 border-b border-border flex items-center justify-between"
                style={{ borderTopWidth: 3, borderTopColor: stage.color }}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{stage.name}</span>
                    <span className="text-[10px] text-muted-foreground/60 bg-muted px-1.5 rounded-full">
                      {metrics.count}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/70">
                    R$ {metrics.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | Ticket medio R$ {metrics.average.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    {index > 0 ? ` | Conv ${stageConversion.toFixed(1)}%` : ""}
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateDeal(stage.id)}
                  aria-label="Adicionar negocio"
                  className="text-muted-foreground/60 hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
              </div>

              <div className="p-2 space-y-2 min-h-[100px] max-h-[400px] overflow-y-auto">
                {isOver && draggedDeal && (
                  <div className="border border-dashed border-primary/60 bg-primary/5 text-primary rounded-md py-2 text-center text-[11px]">
                    Solte aqui para mover
                  </div>
                )}
                {showCreateDeal === stage.id && (
                  <div className="bg-muted border border-border rounded-lg p-2 space-y-2">
                    <div>
                      <input
                        value={newDealTitle}
                        onChange={(e) => {
                          setNewDealTitle(e.target.value);
                          setDealErrors({});
                        }}
                        onBlur={() => {
                          if (!newDealTitle.trim()) {
                            setDealErrors({ title: "Campo obrigatorio" });
                          }
                        }}
                        placeholder="Titulo... *"
                        className={`w-full px-2 py-1.5 text-xs bg-background border rounded text-foreground placeholder-muted-foreground/60 outline-none ${
                          dealErrors.title ? "border-red-500" : "border-border"
                        }`}
                        autoFocus
                      />
                      {dealErrors.title && (
                        <p className="text-xs text-red-500 mt-1">{dealErrors.title}</p>
                      )}
                    </div>
                    <input
                      value={newDealValue}
                      onChange={(e) => setNewDealValue(e.target.value)}
                      placeholder="Valor (R$)"
                      type="number"
                      className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder-muted-foreground/60 outline-none"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleCreateDeal(stage.id)}
                        className="flex-1 px-2 py-1 text-xs bg-primary text-white rounded"
                      >
                        Criar
                      </button>
                      <button
                        onClick={() => setShowCreateDeal(null)}
                        className="px-2 py-1 text-xs text-muted-foreground/60 hover:text-foreground"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {(stage.deals || [])
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((deal) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => setDraggedDeal(deal.id)}
                      className={`bg-muted border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-muted-foreground/30 hover:-translate-y-0.5 transition-all ${
                        draggedDeal === deal.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <GripVertical className="size-3 text-muted-foreground/60 shrink-0" />
                          <span className="text-sm text-foreground truncate">{deal.title}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteDeal(deal.id)}
                          aria-label="Excluir negocio"
                          className="text-muted-foreground/60 hover:text-red-500 shrink-0"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {deal.status === "won"
                            ? "Ganho"
                            : deal.status === "lost"
                              ? "Perdido"
                              : "Aberto"}
                        </span>
                        {deal.value > 0 && (
                          <p className="text-xs text-emerald-400">
                            R$ {deal.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
