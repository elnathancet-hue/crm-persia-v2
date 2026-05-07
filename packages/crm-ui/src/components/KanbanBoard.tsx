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
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Checkbox } from "@persia/ui/checkbox";
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
} from "@persia/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@persia/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
// PR-PIPETOOLS: dropdown rico "Funil atual" na toolbar.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import {
  Plus,
  Trash2,
  User,
  Phone,
  Mail,
  Search,
  MessageCircle,
  ChevronDown,
  ChevronLeft,
  Settings,
  Settings2,
  CircleDollarSign,
  Target,
  TrendingUp,
  Flag,
  Percent,
  X,
  Check,
  SlidersHorizontal,
  Tag as TagIcon,
  Clock,
  Move,
  CheckCheck,
} from "lucide-react";

// Formata "ha X" curto pra footer do card (PR-D).
function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}
import type {
  DealLossReason,
  DealWithLead,
  LeadTagJoin,
  Pipeline,
  PipelineGoal,
  Stage,
  StageOutcome,
  TagRef,
} from "@persia/shared/crm";

import { useKanbanActions } from "../context";
import type { MarkAsLostInput } from "../actions";
import type { ExportColumn } from "../lib/export";
// PR-CRMOPS: configuracao do Kanban volta pra inline (sem rota
// separada). Drawer + dialog renderizados no proprio componente.
import { CreateKanbanDialog } from "./CreateKanbanDialog";
import { CreateLeadFromKanbanDialog } from "./CreateLeadFromKanbanDialog";
import { EditKanbanStructureDrawer } from "./EditKanbanStructureDrawer";
// PR-PIPETOOLS: drawer "Configurar funis" — gestao consolidada
import { ManageFunisDrawer } from "./ManageFunisDrawer";
import { MarkAsLostDialog } from "./MarkAsLostDialog";
import { ExportMenu } from "./ExportMenu";
import { DialogHero } from "./DialogHero";

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
    activeClass: "bg-purple-600 text-white shadow-md shadow-purple-600/20",
    inactiveClass:
      "border border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-500/30 dark:text-purple-300 dark:hover:bg-purple-500/10",
    headerBg: "bg-blue-500",
    columnBg: "bg-muted/30 dark:bg-muted/20",
  },
  {
    outcome: "falha",
    label: "Falha",
    activeClass: "bg-red-500 text-white shadow-md shadow-red-500/20",
    inactiveClass:
      "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10",
    headerBg: "bg-red-500",
    columnBg: "bg-red-50/30 dark:bg-red-500/5",
  },
  {
    outcome: "bem_sucedido",
    label: "Bem-sucedido",
    activeClass: "bg-emerald-500 text-white shadow-md shadow-emerald-500/20",
    inactiveClass:
      "border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10",
    headerBg: "bg-emerald-500",
    columnBg: "bg-emerald-50/30 dark:bg-emerald-500/5",
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

// PR-J: contrastTextColor — escolhe texto branco ou dark com base na
// luminancia do background. Usado nos headers de coluna do Kanban (cor
// do stage como bg, texto precisa ser legivel). Heuristica simples
// (relative luminance W3C-style). Fallback pra dark se hex invalido.
function contrastTextColor(bgHex: string): string {
  const hex = bgHex.replace(/^#/, "");
  if (hex.length !== 3 && hex.length !== 6) return "#1a1a1a";
  const full =
    hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "#1a1a1a";
  // YIQ luma (perceived brightness)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#1a1a1a" : "#ffffff";
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

// ============================================================================
// Filtros avancados (PR-K2)
// ============================================================================

export type TagLogic = "any" | "all" | "not";

export interface AdvancedFilters {
  /** Lista de tag IDs filtradas. Vazio = ignora. */
  tagIds: string[];
  /** Logica do filtro de tags. */
  tagLogic: TagLogic;
  /** Faixa de valor min (R$). null = sem limite. */
  valueMin: number | null;
  /** Faixa de valor max (R$). null = sem limite. */
  valueMax: number | null;
  /** Stale: deals com updated_at antes de N dias. null = ignora. */
  staleDays: number | null;
  /** Filtra por responsavel do lead (auth.users.id). null = todos. */
  assigneeId: string | null;
}

const EMPTY_FILTERS: AdvancedFilters = {
  tagIds: [],
  tagLogic: "any",
  valueMin: null,
  valueMax: null,
  staleDays: null,
  assigneeId: null,
};

function countActiveFilters(f: AdvancedFilters): number {
  let count = 0;
  if (f.tagIds.length > 0) count += 1;
  if (f.valueMin !== null || f.valueMax !== null) count += 1;
  if (f.staleDays !== null) count += 1;
  if (f.assigneeId !== null) count += 1;
  return count;
}

const STALE_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "7 dias" },
  { value: 14, label: "14 dias" },
  { value: 30, label: "30 dias" },
  { value: 60, label: "60 dias" },
];

// Sentinela pra Select shadcn — base-ui nao aceita value="" como item.
const ALL_ASSIGNEES = "__all__";

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
  /** Tags da org pra filtros avancados + bulk apply. Vazio = filtro
   *  oculta tag-pickers (mantem outros filtros). */
  tags?: TagRef[];
  /** Lista de responsaveis pra filtro 'Atribuido a'. Vazio = oculta. */
  assignees?: { id: string; name: string }[];
  /**
   * PR-CRMOPS: permite criar novo Kanban inline (botao "+ Criar novo
   * Kanban" na toolbar). Default: derivado de `canManagePipelines`.
   * Pode ser explicitamente desativado (ex: tela de Kanban so-leitura).
   */
  canCreateKanban?: boolean;
  /**
   * PR-CRMOPS: permite editar estrutura do Kanban inline (botao
   * "Editar estrutura" abre Sheet/Drawer com PipelineStagesEditor).
   * Default: derivado de `canManagePipelines`.
   */
  canEditStages?: boolean;
  /**
   * PR-CRMOPS2: quando setado, KanbanBoard fica em modo "controlled" —
   * renderiza so esse funil, esconde o select de funis (caller decide
   * via biblioteca de funis). Quando undefined, comportamento legado
   * (state interno + select).
   */
  pipelineId?: string;
  /**
   * PR-PIPETOOLS: callback pra trocar de funil via dropdown da toolbar.
   * CrmShell sincroniza com URL (?pipeline={id}). Em modo controlled
   * + esse callback presente, o dropdown "Funil atual" lista todos os
   * funis pra trocar.
   */
  onPipelineChange?: (newPipelineId: string) => void;
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
  tags: orgTags = [],
  assignees = [],
  canCreateKanban,
  canEditStages,
  pipelineId: controlledPipelineId,
  onPipelineChange,
}: KanbanBoardProps) {
  // PR-CRMOPS: defaults derivados de `canManagePipelines` pra preservar
  // compat com call-sites que ainda nao foram atualizados (admin etc).
  const effectiveCanCreateKanban = canCreateKanban ?? canManagePipelines;
  const effectiveCanEditStages = canEditStages ?? canManagePipelines;
  const actions = useKanbanActions();
  // PR-CRMOPS2: modo controlled (CrmShell passa pipelineId). Senao, usa
  // state interno (compat com admin que nao tem biblioteca).
  const [internalPipeline, setInternalPipeline] = React.useState(
    controlledPipelineId ?? (pipelines[0]?.id || ""),
  );
  const isControlled = controlledPipelineId !== undefined;
  const selectedPipeline = isControlled ? controlledPipelineId : internalPipeline;
  const setSelectedPipeline = (next: string) => {
    if (isControlled) {
      // PR-PIPETOOLS: em modo controlled, o caller (CrmShell) controla.
      // Dispara onPipelineChange pro pai sincronizar com URL e re-fetchar.
      onPipelineChange?.(next);
    } else {
      setInternalPipeline(next);
    }
  };
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  // PR-CRMOPS: dialog "Criar novo Kanban" + drawer "Editar estrutura"
  // ambos abertos inline via toolbar. O usuario nao sai do CRM pra
  // mexer em nenhum dos dois.
  const [createKanbanOpen, setCreateKanbanOpen] = React.useState(false);
  const [editStructureOpen, setEditStructureOpen] = React.useState(false);

  // PR-CRMOPS2: dialog do "+" da coluna. Controlado pelo board pra ter
  // 1 unico dialog renderizado (em vez de 1 por stage). Quando setado,
  // abre o CreateLeadFromKanbanDialog com a stage correspondente.
  const [addLeadStage, setAddLeadStage] = React.useState<
    { id: string; name: string } | null
  >(null);

  // PR-PIPETOOLS: drawer "Configurar funis" — gestao consolidada
  // (lista funis + criar + editar etapas + excluir). Acessivel via
  // dropdown "Funil atual" na toolbar OU botao "Configurar funil"
  // nas acoes rapidas.
  const [manageFunisOpen, setManageFunisOpen] = React.useState(false);
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

  // ---- Filtros avancados (PR-K2) ----
  const [advancedFilters, setAdvancedFilters] =
    React.useState<AdvancedFilters>(EMPTY_FILTERS);

  // ---- Bulk selection (PR-K2) ----
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [bulkPending, setBulkPending] = React.useState(false);
  const [bulkConfirm, setBulkConfirm] = React.useState<
    | { kind: "delete" }
    | { kind: "won" }
    | null
  >(null);
  const [bulkMoveOpen, setBulkMoveOpen] = React.useState(false);
  const [bulkTagOpen, setBulkTagOpen] = React.useState(false);

  // ---- MarkAsLost (PR-K3) ----
  type LossTarget =
    | { mode: "single"; dealId: string; dealTitle: string | null }
    | { mode: "bulk"; dealIds: string[] };
  const [lossTarget, setLossTarget] = React.useState<LossTarget | null>(null);
  const [lossReasons, setLossReasons] = React.useState<DealLossReason[]>([]);
  const [lossPending, setLossPending] = React.useState(false);
  const lossReasonsLoaded = React.useRef(false);

  const loadLossReasons = React.useCallback(async () => {
    if (lossReasonsLoaded.current || !actions.getLossReasons) return;
    try {
      const r = await actions.getLossReasons();
      setLossReasons(r);
      lossReasonsLoaded.current = true;
    } catch {
      setLossReasons([]);
    }
  }, [actions]);

  const toggleSelected = React.useCallback((dealId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }, []);

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set());
  }, []);

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

    // ---- Filtros avancados (PR-K2) ----
    const af = advancedFilters;
    if (af.tagIds.length > 0) {
      filtered = filtered.filter((d) => {
        const dealTagIds = (d.leads?.lead_tags ?? [])
          .map((lt: LeadTag) => lt.tags?.id)
          .filter((id): id is string => Boolean(id));
        if (af.tagLogic === "all") {
          return af.tagIds.every((id) => dealTagIds.includes(id));
        }
        if (af.tagLogic === "not") {
          return !af.tagIds.some((id) => dealTagIds.includes(id));
        }
        // 'any'
        return af.tagIds.some((id) => dealTagIds.includes(id));
      });
    }
    if (af.valueMin !== null) {
      filtered = filtered.filter((d) => (d.value ?? 0) >= af.valueMin!);
    }
    if (af.valueMax !== null) {
      filtered = filtered.filter((d) => (d.value ?? 0) <= af.valueMax!);
    }
    if (af.staleDays !== null) {
      const cutoff = Date.now() - af.staleDays * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((d) => {
        const ts = d.updated_at ? new Date(d.updated_at).getTime() : null;
        // Sem updated_at -> trata como velho (conservador)
        if (ts === null) return true;
        return ts < cutoff;
      });
    }
    if (af.assigneeId !== null) {
      filtered = filtered.filter(
        (d) => d.leads?.assigned_to === af.assigneeId,
      );
    }

    return filtered;
  }, [
    localDeals,
    searchQuery,
    selectedPipeline,
    statusFilter,
    advancedFilters,
  ]);

  // ---- Export columns (PR-K3) — derivada de filteredDeals + stages ----
  const stageNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of initialStages) m.set(s.id, s.name);
    return m;
  }, [initialStages]);
  const pipelineNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pipelines) m.set(p.id, p.name);
    return m;
  }, [pipelines]);

  const dealExportColumns = React.useMemo<ExportColumn<Deal>[]>(
    () => [
      { header: "Negocio", accessor: (d) => d.title },
      { header: "Lead", accessor: (d) => d.leads?.name ?? "" },
      { header: "Telefone", accessor: (d) => d.leads?.phone ?? "" },
      { header: "Email", accessor: (d) => d.leads?.email ?? "" },
      { header: "Valor (R$)", accessor: (d) => Number(d.value ?? 0) },
      {
        header: "Status",
        accessor: (d) =>
          d.status === "won"
            ? "Ganho"
            : d.status === "lost"
              ? "Perdido"
              : "Em andamento",
      },
      {
        header: "Funil",
        accessor: (d) => pipelineNameById.get(d.pipeline_id) ?? "",
      },
      {
        header: "Etapa",
        accessor: (d) => stageNameById.get(d.stage_id) ?? "",
      },
      {
        header: "Responsavel",
        accessor: (d) => d.leads?.assignee?.full_name ?? "",
      },
      {
        header: "Tags",
        accessor: (d) =>
          (d.leads?.lead_tags ?? [])
            .map((lt: LeadTag) => lt.tags?.name ?? "")
            .filter(Boolean)
            .join(", "),
      },
      {
        header: "Motivo da perda",
        accessor: (d) => d.loss_reason ?? "",
      },
      {
        header: "Concorrente",
        accessor: (d) => d.competitor ?? "",
      },
      {
        header: "Atualizado em",
        accessor: (d) => (d.updated_at ? new Date(d.updated_at) : ""),
      },
    ],
    [pipelineNameById, stageNameById],
  );

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

  // PR-AUD4: useCallback (deps vazias). Estavel entre renders -> permite
  // que DealCard (React.memo) nao re-renderize por causa dessa prop.
  const handleDragStart = React.useCallback(
    (e: React.DragEvent, dealId: string) => {
      setDraggedDealId(dealId);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  function handleDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStageId(stageId);
  }

  function handleDragLeave() {
    setDragOverStageId(null);
  }

  // PR-AUD5: dedup de drag-drop. Sem isso, se o usuario arrasta o
  // MESMO card 2x rapidamente (drag pra A, depois pra B antes da
  // request da A terminar), 2 requests racem no server e o estado
  // final da `deals.stage_id` depende de qual chega ultimo. UI fica
  // potencialmente desincronizada com servidor.
  // Solucao: enquanto ha move em flight pro mesmo dealId, ignora
  // tentativas subsequentes. Conservador (perde 1 drag se acontecer)
  // mas nunca causa estado inconsistente.
  const pendingMovesRef = React.useRef<Set<string>>(new Set());

  function handleDrop(stageId: string) {
    setDragOverStageId(null);
    if (!draggedDealId) return;

    const dealId = draggedDealId;
    const deal = localDeals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === stageId) {
      setDraggedDealId(null);
      return;
    }

    // PR-AUD5: ja tem outra move em flight pro mesmo deal? Pula sem
    // aplicar optimistic. UI fica como esta + usuario pode retentar.
    if (pendingMovesRef.current.has(dealId)) {
      setDraggedDealId(null);
      toast.info("Aguarde a movimentacao anterior terminar.");
      return;
    }

    const previousStageId = deal.stage_id;
    pendingMovesRef.current.add(dealId);

    setLocalDeals((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stage_id: stageId } : d,
      ),
    );
    setDraggedDealId(null);

    startTransition(async () => {
      try {
        await actions.moveDealStage(dealId, stageId);
        onChange?.();
      } catch {
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === dealId ? { ...d, stage_id: previousStageId } : d,
          ),
        );
      } finally {
        pendingMovesRef.current.delete(dealId);
      }
    });
  }

  function handleMoveToTerminal(
    dealId: string,
    outcome: "falha" | "bem_sucedido",
  ) {
    // PR-K3: ao marcar como perdido, abre MarkAsLostDialog (captura
    // motivo + concorrente + nota). Fallback no comportamento antigo
    // (move sem capturar) se a action nao estiver disponivel — mantem
    // compat retroativa pra clients antigos.
    if (outcome === "falha" && actions.markDealAsLost) {
      const deal = localDeals.find((d) => d.id === dealId);
      void loadLossReasons();
      setLossTarget({
        mode: "single",
        dealId,
        dealTitle: deal?.title ?? deal?.leads?.name ?? null,
      });
      return;
    }

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

  /**
   * Submit do MarkAsLostDialog — single ou bulk dependendo do mode.
   * Setado no lossTarget.
   */
  async function submitLoss(input: MarkAsLostInput) {
    if (!lossTarget) return;
    setLossPending(true);
    try {
      if (lossTarget.mode === "single") {
        if (!actions.markDealAsLost) {
          throw new Error("Acao indisponivel");
        }
        await actions.markDealAsLost(lossTarget.dealId, input);
        setLocalDeals((prev) =>
          prev.map((d) =>
            d.id === lossTarget.dealId
              ? {
                  ...d,
                  status: "lost",
                  loss_reason: input.loss_reason,
                  competitor: input.competitor ?? null,
                  loss_note: input.loss_note ?? null,
                }
              : d,
          ),
        );
        toast.success("Negocio marcado como perdido");
      } else {
        if (!actions.bulkMarkDealsAsLost) {
          throw new Error("Acao em massa indisponivel");
        }
        const res = await actions.bulkMarkDealsAsLost(
          lossTarget.dealIds,
          input,
        );
        setLocalDeals((prev) =>
          prev.map((d) =>
            lossTarget.dealIds.includes(d.id)
              ? {
                  ...d,
                  status: "lost",
                  loss_reason: input.loss_reason,
                  competitor: input.competitor ?? null,
                  loss_note: input.loss_note ?? null,
                }
              : d,
          ),
        );
        clearSelection();
        toast.success(
          `${res.updated_count} negocio${res.updated_count === 1 ? "" : "s"} marcado${res.updated_count === 1 ? "" : "s"} como perdido${res.updated_count === 1 ? "" : "s"}`,
        );
      }
      setLossTarget(null);
      onChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao marcar perda");
    } finally {
      setLossPending(false);
    }
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

  // PR-AUD4: useCallback (deps vazias).
  const handleDealUpdated = React.useCallback(
    (dealId: string, updates: Partial<Deal>) => {
      setLocalDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, ...updates } : d)),
      );
    },
    [],
  );

  // ---- Bulk handlers (PR-K2) ----
  // Cap conservador (200) ja eh enforced no shared mutation, mas
  // duplicamos aqui pra feedback imediato sem ida ao server.
  const BULK_CAP = 200;
  const selectedCount = selectedIds.size;

  /**
   * PR-AUDX: runBulk agora aceita um optimistic update OPCIONAL com
   * revert. Antes os handlers aplicavam setLocalDeals depois do
   * `runBulk(...)`, mesmo se falhasse — UI ficava inconsistente
   * (cards na coluna errada ate o re-fetch do pai). Agora:
   *   1. snapshot do estado anterior
   *   2. optimisticUpdate aplicado ANTES do op()
   *   3. se op() throw, restaura snapshot
   */
  async function runBulk<T>(
    op: () => Promise<T>,
    successMsg: (res: T) => string,
    optimisticUpdate?: (prev: Deal[]) => Deal[],
  ) {
    if (selectedCount === 0) return;
    if (selectedCount > BULK_CAP) {
      toast.error(`Maximo ${BULK_CAP} negocios por operacao em massa.`);
      return;
    }
    let snapshot: Deal[] | null = null;
    if (optimisticUpdate) {
      // Captura estado anterior pra eventual revert. Usamos o callback
      // pattern do setState pra ler o valor mais recente sem race.
      setLocalDeals((prev) => {
        snapshot = prev;
        return optimisticUpdate(prev);
      });
    }
    setBulkPending(true);
    try {
      const res = await op();
      toast.success(successMsg(res));
      clearSelection();
      onChange?.();
    } catch (err) {
      // Reverte UI antes de avisar o usuario.
      if (snapshot !== null) setLocalDeals(snapshot);
      toast.error(err instanceof Error ? err.message : "Falha na operacao");
    } finally {
      setBulkPending(false);
    }
  }

  async function handleBulkMove(stageId: string) {
    if (!actions.bulkMoveDeals) {
      toast.error("Mover em massa indisponivel.");
      return;
    }
    const ids = Array.from(selectedIds);
    setBulkMoveOpen(false);
    await runBulk(
      () => actions.bulkMoveDeals!(ids, stageId),
      (r) =>
        `${r.moved_count} negocio${r.moved_count === 1 ? "" : "s"} movido${r.moved_count === 1 ? "" : "s"}`,
      (prev) =>
        prev.map((d) =>
          selectedIds.has(d.id) ? { ...d, stage_id: stageId } : d,
        ),
    );
  }

  async function handleBulkSetStatus(status: "won" | "lost") {
    if (!actions.bulkSetDealStatus) {
      toast.error("Operacao em massa indisponivel.");
      return;
    }
    const ids = Array.from(selectedIds);
    await runBulk(
      () => actions.bulkSetDealStatus!(ids, status),
      (r) =>
        `${r.updated_count} negocio${r.updated_count === 1 ? "" : "s"} marcado${r.updated_count === 1 ? "" : "s"} como ${status === "won" ? "ganho" : "perdido"}`,
      (prev) =>
        prev.map((d) =>
          selectedIds.has(d.id) ? { ...d, status } : d,
        ),
    );
  }

  async function handleBulkDelete() {
    if (!actions.bulkDeleteDeals) {
      toast.error("Exclusao em massa indisponivel.");
      return;
    }
    const ids = Array.from(selectedIds);
    await runBulk(
      () => actions.bulkDeleteDeals!(ids),
      (r) =>
        `${r.deleted_count} negocio${r.deleted_count === 1 ? "" : "s"} excluido${r.deleted_count === 1 ? "" : "s"}`,
      (prev) => prev.filter((d) => !selectedIds.has(d.id)),
    );
  }

  async function handleBulkApplyTags(tagIds: string[]) {
    if (!actions.bulkApplyTagsToDeals) {
      toast.error("Aplicacao em massa indisponivel.");
      return;
    }
    if (tagIds.length === 0) {
      toast.info("Selecione pelo menos uma tag.");
      return;
    }
    const ids = Array.from(selectedIds);
    setBulkTagOpen(false);
    // Tags aplicadas no LEAD, nao no Deal — nao ha optimistic update visivel
    // no Kanban (cards nao mudam). onChange cuida do refresh.
    await runBulk(
      () => actions.bulkApplyTagsToDeals!(ids, tagIds),
      (r) => `${r.leads_count} lead${r.leads_count === 1 ? "" : "s"} marcado${r.leads_count === 1 ? "" : "s"} com ${tagIds.length} tag${tagIds.length === 1 ? "" : "s"}`,
    );
  }

  // PR-J: outcome pills sao reusados em toolbar (Linha 1, direita)
  const outcomePillsEl = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {OUTCOME_BUCKETS.map((bucket) => {
        const isActive = activeOutcome === bucket.outcome;
        const stageCount = stagesByOutcome[bucket.outcome].length;
        return (
          <button
            key={bucket.outcome}
            type="button"
            onClick={() => setActiveOutcome(bucket.outcome)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive ? bucket.activeClass : bucket.inactiveClass
            }`}
            aria-pressed={isActive}
          >
            <span>{bucket.label}</span>
            {stageCount > 0 && (
              <span
                className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${
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
  );

  return (
    <div className="space-y-3">
      {/* ====== TOPBAR — PR-J reorganizada em 2 LINHAS ======
          Briefing user (screenshot):
          - Linha 1: Funil atual (destacado) | Busca | Filtros | Outcomes
          - Linha 2: Stats compactos + Metas + Configurar funil

          REMOVIDO desta toolbar (vs versao anterior):
          - OUTCOME PILLS centralizadas no topo (movidos pra Linha 1)
          - Status Select (Todos/Em andamento/Ganho/Perdido) — redundante
            com outcome pills
          - ExportMenu — fica so na tab Leads (briefing user)
          - toolbarExtras Importar — removido em crm-client.tsx
            (briefing user: "deixar essa opcao somente em leads") */}

      {/* ===== Linha 1: Funil atual destacado + busca + filtros + outcomes ===== */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Dropdown "Funil atual" rico (em modo controlled).
            Em modo uncontrolled (admin antigo), cai no select tradicional. */}
        {isControlled ? (
          <FunilCurrentDropdown
            currentName={pipelines.find((p) => p.id === selectedPipeline)?.name ?? ""}
            pipelines={pipelines}
            stages={initialStages}
            selectedId={selectedPipeline}
            onSelect={(id) => setSelectedPipeline(id)}
            canCreate={effectiveCanCreateKanban}
            canManage={effectiveCanEditStages}
            onCreate={() => setCreateKanbanOpen(true)}
            onManage={() => setManageFunisOpen(true)}
          />
        ) : (
          pipelines.length > 1 && (
            // PR-HOTFIX-CRMOPS5: defesa contra Base UI error #31
            // (Select.Root recebe value sem SelectItem matching).
            // 1. `validPipelines` filtra ids vazios — protege contra
            //    pipeline "fantasma" vindo do banco
            // 2. `value || undefined` — se selectedPipeline for "",
            //    Base UI trata como uncontrolled (sem matching error)
            // 3. `onValueChange` ignora null/empty (mantem ultimo valor)
            <Select
              value={selectedPipeline || undefined}
              onValueChange={(v) => {
                if (v) setSelectedPipeline(v);
              }}
            >
              <SelectTrigger className="w-56 h-9 rounded-md">
                <SelectValue placeholder="Selecione o funil">
                  {pipelines.find((p) => p.id === selectedPipeline)?.name ??
                    "Selecione o funil"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pipelines
                  .filter((p) => Boolean(p.id))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )
        )}

        {/* Busca — flex-1 pra ocupar resto do espaço */}
        <div className="relative flex-1 min-w-[200px] max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar lead..."
            className="h-9 pl-9 rounded-md"
          />
        </div>

        {/* PR-CRMOPS4: Filtros avançados ao lado da busca (era na linha
            3 junto de Metas/Export/Import). Filtros sao "zoom no que ja
            existe", agem junto com a busca — agrupar aqui faz mais
            sentido mental. */}
        <AdvancedFiltersPopover
          value={advancedFilters}
          onChange={setAdvancedFilters}
          tags={orgTags}
          assignees={assignees}
        />

        {/* PR-J: outcomes pills na DIREITA da Linha 1 (briefing user
            screenshot). Antes ficavam centralizados no topo isolado. */}
        <div className="ml-auto">{outcomePillsEl}</div>
      </div>

      {/* ===== Linha 2: Stats compactos + Metas + Configurar funil =====
          PR-J: stats antes ficavam na Linha 2 com Status Select. Status
          Select removido (redundante com outcomes pills da Linha 1).
          Metas + Configurar funil colados aqui (briefing user: "alinhar
          ao lado de filtros" — mas Filtros ja na Linha 1 com busca, entao
          fica na Linha 2 que e a linha de "acoes" e stats). */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Stats compactos */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <MetricChip icon={<Target className="size-3.5" />}>
            <strong className="font-semibold">{boardMetrics.count}</strong>{" "}
            <span className="text-muted-foreground">leads</span>
          </MetricChip>
          {boardMetrics.total > 0 && (
            <MetricChip icon={<CircleDollarSign className="size-3.5" />}>
              <strong className="font-semibold">
                R$ {formatCurrency(boardMetrics.total)}
              </strong>
            </MetricChip>
          )}
          <MetricChip icon={<TrendingUp className="size-3.5" />}>
            <strong className="font-semibold text-emerald-600 dark:text-emerald-400">
              {boardMetrics.won}
            </strong>{" "}
            <span className="text-muted-foreground">ganhos</span>
          </MetricChip>
          <MetricChip icon={<Percent className="size-3.5" />}>
            <strong className="font-semibold">
              {boardMetrics.conversionRate.toFixed(1)}%
            </strong>{" "}
            <span className="text-muted-foreground">conv.</span>
          </MetricChip>
        </div>

        {/* PR-J: Acoes (Metas + Configurar funil) na MESMA linha dos
            stats, alinhadas a direita. Importar/Exportar removidos. */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
          <Button
            type="button"
            variant={showGoalsEditor ? "secondary" : "ghost"}
            size="sm"
            className="h-7 rounded-md px-2.5 gap-1.5"
            onClick={() => setShowGoalsEditor((prev) => !prev)}
            title="Metas do funil"
          >
            <Flag className="size-3.5" />
            <span className="hidden md:inline">Metas</span>
          </Button>

          {/* toolbarExtras (Importar) removido — briefing user: "tirar
              importar e exportar, deixar essa opcao somente em leads".
              ExportMenu removido tambem (mesma razao).
              CRM client (apps/crm) parou de injetar toolbarExtras no PR-J. */}
          {toolbarExtras}

          {(effectiveCanCreateKanban || effectiveCanEditStages) && (
            <>
              <span className="h-5 w-px bg-border" aria-hidden />
              {!isControlled && effectiveCanCreateKanban && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8 rounded-md px-2.5 gap-1.5"
                  onClick={() => setCreateKanbanOpen(true)}
                  title="Criar novo funil"
                >
                  <Plus className="size-3.5" aria-hidden />
                  <span>Criar novo funil</span>
                </Button>
              )}
              {effectiveCanEditStages && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-md px-2.5 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (isControlled) {
                      setManageFunisOpen(true);
                    } else {
                      setEditStructureOpen(true);
                    }
                  }}
                  title="Configurar funil (etapas, cores, regras)"
                >
                  <Settings2 className="size-3.5" aria-hidden />
                  <span>Configurar funil</span>
                </Button>
              )}
            </>
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

      {/* ====== BULK TOOLBAR (PR-K2) — aparece quando ha selecao ====== */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="rounded-full bg-primary text-primary-foreground"
            >
              {selectedCount}
            </Badge>
            <span className="font-medium">
              {selectedCount === 1
                ? "negocio selecionado"
                : "negocios selecionados"}
            </span>
            {selectedCount > BULK_CAP && (
              <span className="text-xs text-destructive">
                (max {BULK_CAP} por operacao)
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-md"
              disabled={bulkPending || sortedStages.length === 0}
              onClick={() => setBulkMoveOpen(true)}
              title="Mover selecionados pra outra etapa"
            >
              <Move className="size-3.5" />
              Mover etapa
            </Button>
            {orgTags.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-md"
                disabled={bulkPending}
                onClick={() => setBulkTagOpen(true)}
                title="Aplicar tags nos leads dos selecionados"
              >
                <TagIcon className="size-3.5" />
                Aplicar tag
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-md text-emerald-600 hover:text-emerald-700"
              disabled={bulkPending}
              onClick={() => setBulkConfirm({ kind: "won" })}
            >
              <Check className="size-3.5" />
              Marcar ganho
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-md text-destructive hover:text-destructive"
              disabled={bulkPending}
              onClick={() => {
                if (actions.bulkMarkDealsAsLost) {
                  // PR-K3: abre MarkAsLostDialog pra capturar motivo
                  void loadLossReasons();
                  setLossTarget({
                    mode: "bulk",
                    dealIds: Array.from(selectedIds),
                  });
                } else {
                  // Fallback: comportamento antigo (sem motivo)
                  void handleBulkSetStatus("lost");
                }
              }}
            >
              <X className="size-3.5" />
              Marcar perdido
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-md text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={bulkPending}
                onClick={() => setBulkConfirm({ kind: "delete" })}
                title="Excluir negocios selecionados"
              >
                <Trash2 className="size-3.5" />
                Excluir
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-md"
              onClick={clearSelection}
              disabled={bulkPending}
            >
              Cancelar selecao
            </Button>
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
              className="flex-shrink-0 w-[320px]"
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(stage.id)}
            >
              <div
                className={`rounded-2xl ${columnBgClass} transition-all duration-200 min-h-[420px] flex flex-col border border-transparent ${
                  isOver
                    ? "ring-2 ring-primary/40 border-primary/30 bg-primary/5 -translate-y-0.5 shadow-md"
                    : ""
                }`}
              >
                {/* PR-J: Header da coluna agora usa cor do stage como
                    background (briefing user — screenshot com headers
                    coloridos NOVO LEAD/COLETA/COTACAO/DOCUMENTACAO).
                    Texto adapta automaticamente ao contraste via
                    contrastTextColor() helper. Mantem nome stage uppercase
                    pra match com o screenshot. */}
                {(() => {
                  const headerBg = stage.color || "#3b82f6";
                  const headerText = contrastTextColor(headerBg);
                  const subtleText =
                    headerText === "#ffffff"
                      ? "rgba(255,255,255,0.75)"
                      : "rgba(0,0,0,0.65)";
                  return (
                    <div
                      className="px-4 py-3 rounded-t-2xl"
                      style={{ backgroundColor: headerBg, color: headerText }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <h3
                            className="truncate font-bold text-sm uppercase tracking-wide"
                            style={{ color: headerText }}
                          >
                            {stage.name}
                          </h3>
                        </div>
                    {canEdit && (
                      // PR-CRMOPS2: o "+" agora abre o form de Lead
                      // (briefing C). Se actions.createLeadWithDeal nao
                      // estiver setado (admin antigo), cai no fluxo
                      // antigo de "Novo negocio".
                      actions.createLeadWithDeal ? (
                        <button
                          type="button"
                          aria-label={`Adicionar lead em ${stage.name}`}
                          onClick={() => {
                            setAddLeadStage({ id: stage.id, name: stage.name });
                          }}
                          className="inline-flex items-center justify-center size-7 rounded-md transition-colors hover:bg-black/10"
                          style={{ color: "currentColor" }}
                        >
                          <Plus className="size-4" />
                        </button>
                      ) : (
                        <AddDealDialog
                          pipelineId={selectedPipeline}
                          stageId={stage.id}
                          leads={leads}
                          onCreated={handleDealCreated}
                          buttonColor="currentColor"
                        />
                      )
                    )}
                  </div>
                      {/* PR-I/J: subtitle "Leads: X" + R$ na MESMA linha.
                          Cores adaptam ao header (texto branco/dark). */}
                      <div
                        className="mt-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums"
                        title={
                          index > 0
                            ? `Ticket médio R$ ${formatCurrency(metrics.average)} · Conv ${stageConversion.toFixed(1)}%`
                            : `Ticket médio R$ ${formatCurrency(metrics.average)}`
                        }
                      >
                        <span
                          className="font-medium"
                          style={{ color: subtleText }}
                        >
                          Leads:{" "}
                          <strong
                            className="tabular-nums"
                            style={{ color: headerText }}
                          >
                            {metrics.count}
                          </strong>
                        </span>
                        {metrics.total > 0 && (
                          <span
                            className="font-semibold tabular-nums"
                            style={{ color: headerText }}
                          >
                            R$ {formatCurrency(metrics.total)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="px-2.5 py-2.5 space-y-2 flex-1 overflow-y-auto">
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
                      selected={selectedIds.has(deal.id)}
                      // PR-AUD4: passa o callback estavel direto. DealCard
                      // chama internamente com deal.id. Sem isso, lambda
                      // inline criava nova ref em todo render -> 50+ cards
                      // re-renderizavam mesmo se nada mudasse.
                      onToggleSelected={
                        canEdit && actions.bulkMoveDeals
                          ? toggleSelected
                          : undefined
                      }
                      hasActiveSelection={selectedCount > 0}
                      // PR-C: card connections — tags + responsaveis +
                      // refresh callback. Esses 3 sao opcionais (admin
                      // pode passar [] e o card degrada graciosamente).
                      orgTags={orgTags}
                      assignees={assignees}
                      onChange={onChange}
                    />
                  ))}
                  {/* Empty state — discreto + clicavel pra adicionar deal */}
                  {stageDeals.length === 0 && (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        canEdit &&
                        document
                          .getElementById(`add-deal-${stage.id}`)
                          ?.click()
                      }
                      className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 bg-card/40 px-4 py-10 text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:cursor-default disabled:opacity-60 disabled:hover:border-border/50 disabled:hover:bg-card/40 disabled:hover:text-muted-foreground"
                    >
                      <span className="inline-flex size-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                        <Plus className="size-4" />
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider">
                        Etapa vazia
                      </span>
                      {canEdit && (
                        <span className="text-[10px] text-muted-foreground/70 normal-case tracking-normal">
                          clique para adicionar
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ====== MARK AS LOST DIALOG (PR-K3) ====== */}
      <MarkAsLostDialog
        open={lossTarget !== null}
        onOpenChange={(o) => !o && setLossTarget(null)}
        count={
          lossTarget?.mode === "single"
            ? 1
            : (lossTarget?.dealIds.length ?? 0)
        }
        reasons={lossReasons}
        onLoadReasons={loadLossReasons}
        onConfirm={submitLoss}
        pending={lossPending}
        dealTitle={
          lossTarget?.mode === "single" ? lossTarget.dealTitle : undefined
        }
      />

      {/* ====== BULK DIALOGS (PR-K2) ====== */}
      <BulkMoveDialog
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        stages={sortedStages.length > 0 ? sortedStages : initialStages.filter((s) => s.pipeline_id === selectedPipeline)}
        selectedCount={selectedCount}
        onConfirm={handleBulkMove}
        pending={bulkPending}
      />
      <BulkApplyTagsDialog
        open={bulkTagOpen}
        onOpenChange={setBulkTagOpen}
        tags={orgTags}
        selectedCount={selectedCount}
        onConfirm={handleBulkApplyTags}
        pending={bulkPending}
      />
      <AlertDialog
        open={bulkConfirm !== null}
        onOpenChange={(o) => !o && setBulkConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm?.kind === "delete"
                ? `Excluir ${selectedCount} negocio${selectedCount === 1 ? "" : "s"}?`
                : `Marcar ${selectedCount} como ganho?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm?.kind === "delete"
                ? "Os negocios selecionados serao removidos permanentemente. Esta acao nao pode ser desfeita."
                : "Voce pode reverter individualmente depois, mas a acao em massa nao tem 'desfazer'."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const k = bulkConfirm?.kind;
                setBulkConfirm(null);
                if (k === "delete") await handleBulkDelete();
                else if (k === "won") await handleBulkSetStatus("won");
              }}
              className={
                bulkConfirm?.kind === "delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PR-CRMOPS: dialog "Criar novo Kanban" + drawer "Editar estrutura".
          Ambos abrem dentro do contexto do CRM (sem navegar). O drawer
          edita SO o pipeline ativo (selectedPipeline) — pra trocar de
          Kanban, usuario usa o select da toolbar (decisao do briefing
          PR-CRMOPS). */}
      {effectiveCanCreateKanban && (
        <CreateKanbanDialog
          open={createKanbanOpen}
          onOpenChange={setCreateKanbanOpen}
          onCreated={(newPipelineId) => {
            setSelectedPipeline(newPipelineId);
            onChange?.();
          }}
        />
      )}
      {/* PR-CRMOPS2: dialog do "+" das colunas. So renderiza quando ha
          uma stage selecionada (controlado por estado do board). */}
      {canEdit && actions.createLeadWithDeal && addLeadStage && (
        <CreateLeadFromKanbanDialog
          open={true}
          onOpenChange={(open) => !open && setAddLeadStage(null)}
          pipelineId={selectedPipeline}
          stageId={addLeadStage.id}
          stageName={addLeadStage.name}
          onCreated={() => {
            // Pai re-fetcha; card aparece com embed `leads` completo.
            onChange?.();
          }}
        />
      )}
      {/* PR-PIPETOOLS: drawer "Configurar funis" — gestao consolidada
          (lista + criar + editar + excluir). Acessivel via botao
          "Configurar funil" na toolbar OU via dropdown "Funil atual"
          → "Configurar funis...". So renderiza em modo controlled. */}
      {isControlled && effectiveCanEditStages && (
        <ManageFunisDrawer
          open={manageFunisOpen}
          onOpenChange={setManageFunisOpen}
          pipelines={pipelines}
          stages={initialStages}
          onSelectPipeline={(id) => setSelectedPipeline(id)}
          onChange={onChange}
        />
      )}
      {/* PR-CRMOPS2: editor de etapas do funil ativo — modo
          uncontrolled (admin antigo) abre direto. Em modo CRM
          controlled, o ManageFunisDrawer abre esse modal por baixo
          quando user clica "Editar" num funil da lista. */}
      {!isControlled && effectiveCanEditStages && selectedPipeline && (
        <EditKanbanStructureDrawer
          open={editStructureOpen}
          onOpenChange={setEditStructureOpen}
          pipelineId={selectedPipeline}
          pipelineName={
            // PR-H: fallback "Funil" em vez de "Kanban" — termo user-facing
            pipelines.find((p) => p.id === selectedPipeline)?.name ?? "Funil"
          }
          stages={initialStages.filter((s) => s.pipeline_id === selectedPipeline)}
          canDeleteKanban={pipelines.length > 1}
          onChange={onChange}
          onDeleted={() => {
            // Auto-seleciona outro funil se o atual foi excluido
            const remaining = pipelines.filter((p) => p.id !== selectedPipeline);
            setSelectedPipeline(remaining[0]?.id ?? "");
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

// ============ DEAL CARD ============
//
// PR-AUD4: wrappado em React.memo. Sem isso, qualquer re-render do
// KanbanBoard (filtro, busca, optimistic update) re-renderiza TODOS
// os cards (50-200+ na maioria dos casos). Com memo + props estaveis
// (useCallback nos handlers, toggleSelected sem lambda inline), so
// cards cuja prop mudou re-renderizam.
const DealCard = React.memo(function DealCardImpl({
  deal,
  draggedDealId,
  onDragStart,
  onDelete,
  onUpdate,
  onMoveToTerminal,
  hasFailureBucket,
  hasSuccessBucket,
  canEdit,
  selected,
  onToggleSelected,
  hasActiveSelection,
  orgTags,
  assignees,
  onChange,
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
  /** PR-K2: card selecionado pra bulk op. */
  selected: boolean;
  /**
   * PR-K2: callback de toggle. undefined = bulk indisponivel.
   * PR-AUD4: assinatura mudou pra receber dealId — permite passar
   * referencia estavel em vez de lambda inline (perf).
   */
  onToggleSelected?: (dealId: string) => void;
  /** PR-K2: ha pelo menos 1 card selecionado em qualquer lugar (mostra
   *  checkbox sempre, nao so no hover). */
  hasActiveSelection: boolean;
  /**
   * PR-C: tags da org pra Popover "+ Tag" no card. Vazio = oculta o
   * botao (tags nao configuradas).
   */
  orgTags: TagRef[];
  /**
   * PR-C: lista de membros da org pra dropdown "Atribuir" no pill
   * responsavel. Vazio = pill fica readonly (legacy).
   */
  assignees: { id: string; name: string }[];
  /** PR-C: callback pro pai re-fetchar apos add tag/atribuir. */
  onChange?: () => void;
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

  // Quando ha selecao ativa (em qualquer card), o click no card faz
  // toggle ao inves de abrir detalhe. Isso evita acidentes "abri dialog
  // achando que ia selecionar".
  // PR-K4: ignora click se estamos editando inline (input dentro do card)
  const handleCardClick = (e: React.MouseEvent) => {
    if (editingField !== null) {
      e.stopPropagation();
      return;
    }
    if (onToggleSelected && hasActiveSelection) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelected(deal.id);
      return;
    }
    setDetailOpen(true);
  };

  // ---- Inline edit (PR-K4) ----
  // Duplo-click no titulo ou no valor abre input com autoFocus.
  // Enter = salva. Escape = cancela. Blur = salva (a menos que cancelado).
  const actionsRef = useKanbanActions();
  type EditableField = "title" | "value";
  const [editingField, setEditingField] = React.useState<EditableField | null>(
    null,
  );
  const [editPending, setEditPending] = React.useState(false);

  const saveEdit = async (field: EditableField, raw: string) => {
    setEditPending(true);
    try {
      if (field === "title") {
        const trimmed = raw.trim();
        if (!trimmed || trimmed === deal.title) {
          setEditingField(null);
          return;
        }
        await actionsRef.updateDeal(deal.id, { title: trimmed });
        onUpdate(deal.id, { title: trimmed });
      } else {
        const parsed = Number(raw.replace(",", "."));
        if (!Number.isFinite(parsed) || parsed < 0) {
          toast.error("Valor invalido");
          return;
        }
        if (parsed === deal.value) {
          setEditingField(null);
          return;
        }
        await actionsRef.updateDeal(deal.id, { value: parsed });
        onUpdate(deal.id, { value: parsed });
      }
      setEditingField(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setEditPending(false);
    }
  };

  // PR-K6: subtitulo do card — usa email se nao tiver outro contexto.
  // Studio coloca empresa em uppercase pequena; sem campo "company"
  // no schema, usamos email (ou telefone formatado) como fallback.
  const subtitle =
    lead?.email || (phone ? `Tel: ${phone}` : null);

  // Avatar inicial colorido — hash do nome -> 1 de 8 paletas saturadas
  // (espelha o "avatar colorido" do studio).
  const avatarColor = React.useMemo(() => {
    const palette = [
      "bg-blue-500",
      "bg-emerald-500",
      "bg-amber-500",
      "bg-rose-500",
      "bg-violet-500",
      "bg-cyan-500",
      "bg-orange-500",
      "bg-pink-500",
    ];
    const seed = (lead?.name || deal.title || "?")
      .split("")
      .reduce((a, c) => a + c.charCodeAt(0), 0);
    return palette[seed % palette.length];
  }, [lead?.name, deal.title]);

  return (
    <>
      <div
        className={`group relative bg-card border border-border/60 rounded-xl p-3.5 transition-all duration-200 ${
          canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        } ${isDragging ? "opacity-40 ring-2 ring-primary scale-[0.98]" : "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-foreground/5"} ${
          selected
            ? "border-primary ring-2 ring-primary/30 bg-primary/[0.03]"
            : "hover:border-primary/40"
        }`}
        draggable={canEdit && !hasActiveSelection}
        onDragStart={(e) =>
          canEdit && !hasActiveSelection && onDragStart(e, deal.id)
        }
        onClick={handleCardClick}
      >
        {/* Checkbox de selecao bulk — hover ou ativo. */}
        {onToggleSelected && (
          <div
            className={`absolute left-2 top-2 z-10 transition-opacity ${
              selected || hasActiveSelection
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelected(deal.id);
            }}
          >
            <Checkbox
              checked={selected}
              aria-label={selected ? "Desmarcar negocio" : "Selecionar negocio"}
              className="bg-card shadow-sm"
            />
          </div>
        )}

        {/* Linha 1: Avatar maior + Titulo (bold dark) + WhatsApp shortcut */}
        <div
          className={`flex items-start gap-2.5 ${onToggleSelected ? "pl-6" : ""}`}
        >
          {/* Avatar maior (8x8) com cor saturada — destaque visual principal */}
          {initials && (
            <span
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm ${avatarColor}`}
              aria-hidden
            >
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {editingField === "title" && canEdit ? (
              <InlineEdit
                initialValue={deal.title}
                type="text"
                ariaLabel="Editar titulo"
                pending={editPending}
                onCommit={(v) => saveEdit("title", v)}
                onCancel={() => setEditingField(null)}
                className="text-sm font-bold text-foreground"
              />
            ) : (
              <h4
                className={`truncate text-sm font-bold leading-tight text-foreground ${
                  canEdit ? "cursor-text" : ""
                }`}
                title={canEdit ? "Duplo-click para editar" : displayName}
                onDoubleClick={(e) => {
                  if (!canEdit) return;
                  e.stopPropagation();
                  setEditingField("title");
                }}
              >
                {displayName}
              </h4>
            )}
            {subtitle && (
              <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {/* PR-C: substitui o botao "Abrir WhatsApp" (wa.me externo) por
              "Abrir conversa" — find-or-create conversation interna e
              navega pro /chat. Fallback pra wa.me apenas se a action de
              conversa nao estiver injetada (compat admin) ou se o deal
              nao tem lead_id (caso degenerado). */}
          {phone && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center size-7 rounded-full bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 transition-colors"
              title={
                actionsRef.findOrCreateConversationByLead && deal.lead_id
                  ? "Abrir conversa"
                  : "Abrir WhatsApp"
              }
              onClick={async (e) => {
                e.stopPropagation();
                if (actionsRef.findOrCreateConversationByLead && deal.lead_id) {
                  try {
                    const { conversationId } =
                      await actionsRef.findOrCreateConversationByLead(
                        deal.lead_id,
                      );
                    window.location.href = `/chat?id=${conversationId}`;
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Falha ao abrir conversa",
                    );
                  }
                  return;
                }
                // Fallback (compat admin / lead sem id): wa.me externo
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

        {/* PR-C: Tags display + botao "+ Tag" inline.
            Antes era so display read-only — agora agente adiciona tag
            direto no card via Popover (Popover lista tags da org que
            ainda nao estao aplicadas). */}
        {(tags.length > 0 ||
          (canEdit &&
            deal.lead_id &&
            actionsRef.addTagToLead &&
            orgTags.length > 0)) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <ColoredTagPill key={tag.id} tag={tag} />
            ))}
            {canEdit &&
              deal.lead_id &&
              actionsRef.addTagToLead &&
              orgTags.length > 0 && (
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-border/60 bg-card px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
                        title="Adicionar tag"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Plus className="size-3" />
                        Tag
                      </button>
                    }
                  />
                  <PopoverContent
                    align="start"
                    className="w-56 p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Adicionar tag
                    </div>
                    {(() => {
                      const appliedIds = new Set(tags.map((t) => t.id));
                      const available = orgTags.filter(
                        (t) => !appliedIds.has(t.id),
                      );
                      if (available.length === 0) {
                        return (
                          <div className="px-2 py-2 text-[11px] text-muted-foreground">
                            Todas as tags já foram aplicadas.
                          </div>
                        );
                      }
                      const leadId = deal.lead_id;
                      if (!leadId) return null;
                      return available.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                          onClick={async () => {
                            if (!actionsRef.addTagToLead) return;
                            try {
                              await actionsRef.addTagToLead(leadId, tag.id);
                              toast.success(`Tag "${tag.name}" adicionada`);
                              onChange?.();
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Falha ao adicionar tag",
                              );
                            }
                          }}
                        >
                          <span
                            className="inline-block size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color || "#888" }}
                          />
                          <span className="truncate">{tag.name}</span>
                        </button>
                      ));
                    })()}
                  </PopoverContent>
                </Popover>
              )}
          </div>
        )}

        {/* PR-I: pill VALOR ESTIMADO (verde) — so renderiza quando ha
            valor cadastrado OU usuario esta editando (pra permitir
            adicionar valor depois). Quando valor=0 e nao editando, o
            espaco fica limpo. Botao "+ Adicionar valor" sutil aparece
            so no hover do card pra permitir cadastrar. */}
        {(deal.value > 0 || editingField === "value") && (
          <div className="mt-3">
            {editingField === "value" && canEdit ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
                <CircleDollarSign className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-700/70 dark:text-emerald-300/70">
                    Valor estimado
                  </div>
                  <div className="flex items-center gap-1 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                    <span>R$</span>
                    <InlineEdit
                      initialValue={String(deal.value ?? 0)}
                      type="number"
                      ariaLabel="Editar valor"
                      pending={editPending}
                      onCommit={(v) => saveEdit("value", v)}
                      onCancel={() => setEditingField(null)}
                      className="flex-1 text-emerald-800 dark:text-emerald-200"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-left transition-colors hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20"
                title={canEdit ? "Duplo-click para editar valor" : undefined}
                onDoubleClick={(e) => {
                  if (!canEdit) return;
                  e.stopPropagation();
                  setEditingField("value");
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <CircleDollarSign className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-700/70 dark:text-emerald-300/70">
                    Valor estimado
                  </div>
                  <div className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                    R$ {formatCurrency(deal.value)}
                  </div>
                </div>
              </button>
            )}
          </div>
        )}
        {/* PR-I: link sutil "+ Adicionar valor" so quando valor=0,
            visivel apenas no hover do card pra nao poluir. */}
        {deal.value === 0 && canEdit && editingField !== "value" && (
          <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              className="text-[10px] font-medium text-muted-foreground hover:text-emerald-600 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setEditingField("value");
              }}
            >
              + Adicionar valor estimado
            </button>
          </div>
        )}

        {/* PR-C: Pill RESPONSÁVEL (azul) — agora clicavel.
            Antes era read-only — agora abre DropdownMenu com lista de
            membros da org pra atribuir/desatribuir direto do card.
            Degrada graciosamente: se nao tem assignees ou actions
            de atribuir, fica read-only (admin / lead sem id). */}
        {(() => {
          const assigneeName = lead?.assignee?.full_name;
          const initials = assigneeName
            ? assigneeName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p: string) => p[0])
                .join("")
                .toUpperCase()
            : "?";
          const canAssign =
            canEdit &&
            !!deal.lead_id &&
            !!actionsRef.assignLead &&
            assignees.length > 0;
          const leadId = deal.lead_id;

          // PR-I: SEM assignee = texto cinza simples "Sem responsável"
          // (em vez de pill azul cheio com "?" — visualmente mais leve,
          // espelha briefing do design). COM assignee = pill azul cheio
          // mantido (mostra avatar + nome).
          if (!canAssign || !leadId) {
            if (!assigneeName) {
              return (
                <div className="mt-2 px-1 text-xs font-medium text-muted-foreground/70">
                  Sem responsável
                </div>
              );
            }
            return (
              <div className="mt-2 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 dark:bg-blue-500/10">
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-white"
                  aria-hidden
                >
                  {initials}
                </span>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-blue-700/70 dark:text-blue-300/70">
                    Responsável
                  </div>
                  <div className="truncate text-sm font-semibold text-blue-800 dark:text-blue-200">
                    {assigneeName}
                  </div>
                </div>
              </div>
            );
          }

          // PR-I: SEM assignee + canAssign = texto cinza clicavel
          // (abre dropdown). COM assignee = pill azul cheio (atual).
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  assigneeName ? (
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-left transition-colors hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-white"
                        aria-hidden
                      >
                        {initials}
                      </span>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-blue-700/70 dark:text-blue-300/70">
                          Responsável
                        </div>
                        <div className="truncate text-sm font-semibold text-blue-800 dark:text-blue-200">
                          {assigneeName}
                        </div>
                      </div>
                      <ChevronDown className="size-3.5 shrink-0 text-blue-700/60 dark:text-blue-300/60" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground/70 hover:text-blue-600 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Sem responsável
                      <ChevronDown className="size-3 opacity-60" />
                    </button>
                  )
                }
              />
              <DropdownMenuContent
                align="start"
                className="w-56"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuLabel>Atribuir responsável</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {assignees.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={async () => {
                      if (!actionsRef.assignLead) return;
                      try {
                        await actionsRef.assignLead(leadId, m.id);
                        toast.success(`Atribuído a ${m.name}`);
                        onChange?.();
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "Falha ao atribuir",
                        );
                      }
                    }}
                  >
                    {m.name}
                    {lead?.assigned_to === m.id && (
                      <Check className="ml-auto size-3.5" />
                    )}
                  </DropdownMenuItem>
                ))}
                {assigneeName && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        if (!actionsRef.assignLead) return;
                        try {
                          await actionsRef.assignLead(leadId, null);
                          toast.success("Responsável removido");
                          onChange?.();
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Falha ao remover",
                          );
                        }
                      }}
                      className="text-muted-foreground"
                    >
                      Sem responsável
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}

        {/* Footer: horario relativo da ultima atividade (discreto).
            Usa deal.updated_at que JA EXISTE — sem logica nova. */}
        {deal.updated_at && (
          <div className="mt-3 flex items-center gap-1 border-t border-border/40 pt-2 text-[10px] text-muted-foreground/80">
            <Clock className="size-3" />
            <span>{formatRelativeShort(deal.updated_at)}</span>
          </div>
        )}

        {/* PR-I: Botoes terminais sempre visiveis (briefing user — design
            do screenshot mostra Descartado/Fechado proeminentes).
            Mantem disabled state quando bucket nao configurado.
            Cores mais saturadas (background ao inves de border-only)
            pra ficar igual ao screenshot. */}
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            disabled={!canEdit || !hasFailureBucket}
            onClick={(e) => {
              e.stopPropagation();
              onMoveToTerminal(deal.id, "falha");
            }}
            title={
              hasFailureBucket
                ? "Marcar como perdido (registra motivo)"
                : "Sem etapa de falha configurada"
            }
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
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
                ? "Marcar como ganho"
                : "Sem etapa de sucesso configurada"
            }
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
          >
            <Check className="size-3" />
            Negócio fechado
          </button>
        </div>
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
});

// ============ FUNIL CURRENT DROPDOWN (PR-PIPETOOLS) ============
//
// Dropdown rico que substitui o botao "← Funis" + nome estatico
// antigos. Mostra o funil ativo + lista pra trocar + acoes "+ Criar
// novo funil" e "Configurar funis...".
//
// Uso: so em modo controlled (CrmShell controla pipelineId).

// PR-J: FunilCurrentDropdown enriquecido com cards de funis (briefing
// user — "ao clicar que apareca o menu parecido com configurar funil,
// para selecionar o funil"). Cada funil renderiza nome + numero de
// etapas + chips coloridos com bullet por stage. Visual destacado:
// botao trigger com bg-primary/10 + cor primary.
function FunilCurrentDropdown({
  currentName,
  pipelines,
  stages,
  selectedId,
  onSelect,
  canCreate,
  canManage,
  onCreate,
  onManage,
}: {
  currentName: string;
  pipelines: Pipeline[];
  /** Stages de TODOS os funis — usado pra renderizar chips coloridos
   *  no dropdown (sem chamada extra). */
  stages: Stage[];
  selectedId: string;
  onSelect: (id: string) => void;
  canCreate: boolean;
  canManage: boolean;
  onCreate: () => void;
  onManage: () => void;
}) {
  // Agrupa stages por pipeline_id pra render dos chips
  const stagesByPipeline = React.useMemo(() => {
    const map = new Map<string, Stage[]>();
    for (const s of stages) {
      const arr = map.get(s.pipeline_id) ?? [];
      arr.push(s);
      map.set(s.pipeline_id, arr);
    }
    // Ordena cada array por sort_order
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return map;
  }, [stages]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-md gap-2 max-w-xs border-primary/30 bg-primary/5 hover:bg-primary/10 text-foreground"
            title="Trocar de funil ou gerenciar"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary shrink-0">
              Funil atual
            </span>
            <span className="font-bold text-foreground truncate">
              {currentName || "—"}
            </span>
            <ChevronDown className="size-3.5 text-primary shrink-0" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        className="w-[360px] p-2 max-h-[480px] overflow-y-auto"
      >
        {pipelines.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Trocar de funil
            </div>
            <div className="space-y-1.5">
              {pipelines.map((p) => {
                const isActive = p.id === selectedId;
                const pipelineStages = stagesByPipeline.get(p.id) ?? [];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {p.name}
                      </span>
                      {isActive && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                          <Check className="size-3" aria-hidden />
                          Atual
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-2">
                      {pipelineStages.length} etapa
                      {pipelineStages.length === 1 ? "" : "s"}
                    </p>
                    {pipelineStages.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {pipelineStages.slice(0, 8).map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground"
                          >
                            <span
                              className="inline-block size-1.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: s.color || "#888",
                              }}
                              aria-hidden
                            />
                            {s.name}
                          </span>
                        ))}
                        {pipelineStages.length > 8 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{pipelineStages.length - 8}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {(canCreate || canManage) && (
          <>
            <div className="my-2 h-px bg-border" />
            <div className="space-y-0.5">
              {canCreate && (
                <button
                  type="button"
                  onClick={onCreate}
                  className="w-full inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Criar novo funil
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={onManage}
                  className="w-full inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Settings2 className="size-3.5" aria-hidden />
                  Configurar funis...
                </button>
              )}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============ METRIC CHIP (PR-D) ============
//
// Pill compacta de metrica do board (count negocios, total, ganhos,
// conversao). Visual sutil: bg-muted/40 + border-border + radius
// arredondado. Numero em strong, label em muted.

function MetricChip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </span>
  );
}

// ============ COLORED TAG PILL (PR-K6) ============
//
// Tag colorida saturada usando tag.color. Espelha o visual do studio
// onde "QUENTE" (vermelho), "RECORRENTE" (verde), "IMPORTANTE" (rosa)
// aparecem com fundo saturado + texto branco. Calculo de contraste
// garante legibilidade (texto branco em cor escura, texto escuro em
// cor clara).

function ColoredTagPill({ tag }: { tag: Tag }) {
  // Helper de contraste — calcula luminance pra decidir cor do texto
  const textOnColor = React.useMemo(() => {
    const c = (tag.color || "#6366f1").replace("#", "");
    if (c.length !== 6) return "#ffffff";
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#1A1A1A" : "#FFFFFF";
  }, [tag.color]);

  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm"
      style={{
        backgroundColor: tag.color || "#6366f1",
        color: textOnColor,
      }}
    >
      {tag.name}
    </span>
  );
}

// ============ INLINE EDIT (PR-K4) ============
//
// Input compacto pra edicao inline de campo no card. autoFocus +
// select all ao montar. Enter = commit. Escape = cancel. Blur =
// commit (a menos que Escape tenha sido apertado antes).

function InlineEdit({
  initialValue,
  type,
  ariaLabel,
  pending,
  onCommit,
  onCancel,
  className,
}: {
  initialValue: string;
  type: "text" | "number";
  ariaLabel: string;
  pending: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = React.useState(initialValue);
  const cancelledRef = React.useRef(false);
  // PR-AUDX: dedup de commit. Sem isso, Enter dispara onCommit e o
  // blur que vem em seguida (input perde foco) tambem dispara —
  // resultado: 2 PATCHs em sequencia, race no servidor.
  const submittedRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Auto-select texto inteiro pra facilitar substituicao
    inputRef.current?.select();
  }, []);

  const safeCommit = React.useCallback(
    (next: string) => {
      if (submittedRef.current || cancelledRef.current) return;
      submittedRef.current = true;
      onCommit(next);
    },
    [onCommit],
  );

  return (
    <input
      ref={inputRef}
      type={type}
      autoFocus
      value={value}
      disabled={pending}
      aria-label={ariaLabel}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          safeCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelledRef.current = true;
          onCancel();
        }
        // Bloqueia outros keystrokes propagarem (evita drag handlers)
        e.stopPropagation();
      }}
      onBlur={() => {
        if (cancelledRef.current) return;
        safeCommit(value);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={`w-full bg-background border border-primary/40 rounded px-1.5 py-0.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50 ${className ?? ""}`}
      step={type === "number" ? "0.01" : undefined}
      min={type === "number" ? 0 : undefined}
      inputMode={type === "number" ? "decimal" : undefined}
    />
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

  // PR-AUD5: mountedRef pra guardar setState apos unmount. Sem isso, se
  // o usuario fecha o dialog antes do updateDeal terminar, onOpenChange
  // dispara setState em componente desmontado (warning + memory leak
  // potencial). Setado false no cleanup.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    if (isPending) return; // PR-AUD5: dedup contra double-submit
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
        // PR-AUD5: so fecha se ainda montado (usuario nao fechou
        // antes da response).
        if (mountedRef.current) onOpenChange(false);
      } catch {
        if (mountedRef.current) {
          onUpdate(deal.id, { title: deal.title, value: deal.value });
        }
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
          <DialogTitle className="sr-only">Detalhes do Negócio</DialogTitle>
          <DialogHero
            icon={<CircleDollarSign className="size-5" />}
            title="Detalhes do negócio"
            tagline={lead?.name ? `Lead: ${lead.name}` : "Edite os campos abaixo"}
          />
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
              // PR-AUD5: cap defensivo. Schema do banco tem limite — sem
              // maxLength no input, usuario pode colar 5k chars e so
              // descobrir o erro depois do submit (toast generico).
              maxLength={200}
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
    if (isPending) return; // PR-AUD5: dedup contra double-submit
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
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Novo Negócio</DialogTitle>
          <DialogHero
            icon={<Plus className="size-5" />}
            title="Novo negócio"
            tagline="Preencha os detalhes abaixo"
          />
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
              maxLength={200}
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

// ============================================================================
// PR-K2 Subcomponentes: AdvancedFiltersPopover + BulkMoveDialog + BulkApplyTagsDialog
// ============================================================================

function AdvancedFiltersPopover({
  value,
  onChange,
  tags,
  assignees,
}: {
  value: AdvancedFilters;
  onChange: (next: AdvancedFilters) => void;
  tags: TagRef[];
  assignees: { id: string; name: string }[];
}) {
  const activeCount = countActiveFilters(value);
  const [valueMinStr, setValueMinStr] = React.useState(
    value.valueMin === null ? "" : String(value.valueMin),
  );
  const [valueMaxStr, setValueMaxStr] = React.useState(
    value.valueMax === null ? "" : String(value.valueMax),
  );

  // Sync local input strings se o filtro for resetado de fora
  React.useEffect(() => {
    setValueMinStr(value.valueMin === null ? "" : String(value.valueMin));
    setValueMaxStr(value.valueMax === null ? "" : String(value.valueMax));
  }, [value.valueMin, value.valueMax]);

  const toggleTag = (id: string) => {
    onChange({
      ...value,
      tagIds: value.tagIds.includes(id)
        ? value.tagIds.filter((t) => t !== id)
        : [...value.tagIds, id],
    });
  };

  const clearAll = () => {
    onChange(EMPTY_FILTERS);
    setValueMinStr("");
    setValueMaxStr("");
  };

  const applyValueRange = () => {
    const parsedMin =
      valueMinStr.trim() === "" ? null : Number(valueMinStr.replace(",", "."));
    const parsedMax =
      valueMaxStr.trim() === "" ? null : Number(valueMaxStr.replace(",", "."));
    onChange({
      ...value,
      valueMin:
        parsedMin !== null && Number.isFinite(parsedMin) ? parsedMin : null,
      valueMax:
        parsedMax !== null && Number.isFinite(parsedMax) ? parsedMax : null,
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={activeCount > 0 ? "secondary" : "ghost"}
            size="sm"
            className="h-8 rounded-md px-2.5"
          />
        }
      >
        <SlidersHorizontal className="size-3.5" />
        Filtros
        {activeCount > 0 && (
          <Badge
            variant="secondary"
            className="ml-1 h-4 min-w-4 rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          >
            {activeCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={6}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Filtros avançados</span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="max-h-[480px] space-y-4 overflow-y-auto p-3">
          {/* Tags + lógica */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tags
                </Label>
                <Select
                  value={value.tagLogic}
                  onValueChange={(v) =>
                    onChange({ ...value, tagLogic: (v as TagLogic) ?? "any" })
                  }
                >
                  <SelectTrigger className="h-7 w-[110px] text-[11px]">
                    <SelectValue>
                      {value.tagLogic === "any"
                        ? "Qualquer"
                        : value.tagLogic === "all"
                          ? "Todas"
                          : "Nenhuma"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="not">Nenhuma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const checked = value.tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted text-foreground hover:bg-muted/70"
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {value.tagLogic === "any"
                  ? "Mostra negócios com pelo menos uma das tags."
                  : value.tagLogic === "all"
                    ? "Mostra negócios com TODAS as tags marcadas."
                    : "Esconde negócios que tenham qualquer tag marcada."}
              </p>
            </div>
          )}

          {/* Faixa de valor */}
          <div className="space-y-2 border-t border-border pt-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Faixa de valor (R$)
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Mín"
                value={valueMinStr}
                onChange={(e) => setValueMinStr(e.target.value)}
                onBlur={applyValueRange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyValueRange();
                }}
                className="h-9"
              />
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Máx"
                value={valueMaxStr}
                onChange={(e) => setValueMaxStr(e.target.value)}
                onBlur={applyValueRange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyValueRange();
                }}
                className="h-9"
              />
            </div>
          </div>

          {/* Sem atividade */}
          <div className="space-y-2 border-t border-border pt-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Sem atualização há
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ ...value, staleDays: null })}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  value.staleDays === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted text-foreground hover:bg-muted/70"
                }`}
              >
                Sem filtro
              </button>
              {STALE_OPTIONS.map((opt) => {
                const active = value.staleDays === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ ...value, staleDays: opt.value })}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-border bg-muted text-foreground hover:bg-muted/70"
                    }`}
                  >
                    <Clock className="size-3" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Responsável */}
          {assignees.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Responsável
              </Label>
              <Select
                value={value.assigneeId ?? ALL_ASSIGNEES}
                onValueChange={(v) =>
                  onChange({
                    ...value,
                    assigneeId: !v || v === ALL_ASSIGNEES ? null : v,
                  })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue>
                    {value.assigneeId === null
                      ? "Todos os responsáveis"
                      : (assignees.find((a) => a.id === value.assigneeId)
                          ?.name ?? "Responsável")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ASSIGNEES}>
                    Todos os responsáveis
                  </SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BulkMoveDialog({
  open,
  onOpenChange,
  stages,
  selectedCount,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: Stage[];
  selectedCount: number;
  onConfirm: (stageId: string) => Promise<void>;
  pending: boolean;
}) {
  const [stageId, setStageId] = React.useState<string>(stages[0]?.id ?? "");

  React.useEffect(() => {
    if (open && stages.length > 0 && !stages.some((s) => s.id === stageId)) {
      setStageId(stages[0].id);
    }
  }, [open, stages, stageId]);

  const dialogTitle = `Mover ${selectedCount} negócio${selectedCount === 1 ? "" : "s"} pra outra etapa`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <DialogHero
            icon={<Move className="size-5" />}
            title={dialogTitle}
            tagline="Selecione a etapa de destino"
          />
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Etapa de destino
          </Label>
          <Select value={stageId} onValueChange={(v) => setStageId(v ?? "")}>
            <SelectTrigger className="h-10">
              <SelectValue>
                {stages.find((s) => s.id === stageId)?.name ?? "Selecione"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Os negócios precisam estar todos no mesmo funil. A ação em massa
            não dispara fluxos automatizados (use mover individual pra isso).
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => stageId && onConfirm(stageId)}
            disabled={pending || !stageId}
          >
            {pending ? "Movendo..." : "Mover"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkApplyTagsDialog({
  open,
  onOpenChange,
  tags,
  selectedCount,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: TagRef[];
  selectedCount: number;
  onConfirm: (tagIds: string[]) => Promise<void>;
  pending: boolean;
}) {
  const [picked, setPicked] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open) setPicked([]);
  }, [open]);

  const toggle = (id: string) => {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const dialogTitle = `Aplicar tags em ${selectedCount} negócio${selectedCount === 1 ? "" : "s"}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
          <DialogHero
            icon={<TagIcon className="size-5" />}
            title={dialogTitle}
            tagline="Tags aplicadas aos leads desses negócios"
          />
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Selecione as tags
          </Label>
          <div className="flex max-h-[280px] flex-wrap gap-1.5 overflow-y-auto">
            {tags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma tag cadastrada. Crie tags em /tags primeiro.
              </p>
            ) : (
              tags.map((t) => {
                const checked = picked.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted text-foreground hover:bg-muted/70"
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            As tags são aplicadas aos LEADS dos negócios selecionados (tag é
            propriedade do lead). Tags já aplicadas não duplicam.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(picked)}
            disabled={pending || picked.length === 0}
          >
            {pending ? "Aplicando..." : "Aplicar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
