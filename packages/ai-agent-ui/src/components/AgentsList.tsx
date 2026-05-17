"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentConfig } from "@persia/shared/ai-agent";
import { getAgentTemplate } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
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
import { AgentStatusBadge } from "./AgentStatusBadge";
import {
  AgentCreationWizard,
  type AgentCreationWizardSubmit,
} from "./AgentCreationWizard";
import { useAgentActions } from "../context";

// STARTER_PROMPT inline foi movido pro shared (`agent-templates.ts`) —
// quando templateSlug = "blank", o backend usa o system_prompt do
// template "blank" que ja contem as regras anti-alucinacao.

interface Props {
  initialAgents: AgentConfig[];
  nativeEnabled: boolean;
}

export function AgentsList({ initialAgents, nativeEnabled }: Props) {
  const { createAgent, deleteAgent, setNativeAgentEnabled } = useAgentActions();
  const [agents, setAgents] = React.useState(initialAgents);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AgentConfig | null>(null);
  const [enabled, setEnabled] = React.useState(nativeEnabled);
  const [isPending, startTransition] = React.useTransition();

  const handleToggleFlag = () => {
    startTransition(async () => {
      try {
        const next = await setNativeAgentEnabled(!enabled);
        setEnabled(next);
        toast.success(
          next ? "Agente nativo ativado para esta organização" : "Agente nativo desativado",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar flag");
      }
    });
  };

  const handleCreate = (input: AgentCreationWizardSubmit) => {
    const tpl = getAgentTemplate(input.templateSlug);
    startTransition(async () => {
      try {
        const created = await createAgent({
          name: input.name,
          description: input.description || tpl.short_description,
          scope_type: "global",
          model: input.model,
          // system_prompt vem do template — "blank" tem prompt base
          // generico com regras anti-alucinacao; outros templates tem
          // contexto adicional.
          system_prompt: tpl.system_prompt,
          template_slug: input.templateSlug,
        });
        setAgents((prev) => [created, ...prev]);
        setCreateOpen(false);
        toast.success(
          tpl.stages.length > 0
            ? `Agente criado com ${tpl.stages.length} etapa${tpl.stages.length === 1 ? "" : "s"} pré-configuradas`
            : "Agente criado",
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Falha ao criar agente",
        );
      }
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      try {
        await deleteAgent(target.id);
        setAgents((prev) => prev.filter((a) => a.id !== target.id));
        setDeleteTarget(null);
        toast.success("Agente removido");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover");
      }
    });
  };

  return (
    <div className="space-y-4">
      {!enabled ? (
        <Card className="border-warning-ring bg-warning-soft/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Agente nativo desativado</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Você pode configurar os agentes agora, mas eles so respondem mensagens quando o recurso e ativado para a organização.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleToggleFlag}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Ativar"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-success-ring bg-success-soft/50">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="size-2 rounded-full bg-success" aria-hidden />
            <p className="text-sm flex-1">
              Agente nativo ativo. Conversas novas seguirao a configuração do agente com status <strong>Ativo</strong>.
            </p>
            <Button size="sm" variant="ghost" onClick={handleToggleFlag} disabled={isPending}>
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Desativar"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Novo agente
        </Button>
      </div>

      {agents.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onDelete={() => setDeleteTarget(agent)}
            />
          ))}
        </div>
      )}

      <AgentCreationWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        isPending={isPending}
        onSubmit={handleCreate}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover agente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o agente, suas etapas, ferramentas e histórico. Conversas ja processadas não sao excluidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="size-14 rounded-2xl bg-gradient-to-br from-progress to-primary flex items-center justify-center">
          <Sparkles className="size-7 text-white" />
        </div>
        <div className="space-y-1 max-w-md">
          <h2 className="font-semibold tracking-tight">Crie seu primeiro agente</h2>
          <p className="text-sm text-muted-foreground">
            Um agente responde conversas do WhatsApp automaticamente, seguindo o prompt e as etapas que você definir. Comece com um perfil simples — você refina depois.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Criar primeiro agente
        </Button>
      </CardContent>
    </Card>
  );
}

function AgentCard({
  agent,
  onDelete,
}: {
  agent: AgentConfig;
  onDelete: () => void;
}) {
  return (
    <Card className="transition-all hover:shadow-sm hover:border-primary/40">
      <CardContent className="p-6 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="size-10 rounded-xl bg-gradient-to-br from-progress to-primary flex items-center justify-center shrink-0">
              <Sparkles className="size-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/automations/agents/${agent.id}`}
                  className="text-base font-semibold tracking-tight hover:underline truncate"
                >
                  {agent.name}
                </Link>
                <AgentStatusBadge status={agent.status} />
              </div>
              {agent.description ? (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {agent.description}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground/60 italic mt-1">
                  Sem descrição
                </p>
              )}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-10"
            onClick={onDelete}
            aria-label={`Remover agente ${agent.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span className="font-mono">{agent.model}</span>
          <Link
            href={`/automations/agents/${agent.id}`}
            className="text-primary hover:underline font-medium"
          >
            Configurar →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
