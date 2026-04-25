"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { AgentActionsProvider, AgentEditor } from "@persia/ai-agent-ui";
import type {
  AgentConfig,
  AgentCostLimit,
  AgentKnowledgeSource,
  AgentNotificationTemplate,
  AgentScheduledJob,
  AgentStage,
  AgentTool,
} from "@persia/shared/ai-agent";
import { ClientSelector } from "@/components/client-selector";
import { NoContextFallback } from "@/components/no-context-fallback";
import { getAgent } from "@/actions/ai-agent/configs";
import { listCostLimits } from "@/actions/ai-agent/limits";
import { listStages } from "@/actions/ai-agent/stages";
import { listToolsForAgent } from "@/actions/ai-agent/tools";
import { listAllowedDomains } from "@/actions/ai-agent/webhook-allowlist";
import { listKnowledgeSources } from "@/actions/ai-agent/knowledge";
import { listNotificationTemplates } from "@/actions/ai-agent/notifications";
import { listScheduledJobs } from "@/actions/ai-agent/scheduled-jobs";
import { createAdminAgentActions } from "@/features/ai-agent/admin-actions";
import { useActiveOrg } from "@/lib/stores/client-store";

interface Props {
  agentId: string;
}

export function AgentEditorClient({ agentId }: Props) {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const actions = React.useMemo(
    () => (activeOrgId ? createAdminAgentActions(activeOrgId) : null),
    [activeOrgId],
  );
  const [agent, setAgent] = React.useState<AgentConfig | null>(null);
  const [stages, setStages] = React.useState<AgentStage[]>([]);
  const [tools, setTools] = React.useState<AgentTool[]>([]);
  const [limits, setLimits] = React.useState<AgentCostLimit[]>([]);
  const [allowedDomains, setAllowedDomains] = React.useState<string[]>([]);
  const [knowledgeSources, setKnowledgeSources] = React.useState<
    AgentKnowledgeSource[]
  >([]);
  const [notificationTemplates, setNotificationTemplates] = React.useState<
    AgentNotificationTemplate[]
  >([]);
  const [scheduledJobs, setScheduledJobs] = React.useState<
    AgentScheduledJob[]
  >([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeOrgId || !isManagingClient) {
        setAgent(null);
        setStages([]);
        setTools([]);
        setLimits([]);
        setAllowedDomains([]);
        setKnowledgeSources([]);
        setNotificationTemplates([]);
        setScheduledJobs([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const nextAgent = await getAgent(activeOrgId, agentId);
        if (!nextAgent) {
          if (!cancelled) {
            setAgent(null);
            setStages([]);
            setTools([]);
            setLimits([]);
            setAllowedDomains([]);
            setKnowledgeSources([]);
            setNotificationTemplates([]);
            setScheduledJobs([]);
          }
          return;
        }

        const [
          nextStages,
          nextTools,
          nextLimits,
          nextAllowedDomains,
          nextKnowledgeSources,
          nextNotificationTemplates,
          nextScheduledJobs,
        ] = await Promise.all([
          listStages(activeOrgId, agentId),
          listToolsForAgent(activeOrgId, agentId),
          listCostLimits(activeOrgId),
          listAllowedDomains(activeOrgId),
          listKnowledgeSources(activeOrgId, agentId),
          listNotificationTemplates(activeOrgId, agentId),
          listScheduledJobs(activeOrgId, agentId),
        ]);

        if (!cancelled) {
          setAgent(nextAgent);
          setStages(nextStages);
          setTools(nextTools);
          setLimits(nextLimits);
          setAllowedDomains(nextAllowedDomains);
          setKnowledgeSources(nextKnowledgeSources);
          setNotificationTemplates(nextNotificationTemplates);
          setScheduledJobs(nextScheduledJobs);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, agentId, isManagingClient]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Editor do Agente</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajuste regras, etapas e ferramentas para a conta em contexto
            {isManagingClient && activeOrgName ? `: ${activeOrgName}` : ""}.
          </p>
        </div>
        <ClientSelector />
      </div>

      {!isManagingClient || !activeOrgId ? (
        <NoContextFallback />
      ) : loading || !actions ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !agent ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="font-medium">Agente não encontrado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Verifique se a conta selecionada é a mesma onde esse agente foi criado.
          </p>
        </div>
      ) : (
        <AgentActionsProvider actions={actions}>
          <AgentEditor
            initialAgent={agent}
            initialStages={stages}
            initialTools={tools}
            initialLimits={limits}
            initialAllowedDomains={allowedDomains}
            initialKnowledgeSources={knowledgeSources}
            initialNotificationTemplates={notificationTemplates}
            initialScheduledJobs={scheduledJobs}
          />
        </AgentActionsProvider>
      )}
    </div>
  );
}
