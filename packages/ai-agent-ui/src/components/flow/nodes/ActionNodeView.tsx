"use client";

// Action node — ação determinística (sem passar pela IA). Entrada à
// esquerda, saída "default" à direita. Mostra config inline (tag,
// stage, template, etc) baseado em action_type.

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import {
  ArrowRightLeft,
  Calendar,
  Image as ImageIcon,
  ListChecks,
  Power,
  StopCircle,
  Tag as TagIcon,
  TagsIcon,
  UserCheck,
  UserCog,
} from "lucide-react";
import type {
  FlowActionNode,
  FlowActionType,
} from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";

const ACTION_ICONS: Record<FlowActionType, typeof TagIcon> = {
  add_tag: TagIcon,
  remove_tag: TagsIcon,
  move_pipeline_stage: ArrowRightLeft,
  create_appointment: Calendar,
  trigger_notification: ListChecks,
  send_media: ImageIcon,
  stop_agent: StopCircle,
  transfer_to_user: UserCheck,
  transfer_to_agent: UserCog,
};

function configPreview(actionType: FlowActionType, config: Record<string, unknown>): string {
  switch (actionType) {
    case "add_tag":
    case "remove_tag":
      return (config.tag_name as string) || "Sem tag selecionada";
    case "move_pipeline_stage":
      return (config.stage_name as string) || "Sem etapa selecionada";
    case "create_appointment":
      return (config.type_slug as string) || "Tipo: a IA decide no momento";
    case "trigger_notification":
      return (config.template_name as string) || "Sem template selecionado";
    case "send_media":
      return (config.slug as string) || "Sem mídia selecionada";
    case "transfer_to_user":
      return (config.user as string) || "Sem usuário selecionado";
    case "transfer_to_agent":
      return (config.target_agent_name as string) || "Sem agente alvo";
    case "stop_agent":
      return "Encerra a sessão da IA";
    default:
      return "";
  }
}

interface Props {
  data: FlowActionNode["data"];
  selected?: boolean;
}

export function ActionNodeView({ data, selected }: Props) {
  const Icon = ACTION_ICONS[data.action_type] ?? Power;
  const preview = configPreview(data.action_type, data.config);
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!size-3 !bg-progress !border-2 !border-background"
      />
      <NodeShell
        icon={Icon}
        label={data.label}
        badge="Ação automática"
        variant="action"
        selected={selected}
      >
        <div className="line-clamp-2">{preview}</div>
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        className="!size-3 !bg-progress !border-2 !border-background"
      />
    </>
  );
}
