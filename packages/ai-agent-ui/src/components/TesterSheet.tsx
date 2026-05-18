"use client";

import * as React from "react";
import {
  AlertCircle,
  Clock,
  FlaskConical,
  Info,
  Loader2,
  Moon,
  PauseCircle,
  RefreshCcw,
  Send,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentStage,
  TesterEvent,
  TesterLiveResponse,
  TesterResponse,
  TesterSkipReason,
  TesterStepSummary,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Switch } from "@persia/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import { useAgentActions } from "../context";

// PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): Tester com 2 modos.
//   Modo "Conversa fiel" (default ON quando testAgentLive existe):
//     usa o pipeline real (tryEnqueueForNativeAgent + debounce + split).
//     Mostra timeline de eventos: send_text, setTyping, sendMedia, delays
//     reais entre msgs. Identifica pause/resume keywords, business hours.
//   Modo "Tiro unico" (legado): chama testAgent (single shot, sem split,
//     sem debounce). Mantido pra debug rapido de prompt/etapas.

interface Props {
  configId: string;
  stages: AgentStage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UserTurn {
  kind: "user";
  text: string;
}

interface AgentTurn {
  kind: "agent";
  message: string;
  delayBeforeMs: number; // delay desde a msg anterior (UI usa pra animar)
  isTyping?: boolean;
}

interface SystemTurn {
  kind: "system";
  icon: "pause" | "after_hours" | "info" | "error";
  text: string;
}

interface StepsTurn {
  kind: "steps";
  steps: TesterStepSummary[];
  next_stage_id?: string | null;
  started_stage_id?: string;
}

type Turn = UserTurn | AgentTurn | SystemTurn | StepsTurn;

export function TesterSheet({ configId, stages, open, onOpenChange }: Props) {
  const actions = useAgentActions();
  const hasLive = typeof actions.testAgentLive === "function";
  const hasReset = typeof actions.resetTesterConversation === "function";

  const [message, setMessage] = React.useState("");
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [isPending, startTransition] = React.useTransition();
  const [faithfulMode, setFaithfulMode] = React.useState(hasLive);
  const [expediteDebounce, setExpediteDebounce] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = message.trim();
    if (!text || isPending) return;

    setTurns((prev) => [...prev, { kind: "user", text }]);
    setMessage("");

    if (faithfulMode && hasLive) {
      runFaithful(text);
    } else {
      runLegacy(text);
    }
  };

  const runFaithful = (text: string) => {
    startTransition(async () => {
      try {
        const res = await actions.testAgentLive!({
          config_id: configId,
          message: text,
          expedite_debounce: expediteDebounce,
        });
        appendFaithfulTurns(setTurns, res);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao testar");
        setTurns((prev) => [
          ...prev,
          {
            kind: "system",
            icon: "error",
            text: err instanceof Error ? err.message : "erro desconhecido",
          },
        ]);
      }
    });
  };

  const runLegacy = (text: string) => {
    startTransition(async () => {
      try {
        const res: TesterResponse = await actions.testAgent({
          config_id: configId,
          message: text,
          dry_run: true,
        });
        setTurns((prev) => [
          ...prev,
          {
            kind: "agent",
            message: res.assistant_reply || "(sem resposta)",
            delayBeforeMs: 0,
          },
          ...(res.steps.length > 0
            ? [
                {
                  kind: "steps" as const,
                  steps: res.steps,
                  next_stage_id: res.next_stage_id,
                },
              ]
            : []),
        ]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao testar");
      }
    });
  };

  const handleReset = () => {
    setTurns([]);
    if (hasReset && faithfulMode) {
      startTransition(async () => {
        try {
          await actions.resetTesterConversation!();
          toast.success("Conversa do Tester apagada — proxima msg comeca do zero");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Falha ao resetar conversa",
          );
        }
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" />
            <SheetTitle>Testar agente</SheetTitle>
          </div>
          <SheetDescription className="flex items-start gap-1.5">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            {faithfulMode
              ? "Modo fiel: pipeline real com pause/resume, horario comercial, debounce, picotar e delays. Tools simuladas (nao afetam dados reais)."
              : "Modo simulacao basico: 1 mensagem, 1 resposta. Sem split/debounce/business hours. Para debug rapido."}
          </SheetDescription>

          {/* Toggles de modo */}
          <div className="pt-3 space-y-2">
            {hasLive ? (
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <Wand2 className="size-3.5 text-primary" />
                  <span className="font-medium">Conversa fiel</span>
                  <span className="text-muted-foreground">(pipeline real)</span>
                </span>
                <Switch
                  checked={faithfulMode}
                  onCheckedChange={setFaithfulMode}
                  disabled={isPending}
                />
              </label>
            ) : null}
            {faithfulMode ? (
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span>Acelerar janela de debounce</span>
                </span>
                <Switch
                  checked={expediteDebounce}
                  onCheckedChange={setExpediteDebounce}
                  disabled={isPending}
                />
              </label>
            ) : null}
            {faithfulMode && !expediteDebounce ? (
              <p className="text-[10px] text-muted-foreground">
                ⏱ Tester vai esperar a janela real do agente (ate 10s) antes
                de flushar. Util pra reproduzir bug de timing.
              </p>
            ) : null}
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-2 space-y-3 bg-muted/20"
        >
          {turns.length === 0 ? (
            <EmptyState faithfulMode={faithfulMode} stagesCount={stages.length} />
          ) : (
            turns.map((turn, i) => (
              <TurnRenderer key={i} turn={turn} stages={stages} />
            ))
          )}
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1">
              <Loader2 className="size-3 animate-spin" />
              {faithfulMode
                ? expediteDebounce
                  ? "Rodando pipeline..."
                  : "Aguardando janela de debounce + pipeline..."
                : "Agente pensando..."}
            </div>
          ) : null}
        </div>

        <SheetFooter className="flex-col gap-2">
          {stages.length === 0 ? (
            <p className="text-xs text-muted-foreground self-start">
              Crie pelo menos uma etapa na aba <strong>Etapas</strong> antes de testar.
            </p>
          ) : null}
          <div className="flex flex-row gap-2 w-full">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={isPending}
              title={
                faithfulMode && hasReset
                  ? "Limpa a tela + apaga state da conversa no servidor"
                  : "Limpa a tela"
              }
            >
              <RefreshCcw className="size-3.5 mr-1" />
              Resetar
            </Button>
            <form onSubmit={handleSend} className="flex-1 flex gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  stages.length === 0
                    ? "Crie uma etapa primeiro"
                    : "Digite como se fosse o lead..."
                }
                disabled={isPending || stages.length === 0}
                aria-label="Mensagem de teste"
              />
              <Button
                type="submit"
                disabled={isPending || !message.trim() || stages.length === 0}
              >
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Render helpers
// ============================================================================

function EmptyState({
  faithfulMode,
  stagesCount,
}: {
  faithfulMode: boolean;
  stagesCount: number;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
      <div className="size-16 rounded-2xl bg-gradient-to-br from-progress to-primary flex items-center justify-center shadow-sm">
        <FlaskConical className="size-7 text-primary-foreground" />
      </div>
      <div className="space-y-1 max-w-xs">
        <p className="text-sm font-semibold tracking-tight">
          {faithfulMode ? "Conversa fiel" : "Tiro unico"}
        </p>
        <p className="text-xs text-muted-foreground">
          {faithfulMode
            ? "Mande como se fosse o lead. O agente roda o pipeline completo: pause/resume, horario, debounce, picotar. Voce ve cada mensagem chegando com o delay real."
            : "Mande uma mensagem como se fosse o cliente. Agente responde 1x sem picotar."}
        </p>
        {stagesCount === 0 ? (
          <p className="text-xs text-amber-600 mt-2">
            Sem etapas cadastradas — agente vai responder com prompt base.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TurnRenderer({ turn, stages }: { turn: Turn; stages: AgentStage[] }) {
  switch (turn.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
            {turn.text}
          </div>
        </div>
      );
    case "agent":
      return (
        <div className="flex flex-col items-start gap-1 max-w-[85%]">
          {turn.delayBeforeMs > 0 ? (
            <span className="text-[10px] text-muted-foreground/70 ml-1">
              + {formatDelay(turn.delayBeforeMs)}
              {turn.isTyping ? " (digitando)" : ""}
            </span>
          ) : null}
          <div className="rounded-2xl rounded-bl-sm bg-background border px-3 py-2 text-sm whitespace-pre-wrap">
            {turn.message}
          </div>
        </div>
      );
    case "system":
      return <SystemBanner turn={turn} />;
    case "steps":
      return <StepsBlock turn={turn} stages={stages} />;
  }
}

function SystemBanner({ turn }: { turn: SystemTurn }) {
  const styles =
    turn.icon === "error"
      ? "bg-destructive/10 text-destructive border-destructive/20"
      : turn.icon === "pause"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
      : turn.icon === "after_hours"
      ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
      : "bg-muted/40 text-muted-foreground border-border";
  const Icon =
    turn.icon === "error"
      ? AlertCircle
      : turn.icon === "pause"
      ? PauseCircle
      : turn.icon === "after_hours"
      ? Moon
      : Info;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${styles}`}
    >
      <Icon className="size-3.5 shrink-0 mt-0.5" />
      <span>{turn.text}</span>
    </div>
  );
}

function StepsBlock({
  turn,
  stages,
}: {
  turn: StepsTurn;
  stages: AgentStage[];
}) {
  const transition =
    turn.next_stage_id && turn.next_stage_id !== turn.started_stage_id
      ? findStageDescriptor(stages, turn.next_stage_id)
      : null;
  return (
    <div className="flex flex-col items-start gap-1.5 ml-1">
      {transition ? (
        <div className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <span aria-hidden>→</span>
          Avancou pra Etapa {transition.order}: {transition.situation}
        </div>
      ) : null}
      {turn.steps.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground select-none">
            {turn.steps.length === 1 ? "1 passo" : `${turn.steps.length} passos`}
            <span className="ml-1 opacity-60">(detalhes tecnicos)</span>
          </summary>
          <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-muted">
            {turn.steps.map((step, idx) => (
              <StepDetail key={idx} step={step} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function StepDetail({ step }: { step: TesterStepSummary }) {
  const label =
    step.step_type === "llm"
      ? "Pensamento da IA"
      : step.step_type === "tool"
      ? `Ferramenta: ${step.tool_name ?? step.native_handler ?? "?"}`
      : step.step_type === "summarization"
      ? "Resumo de contexto"
      : "Verificacao de regra";
  return (
    <div className="text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground/70">{step.duration_ms}ms</span>
      </div>
      {step.step_type === "tool" && step.output ? (
        <Card className="mt-1 py-1.5">
          <CardContent className="px-2 py-1 font-mono text-[10px] break-all">
            {JSON.stringify(step.output).slice(0, 220)}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ============================================================================
// Mapping TesterLiveResponse → Turn[]
// ============================================================================

function appendFaithfulTurns(
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>,
  res: TesterLiveResponse,
): void {
  const newTurns: Turn[] = [];

  // Pulou — banner com motivo
  if (res.skipped) {
    newTurns.push({
      kind: "system",
      icon: skipIcon(res.skipped),
      text: res.human_message ?? labelForSkip(res.skipped),
    });
  }

  // Reconstroi mensagens do agente a partir dos eventos do provider stub.
  // Cada send_text vira uma bolha. Calcula delay relativo ao evento
  // anterior (ts diff em ms). setTyping/off entre 2 send_texts marca
  // a proxima bolha como "digitando".
  const sendEvents: Array<{ ev: TesterEvent; wasTyping: boolean }> = [];
  let typingActive = false;
  for (const ev of res.events) {
    if (ev.kind === "set_typing_on") {
      typingActive = true;
    } else if (ev.kind === "set_typing_off") {
      typingActive = false;
    } else if (ev.kind === "send_text" || ev.kind === "send_media") {
      sendEvents.push({ ev, wasTyping: typingActive });
      typingActive = false;
    }
  }

  let prevTs: number | null = null;
  for (const { ev, wasTyping } of sendEvents) {
    const delay = prevTs === null ? 0 : Math.max(0, ev.ts - prevTs);
    if (ev.kind === "send_text") {
      newTurns.push({
        kind: "agent",
        message: String(ev.payload.message ?? "(vazio)"),
        delayBeforeMs: delay,
        isTyping: wasTyping,
      });
    } else if (ev.kind === "send_media") {
      const url = String(ev.payload.mediaUrl ?? "");
      const caption = ev.payload.caption ? String(ev.payload.caption) : "";
      newTurns.push({
        kind: "agent",
        message: `📎 ${ev.payload.mediaType ?? "midia"}${
          caption ? ` — ${caption}` : ""
        }\n${url}`,
        delayBeforeMs: delay,
        isTyping: wasTyping,
      });
    }
    prevTs = ev.ts;
  }

  // Steps + transicao no fim
  if (res.steps.length > 0 || res.next_stage_id) {
    newTurns.push({
      kind: "steps",
      steps: res.steps,
      next_stage_id: res.next_stage_id,
    });
  }

  if (newTurns.length === 0) {
    // Pipeline retornou sem eventos NEM skip — improvavel mas defensivo.
    newTurns.push({
      kind: "system",
      icon: "info",
      text: "Pipeline rodou mas nao gerou mensagens (verifique logs).",
    });
  }

  setTurns((prev) => [...prev, ...newTurns]);
}

function skipIcon(reason: TesterSkipReason): SystemTurn["icon"] {
  switch (reason) {
    case "paused_by_keyword":
    case "paused_active":
    case "native_agent_handoff":
      return "pause";
    case "after_hours":
      return "after_hours";
    case "feature_flag_off":
    case "no_active_config":
      return "error";
    default:
      return "info";
  }
}

function labelForSkip(reason: TesterSkipReason): string {
  switch (reason) {
    case "feature_flag_off":
      return "Agente nativo desligado nesta organizacao";
    case "no_active_config":
      return "Nenhum agente ativo";
    case "paused_by_keyword":
      return "IA pausada por palavra-chave";
    case "paused_active":
      return "Conversa esta pausada";
    case "after_hours":
      return "Fora do horario comercial";
    case "native_agent_handoff":
      return "Palavra de reativacao detectada";
    case "rate_limited":
      return "Rate limit atingido";
    case "cost_ceiling":
      return "Teto de custo atingido";
    default:
      return "Pipeline pulou";
  }
}

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}min`;
}

function findStageDescriptor(
  stages: AgentStage[],
  stageId: string,
): { order: number; situation: string } | null {
  const sorted = stages.slice().sort((a, b) => a.order_index - b.order_index);
  const idx = sorted.findIndex((s) => s.id === stageId);
  if (idx < 0) return null;
  return { order: idx + 1, situation: sorted[idx]!.situation };
}
