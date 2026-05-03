"use client";

// KanbanBoard — view do funil compartilhada entre CRM (cliente) e Admin
// (superadmin). Auth/role/router moram nos apps; o pacote recebe:
//   - dados (pipelines, stages, deals, leads) via props
//   - permissoes (canEdit, canManagePipelines) via props
//   - actions (mutations) via <KanbanProvider> (DI igual ao ai-agent-ui)
//   - onChange callback pra o pai re-fetchar/revalidar quando algo muda
//
// Originalmente em apps/crm/src/app/(dashboard)/crm/crm-client.tsx
// (~1255 linhas). Extraido pra resolver drift visual entre os 2 apps.

import * as React from "react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Plus,
  Trash2,
  User,
  Phone,
  Mail,
  Search,
  MessageCircle,
  Settings,
  CircleDollarSign,
  Target,
  TrendingUp,
  Flag,
  Percent,
  X,
  Check,
} from "lucide-react";
import type {
  DealWithLead,
  LeadTagJoin,
  Pipeline,
  PipelineGoal,
  Stage,
  StageOutcome,
  TagRef,
} from "@persia/shared/crm";

import { useKanbanActions } from "../context";
import { PipelineConfigDrawer } from "./PipelineConfigDrawer";

// Buckets de outcome — define labels, cores e ordem visual dos 3
// pills do filtro principal. Espelha o design da referencia.
const OUTCOME_BUCKETS: Array<{
  outcome: StageOutcome;
  label: string;
  /** Tailwind classes pra pill ATIVO (cor cheia + texto branco). */
  activeClass: string;
  /** Tailwind classes pra pill INATIVO (border discreto). */
  inactiveClass: string;
  /** Cor do header das colunas deste bucket. */
  headerBg: string;
  /** Cor de fundo da coluna inteira quando ativa (refletindo o outcome). */
  columnBg: string;
}> = [
  {
    outcome: "em_andamento",
    label: "Em andamento",
    activeClass: "bg-purple-600 text-white",
    inactiveClass: "border border-purple-300 text-purple-700 hover:bg-purple-50",
    headerBg: "bg-blue-500",
    columnBg: "bg-sky-50/60",
  },
  {
    outcome: "falha",
    label: "Falha",
    activeClass: "bg-red-500 text-white",
    inactiveClass: "border border-red-300 text-red-700 hover:bg-red-50",
    headerBg: "bg-red-500",
    columnBg: "bg-red-50/50",
  },
  {
    outcome: "bem_sucedido",
    label: "Bem-sucedido",
    activeClass: "bg-emerald-500 text-white",
    inactiveClass: "border border-emerald-300 text-emerald-700 hover:bg-emerald-50",
    headerBg: "bg-emerald-500",
    columnBg: "bg-emerald-50/50",
  },
];

type Tag = TagRef;
type LeadTag = LeadTagJoin;
type Deal = DealWithLead;

export interface KanbanLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
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

const DEFAULT_PIPELINE_GOAL: PipelineGoal = { revenue: 0, won: 0 };

export interface KanbanBoardProps {
  pipelines: Pipeline[];
  stages: Stage[];
  deals: Deal[];
  leads: KanbanLead[];
  /** agent+: pode criar/editar/mover/excluir negocios. */
  canEdit: boolean;
  /** admin+: pode configurar funis (criar/renomear/deletar pipelines+stages). */
  canManagePipelines: boolean;
  /**
   * Chamado depois de cada mutation server-side bem-sucedida — pra o pai
   * re-fetchar dados (CRM usa router.refresh; admin re-fetcha via state).
   */
  onChange?: () => void;
  /** localStorage key pras metas (uma por app pra nao colidir). */
  goalsStorageKey?: string;
  /** Slot opcional na toolbar (ex.: botao Importar do CRM, antes do
   *  icone Configurar). Cada app injeta o que precisa. */
  toolbarExtras?: React.ReactNode;
}

export function KanbanBoard({
  pipelines,
  stages: initialStages,
  deals: initialDeals,
  leads,
  canEdit,
  canManagePipelines,
  onChange,
  goalsStorageKey = "crm-kanban-goals-v1",
  toolbarExtras,
}: KanbanBoardProps) {
  const actions = useKanbanActions();
  const [selectedPipeline, setSelectedPipeline] = React.useState(
    pipelines[0]?.id || "",
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [configDrawerOpen, setConfigDrawerOpen] = React.useState(false);
  const [activeOutcome, setActiveOutcome] =
    React.useState<StageOutcome>("em_andamento");
  const [draggedDealId, setDraggedDealId] = React.useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = React.useState<string | null>(
    null,
  );
  const [localDeals, setLocalDeals] = React.useState<Deal[]>(initialDeals);
  const [goalsByPipeline, setGoalsByPipeline] = React.useState<
    Record<string, PipelineGoal>
  >({});
  const [showGoalsEditor, setShowGoalsEditor] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setLocalDeals(initialDeals);
  }, [initialDeals]);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(goalsStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, Partial<PipelineGoal>>;
      const normalized = Object.fromEntries(
        Object.entries(parsed).map(([pipelineId, goal]) => [
          pipelineId,
          {
            revenue: Math.max(0, Number(goal.revenue) || 0),
            won: Math.max(0, Number(goal.won) || 0),
          },
        ]),
      ) as Record<string, PipelineGoal>;
      setGoalsByPipeline(normalized);
    } catch {
      setGoalsByPipeline({});
    }
  }, [goalsStorageKey]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(
        goalsStorageKey,
        JSON.stringify(goalsByPipeline),
      );
    } catch {
      // ignore persistence errors
    }
  }, [goalsByPipeline, goalsStorageKey]);

  const stagesByOutcome = React.useMemo(() => {
    const grouped: Record<StageOutcome, Stage[]> = {
      em_andamento: [],
      falha: [],
      bem_sucedido: [],
    };
    for (const stage of initialStages) {
      if (stage.pipeline_id !== selectedPipeline) continue;
      const bucket = (stage.outcome ?? "em_andamento") as StageOutcome;
      grouped[bucket].push(stage);
    }
    for (const k of Object.keys(grouped) as StageOutcome[]) {
      grouped[k].sort((a, b) => a.sort_order - b.sort_order);
    }
    return grouped;
  }, [initialStages, selectedPipeline]);

  const sortedStages = stagesByOutcome[activeOutcome];

  const filteredDeals = React.useMemo(() => {
    let filtered = localDeals.filter(
      (deal) => deal.pipeline_id === selectedPipeline,
    );
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.leads?.name.toLowerCase().includes(q) ||
          d.leads?.phone?.includes(q) ||
          d.leads?.email?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((d) => d.status === statusFilter);
    }
    return filtered;
  }, [localDeals, searchQuery, selectedPipeline, statusFilter]);

  const boardMetrics = React.useMemo(() => {
    const total = filteredDeals.reduce(
      (sum, deal) => sum + (deal.value || 0),
      0,
    );
    const won = filteredDeals.filter((deal) => deal.status === "won").length;
    const lost = filteredDeals.filter((deal) => deal.status === "lost").length;
    const conversionRate = getConversionRate(won, lost);
    return {
      count: filteredDeals.length,
      total,
      won,
      lost,
      conversionRate,
    };
  }, [filteredDeals]);

  const pipelineGoal =
    goalsByPipeline[selectedPipeline] || DEFAULT_PIPELINE_GOAL;
  const revenueProgress =
    pipelineGoal.revenue > 0
      ? Math.min((boardMetrics.total / pipelineGoal.revenue) * 100, 100)
      : 0;
  const wonProgress =
    pipelineGoal.won > 0
      ? Math.min((boardMetrics.won / pipelineGoal.won) * 100, 100)
      : 0;

  function updatePipelineGoal(field: keyof PipelineGoal, value: number) {
    if (!selectedPipeline) return;
    setGoalsByPipeline((prev) => ({
      ...prev,
      [selectedPipeline]: {
        ...(prev[selectedPipeline] || DEFAULT_PIPELINE_GOAL),
        [field]: Math.max(0, value),
      },
    }));
  }

  function dealsByStage(stageId: string) {
    return filteredDeals
      .filter((d) => d.stage_id === stageId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  // ---- DRAG & DROP ----

  function handleDragStart(e: React.DragEvent, dealId: string) {
    setDraggedDealId(dealId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStageId(stageId);
  }

  function handleDragLeave() {
    setDragOverStageId(null);
  }

  function handleDrop(stageId: string) {
    setDragOverStageId(null);
    if (!draggedDealId) return;

    const deal = localDeals.find((d) => d.id === draggedDealId);
    if (!deal || deal.stage_id === stageId) {
      setDraggedDealId(null);
      return;
    }

    const previousStageId = deal.stage_id;

    setLocalDeals((prev) =>
      prev.map((d) =>
        d.id === draggedDealId ? { ...d, stage_id: stageId } : d,
      ),
    );
    setDraggedDealId(null);

    startTransition(async () => {
      try {
        await actions.moveDealStage(draggedDealId, stageId);
        onChange?.();
      } catch {
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === draggedDealId ? { ...d, stage_id: previousStageId } : d,
          ),
        );
      }
    });
  }

  function handleMoveToTerminal(
    dealId: string,
    outcome: "falha" | "bem_sucedido",
  ) {
    const terminalStage = stagesByOutcome[outcome][0];
    if (!terminalStage) {
      console.warn(
        `[handleMoveToTerminal] Pipeline nao tem stage com outcome=${outcome}.`,
      );
      return;
    }
    const deal = localDeals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === terminalStage.id) return;

    const previousStageId = deal.stage_id;

    setLocalDeals((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stage_id: terminalStage.id } : d,
      ),
    );

    startTransition(async () => {
      try {
        await actions.moveDealStage(dealId, terminalStage.id);
        onChange?.();
      } catch {
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === dealId ? { ...d, stage_id: previousStageId } : d,
          ),
        );
      }
    });
  }

  function handleDeleteDeal(dealId: string) {
    const previous = [...localDeals];
    setLocalDeals((prev) => prev.filter((d) => d.id !== dealId));

    startTransition(async () => {
      try {
        await actions.deleteDeal(dealId);
        onChange?.();
      } catch {
        setLocalDeals(previous);
      }
    });
  }

  function handleDealCreated(deal: Deal) {
    setLocalDeals((prev) => [...prev, deal]);
    onChange?.();
  }

  function handleDealUpdated(dealId: string, updates: Partial<Deal>) {
    setLocalDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, ...updates } : d)),
    );
  }

  return (
    <div className="space-y-4">
      {/* ====== OUTCOME PILLS ====== */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {OUTCOME_BUCKETS.map((bucket) => {
          const isActive = activeOutcome === bucket.outcome;
          const stageCount = stagesByOutcome[bucket.outcome].length;
          return (
            <button
              key={bucket.outcome}
              type="button"
              onClick={() => setActiveOutcome(bucket.outcome)}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${
                isActive ? bucket.activeClass : bucket.inactiveClass
              }`}
              aria-pressed={isActive}
            >
              <span>{bucket.label}</span>
              {stageCount > 0 && (
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    isActive ? "bg-white/20" : "bg-current/10"
                  }`}
                >
                  {stageCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ====== TOP BAR ====== */}
      <div className="flex items-center gap-3 flex-wrap">
        {pipelines.length > 1 && (
          <Select
            value={selectedPipeline}
            onValueChange={(v) => setSelectedPipeline(v ?? "")}
          >
            <SelectTrigger className="w-48 h-9 rounded-md">
              <SelectValue placeholder="Selecione o funil" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "all")}
        >
          <SelectTrigger className="w-40 h-9 rounded-md">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="open">Em andamento</SelectItem>
            <SelectItem value="won">Ganho</SelectItem>
            <SelectItem value="lost">Perdido</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar negócio ou lead..."
            className="h-9 pl-9 rounded-md"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium gap-1.5"
          >
            <Target className="size-3.5" />
            {boardMetrics.count} negocios
          </Badge>
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium gap-1.5"
          >
            <CircleDollarSign className="size-3.5" />
            R$ {formatCurrency(boardMetrics.total)}
          </Badge>
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium gap-1.5"
          >
            <TrendingUp className="size-3.5" />
            {boardMetrics.won} ganhos
          </Badge>
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium gap-1.5"
          >
            <Percent className="size-3.5" />
            {boardMetrics.conversionRate.toFixed(1)}% conv.
          </Badge>
          <Badge
            variant="secondary"
            className="rounded-full px-3 py-1 text-xs font-medium"
          >
            {boardMetrics.lost} perdidos
          </Badge>
          <Button
            type="button"
            variant={showGoalsEditor ? "secondary" : "ghost"}
            size="sm"
            className="h-8 rounded-md px-2.5"
            onClick={() => setShowGoalsEditor((prev) => !prev)}
          >
            <Flag className="size-3.5" />
            Metas
          </Button>
          {toolbarExtras}
          {canManagePipelines && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-md"
              title="Configurar funis"
              onClick={() => setConfigDrawerOpen(true)}
            >
              <Settings className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {showGoalsEditor && (
        <div className="rounded-xl border bg-card p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-revenue" className="text-xs">
                Meta de receita (R$)
              </Label>
              <Input
                id="goal-revenue"
                type="number"
                min={0}
                step="0.01"
                value={
                  pipelineGoal.revenue === 0 ? "" : String(pipelineGoal.revenue)
                }
                onChange={(e) =>
                  updatePipelineGoal("revenue", Number(e.target.value))
                }
                placeholder="Ex: 50000"
                className="h-9 rounded-md"
              />
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
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
              <Label htmlFor="goal-won" className="text-xs">
                Meta de negocios ganhos
              </Label>
              <Input
                id="goal-won"
                type="number"
                min={0}
                step="1"
                value={pipelineGoal.won === 0 ? "" : String(pipelineGoal.won)}
                onChange={(e) =>
                  updatePipelineGoal("won", Number(e.target.value))
                }
                placeholder="Ex: 25"
                className="h-9 rounded-md"
              />
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
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
        </div>
      )}

      {/* ====== KANBAN COLUMNS ====== */}
      {sortedStages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma etapa em{" "}
            <strong>
              {OUTCOME_BUCKETS.find((b) => b.outcome === activeOutcome)?.label}
            </strong>{" "}
            neste funil.
          </p>
          {canManagePipelines && (
            <p className="mt-1 text-xs text-muted-foreground">
              Configure no menu de configurações.
            </p>
          )}
        </div>
      ) : null}
      <div
        className={`flex gap-4 overflow-x-auto pb-4 ${
          isPending ? "opacity-90" : ""
        }`}
      >
        {sortedStages.map((stage, index) => {
          const stageDeals = dealsByStage(stage.id);
          const isOver = dragOverStageId === stage.id;
          const metrics = getStageMetrics(stageDeals);
          const previousCount =
            index === 0
              ? stageDeals.length
              : dealsByStage(sortedStages[index - 1].id).length;
          const stageConversion =
            index === 0
              ? 100
              : previousCount > 0
                ? (metrics.count / previousCount) * 100
                : 0;

          const bucketDef = OUTCOME_BUCKETS.find(
            (b) => b.outcome === activeOutcome,
          );
          const columnBgClass = bucketDef?.columnBg ?? "bg-muted/30";

          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-80"
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(stage.id)}
            >
              <div
                className={`rounded-xl ${columnBgClass} transition-all duration-200 min-h-[500px] flex flex-col ${
                  isOver
                    ? "ring-2 ring-primary/50 bg-primary/5 -translate-y-0.5"
                    : ""
                }`}
              >
                <div
                  className="px-3 py-2.5 flex items-center justify-between rounded-t-xl bg-card border-b"
                  style={{ borderTop: `3px solid ${stage.color}` }}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{stage.name}</h3>
                      <Badge
                        variant="secondary"
                        className="h-5 px-1.5 text-[10px] font-bold"
                      >
                        {metrics.count}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>R$ {formatCurrency(metrics.total)}</span>
                      <span>
                        Ticket medio: R$ {formatCurrency(metrics.average)}
                      </span>
                      {index > 0 && (
                        <span>Conv: {stageConversion.toFixed(1)}%</span>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <AddDealDialog
                      pipelineId={selectedPipeline}
                      stageId={stage.id}
                      leads={leads}
                      onCreated={handleDealCreated}
                      buttonColor="currentColor"
                    />
                  )}
                </div>

                <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                  {isOver && draggedDealId && (
                    <div className="border border-dashed border-primary/60 bg-primary/5 text-primary rounded-md py-2 text-center text-[11px]">
                      Solte aqui para mover
                    </div>
                  )}
                  {stageDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      draggedDealId={draggedDealId}
                      onDragStart={handleDragStart}
                      onDelete={handleDeleteDeal}
                      onUpdate={handleDealUpdated}
                      onMoveToTerminal={handleMoveToTerminal}
                      hasFailureBucket={stagesByOutcome.falha.length > 0}
                      hasSuccessBucket={
                        stagesByOutcome.bem_sucedido.length > 0
                      }
                      canEdit={canEdit}
                    />
                  ))}
                  {stageDeals.length === 0 && (
                    <div className="flex items-center justify-center h-20 border-dashed border-2 rounded-lg m-2 text-xs text-muted-foreground">
                      Nenhum negócio
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {canManagePipelines && (
        <PipelineConfigDrawer
          open={configDrawerOpen}
          onOpenChange={setConfigDrawerOpen}
          pipelines={pipelines}
          stages={initialStages}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// ============ DEAL CARD ============

function DealCard({
  deal,
  draggedDealId,
  onDragStart,
  onDelete,
  onUpdate,
  onMoveToTerminal,
  hasFailureBucket,
  hasSuccessBucket,
  canEdit,
}: {
  deal: Deal;
  draggedDealId: string | null;
  onDragStart: (e: React.DragEvent, dealId: string) => void;
  onDelete: (dealId: string) => void;
  onUpdate: (dealId: string, updates: Partial<Deal>) => void;
  onMoveToTerminal: (
    dealId: string,
    outcome: "falha" | "bem_sucedido",
  ) => void;
  hasFailureBucket: boolean;
  hasSuccessBucket: boolean;
  canEdit: boolean;
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const isDragging = draggedDealId === deal.id;
  const lead = deal.leads;
  const phone = lead?.phone;

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const tags: Tag[] = React.useMemo(() => {
    if (!lead?.lead_tags) return [];
    return lead.lead_tags
      .map((lt: LeadTag) => lt.tags)
      .filter((t: Tag | null): t is Tag => t !== null);
  }, [lead?.lead_tags]);

  const initials = React.useMemo(() => {
    const name = lead?.name?.trim();
    if (!name) return "";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [lead?.name]);

  const displayName = lead?.name || deal.title;

  return (
    <>
      <div
        className={`group bg-card border rounded-xl p-3 hover:shadow-sm hover:border-primary/30 transition-all duration-150 ${
          canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        } ${isDragging ? "opacity-40 ring-2 ring-primary" : ""}`}
        draggable={canEdit}
        onDragStart={(e) => canEdit && onDragStart(e, deal.id)}
        onClick={() => setDetailOpen(true)}
      >
        <div className="flex items-center gap-2.5">
          <div className="size-9 shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center text-xs font-semibold text-muted-foreground">
            {initials ? <span>{initials}</span> : <span aria-hidden>?</span>}
          </div>

          <p className="flex-1 min-w-0 text-sm font-semibold truncate text-cyan-600">
            {displayName}
          </p>

          {phone && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center size-7 rounded-full bg-green-500/15 text-green-600 hover:bg-green-500/25 transition-colors"
              title="Abrir WhatsApp"
              onClick={(e) => {
                e.stopPropagation();
                window.open(
                  `https://wa.me/55${cleanPhone(phone)}`,
                  "_blank",
                );
              }}
            >
              <MessageCircle className="size-3.5" />
            </button>
          )}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 ml-11.5">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-cyan-50 text-cyan-700"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          {lead?.assignee?.full_name
            ? `Responsável: ${lead.assignee.full_name}`
            : "Sem responsável"}
        </p>

        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            type="button"
            disabled={!canEdit || !hasFailureBucket}
            onClick={(e) => {
              e.stopPropagation();
              onMoveToTerminal(deal.id, "falha");
            }}
            title={
              hasFailureBucket
                ? "Mover pra etapa de falha"
                : "Sem etapa de falha configurada neste funil"
            }
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium bg-red-500 text-white hover:bg-red-600 disabled:bg-red-200 disabled:cursor-not-allowed transition-colors"
          >
            <X className="size-3" />
            Negócio descartado
          </button>
          <button
            type="button"
            disabled={!canEdit || !hasSuccessBucket}
            onClick={(e) => {
              e.stopPropagation();
              onMoveToTerminal(deal.id, "bem_sucedido");
            }}
            title={
              hasSuccessBucket
                ? "Mover pra etapa de sucesso"
                : "Sem etapa de sucesso configurada neste funil"
            }
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-emerald-200 disabled:cursor-not-allowed transition-colors"
          >
            <Check className="size-3" />
            Negócio fechado
          </button>
        </div>

        {deal.value > 0 && (
          <p className="text-[11px] font-medium text-muted-foreground mt-2">
            R$ {formatCurrency(deal.value)}
          </p>
        )}
      </div>

      <DealDetailDialog
        deal={deal}
        lead={lead}
        tags={tags}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={onDelete}
        onUpdate={onUpdate}
        canEdit={canEdit}
      />
    </>
  );
}

// ============ DEAL DETAIL DIALOG ============

function DealDetailDialog({
  deal,
  lead,
  tags,
  open,
  onOpenChange,
  onDelete,
  onUpdate,
  canEdit,
}: {
  deal: Deal;
  lead: { name: string; phone: string | null; email: string | null } | null;
  tags: Tag[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (dealId: string) => void;
  onUpdate: (dealId: string, updates: Partial<Deal>) => void;
  canEdit: boolean;
}) {
  const actions = useKanbanActions();
  const [isPending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(deal.title);
  const [value, setValue] = React.useState(String(deal.value || 0));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors((prev) => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  }

  React.useEffect(() => {
    setTitle(deal.title);
    setValue(String(deal.value || 0));
  }, [deal.title, deal.value]);

  function handleSave() {
    let valid = true;
    if (!title.trim()) {
      setError("detail_title", "Campo obrigatório");
      valid = false;
    } else {
      clearError("detail_title");
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      setError("detail_value", "Valor deve ser >= 0");
      valid = false;
    } else {
      clearError("detail_value");
    }
    if (!valid) return;

    const newTitle = title.trim() || deal.title;
    const newValue = parseFloat(value) || 0;

    onUpdate(deal.id, { title: newTitle, value: newValue });

    startTransition(async () => {
      try {
        await actions.updateDeal(deal.id, {
          title: newTitle,
          value: newValue,
        });
        onOpenChange(false);
      } catch {
        onUpdate(deal.id, { title: deal.title, value: deal.value });
      }
    });
  }

  function handleDelete() {
    onOpenChange(false);
    onDelete(deal.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Detalhes do Negócio
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Título {canEdit && "*"}
            </Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                clearError("detail_title");
              }}
              onBlur={() => {
                if (!title.trim())
                  setError("detail_title", "Campo obrigatório");
                else clearError("detail_title");
              }}
              disabled={!canEdit}
              className={`h-10 rounded-md ${
                errors.detail_title
                  ? "border-destructive focus-visible:ring-destructive/50"
                  : ""
              }`}
            />
            {errors.detail_title && (
              <p className="text-xs text-destructive mt-1">
                {errors.detail_title}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                clearError("detail_value");
              }}
              onBlur={() => {
                const n = parseFloat(value);
                if (isNaN(n) || n < 0)
                  setError("detail_value", "Valor deve ser >= 0");
                else clearError("detail_value");
              }}
              disabled={!canEdit}
              className={`h-10 rounded-md ${
                errors.detail_value
                  ? "border-destructive focus-visible:ring-destructive/50"
                  : ""
              }`}
            />
            {errors.detail_value && (
              <p className="text-xs text-destructive mt-1">
                {errors.detail_value}
              </p>
            )}
          </div>

          {lead && (
            <div className="rounded-xl border p-4 space-y-3">
              <p className="text-sm font-medium">Lead</p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <User className="size-3.5" />
                  {lead.name}
                </div>
                {lead.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="size-3.5" />
                    <a
                      href={`https://wa.me/55${cleanPhone(lead.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 hover:underline"
                    >
                      {lead.phone}
                    </a>
                  </div>
                )}
                {lead.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="size-3.5" />
                    {lead.email}
                  </div>
                )}
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t">
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: tag.color + "20",
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between mt-6">
            {canEdit ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                >
                  <Trash2 className="size-4 mr-1" />
                  Excluir
                </Button>
                <div className="flex gap-3">
                  <DialogClose
                    render={
                      <Button variant="outline" className="rounded-md">
                        Cancelar
                      </Button>
                    }
                  />
                  <Button
                    onClick={handleSave}
                    disabled={isPending}
                    className="rounded-md"
                  >
                    {isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="ml-auto">
                <DialogClose
                  render={
                    <Button variant="outline" className="rounded-md">
                      Fechar
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ ADD DEAL DIALOG ============

function AddDealDialog({
  pipelineId,
  stageId,
  leads,
  onCreated,
  buttonColor,
}: {
  pipelineId: string;
  stageId: string;
  leads: KanbanLead[];
  onCreated: (deal: Deal) => void;
  buttonColor: string;
}) {
  const actions = useKanbanActions();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [selectedLeadId, setSelectedLeadId] = React.useState("");
  const [titleInput, setTitleInput] = React.useState("");
  const [valueInput, setValueInput] = React.useState("");
  const [addErrors, setAddErrors] = React.useState<Record<string, string>>({});

  function setAddError(field: string, msg: string) {
    setAddErrors((prev) => ({ ...prev, [field]: msg }));
  }

  function clearAddError(field: string) {
    setAddErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    let valid = true;
    if (!titleInput.trim()) {
      setAddError("add_title", "Campo obrigatório");
      valid = false;
    } else {
      clearAddError("add_title");
    }
    const numValue = parseFloat(valueInput);
    if (valueInput && (isNaN(numValue) || numValue < 0)) {
      setAddError("add_value", "Valor deve ser >= 0");
      valid = false;
    } else {
      clearAddError("add_value");
    }
    if (!valid) return;

    const title = titleInput.trim();
    const value = parseFloat(valueInput) || 0;
    const leadId = selectedLeadId || null;

    startTransition(async () => {
      try {
        const result = await actions.createDeal({
          pipelineId,
          stageId,
          title,
          value,
          leadId,
        });
        if (result) {
          const matchedLead = leads.find((l) => l.id === selectedLeadId);
          onCreated({
            ...result,
            stage_id: result.stage_id || stageId,
            leads: matchedLead
              ? {
                  name: matchedLead.name,
                  phone: matchedLead.phone,
                  email: matchedLead.email,
                  lead_tags: [],
                }
              : null,
          } as Deal);
        }
        setOpen(false);
        setSelectedLeadId("");
        setTitleInput("");
        setValueInput("");
      } catch (err) {
        console.error("Erro ao criar negocio:", err);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center justify-center size-7 rounded-md transition-colors hover:bg-black/10"
            style={{ color: buttonColor }}
          >
            <Plus className="size-4" />
          </button>
        }
      />
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Novo Negócio
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Título *</Label>
            <Input
              value={titleInput}
              onChange={(e) => {
                setTitleInput(e.target.value);
                clearAddError("add_title");
              }}
              required
              placeholder="Nome do negócio"
              onBlur={(e) => {
                if (!e.target.value.trim())
                  setAddError("add_title", "Campo obrigatório");
                else clearAddError("add_title");
              }}
              className={`h-10 rounded-md ${
                addErrors.add_title
                  ? "border-destructive focus-visible:ring-destructive/50"
                  : ""
              }`}
            />
            {addErrors.add_title && (
              <p className="text-xs text-destructive mt-1">
                {addErrors.add_title}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={valueInput}
              onChange={(e) => {
                setValueInput(e.target.value);
                clearAddError("add_value");
              }}
              placeholder="0.00"
              onBlur={(e) => {
                const n = parseFloat(e.target.value);
                if (e.target.value && (isNaN(n) || n < 0))
                  setAddError("add_value", "Valor deve ser >= 0");
                else clearAddError("add_value");
              }}
              className={`h-10 rounded-md ${
                addErrors.add_value
                  ? "border-destructive focus-visible:ring-destructive/50"
                  : ""
              }`}
            />
            {addErrors.add_value && (
              <p className="text-xs text-destructive mt-1">
                {addErrors.add_value}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Lead (opcional)</Label>
            <Select
              value={selectedLeadId}
              onValueChange={(v) => setSelectedLeadId(v ?? "")}
            >
              <SelectTrigger className="w-full h-10 rounded-md">
                <SelectValue placeholder="Selecione um lead" />
              </SelectTrigger>
              <SelectContent>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name}
                    {lead.phone ? ` (${lead.phone})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-11 font-medium rounded-md"
          >
            {isPending ? "Criando..." : "Criar Negócio"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
