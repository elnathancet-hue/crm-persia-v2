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
import { InlineFormPanel } from "../InlineFormPanel";
import type { FlowCatalogs } from "../catalog-types";
import { useFlowTesterHighlight } from "../../flow-tester-context";

interface Props {
  data: FlowAIAgentNode["data"];
  selected?: boolean;
  /** PR 28 (mai/2026): id do node passado pelo wrapper do nodeTypes
   * pra consultar o highlight do Tester via context. */
  id: string;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onPatch?: (data: Record<string, unknown>) => void;
  catalogs?: FlowCatalogs;
  catalogsLoading?: boolean;
}

export function AIAgentNodeView({
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
  const instructions = data.instructions ?? [];
  // PR 23 (mai/2026): preview de prompt foi removido do card. Prompt
  // base vive em Configurações do agente (RulesTab) — mostrá-lo aqui
  // duplicava informação e confundia. Card agora mostra só label +
  // lista de instructions[] (saídas nomeadas).
  //
  // incompleteReason também sumiu: IA sem prompt local cai no prompt
  // global de Configurações; sem instructions cai no handle default.
  // Ambos cenários são válidos — não tem motivo pra marcar âmbar.
  //
  // PR 21 (mai/2026): form inline quando selected
  // Fix mai/2026: key={id} forca remount do InlineFormPanel quando o
  // cliente seleciona outro node. Sem isso, draft de outro node poderia
  // vazar pra este. Tambem garante que data inicial seja respeitada.
  const expandedContent =
    onPatch && catalogs ? (
      <InlineFormPanel
        key={id}
        nodeType="ai_agent"
        data={data as unknown as Record<string, unknown>}
        onPatch={onPatch}
        catalogs={catalogs}
        catalogsLoading={catalogsLoading}
      />
    ) : null;

  // Handles ancorados em px absolutos no header do card (~68px de altura).
  // Centro do header ≈ 34px do topo. Usar px em vez de `top %` evita
  // que os handles flutuem para o meio do formulário quando o card
  // expande (form pode ter 400px+, fazendo 50% cair em lugar errado).
  //
  // Default: centralizado no header (34px).
  // Instructions: distribuídas na seção de conteúdo logo abaixo do header.
  // Header ~68px + border 1px + py-2.5 10px = ~79px até o conteúdo.
  // "Quando terminar" label ~16px + cada row ~20px.
  const HEADER_CENTER_PX = 34;
  const CONTENT_START_PX = 95; // após header + border + padding + label
  const ROW_HEIGHT_PX = 20;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{ top: HEADER_CENTER_PX }}
        className="!size-3 !bg-primary !border-2 !border-background"
      />
      <NodeShell
        icon={BadgeCheck}
        label={data.label || "Conversar com IA"}
        badge="IA"
        variant="ai_agent"
        selected={selected}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        expandedContent={expandedContent}
        expandedLayout="wide"
        recentlyExecuted={recentlyExecuted}
      >
        {/* PR 23 (mai/2026): card mostra só lista de instructions
            (saídas nomeadas). Texto do prompt sumiu — está em
            Configurações do agente. */}
        {instructions.length > 0 ? (
          <div className="space-y-1">
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
        ) : (
          <div className="italic text-muted-foreground/70">
            Segue o fluxo padrão após responder.
          </div>
        )}
      </NodeShell>
      {/* Handle default — sempre presente. IA cai aqui quando responde
          texto sem chamar emit_event. */}
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        style={{ top: instructions.length === 0 ? HEADER_CENTER_PX : CONTENT_START_PX - ROW_HEIGHT_PX }}
        className="!size-3 !bg-primary !border-2 !border-background"
      >
        <span className="absolute -right-14 -translate-y-1/2 text-[9px] font-semibold text-muted-foreground whitespace-nowrap">
          → padrão
        </span>
      </Handle>
      {/* Handles dinâmicos — 1 por instruction. ID == output_handle.
          Posicionados próximos à linha correspondente na lista. */}
      {instructions.map((ins, idx) => {
        const topPx = CONTENT_START_PX + idx * ROW_HEIGHT_PX;
        const labelText = ins.description?.trim() || ins.output_handle;
        return (
          <Handle
            key={ins.id}
            type="source"
            position={Position.Right}
            id={ins.output_handle}
            style={{ top: topPx }}
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
