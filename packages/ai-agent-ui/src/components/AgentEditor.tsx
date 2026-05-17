"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Bot,
  Calendar,
  Clock,
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
  AgentFollowup,
  AgentKnowledgeSource,
  AgentNotificationTemplate,
  AgentScheduledJob,
  AgentStage,
  AgentStatus,
  AgentTool,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { PageTitle } from "@persia/ui/typography";
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
import { FollowupTab } from "./FollowupTab";
import { PlaceholderTab } from "./PlaceholderTab";
import { TesterSheet } from "./TesterSheet";
import type { AgentActions } from "../actions";
import { useAgentActions } from "../context";

// PR-AI-AGENT-VISUAL (mai/2026): tabs custom underline (espelho de
// CrmTabs/AgendaTabs). Lista centralizada pra render iterativo evitar
// duplicacao + facilitar adicao/remocao no futuro.
type AgentTabId =
  | "rules"
  | "stages"
  | "faq"
  | "docs"
  | "tools"
  | "notifications"
  | "calendar"
  | "followups"
  | "limits"
  | "audit";

interface AgentTabDef {
  id: AgentTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const AGENT_TABS: AgentTabDef[] = [
  { id: "rules", label: "Regras", icon: Settings2 },
  { id: "stages", label: "Etapas", icon: ListOrdered },
  { id: "faq", label: "FAQ", icon: HelpCircle },
  { id: "docs", label: "Documentos", icon: Library },
  { id: "tools", label: "Ferramentas", icon: Wrench },
  { id: "notifications", label: "Notificações", icon: Bell },
  { id: "calendar", label: "Agendamento", icon: Calendar },
  { id: "followups", label: "Follow-up", icon: Clock },
  { id: "limits", label: "Limites e Uso", icon: Gauge },
  { id: "audit", label: "Execuções", icon: History },
];

interface Props {
  initialAgent: AgentConfig;
  initialStages: AgentStage[];
  initialTools: AgentTool[];
  initialLimits: AgentCostLimit[];
  initialAllowedDomains: string[];
  initialKnowledgeSources?: AgentKnowledgeSource[];
  initialNotificationTemplates?: AgentNotificationTemplate[];
  initialScheduledJobs?: AgentScheduledJob[];
  initialFollowups?: AgentFollowup[];
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
  initialFollowups = [],
}: Props) {
  const {
    updateAgent,
    listKnowledgeSources,
    listNotificationTemplates,
    listScheduledJobs,
    listFollowups,
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
  const [followups, setFollowups] = React.useState<AgentFollowup[]>(initialFollowups);
  const [testerOpen, setTesterOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [nameDraft, setNameDraft] = React.useState(agent.name);
  // PR-AI-AGENT-VISUAL (mai/2026): tab state controlado pra usar pattern
  // custom underline (espelho de CrmTabs/AgendaTabs). Antes usava
  // <Tabs defaultValue> shadcn (uncontrolled, pill style).
  const [activeTab, setActiveTab] = React.useState<AgentTabId>("rules");

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

  const refreshFollowups = React.useCallback(async () => {
    try {
      const next = await listFollowups(agent.id);
      setFollowups(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar follow-ups");
    }
  }, [agent.id, listFollowups]);

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
    if (initialFollowups.length === 0) {
      void refreshFollowups();
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
      {/* Header sticky com icone grande + nome + acoes. Paridade visual
          com /crm (CrmShell) e /agenda (AgendaPageHeader, PR #217).
          Linha 1: breadcrumb "Voltar". Linha 2: icone + nome + actions.
          Linha 3: tabs underline custom (mesmo pattern). */}
      <div className="sticky -top-6 z-30 -mx-6 -mt-6 px-6 pt-6 pb-3 bg-background/95 backdrop-blur-sm border-b border-border/60 space-y-4">
        <Link
          href="/automations/agents"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar pra lista de agentes
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20">
              <Bot className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={handleNameBlur}
                  className="text-xl font-semibold tracking-tight border-transparent hover:border-input focus:border-input bg-transparent shadow-none px-2 max-w-sm h-auto py-0.5"
                  aria-label="Nome do agente"
                />
                <AgentStatusBadge status={agent.status} />
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure regras, etapas, ferramentas e teste o agente
                antes de ativar.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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

        {/* Tabs custom underline — espelho byte-by-byte de CrmTabs /
            AgendaTabs. Antes usava shadcn <Tabs> pill style — driftava
            do resto do produto. */}
        <div className="flex gap-0.5 border-b border-border overflow-x-auto -mb-3">
          {AGENT_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={isActive}
                className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-3 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isActive
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className={`size-4 ${isActive ? "text-primary" : ""}`} />
                <span>{tab.label}</span>
                {isActive && (
                  <span
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-t-full bg-primary"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conteudo da tab ativa — render condicional (sem TabsContent do
          shadcn). Mesmo pattern do CrmShell e AgendaPageClient. */}
      {activeTab === "rules" && (
        <RulesTab agent={agent} onChange={persistAgent} isPending={isPending} />
      )}
      {activeTab === "stages" && (
        <StagesTab
          configId={agent.id}
          stages={stages}
          tools={tools}
          onChange={setStages}
        />
      )}
      {activeTab === "faq" && (
        <FAQTab
          configId={agent.id}
          sources={knowledgeSources}
          onChange={setKnowledgeSources}
          onRefresh={refreshKnowledgeSources}
        />
      )}
      {activeTab === "docs" && (
        <DocumentsTab
          configId={agent.id}
          sources={knowledgeSources}
          onChange={setKnowledgeSources}
          onRefresh={refreshKnowledgeSources}
        />
      )}
      {activeTab === "tools" && (
        <ToolsTab
          configId={agent.id}
          tools={tools}
          stages={stages}
          allowedDomains={initialAllowedDomains}
          onChange={setTools}
        />
      )}
      {activeTab === "notifications" && (
        <NotificationsTab
          configId={agent.id}
          templates={notificationTemplates}
          onChange={setNotificationTemplates}
          onRefresh={refreshNotificationTemplates}
        />
      )}
      {activeTab === "calendar" && (
        <SchedulingTab
          configId={agent.id}
          jobs={scheduledJobs}
          templates={notificationTemplates}
          onChange={setScheduledJobs}
          onRefresh={refreshScheduledJobs}
        />
      )}
      {activeTab === "followups" && (
        <FollowupTab
          configId={agent.id}
          followups={followups}
          templates={notificationTemplates}
          onChange={setFollowups}
        />
      )}
      {activeTab === "limits" && (
        <LimitsUsageTab configId={agent.id} initialLimits={initialLimits} />
      )}
      {activeTab === "audit" && <AuditTab configId={agent.id} />}

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
