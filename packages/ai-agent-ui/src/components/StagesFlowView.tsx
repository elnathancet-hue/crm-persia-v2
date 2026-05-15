"use client";

import * as React from "react";
import { ArrowDown, Pencil, Plus } from "lucide-react";
import type { AgentStage } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";

interface Props {
  stages: AgentStage[];
  onEdit: (stage: AgentStage) => void;
  onAdd: () => void;
}

// Visualizacao em fluxograma vertical das etapas. Linear (sem branching),
// porque o fluxo do AI Agent e sequencial — cada etapa avanca pra
// proxima conforme o `transition_hint`. Pra branching com react-flow,
// fica pra futuro caso tenhamos esse caso de uso.
//
// Cards renderizam direto com CSS (sem dep nova). Conexoes sao setas
// verticais com label do transition_hint em cima.
export function StagesFlowView({ stages, onEdit, onAdd }: Props) {
  const sorted = React.useMemo(
    () => stages.slice().sort((a, b) => a.order_index - b.order_index),
    [stages],
  );

  if (sorted.length === 0) {
    // Nao deveria chegar aqui (StagesTab so renderiza StagesFlowView quando
    // ha etapas), mas defensivo.
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <StartMarker />

      {sorted.map((stage, index) => {
        const isLast = index === sorted.length - 1;
        return (
          <React.Fragment key={stage.id}>
            <FlowConnector
              hint={index === 0 ? null : sorted[index - 1]!.transition_hint}
              showHint={index !== 0}
            />
            <StageNode
              stage={stage}
              order={index + 1}
              isLast={isLast}
              onEdit={() => onEdit(stage)}
            />
          </React.Fragment>
        );
      })}

      {/* Conexao da ultima etapa pra adicionar nova: linha pontilhada
          + botao "Nova etapa" no final do fluxo. CTA visual pra continuar
          desenhando o fluxo sem ter que voltar pro topo. */}
      <FlowConnector
        hint={sorted[sorted.length - 1]!.transition_hint}
        showHint={true}
      />
      <button
        type="button"
        onClick={onAdd}
        className="flex flex-col items-center gap-1 px-6 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/30 transition-colors group"
      >
        <Plus className="size-5 text-muted-foreground group-hover:text-primary" />
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
          Adicionar próxima etapa
        </span>
      </button>
    </div>
  );
}

function StartMarker() {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success-soft text-success-soft-foreground text-[11px] font-semibold">
      <span className="size-1.5 rounded-full bg-success" aria-hidden />
      Início da conversa
    </div>
  );
}

function FlowConnector({ hint, showHint }: { hint: string | null; showHint: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="h-3 w-px bg-border" aria-hidden />
      {showHint && hint ? (
        <div className="max-w-xs px-2 py-0.5 rounded bg-muted text-[10px] text-muted-foreground italic text-center">
          {hint}
        </div>
      ) : showHint ? (
        <div className="px-2 text-[10px] text-warning italic">
          ⚠ sem dica de transição
        </div>
      ) : null}
      <ArrowDown className="size-3.5 text-muted-foreground/60" aria-hidden />
    </div>
  );
}

function StageNode({
  stage,
  order,
  isLast,
  onEdit,
}: {
  stage: AgentStage;
  order: number;
  isLast: boolean;
  onEdit: () => void;
}) {
  return (
    <Card
      className="w-full max-w-md transition-shadow hover:shadow-md cursor-pointer group"
      onClick={onEdit}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="size-8 rounded-lg bg-primary/10 text-primary text-sm font-bold font-mono flex items-center justify-center shrink-0">
            {order}
          </span>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-semibold text-sm tracking-tight">{stage.situation}</p>
              {stage.rag_enabled ? (
                <span className="text-[9px] px-1.5 py-0 rounded bg-progress-soft text-progress-soft-foreground font-medium uppercase tracking-wider">
                  RAG
                </span>
              ) : null}
              {isLast ? (
                <span className="text-[9px] px-1.5 py-0 rounded bg-success-soft text-success-soft-foreground font-medium">
                  Última
                </span>
              ) : null}
            </div>
            {stage.instruction ? (
              <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                {stage.instruction}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic">Sem instrução</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label={`Editar etapa ${stage.situation}`}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
