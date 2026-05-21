"use client";

// Entry node — ponto de partida do flow. 1 saída ("default") à direita.
//
// PR-FLOW-PIVOT PR 10 (mai/2026): 4 tipos de trigger. Ícone + preview
// mudam por tipo. Triggers segment/pipeline_stage são "em construção"
// (placeholder visual — runtime na próxima atualização).

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { Hash, MessageSquare, TrendingUp, Users } from "lucide-react";
import type { FlowEntryNode, FlowEntryTrigger } from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";
import { InlineFormPanel } from "../InlineFormPanel";
import type { FlowCatalogs } from "../catalog-types";
import { useFlowTesterHighlight } from "../../flow-tester-context";

const TRIGGER_ICONS: Record<FlowEntryTrigger, typeof MessageSquare> = {
  conversation_started: MessageSquare,
  keyword_match: Hash,
  segment_entered: Users,
  pipeline_stage_entered: TrendingUp,
};

function triggerPreview(
  trigger: FlowEntryTrigger,
  config: Record<string, unknown> | undefined,
): string {
  switch (trigger) {
    case "conversation_started":
      return "Em qualquer mensagem do lead.";
    case "keyword_match": {
      const keywords = Array.isArray(config?.keywords)
        ? (config!.keywords as unknown[]).filter(
            (k): k is string => typeof k === "string" && k.trim().length > 0,
          )
        : [];
      if (keywords.length === 0) return "Sem palavras-chave configuradas.";
      const preview = keywords.slice(0, 3).join(", ");
      const more = keywords.length > 3 ? ` +${keywords.length - 3}` : "";
      return `Palavras: ${preview}${more}`;
    }
    case "segment_entered":
      return "Quando entrar na segmentação (em breve).";
    case "pipeline_stage_entered":
      return "Quando entrar na etapa (em breve).";
  }
}

interface Props {
  data: FlowEntryNode["data"];
  selected?: boolean;
  /** PR 28: id pra consultar highlight do Tester. */
  id: string;
  /** PR 29 fix (mai/2026): cliente reportou que entry não podia ser
   * deletado — antes era intencional ("entry é único"), mas com PR 10
   * múltiplos triggers convivem no flow, então faz sentido permitir.
   * FlowCanvas pede confirmação via AlertDialog ao receber esse callback
   * pra evitar delete acidental do único entry. */
  onDelete?: () => void;
  onPatch?: (data: Record<string, unknown>) => void;
  catalogs?: FlowCatalogs;
  catalogsLoading?: boolean;
}

export function EntryNodeView({
  data,
  selected,
  id,
  onDelete,
  onPatch,
  catalogs,
  catalogsLoading,
}: Props) {
  const recentlyExecuted = useFlowTesterHighlight(id);
  const Icon = TRIGGER_ICONS[data.trigger] ?? MessageSquare;
  const preview = triggerPreview(data.trigger, data.config);
  const expandedContent =
    selected && onPatch && catalogs ? (
      <InlineFormPanel
        nodeType="entry"
        data={data as unknown as Record<string, unknown>}
        onPatch={onPatch}
        catalogs={catalogs}
        catalogsLoading={catalogsLoading}
      />
    ) : null;
  return (
    <>
      <NodeShell
        icon={Icon}
        label={data.label || "Entrada"}
        badge="Entrada"
        variant="entry"
        selected={selected}
        onDelete={onDelete}
        expandedContent={expandedContent}
        recentlyExecuted={recentlyExecuted}
      >
        {preview}
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        className="!size-3 !bg-success !border-2 !border-background"
      />
    </>
  );
}
