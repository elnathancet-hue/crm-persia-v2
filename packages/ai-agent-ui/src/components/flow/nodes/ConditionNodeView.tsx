"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { Filter } from "lucide-react";
import type { FlowConditionNode } from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";
import { InlineFormPanel } from "../InlineFormPanel";
import type { FlowCatalogs } from "../catalog-types";
import { useFlowTesterHighlight } from "../../flow-tester-context";

interface Props {
  data: FlowConditionNode["data"];
  selected?: boolean;
  id: string;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onPatch?: (data: Record<string, unknown>) => void;
  catalogs?: FlowCatalogs;
  catalogsLoading?: boolean;
}

function conditionPreview(
  type: FlowConditionNode["data"]["condition_type"],
  config: Record<string, unknown>,
  catalogs?: FlowCatalogs,
): string {
  switch (type) {
    case "has_tag":
      return (config.tag_name as string) || "Sem tag selecionada";
    case "lead_custom_field_equals": {
      const fieldName = (config.field_name as string) || "";
      const field = catalogs?.custom_fields.find(
        (f) => f.name === fieldName || f.field_key === fieldName,
      );
      return `${field?.name ?? (fieldName || "campo")} = ${
        config.value || "valor"
      }`;
    }
    case "in_segment": {
      const segmentId = (config.segment_id as string) || "";
      const segment = catalogs?.segments.find((s) => s.id === segmentId);
      return segment?.name ?? "Sem segmentação";
    }
    default:
      return "";
  }
}

function conditionIncompleteReason(
  type: FlowConditionNode["data"]["condition_type"],
  config: Record<string, unknown>,
): string | null {
  switch (type) {
    case "has_tag":
      if (!(config.tag_name as string)?.trim()) return "Falta selecionar tag";
      return null;
    case "lead_custom_field_equals":
      if (!(config.field_name as string)?.trim()) return "Falta o campo";
      return null;
    case "in_segment":
      if (!(config.segment_id as string)?.trim()) return "Falta segmentação";
      return null;
    default:
      return null;
  }
}

export function ConditionNodeView({
  data,
  selected,
  id,
  onDelete,
  onDuplicate,
  onPatch,
  catalogs,
  catalogsLoading,
}: Props) {
  const recentlyExecuted = useFlowTesterHighlight(id);
  const incompleteReason = conditionIncompleteReason(
    data.condition_type,
    data.config,
  );
  const expandedContent =
    onPatch && catalogs ? (
      <InlineFormPanel
        nodeType="condition"
        data={data as unknown as Record<string, unknown>}
        onPatch={onPatch}
        catalogs={catalogs}
        catalogsLoading={catalogsLoading}
      />
    ) : null;

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
        incomplete={incompleteReason !== null}
        incompleteReason={incompleteReason ?? undefined}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        expandedContent={expandedContent}
        recentlyExecuted={recentlyExecuted}
      >
        <div className="line-clamp-2">
          {conditionPreview(data.condition_type, data.config, catalogs)}
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
