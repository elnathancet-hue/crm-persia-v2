"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Loader2,
  MoreHorizontal,
  Plus,
  PowerOff,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
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
  const { createAgent, deleteAgent, setNativeAgentEnabled, setPrimaryAgent } = useAgentActions();
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
          // PR-FLOW-PIVOT (mai/2026): único valor aceito é 'flow' (canvas
          // visual via @xyflow/react). Substitui modelos legados
          // stages/actions.
          behavior_mode: "flow",
        });
        setAgents((prev) => [created, ...prev]);
        setCreateOpen(false);
        toast.success(
          input.templateSlug === "blank"
            ? "Agente criado"
            : "Agente criado com flow pré-configurado",
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Falha ao criar agente",
        );
      }
    });
  };

  // PR-AGENT-INTEGRATION-3: define este agente como principal. Server
  // atomicamente: zera is_primary=true em outros agentes da org +
  // marca este. Local state atualizado pra refletir imediatamente.
  const handleSetPrimary = (configId: string) => {
    startTransition(async () => {
      try {
        const updated = await setPrimaryAgent(configId);
        setAgents((prev) =>
          prev.map((a) =>
            a.id === updated.id
              ? updated
              : a.is_primary
                ? { ...a, is_primary: false }
                : a,
          ),
        );
        toast.success(`"${updated.name}" agora é o agente principal`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao definir principal");
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

  // PR 17 UX (mai/2026): banner inteligente com 5 estados reais (em vez
  // de só verde/vermelho baseado em nativeEnabled). Cliente vê de cara
  // se o agente realmente está respondendo conversas.
  const activeAgents = agents.filter((a) => a.status === "active");
  const primaryActiveAgent = activeAgents.find((a) => a.is_primary);
  const statusBanner = computeStatusBanner({
    enabled,
    agentsCount: agents.length,
    activeCount: activeAgents.length,
    hasPrimary: Boolean(primaryActiveAgent),
  });

  return (
    <div className="space-y-4">
      <Card className={statusBanner.containerClass}>
        <CardContent className="p-4 flex items-start gap-3">
          <statusBanner.Icon className={`size-5 shrink-0 mt-0.5 ${statusBanner.iconClass}`} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{statusBanner.title}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {statusBanner.description}
            </p>
          </div>
          {statusBanner.showToggle ? (
            <Button
              size="sm"
              variant={enabled ? "ghost" : "outline"}
              onClick={handleToggleFlag}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : enabled ? (
                "Desativar"
              ) : (
                "Ativar"
              )}
            </Button>
          ) : null}
        </CardContent>
      </Card>

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
              onSetPrimary={() => handleSetPrimary(agent.id)}
              isPending={isPending}
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
              Esta ação remove o agente, suas etapas, ferramentas e histórico. Conversas já processadas não são excluídas.
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

// PR 17 UX (mai/2026): banner inteligente. 5 estados em vez de só
// verde/vermelho. Verde só quando REALMENTE pronto (enabled + agent
// ativo + principal). Amarelo pra pendências. Cinza pra desativado
// ou sem agentes.
interface StatusBanner {
  title: string;
  description: string;
  Icon: LucideIcon;
  iconClass: string;
  containerClass: string;
  showToggle: boolean;
}

function computeStatusBanner(params: {
  enabled: boolean;
  agentsCount: number;
  activeCount: number;
  hasPrimary: boolean;
}): StatusBanner {
  const { enabled, agentsCount, activeCount, hasPrimary } = params;

  // 1. Recurso desligado pela org
  if (!enabled) {
    return {
      title: "Agente IA desativado",
      description:
        "Você pode configurar agentes agora, mas eles só respondem mensagens quando o recurso é ativado pra organização.",
      Icon: PowerOff,
      iconClass: "text-muted-foreground",
      containerClass: "border-border bg-muted/30",
      showToggle: true,
    };
  }

  // 2. Ativo mas sem agentes
  if (agentsCount === 0) {
    return {
      title: "Pronto pra criar seu primeiro agente",
      description:
        "Recurso ativo na organização. Falta criar um agente — ele só responde leads quando estiver ativo + marcado como principal.",
      Icon: Sparkles,
      iconClass: "text-muted-foreground",
      containerClass: "border-border bg-card",
      showToggle: true,
    };
  }

  // 3. Tem agente(s) mas nenhum ativo
  if (activeCount === 0) {
    return {
      title: "Nenhum agente ativo",
      description:
        "Você tem agentes em rascunho. Ative um deles + defina como principal pra começar a responder conversas.",
      Icon: AlertTriangle,
      iconClass: "text-warning",
      containerClass: "border-warning-ring bg-warning-soft/50",
      showToggle: true,
    };
  }

  // 4. Tem ativo mas nenhum principal
  if (!hasPrimary) {
    return {
      title: "Defina o agente principal",
      description:
        "Você tem agente ativo, mas ainda não escolheu o principal — sem isso ninguém atende novas conversas. Clique em \"Definir como principal\" no card abaixo.",
      Icon: AlertTriangle,
      iconClass: "text-warning",
      containerClass: "border-warning-ring bg-warning-soft/50",
      showToggle: true,
    };
  }

  // 5. Tudo pronto
  return {
    title: "Agente respondendo conversas",
    description:
      "Agente principal ativo. Novas conversas são atendidas automaticamente. Pause ou troque o principal pelos cards abaixo.",
    Icon: CheckCircle2,
    iconClass: "text-success",
    containerClass: "border-success-ring bg-success-soft/50",
    showToggle: true,
  };
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="size-14 rounded-2xl bg-gradient-to-br from-progress to-primary flex items-center justify-center">
          <Sparkles className="size-7 text-white" />
        </div>
        <div className="space-y-1 max-w-md">
          <h2 className="font-semibold tracking-tight">
            Crie um agente para responder o WhatsApp
          </h2>
          <p className="text-sm text-muted-foreground">
            Um agente conversa com seus leads no WhatsApp automaticamente.
            Você pode revisar o fluxo, testar e ativar antes de publicar — o
            agente só atende leads reais quando estiver pronto.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="size-4" />
          Criar agente
        </Button>
      </CardContent>
    </Card>
  );
}

function AgentCard({
  agent,
  onDelete,
  onSetPrimary,
  isPending,
}: {
  agent: AgentConfig;
  onDelete: () => void;
  onSetPrimary: () => void;
  isPending: boolean;
}) {
  const isPrimary = Boolean(agent.is_primary);
  return (
    <Card
      className={`transition-all hover:shadow-sm ${
        isPrimary ? "border-primary/60 shadow-sm" : "hover:border-primary/40"
      }`}
    >
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
                {isPrimary ? (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider"
                    title="Agente principal — recebe a primeira mensagem do lead"
                  >
                    <Crown className="size-3" />
                    Principal
                  </span>
                ) : null}
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
          {/* PR 38 (mai/2026): lixeira solta virou DropdownMenu com 3
              opções (Configurar / Definir como principal quando
              aplicável / Excluir destrutivo). Reduz risco de click
              acidental no delete + agrupa ações secundárias num
              único affordance. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center size-9 shrink-0 rounded-md text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={`Ações do agente ${agent.name}`}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => {
                  // base-ui não suporta asChild — navego via router.
                  window.location.href = `/automations/agents/${agent.id}`;
                }}
              >
                <Settings className="size-3.5" />
                Configurar
              </DropdownMenuItem>
              {!isPrimary && agent.status === "active" ? (
                <DropdownMenuItem
                  onClick={onSetPrimary}
                  disabled={isPending}
                >
                  <Crown className="size-3.5" />
                  Definir como principal
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Excluir agente
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* PR 17 UX (mai/2026): CTAs explícitos em botões. Estado
            operacional > detalhe técnico. "Definir como principal"
            sai do meio escondido pra Button visível. Modelo IA fica
            em font-mono pequena bem discreta.
            PR 38 (mai/2026): "Definir como principal" + "Excluir"
            saíram do bottom pra dentro do DropdownMenu acima.
            Bottom agora foca em CTA primário "Configurar" + modelo. */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <Link
            href={`/automations/agents/${agent.id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors h-8 px-3 text-xs font-medium"
          >
            <Settings className="size-3.5" />
            Configurar
          </Link>
          <span
            className="font-mono text-[10px] text-muted-foreground/70"
            title="Modelo de IA usado"
          >
            {agent.model}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
