"use client";

// SegmentsList — view de listagem de segmentos com builder de regras
// inline. Compartilhada entre CRM (cliente) e Admin (superadmin). Auth/
// role moram nos apps; o pacote recebe permissoes (canManage) via prop e
// actions via <SegmentsProvider>.
//
// Originalmente em apps/crm/src/components/segments/segment-list.tsx.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
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
import {
  Filter,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import type { Segment, SegmentRules } from "@persia/shared/crm";

import { ConditionBuilder } from "./ConditionBuilder";
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
}

export function SegmentsList({
  initialSegments,
  canManage,
}: SegmentsListProps) {
  const actions = useSegmentsActions();
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<RulesShape>(EMPTY_RULES);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("segment_name", "Campo obrigatório");
      return;
    }
    clearError("segment_name");

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      rules: rules as unknown as SegmentRules,
    };

    startTransition(async () => {
      try {
        if (editingSegment) {
          await actions.updateSegment(editingSegment.id, payload);
          setSegments((prev) =>
            prev.map((s) =>
              s.id === editingSegment.id
                ? {
                    ...s,
                    name: payload.name,
                    description: payload.description ?? null,
                    rules: payload.rules,
                  }
                : s,
            ),
          );
        } else {
          const created = await actions.createSegment(payload);
          if (created) {
            setSegments((prev) => [created, ...prev]);
          }
        }
        setOpen(false);
      } catch {
        // silently fail
      }
    });
  }

  // PR-M02: AlertDialog substitui window.confirm pra delete
  const [pendingDelete, setPendingDelete] = useState<Segment | null>(null);

  function handleDelete(segment: Segment) {
    setPendingDelete(segment);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    startTransition(async () => {
      try {
        await actions.deleteSegment(id);
        setSegments((prev) => prev.filter((s) => s.id !== id));
      } catch {
        // silently fail
      }
    });
  }

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
              <div className="flex-1 space-y-5 overflow-y-auto p-5">
                <div className="space-y-1.5">
                  <Label htmlFor="seg-name" className="text-xs uppercase tracking-wide text-muted-foreground">
                    Nome *
                  </Label>
                  <Input
                    id="seg-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      clearError("segment_name");
                    }}
                    required
                    placeholder="Ex: Leads inativos há 30 dias"
                    onBlur={(e) => {
                      if (!e.target.value.trim())
                        setError("segment_name", "Campo obrigatório");
                      else clearError("segment_name");
                    }}
                    aria-invalid={Boolean(errors.segment_name)}
                    className={
                      errors.segment_name
                        ? "border-destructive/60 ring-1 ring-destructive/20"
                        : ""
                    }
                  />
                  {errors.segment_name && (
                    <p className="text-xs text-destructive">
                      {errors.segment_name}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seg-desc" className="text-xs uppercase tracking-wide text-muted-foreground">
                    Descrição{" "}
                    <span className="normal-case tracking-normal text-muted-foreground/70">
                      (opcional)
                    </span>
                  </Label>
                  <Textarea
                    id="seg-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descreva o objetivo desta segmentação"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Regras de inclusão
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      {rules.conditions.length} regra
                      {rules.conditions.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-3">
                    <ConditionBuilder
                      rules={rules}
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
              <DialogFooter className="border-t border-border bg-card p-4 flex-row justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending}>
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
        <Card className="border border-dashed border-border/60 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Filter className="size-6" />
            </div>
            <p className="text-base font-semibold text-foreground">
              Nenhuma segmentação ainda
            </p>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
              Crie grupos dinâmicos de leads baseados em regras (tags,
              status, origem) pra acionar campanhas e follow-ups.
            </p>
            {canManage && (
              <Button
                onClick={openCreateDialog}
                className="mt-4 rounded-md"
                variant="outline"
              >
                <Plus className="size-4" data-icon="inline-start" />
                Criar primeira segmentação
              </Button>
            )}
          </CardContent>
        </Card>
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

                  {/* Footer com métricas */}
                  <div className="flex items-center justify-between border-t border-border/40 pt-3 text-[11px]">
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
