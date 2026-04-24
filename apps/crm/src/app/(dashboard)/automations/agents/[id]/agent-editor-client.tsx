"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Calendar,
  FileText,
  FlaskConical,
  Gauge,
  HelpCircle,
  History,
  Library,
  ListOrdered,
  Loader2,
  Settings2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentConfig,
  AgentCostLimit,
  AgentStage,
  AgentStatus,
  AgentTool,
} from "@persia/shared/ai-agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentStatusBadge } from "@/features/ai-agent/components/AgentStatusBadge";
import { RulesTab } from "@/features/ai-agent/components/RulesTab";
import { StagesTab } from "@/features/ai-agent/components/StagesTab";
import { ToolsTab } from "@/features/ai-agent/components/ToolsTab";
import { AuditTab } from "@/features/ai-agent/components/AuditTab";
import { LimitsUsageTab } from "@/features/ai-agent/components/LimitsUsageTab";
import { PlaceholderTab } from "@/features/ai-agent/components/PlaceholderTab";
import { TesterSheet } from "@/features/ai-agent/components/TesterSheet";
import { updateAgent } from "@/actions/ai-agent/configs";

interface Props {
  initialAgent: AgentConfig;
  initialStages: AgentStage[];
  initialTools: AgentTool[];
  initialLimits: AgentCostLimit[];
  initialAllowedDomains: string[];
}

export function AgentEditorClient({
  initialAgent,
  initialStages,
  initialTools,
  initialLimits,
  initialAllowedDomains,
}: Props) {
  const [agent, setAgent] = React.useState(initialAgent);
  const [stages, setStages] = React.useState(initialStages);
  const [tools, setTools] = React.useState(initialTools);
  const [testerOpen, setTesterOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [nameDraft, setNameDraft] = React.useState(agent.name);

  const persistAgent = React.useCallback(
    (patch: Parameters<typeof updateAgent>[1], successMsg?: string) => {
      startTransition(async () => {
        try {
          const updated = await updateAgent(agent.id, patch);
          setAgent(updated);
          if (successMsg) toast.success(successMsg);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Falha ao salvar");
        }
      });
    },
    [agent.id],
  );

  const handleNameBlur = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(agent.name);
      return;
    }
    if (trimmed === agent.name) return;
    persistAgent({ name: trimmed }, "Nome atualizado");
  };

  const handleStatusChange = (status: AgentStatus) => {
    persistAgent({ status }, `Status: ${statusLabel(status)}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Link
            href="/automations/agents"
            aria-label="Voltar"
            className="inline-flex items-center justify-center size-8 rounded-md hover:bg-accent text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={handleNameBlur}
              className="text-xl font-semibold tracking-tight border-transparent hover:border-input focus:border-input bg-transparent shadow-none px-2 max-w-sm"
              aria-label="Nome do agente"
            />
            <AgentStatusBadge status={agent.status} />
            {isPending ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={agent.status}
            onValueChange={(v) => v && handleStatusChange(v as AgentStatus)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Rascunho</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="paused">Pausado</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setTesterOpen(true)}>
            <FlaskConical className="size-4" />
            Testar agente
          </Button>
        </div>
      </div>

      <Tabs defaultValue="rules" className="gap-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="rules" className="gap-2">
            <Settings2 className="size-4" />
            Regras
          </TabsTrigger>
          <TabsTrigger value="stages" className="gap-2">
            <ListOrdered className="size-4" />
            Etapas
          </TabsTrigger>
          <TabsTrigger value="faq" className="gap-2">
            <HelpCircle className="size-4" />
            FAQ
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-2">
            <Library className="size-4" />
            Documentos
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-2">
            <Wrench className="size-4" />
            Ferramentas
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="size-4" />
            Notificacoes
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2">
            <Calendar className="size-4" />
            Agendamento
          </TabsTrigger>
          <TabsTrigger value="limits" className="gap-2">
            <Gauge className="size-4" />
            Limites e Uso
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <History className="size-4" />
            Execucoes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <RulesTab agent={agent} onChange={persistAgent} isPending={isPending} />
        </TabsContent>
        <TabsContent value="stages">
          <StagesTab
            configId={agent.id}
            stages={stages}
            tools={tools}
            onChange={setStages}
          />
        </TabsContent>
        <TabsContent value="faq">
          <PlaceholderTab
            icon={HelpCircle}
            title="FAQ — Perguntas frequentes"
            description="Adicione perguntas e respostas que o agente sempre precisa saber. Sera indexado em base vetorial quando a Fase RAG (PR6) chegar."
            phase="PR6"
          />
        </TabsContent>
        <TabsContent value="docs">
          <PlaceholderTab
            icon={FileText}
            title="Documentos da base de conhecimento"
            description="Upload de PDFs, DOCX e TXT para alimentar o contexto do agente. Indexacao automatica em chunks com embedding."
            phase="PR6"
          />
        </TabsContent>
        <TabsContent value="tools">
          <ToolsTab
            configId={agent.id}
            tools={tools}
            stages={stages}
            allowedDomains={initialAllowedDomains}
            onChange={setTools}
          />
        </TabsContent>
        <TabsContent value="notifications">
          <PlaceholderTab
            icon={Bell}
            title="Notificacoes automaticas"
            description="Templates WhatsApp enviados quando o agente toma decisoes (ex: lead qualificado)."
            phase="PR7"
          />
        </TabsContent>
        <TabsContent value="calendar">
          <PlaceholderTab
            icon={Calendar}
            title="Agendamento integrado"
            description="Conecte Google Calendar e permita que o agente marque reunioes direto na conversa."
            phase="PR7"
          />
        </TabsContent>
        <TabsContent value="limits">
          <LimitsUsageTab configId={agent.id} initialLimits={initialLimits} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab configId={agent.id} />
        </TabsContent>
      </Tabs>

      <TesterSheet
        configId={agent.id}
        stages={stages}
        open={testerOpen}
        onOpenChange={setTesterOpen}
      />
    </div>
  );
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "active":
      return "Ativo";
    case "draft":
      return "Rascunho";
    case "paused":
      return "Pausado";
  }
}
