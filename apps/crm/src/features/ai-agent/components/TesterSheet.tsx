"use client";

import * as React from "react";
import { FlaskConical, Info, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentStage,
  TesterResponse,
  TesterStepSummary,
} from "@persia/shared/ai-agent";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { testAgent } from "@/actions/ai-agent/tester";

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
}

export function TesterSheet({ configId, stages, open, onOpenChange }: Props) {
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
        setTurns((prev) => [
          ...prev,
          {
            role: "agent",
            text: res.assistant_reply || "(sem resposta)",
            steps: res.steps,
            tokens: res.tokens_used,
            error: res.error,
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
            Modo dry-run: toda ferramenta que mudaria dados é simulada. Nenhum WhatsApp é enviado.
          </SheetDescription>
          <div className="pt-3 space-y-1.5">
            <Label className="text-xs">Iniciar na etapa</Label>
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
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-12">
              <div className="size-12 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <FlaskConical className="size-6 text-white" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs">
                Mande uma mensagem como se fosse o cliente. O agente responde aqui sem afetar WhatsApp.
              </p>
            </div>
          ) : (
            turns.map((turn, i) => <ChatBubble key={i} turn={turn} />)
          )}
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1">
              <Loader2 className="size-3 animate-spin" />
              Agente pensando...
            </div>
          ) : null}
        </div>

        <SheetFooter className="flex-row gap-2">
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
              placeholder="Digite uma mensagem..."
              disabled={isPending}
              aria-label="Mensagem de teste"
            />
            <Button type="submit" disabled={isPending || !message.trim()}>
              <Send className="size-4" />
            </Button>
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ChatBubble({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1.5 max-w-[85%]">
      <div className="rounded-2xl rounded-bl-sm bg-background border px-3 py-2 text-sm whitespace-pre-wrap">
        {turn.error ? (
          <span className="text-destructive">{turn.error}</span>
        ) : (
          turn.text
        )}
      </div>
      {turn.steps && turn.steps.length > 0 ? (
        <details className="text-xs text-muted-foreground ml-1">
          <summary className="cursor-pointer hover:text-foreground select-none">
            {turn.steps.length} passo(s) · {turn.tokens ?? 0} tokens
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
      ? "LLM"
      : step.step_type === "tool"
      ? `Ferramenta: ${step.tool_name ?? step.native_handler ?? "?"}`
      : "Guardrail";
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
