"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Clock,
  FlaskConical,
  HelpCircle,
  History,
  Library,
  ListOrdered,
  Loader2,
  Menu,
  Settings2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentConfig,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import { AgentSidebar, type AgentSidebarGroup } from "./AgentSidebar";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { RulesTab } from "./RulesTab";
import { StagesTab } from "./StagesTab";
import { ToolsTab } from "./ToolsTab";
import { AuditTab } from "./AuditTab";
import { FAQTab } from "./FAQTab";
import { DocumentsTab } from "./DocumentsTab";
import { FollowupTab } from "./FollowupTab";
import { TesterSheet } from "./TesterSheet";
import type { AgentActions } from "../actions";
import { useAgentActions } from "../context";

// PR-AI-AGENT-SIDEBAR (mai/2026): editor migrado de 9 tabs horizontais
// underline (CrmTabs-style) pra sidebar vertical agrupada. Razao:
// Hick-Hyman (menos itens visiveis ate decidir) + Miller (4 grupos com
// 1-4 itens cada respeitam 7±2). Sidebar fixa no desktop, drawer no
// mobile. Tester sai do header e vira FAB fixo bottom-right — sempre
// acessivel sem disputar espaco com config (paridade com market patterns:
// Custom GPT, Claude Projects, Copilot Studio).
type AgentSectionId =
  | "rules"
  | "stages"
  | "faq"
  | "docs"
  | "tools"
  | "followups"
  | "audit";

function buildSidebarGroups(opts: {
  stagesCount: number;
}): AgentSidebarGroup[] {
  return [
    {
      id: "behavior",
      label: "Comportamento",
      items: [
        { id: "rules", label: "Regras", icon: Settings2 },
        {
          id: "stages",
          label: "Etapas",
          icon: ListOrdered,
          badge: opts.stagesCount > 0 ? opts.stagesCount : null,
        },
      ],
    },
    {
      id: "knowledge",
      label: "Conhecimento",
      items: [
        { id: "faq", label: "FAQ", icon: HelpCircle },
        { id: "docs", label: "Documentos", icon: Library },
      ],
    },
    {
      id: "actions",
      label: "Ações",
      items: [
        // PR-AGENT-INTEGRATION-1: "Notificações" foi pra dentro de Regras
        // (HandoffNotificationCard agrupado com switch de transferir
        // pra humano). "Agendamento" virou tool habilitavel em Regras
        // (sem aba dedicada). Sobra: Ferramentas + Follow-up.
        { id: "tools", label: "Ferramentas", icon: Wrench },
        { id: "followups", label: "Follow-up", icon: Clock },
      ],
    },
    {
      id: "history",
      label: "Histórico",
      items: [{ id: "audit", label: "Execuções", icon: History }],
    },
  ];
}

interface Props {
  initialAgent: AgentConfig;
  initialStages: AgentStage[];
  initialTools: AgentTool[];
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
  const [activeSection, setActiveSection] = React.useState<AgentSectionId>("rules");
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

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

  const sidebarGroups = React.useMemo(
    () => buildSidebarGroups({ stagesCount: stages.length }),
    [stages.length],
  );

  const handleSelect = React.useCallback((id: string) => {
    setActiveSection(id as AgentSectionId);
    setMobileNavOpen(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header sticky — sem tabs (movido pra sidebar), sem botao "Testar
          agente" (vira FAB fixo). Hamburger no mobile abre sidebar via
          drawer. Mantem breadcrumb + identidade + status. */}
      <div className="sticky -top-6 z-30 -mx-6 -mt-6 px-6 pt-6 pb-4 bg-background/95 backdrop-blur-sm border-b border-border/60 space-y-4">
        <Link
          href="/automations/agents"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar pra lista de agentes
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            {/* Mobile nav trigger (lg-): abre Sheet controlado. Nao uso
                SheetTrigger pq base-ui nao tem asChild — controlled Sheet
                + Button onClick e mais simples e da o mesmo resultado. */}
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden shrink-0"
              aria-label="Abrir navegação"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetContent side="left" className="w-72 p-4">
                <SheetHeader>
                  <SheetTitle className="text-sm">Editor</SheetTitle>
                </SheetHeader>
                <div className="mt-4">
                  <AgentSidebar
                    groups={sidebarGroups}
                    activeId={activeSection}
                    onSelect={handleSelect}
                    variant="drawer"
                  />
                </div>
              </SheetContent>
            </Sheet>
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
                Configure regras, etapas e ferramentas. Teste a qualquer
                momento pelo botão flutuante.
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
          </div>
        </div>
      </div>

      {/* Layout: sidebar fixa (lg+) + conteudo. Em <lg, sidebar so via
          drawer (hamburger). Bottom padding garante que o FAB nao tampe
          o ultimo content. */}
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr] pb-24">
        <aside className="hidden lg:block">
          <AgentSidebar
            groups={sidebarGroups}
            activeId={activeSection}
            onSelect={handleSelect}
          />
        </aside>

        <main className="min-w-0">
          {activeSection === "rules" && (
            <RulesTab agent={agent} onChange={persistAgent} isPending={isPending} />
          )}
          {activeSection === "stages" && (
            <StagesTab
              configId={agent.id}
              stages={stages}
              tools={tools}
              onChange={setStages}
            />
          )}
          {activeSection === "faq" && (
            <FAQTab
              configId={agent.id}
              sources={knowledgeSources}
              onChange={setKnowledgeSources}
              onRefresh={refreshKnowledgeSources}
            />
          )}
          {activeSection === "docs" && (
            <DocumentsTab
              configId={agent.id}
              sources={knowledgeSources}
              onChange={setKnowledgeSources}
              onRefresh={refreshKnowledgeSources}
            />
          )}
          {activeSection === "tools" && (
            <ToolsTab
              configId={agent.id}
              tools={tools}
              stages={stages}
              allowedDomains={initialAllowedDomains}
              onChange={setTools}
            />
          )}
          {activeSection === "followups" && (
            <FollowupTab
              configId={agent.id}
              followups={followups}
              templates={notificationTemplates}
              onChange={setFollowups}
            />
          )}
          {activeSection === "audit" && <AuditTab configId={agent.id} />}
        </main>
      </div>

      {/* Tester FAB — fixo bottom-right, z-40 (acima de conteudo, abaixo
          do header sticky z-30 + de sheets/dialogs z-50). Pill com label
          em todas as resolucoes pra discoverability. */}
      <Button
        type="button"
        onClick={() => setTesterOpen(true)}
        size="lg"
        className="fixed bottom-6 right-6 z-40 rounded-full px-5 shadow-lg shadow-primary/30"
        aria-label="Testar agente"
      >
        <FlaskConical className="size-4" />
        Testar agente
      </Button>

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
