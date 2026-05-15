"use client";

import * as React from "react";
import { FlaskConical, Info, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentStage,
  TesterResponse,
  TesterStepSummary,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import { useAgentActions } from "../context";

interface Props {
  configId: string;
  stages: AgentStage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChatTurn {
  role: "user" | "agent";
  text: string;
  steps?: TesterStepSummary[];
  tokens?: number;
  error?: string;
  // Etapa em que o run COMECOU (snapshot do selectedStageId no momento
  // do envio). Usado pra detectar transicao quando comparado com
  // next_stage_id retornado.
  started_stage_id?: string;
  // Etapa pra qual o agente avancou apos esse run. null = continua
  // na mesma etapa. Vem direto de TesterResponse.next_stage_id.
  next_stage_id?: string | null;
}

export function TesterSheet({ configId, stages, open, onOpenChange }: Props) {
  const { testAgent } = useAgentActions();
  const [message, setMessage] = React.useState("");
  const [selectedStageId, setSelectedStageId] = React.useState<string | undefined>();
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [isPending, startTransition] = React.useTransition();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = message.trim();
    if (!text || isPending) return;

    // Snapshot da etapa atual (selectedStageId pode mudar entre clicks
    // do usuario; queremos a que estava ativa no momento do envio).
    const stageAtSend = selectedStageId ?? stages.slice().sort(
      (a, b) => a.order_index - b.order_index,
    )[0]?.id;

    setTurns((prev) => [...prev, { role: "user", text }]);
    setMessage("");

    startTransition(async () => {
      try {
        const res: TesterResponse = await testAgent({
          config_id: configId,
          stage_id: selectedStageId,
          message: text,
          dry_run: true,
        });
        // Auto-avança o select pra etapa seguinte se o agente transicionou.
        // Assim a proxima mensagem do usuario continua de onde parou,
        // espelhando o comportamento real em prod.
        if (res.next_stage_id && res.next_stage_id !== stageAtSend) {
          setSelectedStageId(res.next_stage_id);
        }
        setTurns((prev) => [
          ...prev,
          {
            role: "agent",
            text: res.assistant_reply || "(sem resposta)",
            steps: res.steps,
            tokens: res.tokens_used,
            error: res.error,
            started_stage_id: stageAtSend,
            next_stage_id: res.next_stage_id,
          },
        ]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao testar");
        setTurns((prev) => [
          ...prev,
          {
            role: "agent",
            text: "",
            error: err instanceof Error ? err.message : "erro desconhecido",
          },
        ]);
      }
    });
  };

  const handleClear = () => setTurns([]);

  // Descritor (numero + nome) da etapa atual pra renderizar badge no
  // header. Se nada selecionado, mostra a primeira etapa por order_index
  // (que e a default real do executor).
  const currentStageDescriptor = React.useMemo(() => {
    if (stages.length === 0) return null;
    const sorted = stages.slice().sort((a, b) => a.order_index - b.order_index);
    const targetId = selectedStageId ?? sorted[0]!.id;
    return findStageDescriptor(stages, targetId);
  }, [stages, selectedStageId]);

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
            Modo simulação: nenhum WhatsApp é enviado. Toda ação que mudaria dados é apenas simulada.
          </SheetDescription>
          <div className="pt-3 space-y-1.5">
            <Label className="text-xs">
              Iniciar na etapa
              {currentStageDescriptor ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-normal text-[10px] text-muted-foreground">
                  Atual: {currentStageDescriptor.order}. {currentStageDescriptor.situation}
                </span>
              ) : null}
            </Label>
            <Select
              value={selectedStageId ?? ""}
              onValueChange={(v) => setSelectedStageId(v || undefined)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Primeira etapa (padrão)" />
              </SelectTrigger>
              <SelectContent>
                {stages.length === 0 ? (
                  <SelectItem value="_empty" disabled>
                    Agente sem etapas
                  </SelectItem>
                ) : (
                  stages
                    .slice()
                    .sort((a, b) => a.order_index - b.order_index)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.order_index + 1}. {s.situation}
                      </SelectItem>
                    ))
                )}
              </SelectContent>
            </Select>
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-2 space-y-3 bg-muted/20"
        >
          {turns.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
              <div className="size-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-sm">
                <FlaskConical className="size-7 text-white" />
              </div>
              <div className="space-y-1 max-w-xs">
                <p className="text-sm font-semibold tracking-tight">Conversa de teste</p>
                <p className="text-xs text-muted-foreground">
                  Mande uma mensagem como se fosse o cliente. O agente responde aqui sem afetar o WhatsApp real.
                </p>
              </div>
            </div>
          ) : (
            turns.map((turn, i) => <ChatBubble key={i} turn={turn} stages={stages} />)
          )}
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1">
              <Loader2 className="size-3 animate-spin" />
              Agente pensando...
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
              onClick={handleClear}
              disabled={turns.length === 0 || isPending}
            >
              Limpar
            </Button>
            <form onSubmit={handleSend} className="flex-1 flex gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  stages.length === 0
                    ? "Crie uma etapa primeiro"
                    : "Digite uma mensagem..."
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

function ChatBubble({ turn, stages }: { turn: ChatTurn; stages: AgentStage[] }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.text}
        </div>
      </div>
    );
  }

  // Detecta transicao: agente avancou pra etapa diferente da que comecou.
  // Quando next_stage_id == null, agente continua na mesma etapa (sem badge).
  const transition =
    turn.next_stage_id && turn.next_stage_id !== turn.started_stage_id
      ? findStageDescriptor(stages, turn.next_stage_id)
      : null;

  return (
    <div className="flex flex-col items-start gap-1.5 max-w-[85%]">
      <div className="rounded-2xl rounded-bl-sm bg-background border px-3 py-2 text-sm whitespace-pre-wrap">
        {turn.error ? (
          <span className="text-destructive">{turn.error}</span>
        ) : (
          turn.text
        )}
      </div>
      {transition ? (
        <div className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <span aria-hidden>→</span>
          Avançou pra Etapa {transition.order}: {transition.situation}
        </div>
      ) : null}
      {turn.steps && turn.steps.length > 0 ? (
        <details className="text-xs text-muted-foreground ml-1">
          <summary className="cursor-pointer hover:text-foreground select-none">
            {turn.steps.length === 1 ? "1 passo" : `${turn.steps.length} passos`}
            {turn.tokens ? ` · ~${formatBRL(estimateCostBRL(turn.tokens))}` : ""}
            <span className="ml-1 opacity-60">(detalhes técnicos)</span>
          </summary>
          <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-muted">
            {turn.steps.map((step, idx) => (
              <StepDetail key={idx} step={step} />
            ))}
            {turn.tokens ? (
              <div className="text-[10px] text-muted-foreground/70 pt-1">
                {turn.tokens.toLocaleString("pt-BR")} tokens
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// Devolve order_index (1-based) + situation pra render do badge de
// transicao. Retorna null se a etapa nao existir mais (ex: usuario
// deletou a etapa entre runs do tester — caso raro mas possivel).
function findStageDescriptor(
  stages: AgentStage[],
  stageId: string,
): { order: number; situation: string } | null {
  const sorted = stages.slice().sort((a, b) => a.order_index - b.order_index);
  const idx = sorted.findIndex((s) => s.id === stageId);
  if (idx < 0) return null;
  return { order: idx + 1, situation: sorted[idx]!.situation };
}

// Estimativa grosseira: GPT-4o-mini ~ US$ 0.0006 por 1k tokens.
// USD/BRL ~ 5.30. Dá ~R$ 0.0032 por 1k tokens. Suficiente pra o leigo
// ter noção de "centavos" em vez de números abstratos de tokens.
function estimateCostBRL(tokens: number): number {
  return (tokens / 1000) * 0.0032;
}

function formatBRL(value: number): string {
  if (value < 0.01) return "menos de R$ 0,01";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function StepDetail({ step }: { step: TesterStepSummary }) {
  const label =
    step.step_type === "llm"
      ? "Pensamento da IA"
      : step.step_type === "tool"
      ? `Ferramenta: ${step.tool_name ?? step.native_handler ?? "?"}`
      : "Verificação de regra";
  return (
    <div className="text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground/70">{step.duration_ms}ms</span>
      </div>
      {step.step_type === "tool" && step.output ? (
        <Card className="mt-1 py-1.5">
          <CardContent className="px-2 py-1 font-mono text-[10px] break-all">
            {JSON.stringify(step.output).slice(0, 180)}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
