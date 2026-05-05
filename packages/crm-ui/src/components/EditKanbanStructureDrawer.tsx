"use client";

// PR-CRMOPS2: Modal centralizado pra "Editar estrutura" do Kanban.
//
// Mudou de Sheet lateral 720px (PR-CRMOPS) pra Dialog centralizado
// max-w-5xl — feedback do usuario foi "está bem apertado" no drawer
// lateral, as 3 colunas (Em andamento / Falha / Bem-sucedido) nao
// tinham espaco confortavel.
//
// O nome do componente continua "Drawer" pra preservar imports
// existentes — internamente virou Modal.
//
// Briefing:
//   - Abre dentro do contexto do CRM (sem navegar).
//   - Kanban fica atras com overlay (sem ver, mas sem perder rota).
//   - Edita SO o Kanban ativo (sem master-detail interno).
//   - Permite: criar/renomear/excluir etapa, mudar cor, reordenar,
//     definir tipo (em_andamento/falha/bem_sucedido), editar regra IA.
//   - Permite renomear/excluir o proprio Kanban (header).
//
// DesignFlow Kit aplicado:
//   - Largura max-w-5xl (~1024px) desktop / full mobile.
//   - Altura max-h-[85vh] com scroll interno.
//   - Header: titulo Space Grotesk, subtitulo muted, padding 24px.
//   - Body scroll interno padding 24px.
//   - Auto-save inline no editor — sem footer "Salvar".

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
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
  AlertDialogTrigger,
} from "@persia/ui/alert-dialog";

import type { Stage } from "@persia/shared/crm";
import { useKanbanActions } from "../context";
import { DialogHero } from "./DialogHero";
import { PipelineStagesEditor } from "./PipelineStagesEditor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  stages: Stage[];
  /** Habilita botao "excluir Kanban" no header. False quando e o
   * unico Kanban (org precisa de pelo menos 1). */
  canDeleteKanban: boolean;
  onChange?: () => void;
  onDeleted?: () => void;
}

export function EditKanbanStructureDrawer({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  stages,
  canDeleteKanban,
  onChange,
  onDeleted,
}: Props) {
  const actions = useKanbanActions();
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [, startTransition] = React.useTransition();

  const handleDeleteKanban = () => {
    startTransition(async () => {
      try {
        await actions.deletePipeline(pipelineId);
        onOpenChange(false);
        onDeleted?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[EditKanbanStructureDrawer] deletePipeline:", err);
      }
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // PR-CRMOPS2: max-w-5xl (~1024px) pra dar espaco confortavel
          // pras 3 colunas. Antes era Sheet 720px lateral — apertado.
          // max-h-85vh com flex column pra header fixo + body scrollavel.
          className="sm:max-w-5xl max-h-[85vh] flex flex-col gap-0 p-0 rounded-2xl"
        >
          {/* Header — DesignFlow: Space Grotesk titulo, muted subtitulo */}
          <DialogHeader className="border-b border-border bg-card px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-xl font-bold tracking-tight font-heading truncate">
                  {pipelineName}
                </DialogTitle>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Editar estrutura do funil
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 gap-1.5"
                  onClick={() => setRenameOpen(true)}
                  title="Renomear funil"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">Renomear</span>
                </Button>
                {canDeleteKanban && (
                  <DeleteKanbanButton
                    name={pipelineName}
                    onConfirm={handleDeleteKanban}
                  />
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Body — scroll interno, padding 24px */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <PipelineStagesEditor
              pipelineId={pipelineId}
              stages={stages}
              onChange={onChange}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename dialog (separado pra nao competir com o Dialog principal) */}
      <RenameKanbanDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        pipelineId={pipelineId}
        currentName={pipelineName}
        onChange={onChange}
      />
    </>
  );
}

// ============ Rename dialog ============

function RenameKanbanDialog({
  open,
  onOpenChange,
  pipelineId,
  currentName,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: string;
  currentName: string;
  onChange?: () => void;
}) {
  const actions = useKanbanActions();
  const [name, setName] = React.useState(currentName);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName || isPending) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      try {
        await actions.updatePipelineName(pipelineId, trimmed);
        onOpenChange(false);
        onChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[RenameKanbanDialog] updatePipelineName:", err);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Renomear funil</DialogTitle>
          <DialogHero
            icon={<Pencil className="size-5" />}
            title="Renomear funil"
            tagline="Atualize o nome do funil"
          />
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rename-kanban" className="text-sm font-medium">
              Nome
            </Label>
            <Input
              id="rename-kanban"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              disabled={isPending}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || isPending}
            className="w-full h-11 font-medium rounded-md"
          >
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ Delete kanban button ============

function DeleteKanbanButton({
  name,
  onConfirm,
}: {
  name: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Excluir funil"
          >
            <Trash2 className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Excluir</span>
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir funil</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja excluir &quot;{name}&quot;? Todos os
            negocios e etapas deste funil serao removidos. Esta acao
            nao pode ser desfeita.
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
