"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Calendar,
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
  AgentKnowledgeSource,
  AgentNotificationTemplate,
  AgentScheduledJob,
  AgentStage,
  AgentStatus,
  AgentTool,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@persia/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { RulesTab } from "./RulesTab";
import { StagesTab } from "./StagesTab";
import { ToolsTab } from "./ToolsTab";
import { AuditTab } from "./AuditTab";
import { LimitsUsageTab } from "./LimitsUsageTab";
import { FAQTab } from "./FAQTab";
import { DocumentsTab } from "./DocumentsTab";
import { NotificationsTab } from "./NotificationsTab";
import { SchedulingTab } from "./SchedulingTab";
import { PlaceholderTab } from "./PlaceholderTab";
import { TesterSheet } from "./TesterSheet";
import type { AgentActions } from "../actions";
import { useAgentActions } from "../context";

interface Props {
  initialAgent: AgentConfig;
  initialStages: AgentStage[];
  initialTools: AgentTool[];
  initialLimits: AgentCostLimit[];
  initialAllowedDomains: string[];
  initialKnowledgeSources?: AgentKnowledgeSource[];
  initialNotificationTemplates?: AgentNotificationTemplate[];
  initialScheduledJobs?: AgentScheduledJob[];
}

export function AgentEditor({
  initialAgent,
  initialStages,
  initialTools,
  initialLimits,
  initialAllowedDomains,
  initialKnowledgeSources = [],
  initialNotificationTemplates = [],
  initialScheduledJobs = [],
}: Props) {
  const {
    updateAgent,
    listKnowledgeSources,
    listNotificationTemplates,
    listScheduledJobs,
  } = useAgentActions();
  const [agent, setAgent] = React.useState(initialAgent);
  const [stages, setStages] = React.useState(initialStages);
  const [tools, setTools] = React.useState(initialTools);
  const [knowledgeSources, setKnowledgeSources] = React.useState<
    AgentKnowledgeSource[]
  >(initialKnowledgeSources);
  const [notificationTemplates, setNotificationTemplates] = React.useState<
    AgentNotificationTemplate[]
  >(initialNotificationTemplates);
  const [scheduledJobs, setScheduledJobs] = React.useState<
    AgentScheduledJob[]
  >(initialScheduledJobs);
  const [testerOpen, setTesterOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [nameDraft, setNameDraft] = React.useState(agent.name);

  const refreshKnowledgeSources = React.useCallback(async () => {
    try {
      const next = await listKnowledgeSources(agent.id);
      setKnowledgeSources(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar base de conhecimento");
    }
  }, [agent.id, listKnowledgeSources]);

  const refreshNotificationTemplates = React.useCallback(async () => {
    try {
      const next = await listNotificationTemplates(agent.id);
      setNotificationTemplates(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar notificações");
    }
  }, [agent.id, listNotificationTemplates]);

  const refreshScheduledJobs = React.useCallback(async () => {
    try {
      const next = await listScheduledJobs(agent.id);
      setScheduledJobs(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar agendamentos");
    }
  }, [agent.id, listScheduledJobs]);

  // Lazy first-fetch when no SSR-provided sources were passed in.
  React.useEffect(() => {
    if (initialKnowledgeSources.length === 0) {
      void refreshKnowledgeSources();
    }
    if (initialNotificationTemplates.length === 0) {
      void refreshNotificationTemplates();
    }
    if (initialScheduledJobs.length === 0) {
      void refreshScheduledJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-load tools when notification templates change — tool sync acontece
  // server-side, mas a aba Ferramentas precisa enxergar os tools novos.
  React.useEffect(() => {
    // skip on first render (initialTools já vem do SSR)
    if (notificationTemplates === initialNotificationTemplates) return;
    // simplificação: nao recarrega tools via fetch — deixamos o usuário
    // dar refresh na aba Ferramentas se quiser ver. O backend é fonte
    // da verdade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationTemplates]);

  const persistAgent = React.useCallback(
    (patch: Parameters<AgentActions["updateAgent"]>[1], successMsg?: string) => {
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
    [agent.id, updateAgent],
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
              <SelectValue>{statusLabel(agent.status)}</SelectValue>
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
            Notificações
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
            Execuções
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
          <FAQTab
            configId={agent.id}
            sources={knowledgeSources}
            onChange={setKnowledgeSources}
            onRefresh={refreshKnowledgeSources}
          />
        </TabsContent>
        <TabsContent value="docs">
          <DocumentsTab
            configId={agent.id}
            sources={knowledgeSources}
            onChange={setKnowledgeSources}
            onRefresh={refreshKnowledgeSources}
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
          <NotificationsTab
            configId={agent.id}
            templates={notificationTemplates}
            onChange={setNotificationTemplates}
            onRefresh={refreshNotificationTemplates}
          />
        </TabsContent>
        <TabsContent value="calendar">
          <SchedulingTab
            configId={agent.id}
            jobs={scheduledJobs}
            templates={notificationTemplates}
            onChange={setScheduledJobs}
            onRefresh={refreshScheduledJobs}
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
