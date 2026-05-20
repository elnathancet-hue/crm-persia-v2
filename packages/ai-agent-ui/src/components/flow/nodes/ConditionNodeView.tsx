"use client";

// Condition node — verificação Sim/Não. Entrada à esquerda; 2 saídas
// nomeadas à direita (top=yes verde, bottom=no vermelho). V1 do runtime
// não executa (placeholder visual — PR 5 implementa).

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { Filter } from "lucide-react";
import type { FlowConditionNode } from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";

interface Props {
  data: FlowConditionNode["data"];
  selected?: boolean;
}

function conditionPreview(
  type: FlowConditionNode["data"]["condition_type"],
  config: Record<string, unknown>,
): string {
  switch (type) {
    case "has_tag":
      return (config.tag_name as string) || "Sem tag selecionada";
    case "lead_custom_field_equals":
      return `${config.field_name || "campo"} = ${config.value || "valor"}`;
    case "in_segment":
      return (config.segment_id as string) || "Sem segmentação";
    default:
      return "";
  }
}

export function ConditionNodeView({ data, selected }: Props) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!size-3 !bg-muted-foreground !border-2 !border-background"
      />
      <NodeShell
        icon={Filter}
        label={data.label}
        badge="Verificação"
        variant="condition"
        selected={selected}
      >
        <div className="line-clamp-2">
          {conditionPreview(data.condition_type, data.config)}
        </div>
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        id="yes"
        style={{ top: "35%" }}
        className="!size-3 !bg-success !border-2 !border-background"
      >
        <span className="absolute -right-8 -translate-y-1/2 text-[10px] font-semibold text-success">
          Sim
        </span>
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id="no"
        style={{ top: "70%" }}
        className="!size-3 !bg-destructive !border-2 !border-background"
      >
        <span className="absolute -right-7 -translate-y-1/2 text-[10px] font-semibold text-destructive">
          Não
        </span>
      </Handle>
    </>
  );
}
