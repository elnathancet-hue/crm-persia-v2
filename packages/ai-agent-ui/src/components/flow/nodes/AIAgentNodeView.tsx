"use client";

// AI Agent node — onde a IA conversa. Entrada à esquerda. Saída
// "default" à direita + 1 handle por evento configurado nas
// instructions[]. Cliente conecta cada handle a uma ação no canvas.
//
// PR-FLOW-PIVOT PR 7 (mai/2026): handles dinâmicos por instruction.
// Antes era 1 só ("default"). Agora a IA pode emitir N eventos
// nomeados via tool emit_event(handle_name) e o flow segue a edge
// correspondente.

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { BadgeCheck } from "lucide-react";
import type { FlowAIAgentNode } from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";

interface Props {
  data: FlowAIAgentNode["data"];
  selected?: boolean;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export function AIAgentNodeView({
  data,
  selected,
  onDelete,
  onDuplicate,
}: Props) {
  const promptPreview = (data.system_prompt ?? "").trim();
  const instructions = data.instructions ?? [];
  // PR 17 UX (mai/2026): IA sem instruções de quando terminar é
  // tecnicamente válida (segue handle default), mas geralmente é sinal
  // de fluxo inacabado. Marcamos como incompleto pra cliente notar.
  const incompleteReason = !promptPreview
    ? "Falta o que a IA deve fazer aqui"
    : null;

  // Layout dos handles à direita:
  //   - default (sempre presente, no centro)
  //   - 1 handle por instruction, espaçados verticalmente abaixo do
  //     centro. UI calcula offset proporcional pra distribuir.
  const totalHandles = 1 + instructions.length;
  const handleSpacing = totalHandles > 1 ? 60 / totalHandles : 0; // % do height

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!size-3 !bg-primary !border-2 !border-background"
      />
      <NodeShell
        icon={BadgeCheck}
        label={data.label || "Conversar com IA"}
        badge="Atendimento com IA"
        variant="ai_agent"
        selected={selected}
        incomplete={incompleteReason !== null}
        incompleteReason={incompleteReason ?? undefined}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
      >
        {promptPreview ? (
          <div className="line-clamp-2">{promptPreview}</div>
        ) : (
          <div className="italic text-muted-foreground/70">
            Sem instruções ainda — clique pra editar.
          </div>
        )}
        {instructions.length > 0 ? (
          <div className="mt-2 space-y-1 border-t border-border/40 pt-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Quando terminar
            </div>
            {instructions.map((ins) => (
              <div
                key={ins.id}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span className="size-1.5 rounded-full bg-primary/60 shrink-0" />
                <span className="truncate">
                  {ins.description?.trim() || ins.output_handle}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </NodeShell>
      {/* Handle default — sempre presente. IA cai aqui quando responde
          texto sem chamar emit_event. */}
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        style={{ top: `${50 - (instructions.length * handleSpacing) / 2}%` }}
        className="!size-3 !bg-primary !border-2 !border-background"
      >
        <span className="absolute -right-12 -translate-y-1/2 text-[9px] font-semibold text-muted-foreground">
          continua
        </span>
      </Handle>
      {/* Handles dinâmicos — 1 por instruction. ID == output_handle.
          Label do handle mostra DESCRIÇÃO (legível) em vez de
          output_handle (snake_case técnico). */}
      {instructions.map((ins, idx) => {
        const topPct =
          50 - (instructions.length * handleSpacing) / 2 + (idx + 1) * handleSpacing;
        const labelText = ins.description?.trim() || ins.output_handle;
        return (
          <Handle
            key={ins.id}
            type="source"
            position={Position.Right}
            id={ins.output_handle}
            style={{ top: `${topPct}%` }}
            className="!size-3 !bg-success !border-2 !border-background"
          >
            <span className="absolute -right-2 translate-x-full -translate-y-1/2 text-[9px] font-semibold text-success whitespace-nowrap max-w-[140px] truncate">
              {labelText.length > 24 ? `${labelText.slice(0, 22)}...` : labelText}
            </span>
          </Handle>
        );
      })}
    </>
  );
}
