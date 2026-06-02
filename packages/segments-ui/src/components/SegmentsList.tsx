"use client";

// SegmentsList — view de listagem de segmentos com builder de regras
// inline. Compartilhada entre CRM (cliente) e Admin (superadmin). Auth/
// role moram nos apps; o pacote recebe permissoes (canManage) via prop e
// actions via <SegmentsProvider>.
//
// Originalmente em apps/crm/src/components/segments/segment-list.tsx.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { EmptyState } from "@persia/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { DialogHero } from "@persia/ui/dialog-hero";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { useDialogMutation } from "@persia/ui";
import {
  ArrowLeft,
  Copy,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import type { Segment, SegmentRules } from "@persia/shared/crm";
import { validateSegmentRules } from "@persia/shared/crm";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { ConditionBuilder, type AssigneeOption, type SegmentCatalogs } from "./ConditionBuilder";
import { useSegmentsActions } from "../context";
import type { SegmentPreviewResult } from "../actions";
import { Toolbar } from "@persia/ui/toolbar";

interface RulesShape {
  operator: "AND" | "OR";
  conditions: Array<{ field: string; op: string; value: string }>;
}

const EMPTY_RULES: RulesShape = { operator: "AND", conditions: [] };

// ---------------------------------------------------------------------------
// Etapa 5: helpers de resumo legível e badge de saúde
// ---------------------------------------------------------------------------

const FIELD_SUMMARY: Record<string, string> = {
  status: "Status",
  source: "Origem",
  channel: "Canal",
  score: "Score",
  tags: "Tag",
  assigned_to: "Responsável",
  created_at: "Criação",
  last_interaction_at: "Última atividade",
  // Etapa 9.
  deal_pipeline_id: "Funil",
  deal_stage_id: "Etapa do funil",
  deal_status: "Status do negócio",
};

const OP_SUMMARY: Record<string, string> = {
  eq: "é",
  neq: "não é",
  gt: "maior que",
  gte: "≥",
  lt: "menor que",
  lte: "≤",
  contains: "contém",
  not_contains: "não contém",
  older_than_days: "há mais de",
  newer_than_days: "há menos de",
  is_null: "está vazio",
  // Aliases por campo (para is_null customizado).
  "deal_status:is_null": "não tem negócio aberto",
};

// is_null label pode variar por campo — retorna o label contextual.
function getIsNullLabel(field: string): string {
  if (field === "deal_status") return "não tem negócio aberto";
  if (field === "last_interaction_at") return "nunca interagiu";
  return "está vazio";
}

const DATE_OPS_SET = new Set(["older_than_days", "newer_than_days"]);

function summarizeCondition(
  cond: { field: string; op: string; value: string },
  catalogs?: SegmentCatalogs,
): string {
  const fieldLabel = FIELD_SUMMARY[cond.field] ?? cond.field;
  const opLabel = OP_SUMMARY[cond.op];

  if (cond.op === "is_null") return `${fieldLabel} ${getIsNullLabel(cond.field)}`;

  let valueLabel = cond.value;
  if (cond.field === "tags" && catalogs?.tags) {
    const tag = catalogs.tags.find((t) => t.id === cond.value);
    if (tag) valueLabel = tag.name;
  }
  if (cond.field === "status" && catalogs?.statuses) {
    const st = catalogs.statuses.find((s) => s.value === cond.value);
    if (st) valueLabel = st.label;
  }
  if (cond.field === "source" && catalogs?.sources) {
    const sr = catalogs.sources.find((s) => s.value === cond.value);
    if (sr) valueLabel = sr.label;
  }
  if (cond.field === "channel" && catalogs?.channels) {
    const ch = catalogs.channels.find((c) => c.value === cond.value);
    if (ch) valueLabel = ch.label;
  }
  if (cond.field === "deal_pipeline_id" && catalogs?.pipelines) {
    const p = catalogs.pipelines.find((p) => p.id === cond.value);
    if (p) valueLabel = p.name;
  }
  if (cond.field === "deal_stage_id" && catalogs?.stages) {
    const s = catalogs.stages.find((s) => s.id === cond.value);
    if (s) valueLabel = s.name;
  }
  if (cond.field === "deal_status") {
    const DEAL_STATUS_LABELS: Record<string, string> = { open: "Em andamento", won: "Ganho", lost: "Perdido" };
    valueLabel = DEAL_STATUS_LABELS[cond.value] ?? cond.value;
  }
  if (DATE_OPS_SET.has(cond.op)) valueLabel = `${cond.value} dias`;

  return `${fieldLabel} ${opLabel ?? cond.op} ${valueLabel}`.trim();
}

function summarizeRules(
  rules: SegmentRules | null | undefined,
  catalogs?: SegmentCatalogs,
): string {
  const conds = (rules?.conditions ?? []).filter(
    (c) => typeof c.field === "string" && typeof c.op === "string",
  ) as Array<{ field: string; op: string; value: string }>;

  if (conds.length === 0) return "";

  const sep = rules?.operator === "OR" ? " OU " : " E ";
  const shown = conds.slice(0, 3).map((c) => summarizeCondition(c, catalogs));
  const suffix = conds.length > 3 ? ` + ${conds.length - 3} mais` : "";
  return shown.join(sep) + suffix;
}

type HealthStatus = "ok" | "zero_leads" | "needs_review" | "no_rules";

function getHealthStatus(segment: Segment): HealthStatus {
  const conds = segment.rules?.conditions ?? [];
  if (conds.length === 0) return "no_rules";
  if (!validateSegmentRules(segment.rules).valid) return "needs_review";
  if (segment.lead_count === 0) return "zero_leads";
  return "ok";
}

const HEALTH_UI: Record<HealthStatus, { label: string; className: string }> = {
  ok: { label: "OK", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  zero_leads: { label: "0 leads", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  needs_review: { label: "Precisa revisar", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  no_rules: { label: "Sem regras", className: "bg-muted text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Etapa 6: templates comerciais
// ---------------------------------------------------------------------------

interface SegmentTemplate {
  id: string;
  name: string;
  description: string;
  rules: RulesShape;
}

const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  {
    id: "no_assignee",
    name: "Leads sem responsável",
    description: "Leads que ainda não foram atribuídos a nenhum membro da equipe.",
    rules: { operator: "AND", conditions: [{ field: "assigned_to", op: "is_null", value: "" }] },
  },
  {
    id: "new_this_week",
    name: "Leads novos da semana",
    description: "Leads cadastrados nos últimos 7 dias.",
    rules: { operator: "AND", conditions: [{ field: "created_at", op: "newer_than_days", value: "7" }] },
  },
  {
    id: "inactive_30d",
    name: "Leads sem interação há 30 dias",
    description: "Leads que não tiveram nenhuma atividade nos últimos 30 dias.",
    rules: { operator: "AND", conditions: [{ field: "last_interaction_at", op: "older_than_days", value: "30" }] },
  },
  {
    id: "hot_leads",
    name: "Leads quentes",
    description: "Leads com score igual ou superior a 70 — alta probabilidade de conversão.",
    rules: { operator: "AND", conditions: [{ field: "score", op: "gte", value: "70" }] },
  },
  {
    id: "lost_leads",
    name: "Leads perdidos",
    description: "Leads com status 'Perdido' que podem ser reativados.",
    rules: { operator: "AND", conditions: [{ field: "status", op: "eq", value: "lost" }] },
  },
  {
    id: "whatsapp_recent",
    name: "Leads recentes via WhatsApp",
    description: "Leads que vieram pelo canal WhatsApp nos últimos 14 dias.",
    rules: {
      operator: "AND",
      conditions: [
        { field: "channel", op: "eq", value: "whatsapp" },
        { field: "created_at", op: "newer_than_days", value: "14" },
      ],
    },
  },
  {
    id: "never_interacted",
    name: "Leads que nunca interagiram",
    description: "Leads sem nenhum registro de interação — aguardando primeiro contato.",
    rules: { operator: "AND", conditions: [{ field: "last_interaction_at", op: "is_null", value: "" }] },
  },
  {
    id: "hot_no_assignee",
    name: "Leads quentes sem responsável",
    description: "Leads promissores ainda sem dono — risco de perda por falta de atenção.",
    rules: {
      operator: "AND",
      conditions: [
        { field: "score", op: "gte", value: "60" },
        { field: "assigned_to", op: "is_null", value: "" },
      ],
    },
  },
  {
    id: "follow_up",
    name: "Precisa de follow-up",
    description: "Leads ativos há mais de 7 dias sem nova interação.",
    rules: {
      operator: "AND",
      conditions: [
        { field: "last_interaction_at", op: "older_than_days", value: "7" },
        { field: "status", op: "neq", value: "lost" },
      ],
    },
  },
  {
    id: "instagram_leads",
    name: "Leads do Instagram",
    description: "Todos os leads originados pelo Instagram.",
    rules: { operator: "AND", conditions: [{ field: "source", op: "eq", value: "instagram" }] },
  },
];

export interface SegmentsListProps {
  initialSegments: Segment[];
  /** admin+: pode criar/editar/deletar segmentos. CRM = admin+; admin app = sempre true. */
  canManage: boolean;
  /**
   * PR-CRMOPS3: lista de responsaveis pra dropdown do criterio
   * "Responsavel" no ConditionBuilder. Quando vazio, o builder usa
   * Input texto (degradacao graciosa).
   */
  assigneeOptions?: AssigneeOption[];
  /**
   * Etapa 1: catálogos com valores conhecidos pra cada campo do builder.
   * Quando presentes, substitui Input livre por Select guiado.
   */
  catalogs?: SegmentCatalogs;
  /**
   * PR-CRMOPS3: URL pra ver os leads de um segmento (botao "Ver
   * leads" no card). Quando ausente, o botao nao aparece. CRM passa
   * `(seg) => '/crm?tab=leads&segment=${seg.id}'`. Admin pode passar
   * undefined ou rota propria.
   */
  viewLeadsHref?: (segment: Segment) => string;
}

export function SegmentsList({
  initialSegments,
  canManage,
  assigneeOptions = [],
  catalogs,
  viewLeadsHref,
}: SegmentsListProps) {
  const actions = useSegmentsActions();
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [open, setOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<RulesShape>(EMPTY_RULES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // PR-CRMUI: validação só agressiva depois da 1a tentativa de submit.
  // Antes, onBlur no campo Nome ja pintava de vermelho no primeiro
  // foco perdido — UX ruim. Agora: o erro so e setado dentro do
  // handleSubmit (apos o usuario clicar "Criar"). Limpa quando digita.

  // Etapa 4: preview de quantidade antes de salvar.
  const [preview, setPreview] = useState<SegmentPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Versão pra descartar respostas antigas se a regra mudou enquanto
  // aguardava o debounce ou a resposta do servidor.
  const previewVersion = useRef(0);

  // Etapa 6: step do dialog ("picker" = escolha modelo, "form" = formulário).
  // Só aplica pra criação nova; edição pula direto pro form.
  const [dialogStep, setDialogStep] = useState<"picker" | "form">("picker");

  // Etapa 7: busca, filtro e ordenação client-side.
  type FilterTab = "all" | "with_leads" | "no_leads" | "needs_review";
  type SortOrder = "recent" | "most_leads" | "name";

  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");

  const displayedSegments = useMemo(() => {
    let list = [...segments];

    // Busca
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q),
      );
    }

    // Filtro por status
    if (filterTab === "with_leads") {
      list = list.filter((s) => s.lead_count > 0);
    } else if (filterTab === "no_leads") {
      list = list.filter((s) => s.lead_count === 0);
    } else if (filterTab === "needs_review") {
      list = list.filter((s) => {
        const h = getHealthStatus(s);
        return h === "needs_review" || h === "no_rules";
      });
    }

    // Ordenação
    if (sortOrder === "most_leads") {
      list.sort((a, b) => b.lead_count - a.lead_count);
    } else if (sortOrder === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    }
    // "recent" = ordem padrão do servidor (created_at DESC), mantém como está.

    return list;
  }, [segments, searchQuery, filterTab, sortOrder]);

  // Sync com prop quando o pai re-fetcha.
  useEffect(() => {
    setSegments(initialSegments);
  }, [initialSegments]);

  // Etapa 4: dispara preview debounced ao alterar regras no dialog.
  // Só ativa quando: dialog aberto + action disponível + regras válidas.
  useEffect(() => {
    if (!open || !actions.previewSegmentRules || rules.conditions.length === 0) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    const validation = validateSegmentRules(rules as unknown as SegmentRules);
    if (!validation.valid) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    const version = ++previewVersion.current;
    setPreviewLoading(true);

    const timer = setTimeout(() => {
      actions.previewSegmentRules!(rules as unknown as SegmentRules)
        .then((result) => {
          if (previewVersion.current === version) {
            setPreview(result);
            setPreviewLoading(false);
          }
        })
        .catch(() => {
          if (previewVersion.current === version) {
            setPreviewLoading(false);
          }
        });
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, open]);

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

  function openCreateDialog() {
    setEditingSegment(null);
    setName("");
    setDescription("");
    setRules(EMPTY_RULES);
    setErrors({});
    setPreview(null);
    previewVersion.current += 1;
    setDialogStep("picker");
    setOpen(true);
  }

  function openEditDialog(segment: Segment) {
    setEditingSegment(segment);
    setName(segment.name);
    setDescription(segment.description ?? "");
    const segRules = segment.rules as Partial<RulesShape> | null;
    setRules({
      operator: segRules?.operator === "OR" ? "OR" : "AND",
      conditions: segRules?.conditions ?? [],
    });
    setErrors({});
    setPreview(null);
    previewVersion.current += 1;
    setDialogStep("form");
    setOpen(true);
  }

  function applyTemplate(tpl: SegmentTemplate) {
    setName(tpl.name);
    setDescription(tpl.description);
    setRules(tpl.rules);
    setErrors({});
    setPreview(null);
    previewVersion.current += 1;
    setDialogStep("form");
  }

  // Sprint 3: mutations padronizadas com useDialogMutation.
  // Toasts antes silenciados ("// silently fail") agora aparecem.
  //
  // Separamos create / update em 2 hooks: o tipo de retorno difere
  // (ActionResult<Segment> vs ActionResult<void>), entao um hook unico
  // exigiria cast. 2 hooks deixam tipos limpos e codigo claro.

  type SegmentPayload = {
    name: string;
    description?: string;
    rules: SegmentRules;
  };

  const createMutation = useDialogMutation<SegmentPayload, Segment>({
    mutation: (payload) => actions.createSegment(payload),
    onOpenChange: setOpen,
    successToast: "Segmentação criada",
    errorToast: (err) => err,
    toastId: "segment-create",
    onSuccess: (data) => {
      if (data) {
        setSegments((prev) => [data, ...prev]);
      }
    },
  });

  const updateMutation = useDialogMutation<
    { id: string; payload: SegmentPayload }
  >({
    mutation: ({ id, payload }) => actions.updateSegment(id, payload),
    onOpenChange: setOpen,
    successToast: "Segmentação atualizada",
    errorToast: (err) => err,
    toastId: "segment-update",
    onSuccess: () => {
      if (editingSegment) {
        setSegments((prev) =>
          prev.map((s) =>
            s.id === editingSegment.id
              ? {
                  ...s,
                  name: name.trim(),
                  description: description.trim() || null,
                  rules: rules as unknown as SegmentRules,
                }
              : s,
          ),
        );
      }
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("segment_name", "Informe um nome pra esta segmentação");
      return;
    }
    clearError("segment_name");

    // Etapa 3: validação client-side das regras antes de enviar ao server.
    const validation = validateSegmentRules(rules as unknown as SegmentRules);
    if (!validation.valid) {
      setError("segment_rules", validation.errors[0] ?? "Regras inválidas");
      return;
    }
    clearError("segment_rules");

    const payload: SegmentPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      rules: rules as unknown as SegmentRules,
    };

    if (editingSegment) {
      updateMutation.run({ id: editingSegment.id, payload });
    } else {
      createMutation.run(payload);
    }
  }

  // PR-M02: AlertDialog substitui window.confirm pra delete.
  // Sprint 3: usa useDialogMutation pra toast/erro padronizado.
  const [pendingDelete, setPendingDelete] = useState<Segment | null>(null);

  const deleteMutation = useDialogMutation<{ id: string }>({
    mutation: ({ id }) => actions.deleteSegment(id),
    onOpenChange: (o) => {
      if (!o) setPendingDelete(null);
    },
    successToast: "Segmentação excluída",
    errorToast: (err) => err,
    toastId: "segment-delete",
    onSuccess: () => {
      if (pendingDelete) {
        setSegments((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      }
    },
  });

  function handleDelete(segment: Segment) {
    setPendingDelete(segment);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    deleteMutation.run({ id: pendingDelete.id });
  }

  // Etapa 8: duplicar segmento.
  const duplicateMutation = useDialogMutation<{ id: string }, Segment>({
    mutation: ({ id }) => (actions.duplicateSegment ? actions.duplicateSegment(id) : Promise.resolve({ error: "Não suportado" })),
    onOpenChange: () => {},
    successToast: "Segmentação duplicada",
    errorToast: (err) => err,
    toastId: "segment-duplicate",
    onSuccess: (data) => {
      if (data) setSegments((prev) => [data, ...prev]);
    },
  });

  const isPending =
    createMutation.pending ||
    updateMutation.pending ||
    deleteMutation.pending ||
    duplicateMutation.pending;

  const dialogTitle =
    editingSegment
      ? "Editar segmentação"
      : dialogStep === "picker"
        ? "Nova segmentação"
        : "Nova segmentação";

  return (
    <div className="space-y-4">
      {/* Header da listagem — botão "Nova Segmentação" alinhado à direita */}
      {canManage && (
        <div className="flex items-center justify-end">
          <Button
            onClick={openCreateDialog}
            className="h-9 rounded-md shadow-sm"
          >
            <Plus className="size-4" data-icon="inline-start" />
            Nova segmentação
          </Button>
        </div>
      )}

      {/* Dialog form */}
      {canManage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="border-b border-border bg-card p-5">
              <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
              <div className="flex items-center gap-3">
                {!editingSegment && dialogStep === "form" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0"
                    onClick={() => setDialogStep("picker")}
                    aria-label="Voltar para modelos"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                <DialogHero
                  icon={<Filter className="size-5" />}
                  title={dialogTitle}
                  tagline={
                    editingSegment
                      ? "Atualize regras e descrição"
                      : dialogStep === "picker"
                        ? "Escolha um modelo ou comece do zero"
                        : "Defina critérios pra agrupar leads"
                  }
                />
              </div>
            </DialogHeader>

            {/* Etapa 6: picker de template */}
            {!editingSegment && dialogStep === "picker" && (
              <div className="flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SEGMENT_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="text-left rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary mt-0.5">
                            <Zap className="size-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground leading-snug">
                              {tpl.name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                              {tpl.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t border-border bg-card px-6 py-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setDialogStep("form")}
                  >
                    <Plus className="size-4" data-icon="inline-start" />
                    Criar do zero
                  </Button>
                </div>
              </div>
            )}

            {/* Form — criação nova ou edição */}
            {(editingSegment || dialogStep === "form") && (
            <form
              onSubmit={handleSubmit}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="seg-name"
                    className="text-sm font-medium text-foreground"
                  >
                    Nome <span className="text-muted-foreground/60">*</span>
                  </Label>
                  <Input
                    id="seg-name"
                    name="segment_name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      clearError("segment_name");
                    }}
                    placeholder="Ex: Leads inativos há 30 dias"
                    aria-invalid={Boolean(errors.segment_name)}
                    aria-describedby={
                      errors.segment_name ? "seg-name-error" : undefined
                    }
                    /* PR-CRMUI: borda de erro suave (era /60 + ring/20).
                       Subtle, nao agressiva. Aparece so apos submit. */
                    className={
                      errors.segment_name
                        ? "border-destructive/40"
                        : ""
                    }
                  />
                  {errors.segment_name && (
                    <p
                      id="seg-name-error"
                      className="text-xs text-destructive/80"
                    >
                      {errors.segment_name}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="seg-desc"
                    className="text-sm font-medium text-foreground"
                  >
                    Descrição{" "}
                    <span className="font-normal text-muted-foreground/70">
                      (opcional)
                    </span>
                  </Label>
                  <Textarea
                    id="seg-desc"
                    name="segment_description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descreva o objetivo desta segmentação"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <Label className="text-sm font-medium text-foreground">
                        Regras de inclusão
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Defina critérios para agrupar leads automaticamente.
                      </p>
                    </div>
                    {rules.conditions.length > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {rules.conditions.length} regra
                        {rules.conditions.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
                    <ConditionBuilder
                      rules={rules}
                      assigneeOptions={assigneeOptions}
                      catalogs={catalogs}
                      onChange={(next) => {
                        setRules({
                          operator: next.operator === "OR" ? "OR" : "AND",
                          conditions: next.conditions,
                        });
                        clearError("segment_rules");
                      }}
                    />
                  </div>
                  {errors.segment_rules && (
                    <p className="text-xs text-destructive/80">
                      {errors.segment_rules}
                    </p>
                  )}
                  {/* Etapa 4: painel de preview — count + amostra de leads */}
                  {actions.previewSegmentRules && rules.conditions.length > 0 && (
                    <div className="mt-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
                      {previewLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          Calculando leads…
                        </div>
                      ) : preview ? (
                        <div className="space-y-2">
                          {/* Contagem */}
                          <div className="flex items-center gap-1.5">
                            <Users className="size-3.5 text-primary shrink-0" />
                            <span className="text-xs font-semibold text-foreground tabular-nums">
                              {preview.count.toLocaleString("pt-BR")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {preview.count === 1 ? "lead encontrado" : "leads encontrados"}
                            </span>
                          </div>
                          {/* Warnings */}
                          {preview.warnings.map((w, i) => (
                            <p key={i} className="text-xs text-warning-soft-foreground">
                              ⚠ {w}
                            </p>
                          ))}
                          {/* Amostra */}
                          {preview.sample.length > 0 && (
                            <div className="space-y-1 pt-0.5">
                              {preview.sample.map((lead) => (
                                <div
                                  key={lead.id}
                                  className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                                >
                                  <span className="truncate font-medium text-foreground/80">
                                    {lead.name ?? "Sem nome"}
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {lead.phone ?? "—"}
                                  </span>
                                </div>
                              ))}
                              {preview.count > preview.sample.length && (
                                <p className="text-[11px] text-muted-foreground/70">
                                  + {(preview.count - preview.sample.length).toLocaleString("pt-BR")} outros
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              {/* PR-HOTFIX-FOOTER: o DialogFooter base tem `-mx-4 -mb-4`
                  (margens negativas) pra "encostar" nas bordas do
                  DialogContent quando ele tem padding p-4. Aqui o
                  DialogContent usa `p-0` (full-bleed custom), entao as
                  margens negativas empurravam o footer PRA FORA do
                  dialog — o botao "Criar segmentacao" ficava colado/
                  saindo da borda direita.

                  Fix: `mx-0 mb-0` cancela as margens negativas do base
                  (cn + tailwind-merge resolve o conflito, ultima
                  classe vence). px-6 py-4 + gap-3 + min-w nos botoes
                  garantem respiro confortavel. */}
              <DialogFooter className="mx-0 mb-0 flex-row justify-end gap-3 border-t border-border bg-card px-6 py-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="min-w-24"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="min-w-32"
                >
                  {isPending
                    ? editingSegment
                      ? "Salvando..."
                      : "Criando..."
                    : editingSegment
                      ? "Salvar alterações"
                      : "Criar segmentação"}
                </Button>
              </DialogFooter>
            </form>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* AlertDialog de confirmação de exclusão */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir &ldquo;{pendingDelete?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A segmentação será removida permanentemente. Os leads não são
              afetados — só este filtro deixa de existir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conteúdo */}
      {segments.length === 0 ? (
        <EmptyState
          icon={<Filter />}
          title="Nenhuma segmentação ainda"
          description="Crie grupos dinâmicos de leads baseados em regras (tags, status, origem) pra acionar campanhas e follow-ups."
          action={
            canManage ? (
              <Button
                onClick={openCreateDialog}
                className="rounded-md"
                variant="outline"
              >
                <Plus className="size-4" data-icon="inline-start" />
                Criar primeira segmentação
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Etapa 7: toolbar de busca, filtro e ordenação */}
          <Toolbar
            density="compact"
            search={
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar segmentação…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-sm"
                />
              </div>
            }
            filters={
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: "all", label: "Todos" },
                    { id: "with_leads", label: "Com leads" },
                    { id: "no_leads", label: "Sem leads" },
                    { id: "needs_review", label: "Precisa revisar" },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilterTab(id)}
                    className={
                      filterTab === id
                        ? "rounded-full px-2.5 py-1 text-[11px] font-semibold bg-foreground text-background"
                        : "rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
            actions={
              <Select
                value={sortOrder}
                onValueChange={(v) => setSortOrder(v as "recent" | "most_leads" | "name")}
              >
                <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Mais recentes</SelectItem>
                  <SelectItem value="most_leads">Mais leads</SelectItem>
                  <SelectItem value="name">Nome</SelectItem>
                </SelectContent>
              </Select>
            }
          />

          {displayedSegments.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="Nenhuma segmentação encontrada"
              description={
                searchQuery
                  ? `Nenhum resultado para "${searchQuery}".`
                  : "Nenhuma segmentação nesta categoria."
              }
              action={
                searchQuery || filterTab !== "all" ? (
                  <Button
                    variant="outline"
                    className="rounded-md"
                    onClick={() => { setSearchQuery(""); setFilterTab("all"); }}
                  >
                    Limpar filtros
                  </Button>
                ) : undefined
              }
            />
          ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedSegments.map((segment) => {
            const conditionsCount = segment.rules?.conditions?.length ?? 0;
            const health = getHealthStatus(segment);
            const { label: healthLabel, className: healthClass } = HEALTH_UI[health];
            const summary = summarizeRules(segment.rules, catalogs);
            return (
              <Card
                key={segment.id}
                className="group relative border border-border/60 bg-card transition-all hover:border-primary/40 hover:shadow-md hover:shadow-foreground/5"
              >
                <CardContent className="space-y-3 p-4">
                  {/* Header do card */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Sparkles className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="truncate text-sm font-bold text-foreground">
                            {segment.name}
                          </h3>
                          {/* Etapa 5: badge de saúde */}
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${healthClass}`}
                          >
                            {healthLabel}
                          </span>
                        </div>
                        {segment.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {segment.description}
                          </p>
                        )}
                        {/* Etapa 5: resumo legível das regras */}
                        {summary && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80 leading-relaxed">
                            {summary}
                          </p>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-7"
                          onClick={() => openEditDialog(segment)}
                          aria-label="Editar segmento"
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        {actions.duplicateSegment && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7"
                            onClick={() => duplicateMutation.run({ id: segment.id })}
                            disabled={duplicateMutation.pending}
                            aria-label="Duplicar segmento"
                          >
                            <Copy className="size-3.5 text-muted-foreground" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDelete(segment)}
                          aria-label="Excluir segmento"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Footer com métricas + acao "Ver leads" */}
                  <div className="border-t border-border/40 pt-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                        <Users className="size-3.5 text-muted-foreground" />
                        <span className="tabular-nums">
                          {segment.lead_count.toLocaleString("pt-BR")}
                        </span>
                        <span className="font-normal text-muted-foreground">
                          {segment.lead_count === 1 ? "lead" : "leads"}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {conditionsCount} regra
                        {conditionsCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    {/* PR-CRMOPS3: acao principal — ve os leads do
                        segmento aplicado como filtro na tab Leads.
                        Visivel sempre (nao depende do hover). */}
                    {viewLeadsHref && (
                      <Link
                        href={viewLeadsHref(segment)}
                        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Users className="size-3.5" aria-hidden />
                        Ver leads
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
          )}
        </>
      )}
    </div>
  );
}
