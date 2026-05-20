"use client";

// AI Agent node — onde a IA conversa. Entrada à esquerda. Saída
// "default" à direita + 1 handle por tool_success nomeado (o runtime
// usa "tool_success:<tool_name>"). UI inline mostra preview do prompt +
// quantidade de instruções.

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { BadgeCheck } from "lucide-react";
import type { FlowAIAgentNode } from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";

interface Props {
  data: FlowAIAgentNode["data"];
  selected?: boolean;
}

export function AIAgentNodeView({ data, selected }: Props) {
  const promptPreview = (data.system_prompt ?? "").trim();
  const instructionsCount = data.instructions?.length ?? 0;
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
        badge="IA"
        variant="ai_agent"
        selected={selected}
      >
        {promptPreview ? (
          <div className="line-clamp-2">{promptPreview}</div>
        ) : (
          <div className="italic text-muted-foreground/70">
            Sem instruções ainda — clique pra editar.
          </div>
        )}
        {instructionsCount > 0 ? (
          <div className="mt-1.5 text-[10px] text-muted-foreground/80">
            {instructionsCount} instrução{instructionsCount === 1 ? "" : "ões"}
          </div>
        ) : null}
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        className="!size-3 !bg-primary !border-2 !border-background"
      />
    </>
  );
}
