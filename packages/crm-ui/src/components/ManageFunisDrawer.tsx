"use client";

// PR-PIPETOOLS: Sheet/Drawer lateral "Configurar funis".
//
// Briefing:
//   "Funis configurados" devia ser um drawer lateral, nao card aberto
//   no meio do Kanban. O drawer contem:
//     - lista de funis
//     - etapas de cada funil (preview)
//     - botao criar novo funil
//     - botao editar funil (abre o EditKanbanStructureDrawer modal
//       existente — editor de etapas master-detail)
//     - botao excluir funil (com confirmacao)
//
// Acessivel via 2 caminhos na UI:
//   1. Dropdown "Funil atual" na toolbar -> "Configurar funis..."
//   2. Botao "Configurar funil" nas acoes rapidas da toolbar
//
// Reusa actions ja existentes (createPipeline, updatePipelineName,
// deletePipeline) via useKanbanActions. Zero logica nova.
//
// DesignFlow: Sheet 600px lateral, body com cards, footer com botao
// "+ Criar novo funil" sticky. Padroes consistentes com outros drawers.

import * as React from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import type { Pipeline, Stage } from "@persia/shared/crm";

import { useKanbanActions } from "../context";
import { CreateKanbanDialog } from "./CreateKanbanDialog";
import { EditKanbanStructureDrawer } from "./EditKanbanStructureDrawer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  stages: Stage[];
  /** Quando setado, callback de "selecionar funil" ao clicar num
   * card. Se omitido, cards apenas abrem editor. */
  onSelectPipeline?: (pipelineId: string) => void;
  /** Disparado apos criar/editar/excluir pra o pai re-fetchar. */
  onChange?: () => void;
}

export function ManageFunisDrawer({
  open,
  onOpenChange,
  pipelines,
  stages,
  onSelectPipeline,
  onChange,
}: Props) {
  const actions = useKanbanActions();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingPipelineId, setEditingPipelineId] = React.useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const stagesByPipeline = React.useMemo(() => {
    const map = new Map<string, Stage[]>();
    for (const s of stages) {
      const arr = map.get(s.pipeline_id) ?? [];
      arr.push(s);
      map.set(s.pipeline_id, arr);
    }
    // Sort each pipeline's stages by sort_order pra preview consistente
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sort_order - b.sort_order);
    }
    return map;
  }, [stages]);

  // Sprint 3e: deletePipeline retorna ActionResult. Antes era try/catch
  // manual; agora result.error check.
  const handleDelete = (pipelineId: string) => {
    startTransition(async () => {
      const result = await actions.deletePipeline(pipelineId);
      if (result && "error" in result && result.error) {
        toast.error(result.error, {
          id: `pipeline-delete-${pipelineId}`,
          duration: 5000,
        });
        return;
      }
      setPendingDeleteId(null);
      toast.success("Funil excluído", {
        id: `pipeline-delete-${pipelineId}`,
        duration: 5000,
      });
      onChange?.();
    });
  };

  const editingPipeline = editingPipelineId
    ? pipelines.find((p) => p.id === editingPipelineId) ?? null
    : null;

  return (
    <>
      {/* Frente B (UX produto-first): drawer lateral migrou pra Dialog
          centralizado responsivo. Centralizado + scroll interno + max-h. */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="w-[92vw] sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <DialogHeader className="border-b border-border bg-card px-6 py-4 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight font-heading">
                  Configurar funis
                </DialogTitle>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Crie, edite ou exclua os funis de venda do CRM.
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* Body — lista de funis */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
            {pipelines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-8 text-center">
                <p className="text-sm font-semibold text-foreground">
                  Nenhum funil ainda
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Crie o primeiro funil pra começar.
                </p>
              </div>
            ) : (
              pipelines.map((p) => {
                const pStages = stagesByPipeline.get(p.id) ?? [];
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    {/* Header do card: nome + acoes */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-foreground truncate">
                          {p.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {pStages.length} etapa{pStages.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => setEditingPipelineId(p.id)}
                          title="Editar etapas"
                        >
                          Editar
                        </Button>
                        {pipelines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setPendingDeleteId(p.id)}
                            aria-label={`Excluir ${p.name}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Preview das etapas (bolinhas + nome curto) */}
                    {pStages.length > 0 && (
                      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                        {pStages.slice(0, 10).map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded-full bg-muted/60 pl-1 pr-2 py-0.5 text-[10px] text-foreground"
                            title={s.name}
                          >
                            <span
                              className="inline-block size-2 rounded-full ring-1 ring-black/5"
                              style={{ backgroundColor: s.color || "#6366f1" }}
                              aria-hidden
                            />
                            <span className="truncate max-w-[80px]">
                              {s.name}
                            </span>
                          </span>
                        ))}
                        {pStages.length > 10 && (
                          <span className="text-[10px] text-muted-foreground/70">
                            +{pStages.length - 10}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Footer do card: botao "Ver no Kanban" */}
                    {onSelectPipeline && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectPipeline(p.id);
                          onOpenChange(false);
                        }}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Ver no Kanban
                        <ChevronRight className="size-3" aria-hidden />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer fixo — criar novo */}
          <div className="border-t border-border bg-card px-6 py-4">
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="w-full h-10 gap-1.5"
            >
              <Plus className="size-4" aria-hidden />
              Criar novo funil
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog "Novo funil" — reusa o componente existente */}
      <CreateKanbanDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(newId) => {
          toast.success("Funil criado");
          onChange?.();
          // Auto-seleciona o novo funil se o caller suportar
          onSelectPipeline?.(newId);
          onOpenChange(false);
        }}
      />

      {/* Modal "Editar estrutura" — reusa modal centralizado existente */}
      {editingPipeline && (
        <EditKanbanStructureDrawer
          open={true}
          onOpenChange={(o) => !o && setEditingPipelineId(null)}
          pipelineId={editingPipeline.id}
          pipelineName={editingPipeline.name}
          stages={stagesByPipeline.get(editingPipeline.id) ?? []}
          canDeleteKanban={pipelines.length > 1}
          onChange={onChange}
          onDeleted={() => {
            setEditingPipelineId(null);
            onChange?.();
          }}
        />
      )}

      {/* Confirma exclusao do funil */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => !o && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir funil</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir &quot;
              {pipelines.find((p) => p.id === pendingDeleteId)?.name}&quot;?
              Todos os negócios e etapas deste funil serão removidos. Esta
              ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDeleteId && handleDelete(pendingDeleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
