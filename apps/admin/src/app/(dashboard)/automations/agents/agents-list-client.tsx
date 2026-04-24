"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { AgentActionsProvider, AgentsList } from "@persia/ai-agent-ui";
import type { AgentConfig } from "@persia/shared/ai-agent";
import { ClientSelector } from "@/components/client-selector";
import { NoContextFallback } from "@/components/no-context-fallback";
import { isNativeAgentEnabled } from "@/actions/ai-agent/feature-flag";
import { listAgents } from "@/actions/ai-agent/configs";
import { createAdminAgentActions } from "@/features/ai-agent/admin-actions";
import { useActiveOrg } from "@/lib/stores/client-store";

export function AgentsListClient() {
  const { activeOrgId, activeOrgName, isManagingClient } = useActiveOrg();
  const actions = React.useMemo(
    () => (activeOrgId ? createAdminAgentActions(activeOrgId) : null),
    [activeOrgId],
  );
  const [agents, setAgents] = React.useState<AgentConfig[]>([]);
  const [nativeEnabled, setNativeEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeOrgId || !isManagingClient) {
        setAgents([]);
        setNativeEnabled(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [nextAgents, enabled] = await Promise.all([
          listAgents(activeOrgId),
          isNativeAgentEnabled(activeOrgId),
        ]);

        if (!cancelled) {
          setAgents(nextAgents);
          setNativeEnabled(enabled);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, isManagingClient]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Agente IA Nativo</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie os agentes da conta selecionada no painel administrativo
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
      ) : (
        <AgentActionsProvider actions={actions}>
          <AgentsList initialAgents={agents} nativeEnabled={nativeEnabled} />
        </AgentActionsProvider>
      )}
    </div>
  );
}
