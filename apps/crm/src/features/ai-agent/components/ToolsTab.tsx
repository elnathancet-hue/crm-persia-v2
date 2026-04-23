"use client";

import * as React from "react";
import { Loader2, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentStage, AgentTool, NativeToolPreset } from "@persia/shared/ai-agent";
import { getPreset } from "@persia/shared/ai-agent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteTool, updateTool } from "@/actions/ai-agent/tools";
import { renderToolIcon } from "@/features/ai-agent/icon-map";
import { DecisionIntelligenceModal } from "./DecisionIntelligenceModal";

interface Props {
  configId: string;
  tools: AgentTool[];
  stages: AgentStage[];
  onChange: (next: AgentTool[]) => void;
}

export function ToolsTab({ configId, tools, stages, onChange }: Props) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AgentTool | null>(null);
  const [pendingToolId, setPendingToolId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const handleToggle = (tool: AgentTool, nextEnabled: boolean) => {
    setPendingToolId(tool.id);
    startTransition(async () => {
      try {
        const updated = await updateTool(tool.id, { is_enabled: nextEnabled });
        onChange(tools.map((t) => (t.id === tool.id ? updated : t)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar ferramenta");
      } finally {
        setPendingToolId(null);
      }
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setPendingToolId(target.id);
    startTransition(async () => {
      try {
        await deleteTool(target.id);
        onChange(tools.filter((t) => t.id !== target.id));
        setDeleteTarget(null);
        toast.success("Ferramenta removida");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      } finally {
        setPendingToolId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Cada ferramenta vira uma decisao que o agente pode tomar. Controle por etapa em{" "}
          <strong>Etapas</strong> (Ferramentas permitidas).
        </p>
        <Button onClick={() => setModalOpen(true)} className="shrink-0">
          <Plus className="size-4" />
          Adicionar Decisao Inteligente
        </Button>
      </div>

      {tools.length === 0 ? (
        <EmptyTools onCreate={() => setModalOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              stagesTotal={stages.length}
              pending={pendingToolId === tool.id}
              onToggle={(enabled) => handleToggle(tool, enabled)}
              onDelete={() => setDeleteTarget(tool)}
            />
          ))}
        </div>
      )}

      <DecisionIntelligenceModal
        configId={configId}
        existingTools={tools}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(created) => onChange([...tools, created])}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover ferramenta?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente perde acesso a essa decisao em todas as etapas. As permissoes por etapa tambem sao removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolCard({
  tool,
  stagesTotal,
  pending,
  onToggle,
  onDelete,
}: {
  tool: AgentTool;
  stagesTotal: number;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const preset: NativeToolPreset | undefined = tool.native_handler
    ? getPreset(tool.native_handler)
    : undefined;

  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {renderToolIcon(preset?.icon_name ?? "HelpCircle", { className: "size-5" })}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">
              {preset?.display_name ?? tool.name}
            </p>
            {tool.execution_mode === "n8n_webhook" ? (
              <Badge variant="outline" className="text-[10px]">
                Webhook
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {preset?.ui_description ?? tool.description}
          </p>
          <p className="text-[11px] text-muted-foreground/70 pt-1">
            Habilite em Etapas para o agente usar ({stagesTotal} etapa{stagesTotal === 1 ? "" : "s"})
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1.5 mr-1">
            {pending ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <Power
                className={`size-3 ${
                  tool.is_enabled ? "text-emerald-600" : "text-muted-foreground/50"
                }`}
              />
            )}
            <Switch
              checked={tool.is_enabled}
              onCheckedChange={(v) => onToggle(Boolean(v))}
              aria-label={`Ativar ferramenta ${preset?.display_name ?? tool.name}`}
              disabled={pending}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Remover ferramenta ${preset?.display_name ?? tool.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTools({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="size-14 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Plus className="size-7 text-white" />
        </div>
        <div className="space-y-1 max-w-md">
          <h3 className="font-semibold">Nenhuma ferramenta adicionada</h3>
          <p className="text-sm text-muted-foreground">
            Decisoes inteligentes deixam o agente transferir conversa, aplicar tags, encerrar atendimento e mais — sem precisar de webhook externo.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Adicionar primeira decisao
        </Button>
      </CardContent>
    </Card>
  );
}
