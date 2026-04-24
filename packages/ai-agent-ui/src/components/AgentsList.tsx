"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { AgentConfig } from "@persia/shared/ai-agent";
import { DEFAULT_MODEL } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { useAgentActions } from "../context";

const STARTER_PROMPT = `Você é um atendente virtual profissional e cordial.
- Apresente-se de forma breve.
- Entenda o que o cliente precisa antes de responder.
- Use linguagem objetiva, com no máximo 3 frases por mensagem.
- Peça transferência para um humano se não souber responder.`;

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

  const handleCreate = async (formData: FormData) => {
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const model = String(formData.get("model") || DEFAULT_MODEL);
    if (!name) {
      toast.error("Nome e obrigatório");
      return;
    }
    startTransition(async () => {
      try {
        const created = await createAgent({
          name,
          description: description || undefined,
          scope_type: "global",
          model,
          system_prompt: STARTER_PROMPT,
        });
        setAgents((prev) => [created, ...prev]);
        setCreateOpen(false);
        toast.success("Agente criado");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao criar agente");
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
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
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
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="size-2 rounded-full bg-emerald-500" aria-hidden />
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo agente</DialogTitle>
            <DialogDescription>
              Você podera refinar prompt e etapas depois. Ele começa como rascunho.
            </DialogDescription>
          </DialogHeader>
          <form
            action={handleCreate}
            className="space-y-4"
            id="create-agent-form"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" placeholder="Ex: Recepção" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Qual o papel desse agente?"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Select name="model" defaultValue={DEFAULT_MODEL}>
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (recomendado)</SelectItem>
                  <SelectItem value="claude-opus-4-7">Claude Opus 4.7 (mais caro, melhor raciocínio)</SelectItem>
                  <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (mais rápido e barato)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="create-agent-form" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <div className="size-14 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sparkles className="size-7 text-white" />
        </div>
        <div className="space-y-1 max-w-md">
          <h2 className="font-semibold">Nenhum agente configurado</h2>
          <p className="text-sm text-muted-foreground">
            Crie seu primeiro agente IA nativo pra responder conversas no WhatsApp diretamente pelo sistema, sem precisar de webhooks externos.
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
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="size-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
              <Sparkles className="size-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/automations/agents/${agent.id}`}
                  className="font-medium hover:underline truncate"
                >
                  {agent.name}
                </Link>
                <AgentStatusBadge status={agent.status} />
              </div>
              {agent.description ? (
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                  {agent.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground/60 italic mt-0.5">
                  Sem descrição
                </p>
              )}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
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
