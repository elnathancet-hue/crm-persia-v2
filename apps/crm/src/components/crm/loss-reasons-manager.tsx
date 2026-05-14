"use client";

// LossReasonsManager (PR-K4) — CRUD do catalogo de motivos de perda
// usado pelo MarkAsLostDialog (PR-K3). Soft delete (is_active=false)
// pra preservar historico em deals ja marcados.
//
// CRM-only: admin/owner gerenciam em /crm/settings. Cada org tem o
// proprio catalogo (8 defaults seedados no first-touch via getLossReasons).

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, AlertTriangle, Ban } from "lucide-react";
import { toast } from "sonner";
import type { DealLossReason } from "@persia/shared/crm";
import { DialogHero } from "@persia/crm-ui";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Checkbox } from "@persia/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import {
  createLossReason,
  deleteLossReason,
  updateLossReason,
} from "@/actions/crm";

interface Props {
  initialReasons: DealLossReason[];
}

export function LossReasonsManager({ initialReasons }: Props) {
  const router = useRouter();
  const [reasons, setReasons] = React.useState<DealLossReason[]>(initialReasons);
  const [isPending, startTransition] = React.useTransition();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DealLossReason | null>(null);
  const [deleting, setDeleting] = React.useState<DealLossReason | null>(null);

  // Sync quando server revalida
  React.useEffect(() => {
    setReasons(initialReasons);
  }, [initialReasons]);

  const handleCreate = (input: {
    label: string;
    requires_competitor: boolean;
    sort_order: number;
  }) => {
    startTransition(async () => {
      try {
        const result = await createLossReason(input);
        // Optimistic: monta DealLossReason temporario; revalidatePath
        // vai sincronizar depois
        const now = new Date().toISOString();
        setReasons((prev) =>
          [
            ...prev,
            {
              id: result.id,
              organization_id: "",
              label: input.label.trim(),
              requires_competitor: input.requires_competitor,
              sort_order: input.sort_order,
              is_active: true,
              created_at: now,
              updated_at: now,
            },
          ].sort((a, b) => a.sort_order - b.sort_order),
        );
        toast.success("Motivo cadastrado");
        setCreateOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao criar");
      }
    });
  };

  const handleUpdate = (
    id: string,
    input: { label: string; requires_competitor: boolean; sort_order: number },
  ) => {
    startTransition(async () => {
      try {
        await updateLossReason(id, input);
        setReasons((prev) =>
          prev
            .map((r) => (r.id === id ? { ...r, ...input } : r))
            .sort((a, b) => a.sort_order - b.sort_order),
        );
        toast.success("Motivo atualizado");
        setEditing(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteLossReason(id);
        setReasons((prev) => prev.filter((r) => r.id !== id));
        toast.success("Motivo desativado (historico preservado)");
        setDeleting(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao excluir");
      }
    });
  };

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Motivos de perda</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Categorias usadas ao marcar negócios como perdidos. Aparecem
            no diálogo &quot;Negócio descartado&quot; do Kanban.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-md gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          Adicionar motivo
        </Button>
      </div>

      {reasons.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
          <AlertTriangle className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum motivo cadastrado. Defaults serão criados automaticamente
            ao usar &quot;Negócio descartado&quot; pela primeira vez.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {reasons.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {r.label}
                  </span>
                  {r.requires_competitor && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      Pede concorrente
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Ordem: {r.sort_order}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-md"
                  onClick={() => setEditing(r)}
                  title="Editar"
                  disabled={isPending}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-md text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleting(r)}
                  title="Desativar"
                  disabled={isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create/Edit dialog */}
      <ReasonFormDialog
        open={createOpen || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
        initial={editing ?? undefined}
        existingMaxOrder={
          reasons.length > 0
            ? Math.max(...reasons.map((r) => r.sort_order))
            : 0
        }
        pending={isPending}
        onSubmit={(values) => {
          if (editing) handleUpdate(editing.id, values);
          else handleCreate(values);
        }}
      />

      {/* Confirmacao de delete (soft) */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desativar &quot;{deleting?.label}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O motivo deixa de aparecer no diálogo de novas perdas, mas o
              histórico de negócios já marcados com ele permanece intacto
              (soft delete).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && handleDelete(deleting.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// ReasonFormDialog — usado pra create + edit (modo controlado pelo `initial`)
// ============================================================================

function ReasonFormDialog({
  open,
  onOpenChange,
  initial,
  existingMaxOrder,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: DealLossReason;
  existingMaxOrder: number;
  pending: boolean;
  onSubmit: (values: {
    label: string;
    requires_competitor: boolean;
    sort_order: number;
  }) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [requiresCompetitor, setRequiresCompetitor] = React.useState(false);
  const [sortOrder, setSortOrder] = React.useState<number>(0);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setLabel(initial?.label ?? "");
      setRequiresCompetitor(initial?.requires_competitor ?? false);
      setSortOrder(initial?.sort_order ?? existingMaxOrder + 10);
    }
  }, [open, initial, existingMaxOrder]);

  const trimmed = label.trim();
  const canSubmit = trimmed.length > 0 && !pending;
  const isEdit = initial !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">
            {isEdit ? "Editar motivo" : "Novo motivo"}
          </DialogTitle>
          <DialogHero
            icon={<Ban className="size-5" />}
            title={isEdit ? "Editar motivo" : "Novo motivo"}
            tagline={
              isEdit
                ? "Atualize os dados abaixo"
                : "Cadastre um novo motivo de perda"
            }
            tone="destructive"
          />
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reason-label" className="text-xs">
              Nome do motivo
            </Label>
            <Input
              id="reason-label"
              name="loss_reason_label"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Sem orçamento"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  onSubmit({
                    label: trimmed,
                    requires_competitor: requiresCompetitor,
                    sort_order: sortOrder,
                  });
                }
              }}
              className="h-10"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={requiresCompetitor}
              onCheckedChange={(v) => setRequiresCompetitor(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <span className="text-sm font-medium">Pede concorrente</span>
              <p className="text-[11px] text-muted-foreground">
                Quando marcar esse motivo, o diálogo abre o campo &quot;Qual
                concorrente?&quot; automaticamente.
              </p>
            </div>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="reason-order" className="text-xs">
              Ordem (menor aparece primeiro)
            </Label>
            <Input
              id="reason-order"
              name="loss_reason_order"
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              className="h-10"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                label: trimmed,
                requires_competitor: requiresCompetitor,
                sort_order: sortOrder,
              })
            }
            disabled={!canSubmit}
          >
            {pending ? "Salvando..." : isEdit ? "Salvar" : "Criar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
