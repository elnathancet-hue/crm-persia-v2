"use client";

import * as React from "react";
import { Globe, Loader2, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentStage, AgentTool, NativeToolPreset } from "@persia/shared/ai-agent";
import { getPreset } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Switch } from "@persia/ui/switch";
import { Badge } from "@persia/ui/badge";
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
import { useAgentActions } from "../context";
import { renderToolIcon } from "../icon-map";
import { DecisionIntelligenceModal } from "./DecisionIntelligenceModal";
import { CustomWebhookToolSheet } from "./CustomWebhookToolSheet";
import { WebhookAllowlistSettings } from "./WebhookAllowlistSettings";

interface Props {
  configId: string;
  tools: AgentTool[];
  stages: AgentStage[];
  allowedDomains: string[];
  onChange: (next: AgentTool[]) => void;
}

export function ToolsTab({
  configId,
  tools,
  stages,
  allowedDomains: initialAllowedDomains,
  onChange,
}: Props) {
  const { deleteTool, updateTool } = useAgentActions();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [webhookOpen, setWebhookOpen] = React.useState(false);
  const [allowedDomains, setAllowedDomains] = React.useState(initialAllowedDomains);
  const [deleteTarget, setDeleteTarget] = React.useState<AgentTool | null>(null);
  const [pendingToolId, setPendingToolId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const hasAllowlist = allowedDomains.length > 0;

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Cada ferramenta vira uma decisão que o agente pode tomar. Controle por etapa em{" "}
          <strong>Etapas</strong> (Ferramentas permitidas).
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              if (!hasAllowlist) {
                toast.info(
                  "Cadastre primeiro um domínio na Allowlist abaixo (n8n.suaempresa.com.br, por exemplo) antes de criar webhook customizado.",
                );
                return;
              }
              setWebhookOpen(true);
            }}
            className={!hasAllowlist ? "opacity-60" : undefined}
            title={
              hasAllowlist
                ? "Adicionar webhook customizado"
                : "Cadastre um domínio na allowlist abaixo antes"
            }
          >
            <Globe className="size-4" />
            Webhook customizado
          </Button>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Adicionar Decisão Inteligente
          </Button>
        </div>
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

      <WebhookAllowlistSettings
        initialDomains={initialAllowedDomains}
        onChange={setAllowedDomains}
      />

      <DecisionIntelligenceModal
        configId={configId}
        existingTools={tools}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreated={(created) => onChange([...tools, created])}
      />
      <CustomWebhookToolSheet
        configId={configId}
        allowedDomains={allowedDomains}
        open={webhookOpen}
        onOpenChange={setWebhookOpen}
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
              O agente perde acesso a essa decisão em todas as etapas. As permissões por etapa também sao removidas.
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

function extractHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
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
  const isWebhook = tool.execution_mode === "n8n_webhook";
  const host = isWebhook ? extractHost(tool.webhook_url) : null;

  return (
    <Card className={isWebhook ? "border-progress/30" : undefined}>
      <CardContent className="p-4 flex items-start gap-3">
        <div
          className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
            isWebhook
              ? "bg-gradient-to-br from-progress to-primary text-progress-foreground"
              : "bg-primary/10 text-primary"
          }`}
        >
          {isWebhook ? (
            <Globe className="size-5" />
          ) : (
            renderToolIcon(preset?.icon_name ?? "HelpCircle", { className: "size-5" })
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">
              {preset?.display_name ?? tool.name}
            </p>
            {isWebhook ? (
              <Badge variant="outline" className="text-[10px] border-progress/40 text-progress">
                Webhook
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {preset?.ui_description ?? tool.description}
          </p>
          {host ? (
            <p className="text-[11px] text-muted-foreground/70 font-mono pt-0.5 truncate">
              {host}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/70 pt-1">
              Habilite em Etapas para o agente usar ({stagesTotal} etapa{stagesTotal === 1 ? "" : "s"})
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1.5 mr-1">
            {pending ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <Power
                className={`size-3 ${
                  tool.is_enabled ? "text-success" : "text-muted-foreground/50"
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
          <h3 className="font-semibold tracking-tight">Dê superpoderes ao agente</h3>
          <p className="text-sm text-muted-foreground">
            Decisões inteligentes deixam o agente transferir conversa, aplicar tags, encerrar atendimento e mais — sem precisar de webhook externo.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Adicionar primeira decisão
        </Button>
      </CardContent>
    </Card>
  );
}
