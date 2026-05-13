"use client";

// SegmentsList — view de listagem de segmentos com builder de regras
// inline. Compartilhada entre CRM (cliente) e Admin (superadmin). Auth/
// role moram nos apps; o pacote recebe permissoes (canManage) via prop e
// actions via <SegmentsProvider>.
//
// Originalmente em apps/crm/src/components/segments/segment-list.tsx.

import { useEffect, useState } from "react";
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
  Filter,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import type { Segment, SegmentRules } from "@persia/shared/crm";

import { ConditionBuilder, type AssigneeOption } from "./ConditionBuilder";
import { useSegmentsActions } from "../context";

interface RulesShape {
  operator: "AND" | "OR";
  conditions: Array<{ field: string; op: string; value: string }>;
}

const EMPTY_RULES: RulesShape = { operator: "AND", conditions: [] };

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

  // Sync com prop quando o pai re-fetcha.
  useEffect(() => {
    setSegments(initialSegments);
  }, [initialSegments]);

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
    setOpen(true);
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

  const isPending =
    createMutation.pending ||
    updateMutation.pending ||
    deleteMutation.pending;

  const dialogTitle = editingSegment
    ? "Editar segmentação"
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
              <DialogHero
                icon={<Filter className="size-5" />}
                title={dialogTitle}
                tagline={
                  editingSegment
                    ? "Atualize regras e descrição"
                    : "Defina critérios pra agrupar leads"
                }
              />
            </DialogHeader>
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
                      onChange={(next) =>
                        setRules({
                          operator: next.operator === "OR" ? "OR" : "AND",
                          conditions: next.conditions,
                        })
                      }
                    />
                  </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((segment) => {
            const conditionsCount = segment.rules?.conditions?.length ?? 0;
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
                        <h3 className="truncate text-sm font-bold text-foreground">
                          {segment.name}
                        </h3>
                        {segment.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {segment.description}
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
    </div>
  );
}
