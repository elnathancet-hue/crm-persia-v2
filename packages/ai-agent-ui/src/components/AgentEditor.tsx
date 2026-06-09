"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Circle,
  Clock,
  FlaskConical,
  GitBranch,
  History,
  ListOrdered,
  Maximize2,
  Menu,
  PlayCircle,
  Save,
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
  AgentStatus,
  AgentTool,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { cn } from "@persia/ui/utils";
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
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { useSaveStatus } from "./use-save-status";
import { FlowTesterProvider } from "./flow-tester-context";
// PR-FLOW-PIVOT PR 3 (mai/2026): aba "Fluxo" agora é o canvas visual.
import { FlowCanvas } from "./flow/FlowCanvas";
import { PlaceholderTab } from "./PlaceholderTab";
import { AuditTab } from "./AuditTab";
import { FollowupTab } from "./FollowupTab";
import { TesterSheet } from "./TesterSheet";
import type { AgentActions } from "../actions";
import { useAgentActions } from "../context";
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
  | "tools"
  | "followups"
  | "audit";

function buildSidebarGroups(_opts: {
  stagesCount: number;
}): AgentSidebarGroup[] {
  return [
    {
      id: "behavior",
      label: "Comportamento",
      items: [
        // PR 22 UX (mai/2026): "Configurações" volta pra cima — cliente
        // precisa configurar o agente (quem ele é, regras, modelo) antes
        // de desenhar o fluxo. "Fluxo" desce e fica como passo seguinte.
        // Reverte a inversão do PR 17.
        { id: "rules", label: "Configurações", icon: Settings2 },
        {
          // ID `stages` mantido pra retrocompat do localStorage de aba ativa.
          id: "stages",
          label: "Fluxo",
          icon: ListOrdered,
        },
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
  // PR-FLOW-PIVOT (mai/2026): initialStages mantido pra compat de assinatura
  // dos pages SSR. Conteúdo ignorado — flow vive em agent_flows e será
  // carregado pelo FlowCanvas (PR 3).
  initialStages: unknown[];
  initialTools: AgentTool[];
  initialAllowedDomains: string[];
  initialKnowledgeSources?: AgentKnowledgeSource[];
  initialNotificationTemplates?: AgentNotificationTemplate[];
  initialScheduledJobs?: AgentScheduledJob[];
  initialFollowups?: AgentFollowup[];
}

type RulesSaveControl = {
  dirty: boolean;
  isPending: boolean;
  onSave: () => void;
} | null;

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
  React.useEffect(() => {
    setNameDraft(agent.name);
  }, [agent.name]);
  // PR 22 UX (mai/2026): agente abre em "Configurações" — cliente
  // precisa definir quem é o agente, regras de conduta, modelo, etc
  // ANTES de desenhar o fluxo visual. Reverte o PR 17 que abria em
  // "stages" (Fluxo). Sem prompt configurado, o fluxo não funciona.
  const [activeSection, setActiveSection] = React.useState<AgentSectionId>("rules");
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const rulesSaveRef = React.useRef<(() => void) | null>(null);
  const [rulesSaveMeta, setRulesSaveMeta] = React.useState({
    dirty: false,
    isPending: false,
  });
  const handleRulesSaveControlChange = React.useCallback(
    (control: RulesSaveControl) => {
      rulesSaveRef.current = control?.onSave ?? null;
      setRulesSaveMeta((prev) => {
        const next = control
          ? { dirty: control.dirty, isPending: control.isPending }
          : { dirty: false, isPending: false };
        return prev.dirty === next.dirty && prev.isPending === next.isPending
          ? prev
          : next;
      });
    },
    [],
  );
  const handleRulesSaveClick = React.useCallback(() => {
    rulesSaveRef.current?.();
  }, []);
  // PR 23 UX (mai/2026): sidebar do editor pode ser recolhida pra abrir
  // mais espaço — especialmente útil no canvas do Fluxo. Estado
  // persiste em localStorage (key global, não por agente — preferência
  // de UI vale pra qualquer agente que o user abrir). Lazy init evita
  // SSR mismatch ao não tocar window no primeiro render — hidrata via
  // useEffect abaixo.
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [flowFullscreen, setFlowFullscreen] = React.useState(false);
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        "persia.agent-editor-sidebar-collapsed",
      );
      if (stored === "1") setSidebarCollapsed(true);
    } catch {
      /* ignore (private mode etc) */
    }
  }, []);
  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          "persia.agent-editor-sidebar-collapsed",
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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

  // PR 26 (mai/2026): save status compartilhado entre header
  // (indicador) e formulários (RulesTab auto-save). Substitui o
  // toast.success/error individual de cada save — agora indicator
  // persistente é a fonte da verdade.
  const saveStatus = useSaveStatus();
  // Track do último patch ok pra botão "Tentar de novo" do indicator.
  const lastFailedPatchRef = React.useRef<{
    patch: Parameters<AgentActions["updateAgent"]>[1];
    successMsg?: string;
  } | null>(null);

  // Fix: destructure os callbacks estáveis (useCallback de deps vazias em
  // useSaveStatus) em vez de depender do objeto saveStatus inteiro.
  // O objeto saveStatus é recriado a cada render (novo ref), o que tornava
  // persistAgent instável — recriado a cada mudança de status (salvando →
  // salvo → idle), causando cascata de re-renders e flicker no save state.
  const { markSaving, markSaved, markError } = saveStatus;

  const persistAgent = React.useCallback(
    (patch: Parameters<AgentActions["updateAgent"]>[1], successMsg?: string) => {
      markSaving();
      startTransition(async () => {
        try {
          const updated = await updateAgent(agent.id, patch);
          setAgent(updated);
          markSaved();
          lastFailedPatchRef.current = null;
          // Manter toast.success só pra mudanças explícitas (ex:
          // troca de status/nome) — campos auto-saved não geram toast
          // pra não spammar (indicator já comunica).
          if (successMsg) toast.success(successMsg);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao salvar";
          markError(message);
          lastFailedPatchRef.current = { patch, successMsg };
        }
      });
    },
    [agent.id, updateAgent, markSaving, markSaved, markError],
  );

  const handleRetrySave = React.useCallback(() => {
    const pending = lastFailedPatchRef.current;
    if (!pending) return;
    persistAgent(pending.patch, pending.successMsg);
  }, [persistAgent]);

  const handleNameBlur = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(agent.name);
      return;
    }
    if (trimmed === agent.name) return;
    persistAgent({ name: trimmed }, "Nome atualizado");
  };

  // Save flow fix #3 (mai/2026): valida dirty antes de salvar status
  // isolado. Antes, cliente editava prompt + trocava status -> status
  // salvava direto + indicator dizia "Tudo salvo" enquanto prompt
  // continuava dirty -> cliente saia e perdia tudo.
  const [pendingStatusChange, setPendingStatusChange] =
    React.useState<AgentStatus | null>(null);

  const handleStatusChange = (status: AgentStatus) => {
    if (rulesSaveMeta.dirty && activeSection === "rules") {
      setPendingStatusChange(status);
      return;
    }
    persistAgent({ status }, `Status: ${statusLabel(status)}`);
  };

  const handleSaveAndChangeStatus = React.useCallback(() => {
    if (!pendingStatusChange) return;
    // 1. Salva mudancas atuais.
    rulesSaveRef.current?.();
    // 2. Aplica novo status na sequencia. persistAgent serializa via
    //    startTransition (queue), entao patch do status entra atras do
    //    save anterior — server processa em ordem.
    persistAgent(
      { status: pendingStatusChange },
      `Status: ${statusLabel(pendingStatusChange)}`,
    );
    setPendingStatusChange(null);
  }, [pendingStatusChange, persistAgent]);

  const handleDiscardAndChangeStatus = React.useCallback(() => {
    if (!pendingStatusChange) return;
    // Cliente escolheu descartar — aplica status sem salvar mudancas
    // locais. State local sera ressincronizado quando o agent updated
    // chegar do server (useEffect do RulesTab).
    persistAgent(
      { status: pendingStatusChange },
      `Status: ${statusLabel(pendingStatusChange)}`,
    );
    setPendingStatusChange(null);
  }, [pendingStatusChange, persistAgent]);

  const sidebarGroups = React.useMemo(
    () => buildSidebarGroups({ stagesCount: stages.length }),
    [stages.length],
  );

  // Save flow fix #2 (mai/2026): bloqueia troca de section quando ha
  // mudancas nao salvas. Sem isso, cliente trocava aba e perdia tudo
  // silenciosamente (UnsavedChangesGuard so cobre link/reload, nao
  // navegacao de section dentro do mesmo editor).
  const [pendingSectionSwitch, setPendingSectionSwitch] =
    React.useState<AgentSectionId | null>(null);

  const handleSelect = React.useCallback(
    (id: string) => {
      const next = id as AgentSectionId;
      if (next === activeSection) return;
      if (rulesSaveMeta.dirty && activeSection === "rules") {
        // Cliente tem mudancas nao salvas no Comportamento. Pede
        // confirmacao antes de trocar de section.
        setPendingSectionSwitch(next);
        return;
      }
      setActiveSection(next);
      setMobileNavOpen(false);
    },
    [activeSection, rulesSaveMeta.dirty],
  );

  const discardAndSwitch = React.useCallback(() => {
    if (pendingSectionSwitch) {
      setActiveSection(pendingSectionSwitch);
      setMobileNavOpen(false);
    }
    setPendingSectionSwitch(null);
  }, [pendingSectionSwitch]);

  // Save flow fix #2 (mai/2026): botao Salvar agora vive num footer
  // sticky GLOBAL — visivel em qualquer section, nao some quando o
  // cliente troca de aba. Mantem inline tambem no header (legado) pra
  // compat com testes.
  const rulesSaveAction =
    activeSection === "rules" ? (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-xs",
            rulesSaveMeta.dirty
              ? "font-medium text-progress"
              : "text-muted-foreground",
          )}
        >
          {rulesSaveMeta.dirty ? "Alterações não salvas" : "Tudo salvo"}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={handleRulesSaveClick}
          disabled={!rulesSaveMeta.dirty || rulesSaveMeta.isPending}
        >
          <Save className="size-3.5" />
          Salvar
        </Button>
      </div>
    ) : null;

  return (
    /* PR 28 (mai/2026): FlowTesterProvider envolve o editor inteiro
       pra que TesterSheet (publisher) e FlowCanvas/NodeViews
       (consumers) compartilhem o último node executado via context.
       Highlight pulsing aparece no node onde o flow parou após cada
       run do Tester. */
    <FlowTesterProvider>
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
                {/* PR 26 (mai/2026): SaveStatusIndicator substitui o
                    spinner isolado — agora mostra "Salvando…" /
                    "Salvo há Xm" / "Erro ao salvar" com retry. */}
                <SaveStatusIndicator
                  status={saveStatus.status}
                  lastSavedAt={saveStatus.lastSavedAt}
                  errorMessage={saveStatus.errorMessage}
                  onRetry={handleRetrySave}
                  isDirty={rulesSaveMeta.dirty}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure regras, etapas e ferramentas. Teste a qualquer
                momento pelo botão flutuante.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-muted-foreground">
              Status do agente
            </span>
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

      {/* PR 18 UX (mai/2026): checklist de publicação. Mostra ao cliente
          exatamente o que falta pra agente começar a responder leads. */}
      <PublishingChecklist
        agent={agent}
        onActivate={() => handleStatusChange("active")}
        isPending={isPending}
        saveAction={rulesSaveAction}
      />

      {/* Layout: sidebar fixa (lg+) + conteudo. Em <lg, sidebar so via
          drawer (hamburger). Bottom padding garante que o FAB nao tampe
          o ultimo content.
          PR 23: grid-cols muda quando sidebar está collapsed — passa
          de 16rem pra ~3.5rem, liberando largura pro canvas do Fluxo. */}
      <div
        className={cn(
          "grid gap-6 pb-24",
          sidebarCollapsed
            ? "lg:grid-cols-[3.5rem_1fr]"
            : "lg:grid-cols-[16rem_1fr]",
        )}
      >
        <aside className="hidden lg:block">
          <AgentSidebar
            groups={sidebarGroups}
            activeId={activeSection}
            onSelect={handleSelect}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        </aside>

        <main className="min-w-0">
          {activeSection === "rules" && (
            <RulesTab
              agent={agent}
              onChange={persistAgent}
              isPending={isPending}
              tools={tools}
              onToolsChange={setTools}
              knowledgeSources={knowledgeSources}
              onKnowledgeSourcesChange={setKnowledgeSources}
              onKnowledgeRefresh={refreshKnowledgeSources}
              onSaveControlChange={handleRulesSaveControlChange}
            />
          )}
          {activeSection === "stages" && (
            <div className="flex flex-col items-center justify-center gap-6 rounded-xl border border-border/60 bg-card py-16 px-8 text-center min-h-[320px]">
              <div className="size-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <GitBranch className="size-8" />
              </div>
              <div className="space-y-2 max-w-sm">
                <p className="text-lg font-semibold">Fluxo de atendimento</p>
                <p className="text-sm text-muted-foreground">
                  Desenhe a sequência de etapas que o agente segue — entradas, respostas de IA, ações automáticas e condições.
                </p>
              </div>
              <Button
                type="button"
                size="lg"
                onClick={() => setFlowFullscreen(true)}
                className="gap-2"
              >
                <Maximize2 className="size-4" />
                Editar fluxo
              </Button>
            </div>
          )}
          {activeSection === "tools" && (
            <PlaceholderTab
              icon={Wrench}
              title="Ferramentas em construção"
              description="A configuração de ferramentas migra pra dentro do canvas (allowlist por flow). PR 3 entrega a UI nova."
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
          em todas as resolucoes pra discoverability.
          Escondido no modo fullscreen (o overlay tem próprio botão Testar). */}
      {!flowFullscreen && (
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
      )}

      {/* Fullscreen flow editor — cobre tudo (CRM nav, header, etc.)
          com z-[100]. Só a barra superior e o FlowCanvas aparecem. */}
      {flowFullscreen && (
        <div className="fixed inset-0 z-[100] bg-background flex flex-col">
          {/* Barra superior do editor fullscreen */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-background px-4 h-12">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFlowFullscreen(false)}
              className="gap-1.5"
            >
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold truncate">{agent.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">— Fluxo de atendimento</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setTesterOpen(true)}
              className="gap-1.5"
            >
              <FlaskConical className="size-3.5" />
              Testar
            </Button>
          </div>
          {/* Canvas ocupa todo o espaço restante */}
          <div className="flex flex-1 min-h-0">
            <FlowCanvas configId={agent.id} fullscreen />
          </div>
        </div>
      )}

      <TesterSheet
        configId={agent.id}
        open={testerOpen}
        onOpenChange={setTesterOpen}
      />

      {/* Save flow fix #2 (mai/2026): footer sticky GLOBAL com botao
          Salvar. Aparece em qualquer section quando ha mudancas nao
          salvas no Comportamento. Fica acima do FAB (z-30 vs z-40),
          mas alinhado a esquerda pra nao competir visualmente. */}
      {activeSection === "rules" && rulesSaveMeta.dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-warning-ring/40 bg-warning-soft/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="size-2 rounded-full bg-warning animate-pulse" />
              <span className="font-medium text-warning-foreground">
                Você tem alterações não salvas
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleRulesSaveClick}
              disabled={rulesSaveMeta.isPending}
            >
              <Save className="size-3.5" />
              {rulesSaveMeta.isPending ? "Salvando..." : "Salvar agora"}
            </Button>
          </div>
        </div>
      )}

      {/* Save flow fix #2 (mai/2026): bloqueio de troca de section
          quando ha mudancas nao salvas. */}
      <AlertDialog
        open={pendingSectionSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSectionSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem alterações no Comportamento do agente que ainda
              não foram salvas. Se trocar de seção agora, essas mudanças
              serão descartadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={discardAndSwitch}>
              Descartar e trocar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save flow fix #3 (mai/2026): valida dirty antes de salvar
          status isolado. Cliente escolhe salvar tudo OU descartar
          mudancas locais. */}
      <AlertDialog
        open={pendingStatusChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar antes de mudar o status?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem alterações no Comportamento do agente que ainda não
              foram salvas. Você pode salvar tudo junto OU descartar
              as mudanças e aplicar apenas o novo status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscardAndChangeStatus}
            >
              Descartar e mudar status
            </Button>
            <AlertDialogAction onClick={handleSaveAndChangeStatus}>
              Salvar tudo e mudar status
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </FlowTesterProvider>
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

// ============================================================================
// PR 18 UX (mai/2026): PublishingChecklist
// ============================================================================
//
// Barra horizontal abaixo do header mostrando o que falta pro agente
// responder leads reais. Cada item é um chip clicável (quando ação
// faz sentido) ou estático.
//
// V1 cobre 3 itens (sem flow inspection pra evitar query extra):
//   - Status ativo
//   - Marcado como principal
//   - Fluxo configurado (deep link pra aba)
//
// Quando todos verdes, mostra banner sucesso "Pronto pra publicar".

function PublishingChecklist({
  agent,
  onActivate,
  isPending,
  saveAction,
}: {
  agent: AgentConfig;
  onActivate: () => void;
  isPending: boolean;
  saveAction?: React.ReactNode;
}) {
  const isActive = agent.status === "active";
  const isPrimary = Boolean(agent.is_primary);

  if (isActive) {
    return (
      <div className="-mx-6 px-6 py-2 bg-success-soft/40 border-b border-success-ring/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <span className="shrink-0 font-medium text-foreground">
              Agente publicado.
            </span>
            <span className="min-w-0 text-muted-foreground">
              {isPrimary
                ? "Como principal, ele responde novas conversas automaticamente."
                : "Como secundário, ele participa quando uma entrada configurada bater."}
            </span>
          </div>
          {saveAction ? <div className="shrink-0">{saveAction}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-6 px-6 py-3 bg-muted/30 border-b border-border/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground">
            Para publicar:
          </span>
          <ChecklistChip
            done={false}
            icon={PlayCircle}
            label="Ativar agente"
            actionLabel="Ativar"
            onAction={onActivate}
            isPending={isPending}
          />
          <span className="text-xs text-muted-foreground">
            Fluxo e entradas podem ser ajustados depois.
          </span>
        </div>
        {saveAction ? <div className="shrink-0">{saveAction}</div> : null}
      </div>
    </div>
  );
}
function ChecklistChip({
  done,
  icon: Icon,
  label,
  actionLabel,
  onAction,
  isPending,
  mode = "todo",
}: {
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
  isPending?: boolean;
  /** "todo" = circle outline (pendente); "info" = mostra mesmo quando
   * não exatamente "concluído" (caso do flow que não inspecionamos). */
  mode?: "todo" | "info";
}) {
  const StateIcon = done ? CheckCircle2 : mode === "info" ? Icon : Circle;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        done
          ? "border-success/40 bg-success-soft/30 text-foreground"
          : "border-border bg-card text-muted-foreground"
      }`}
    >
      <StateIcon
        className={`size-3.5 ${
          done ? "text-success" : "text-muted-foreground"
        }`}
      />
      <span className={done ? "font-medium text-foreground" : ""}>{label}</span>
      {!done && actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={isPending}
          className="ml-1 text-primary hover:underline font-medium disabled:opacity-50"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
