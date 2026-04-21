"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "lucide-react";
import Link from "next/link";
import {
  createDeal,
  updateDealStage,
  updateDeal,
  deleteDeal,
} from "@/actions/crm";
import { useRole } from "@/lib/hooks/use-role";

// ============ TYPES ============

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface LeadTag {
  tags: Tag | null;
}

interface Lead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  status: string;
  lead_id: string | null;
  pipeline_id: string;
  sort_order: number;
  leads: {
    name: string;
    phone: string | null;
    email: string | null;
    lead_tags?: LeadTag[];
  } | null;
  stage_id: string;
}

interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  sort_order: number;
}

interface Pipeline {
  id: string;
  name: string;
}

interface PipelineGoal {
  revenue: number;
  won: number;
}

// ============ HELPERS ============

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

const GOALS_STORAGE_KEY = "crm-kanban-goals-v1";
const DEFAULT_PIPELINE_GOAL: PipelineGoal = { revenue: 0, won: 0 };

// ============ MAIN COMPONENT ============

export function CrmClient({
  pipelines,
  stages: initialStages,
  deals: initialDeals,
  leads,
}: {
  pipelines: Pipeline[];
  stages: Stage[];
  deals: Deal[];
  leads: { id: string; name: string; phone: string | null; email: string | null }[];
}) {
  const { isAgent, isAdmin } = useRole(); // agent+ operates deals; admin+ accesses settings
  const [selectedPipeline, setSelectedPipeline] = React.useState(
    pipelines[0]?.id || ""
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [draggedDealId, setDraggedDealId] = React.useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = React.useState<string | null>(
    null
  );
  const [localDeals, setLocalDeals] = React.useState<Deal[]>(initialDeals);
  const [goalsByPipeline, setGoalsByPipeline] = React.useState<
    Record<string, PipelineGoal>
  >({});
  const [showGoalsEditor, setShowGoalsEditor] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GOALS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, Partial<PipelineGoal>>;
      const normalized = Object.fromEntries(
        Object.entries(parsed).map(([pipelineId, goal]) => [
          pipelineId,
          {
            revenue: Math.max(0, Number(goal.revenue) || 0),
            won: Math.max(0, Number(goal.won) || 0),
          },
        ])
      ) as Record<string, PipelineGoal>;
      setGoalsByPipeline(normalized);
    } catch {
      setGoalsByPipeline({});
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goalsByPipeline));
    } catch {
      // ignore persistence errors
    }
  }, [goalsByPipeline]);

  // Sort stages by sort_order
  const sortedStages = React.useMemo(
    () =>
      initialStages
        .filter((stage) => stage.pipeline_id === selectedPipeline)
        .sort((a, b) => a.sort_order - b.sort_order),
    [initialStages, selectedPipeline]
  );

  // Filter deals
  const filteredDeals = React.useMemo(() => {
    let filtered = localDeals.filter((deal) => deal.pipeline_id === selectedPipeline);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.leads?.name.toLowerCase().includes(q) ||
          d.leads?.phone?.includes(q) ||
          d.leads?.email?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((d) => d.status === statusFilter);
    }
    return filtered;
  }, [localDeals, searchQuery, selectedPipeline, statusFilter]);

  const boardMetrics = React.useMemo(() => {
    const total = filteredDeals.reduce((sum, deal) => sum + (deal.value || 0), 0);
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

  const pipelineGoal = goalsByPipeline[selectedPipeline] || DEFAULT_PIPELINE_GOAL;
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

  // Group deals by stage
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

    // Optimistic update
    setLocalDeals((prev) =>
      prev.map((d) =>
        d.id === draggedDealId ? { ...d, stage_id: stageId } : d
      )
    );
    setDraggedDealId(null);

    // Server update
    startTransition(async () => {
      try {
        await updateDealStage(draggedDealId, stageId);
      } catch {
        // Revert on error
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === draggedDealId
              ? { ...d, stage_id: previousStageId }
              : d
          )
        );
      }
    });
  }

  // ---- DELETE DEAL ----
  function handleDeleteDeal(dealId: string) {
    const previous = [...localDeals];
    setLocalDeals((prev) => prev.filter((d) => d.id !== dealId));

    startTransition(async () => {
      try {
        await deleteDeal(dealId);
      } catch {
        setLocalDeals(previous);
      }
    });
  }

  // ---- ADD DEAL (optimistic) ----
  function handleDealCreated(deal: Deal) {
    setLocalDeals((prev) => [...prev, deal]);
  }

  // ---- UPDATE DEAL ----
  function handleDealUpdated(dealId: string, updates: Partial<Deal>) {
    setLocalDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, ...updates } : d))
    );
  }

  return (
    <div className="space-y-4">
      {/* ====== TOP BAR ====== */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Pipeline selector */}
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

        {/* Status filter */}
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

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar negócio ou lead..."
            className="h-9 pl-9 rounded-md"
          />
        </div>

        {/* Total info + Settings */}
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5">
            <Target className="size-3.5" />
            {boardMetrics.count} negocios
          </Badge>
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5">
            <CircleDollarSign className="size-3.5" />
            R$ {formatCurrency(boardMetrics.total)}
          </Badge>
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5">
            <TrendingUp className="size-3.5" />
            {boardMetrics.won} ganhos
          </Badge>
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5">
            <Percent className="size-3.5" />
            {boardMetrics.conversionRate.toFixed(1)}% conv.
          </Badge>
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-medium">
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
          {isAdmin && (
            <Link href="/crm/settings">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-8 rounded-md"
                title="Configurações do CRM"
              >
                <Settings className="size-4" />
              </Button>
            </Link>
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
                value={pipelineGoal.revenue === 0 ? "" : String(pipelineGoal.revenue)}
                onChange={(e) => updatePipelineGoal("revenue", Number(e.target.value))}
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
                onChange={(e) => updatePipelineGoal("won", Number(e.target.value))}
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
      <div className={`flex gap-4 overflow-x-auto pb-4 ${isPending ? "opacity-90" : ""}`}>
        {sortedStages.map((stage, index) => {
          const stageDeals = dealsByStage(stage.id);
          const isOver = dragOverStageId === stage.id;
          const metrics = getStageMetrics(stageDeals);
          const previousCount =
            index === 0 ? stageDeals.length : dealsByStage(sortedStages[index - 1].id).length;
          const stageConversion =
            index === 0 ? 100 : previousCount > 0 ? (metrics.count / previousCount) * 100 : 0;

          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-80"
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(stage.id)}
            >
              <div
                className={`rounded-xl bg-muted/30 transition-all duration-200 min-h-[500px] flex flex-col ${
                  isOver ? "ring-2 ring-primary/50 bg-primary/5 -translate-y-0.5" : ""
                }`}
              >
                {/* Column header with 3px top border */}
                <div
                  className="px-3 py-2.5 flex items-center justify-between rounded-t-xl bg-card border-b"
                  style={{ borderTop: `3px solid ${stage.color}` }}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{stage.name}</h3>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold">
                        {metrics.count}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>R$ {formatCurrency(metrics.total)}</span>
                      <span>Ticket medio: R$ {formatCurrency(metrics.average)}</span>
                      {index > 0 && <span>Conv: {stageConversion.toFixed(1)}%</span>}
                    </div>
                  </div>
                  {isAgent && (
                    <AddDealDialog
                      pipelineId={selectedPipeline}
                      stageId={stage.id}
                      leads={leads}
                      onCreated={handleDealCreated}
                      buttonColor="currentColor"
                    />
                  )}
                </div>

                {/* Cards area */}
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
                      leads={leads}
                      canEdit={isAgent}
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
  leads,
  canEdit,
}: {
  deal: Deal;
  draggedDealId: string | null;
  onDragStart: (e: React.DragEvent, dealId: string) => void;
  onDelete: (dealId: string) => void;
  onUpdate: (dealId: string, updates: Partial<Deal>) => void;
  leads: { id: string; name: string; phone: string | null; email: string | null }[];
  canEdit: boolean;
}) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const isDragging = draggedDealId === deal.id;
  const lead = deal.leads;
  const phone = lead?.phone;

  // Extract tags from lead_tags
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React compiler cannot analyze type predicate filter; manual useMemo remains correct
  const tags: Tag[] = React.useMemo(() => {
    if (!lead?.lead_tags) return [];
    return lead.lead_tags
      .map((lt) => lt.tags)
      .filter((t): t is Tag => t !== null);
  }, [lead?.lead_tags]);

  return (
    <>
      <div
        className={`bg-card border rounded-lg p-3 hover:shadow-sm hover:-translate-y-0.5 hover:border-primary/30 transition-all duration-150 ${
          canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        } ${isDragging ? "opacity-40 ring-2 ring-primary" : ""}`}
        draggable={canEdit}
        onDragStart={(e) => canEdit && onDragStart(e, deal.id)}
        onClick={() => setDetailOpen(true)}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium truncate">
            {lead?.name || deal.title}
          </p>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {deal.status === "won" ? "Ganho" : deal.status === "lost" ? "Perdido" : "Aberto"}
          </Badge>
        </div>

        <p className="text-[11px] text-muted-foreground truncate mt-1">
          {deal.title}
        </p>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
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

        {/* Contact actions */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1.5">
            {phone && (
              <button
                type="button"
                className="inline-flex items-center justify-center size-7 rounded-md bg-green-500/10 text-green-600 hover:bg-green-500/20 transition-colors"
                title="Abrir WhatsApp"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    `https://wa.me/55${cleanPhone(phone)}`,
                    "_blank"
                  );
                }}
              >
                <MessageCircle className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* Value */}
        {deal.value > 0 && (
          <p className="text-xs font-medium text-muted-foreground mt-2">
            R$ {formatCurrency(deal.value)}
          </p>
        )}
      </div>

      {/* Deal detail dialog */}
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
  const [isPending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState(deal.title);
  const [value, setValue] = React.useState(String(deal.value || 0));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  React.useEffect(() => {
    setTitle(deal.title);
    setValue(String(deal.value || 0));
  }, [deal.title, deal.value]);

  function handleSave() {
    let valid = true;
    if (!title.trim()) { setError("detail_title", "Campo obrigatório"); valid = false; } else { clearError("detail_title"); }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) { setError("detail_value", "Valor deve ser >= 0"); valid = false; } else { clearError("detail_value"); }
    if (!valid) return;

    const newTitle = title.trim() || deal.title;
    const newValue = parseFloat(value) || 0;

    onUpdate(deal.id, { title: newTitle, value: newValue });

    startTransition(async () => {
      try {
        await updateDeal(deal.id, { title: newTitle, value: newValue });
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
            <Label className="text-sm font-medium">Título {canEdit && "*"}</Label>
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); clearError("detail_title"); }}
              onBlur={() => { if (!title.trim()) setError("detail_title", "Campo obrigatório"); else clearError("detail_title"); }}
              disabled={!canEdit}
              className={`h-10 rounded-md ${errors.detail_title ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
            />
            {errors.detail_title && <p className="text-xs text-destructive mt-1">{errors.detail_title}</p>}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => { setValue(e.target.value); clearError("detail_value"); }}
              onBlur={() => { const n = parseFloat(value); if (isNaN(n) || n < 0) setError("detail_value", "Valor deve ser >= 0"); else clearError("detail_value"); }}
              disabled={!canEdit}
              className={`h-10 rounded-md ${errors.detail_value ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
            />
            {errors.detail_value && <p className="text-xs text-destructive mt-1">{errors.detail_value}</p>}
          </div>

          {/* Lead info */}
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

              {/* Tags */}
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
  leads: { id: string; name: string; phone: string | null; email: string | null }[];
  onCreated: (deal: Deal) => void;
  buttonColor: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [selectedLeadId, setSelectedLeadId] = React.useState("");
  const [addErrors, setAddErrors] = React.useState<Record<string, string>>({});

  function setAddError(field: string, msg: string) {
    setAddErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearAddError(field: string) {
    setAddErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function handleSubmit(formData: FormData) {
    const title = formData.get("title") as string || "";
    const value = formData.get("value") as string || "0";
    let valid = true;
    if (!title.trim()) { setAddError("add_title", "Campo obrigatório"); valid = false; } else { clearAddError("add_title"); }
    const numValue = parseFloat(value);
    if (value && (isNaN(numValue) || numValue < 0)) { setAddError("add_value", "Valor deve ser >= 0"); valid = false; } else { clearAddError("add_value"); }
    if (!valid) return;

    formData.set("pipeline_id", pipelineId);
    formData.set("stage_id", stageId);
    if (selectedLeadId) {
      formData.set("lead_id", selectedLeadId);
    }

    startTransition(async () => {
      try {
        const result = await createDeal(formData);
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
          } as never);
        }
        setOpen(false);
        setSelectedLeadId("");
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
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Título *</Label>
            <Input
              name="title"
              required
              placeholder="Nome do negócio"
              onBlur={(e) => { if (!e.target.value.trim()) setAddError("add_title", "Campo obrigatório"); else clearAddError("add_title"); }}
              onChange={() => clearAddError("add_title")}
              className={`h-10 rounded-md ${addErrors.add_title ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
            />
            {addErrors.add_title && <p className="text-xs text-destructive mt-1">{addErrors.add_title}</p>}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Valor (R$)</Label>
            <Input
              name="value"
              type="number"
              step="0.01"
              placeholder="0.00"
              onBlur={(e) => { const n = parseFloat(e.target.value); if (e.target.value && (isNaN(n) || n < 0)) setAddError("add_value", "Valor deve ser >= 0"); else clearAddError("add_value"); }}
              onChange={() => clearAddError("add_value")}
              className={`h-10 rounded-md ${addErrors.add_value ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
            />
            {addErrors.add_value && <p className="text-xs text-destructive mt-1">{addErrors.add_value}</p>}
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
