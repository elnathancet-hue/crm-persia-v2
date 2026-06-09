"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import {
  ArrowRightLeft,
  Calendar,
  Image as ImageIcon,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Pencil,
  Power,
  Shuffle,
  StopCircle,
  Tag as TagIcon,
  TagsIcon,
  Timer,
  UserCheck,
  UserCog,
  XCircle,
} from "lucide-react";
import type {
  FlowActionNode,
  FlowActionType,
} from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";
import { InlineFormPanel } from "../InlineFormPanel";
import type { FlowCatalogs } from "../catalog-types";
import { useFlowTesterHighlight } from "../../flow-tester-context";

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
  set_lead_custom_field: Pencil,
  send_whatsapp_message: MessageCircle,
  send_template_message: MessageSquare,
  round_robin_user: Shuffle,
  close_conversation: XCircle,
  wait_seconds: Timer,
};

function configPreview(
  actionType: FlowActionType,
  config: Record<string, unknown>,
  catalogs?: FlowCatalogs,
): string {
  switch (actionType) {
    case "add_tag":
    case "remove_tag":
      return (config.tag_name as string) || "Sem tag selecionada";
    case "move_pipeline_stage": {
      // Fix mai/2026: antes lia config.stage_name, mas a UI nova
      // (PicketHierarquico do PR #397) persiste config.stage_id (UUID).
      // Sem este fix, todo card de mover etapa ficava com "Sem etapa
      // selecionada" + alerta amarelo mesmo quando configurado.
      const stageId = (config.stage_id as string) || "";
      const stage = catalogs?.pipeline_stages.find((s) => s.id === stageId);
      if (stage) {
        return stage.pipeline_name
          ? `${stage.pipeline_name} › ${stage.name}`
          : stage.name;
      }
      // Fallback pra flows legacy salvos antes do Backlog #11 que
      // ainda guardam stage_name no banco.
      return (config.stage_name as string) || "Sem etapa selecionada";
    }
    case "create_appointment": {
      const typeSlug = (config.type_slug as string) || "";
      const service = catalogs?.agenda_services.find((s) => s.slug === typeSlug);
      return service
        ? `${service.name} (${service.duration_minutes}min)`
        : "Tipo: a IA decide no momento";
    }
    case "trigger_notification":
      return (config.template_name as string) || "Sem template selecionado";
    case "send_media":
      return (config.slug as string) || "Sem mídia selecionada";
    case "transfer_to_user": {
      const user = (config.user as string) || "";
      const member = catalogs?.members.find(
        (m) => m.email === user || m.user_id === user,
      );
      return member
        ? member.name + (member.email ? ` (${member.email})` : "")
        : user || "Sem usuário selecionado";
    }
    case "transfer_to_agent":
      return (config.target_agent_name as string) || "Sem agente alvo";
    case "stop_agent":
      return "Encerra a sessão da IA";
    case "set_lead_custom_field": {
      const fieldKey = (config.field_key as string) || "";
      const field = catalogs?.custom_fields.find((f) => f.field_key === fieldKey);
      const value = (config.value as string) || "(vazio)";
      return `${field?.name ?? (fieldKey || "campo")} = ${value}`;
    }
    case "send_whatsapp_message": {
      const message = (config.message as string) || "";
      if (!message.trim()) return "Sem mensagem configurada";
      const firstLine = message.split("\n")[0] ?? "";
      return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
    }
    case "send_template_message": {
      const tplKey = (config.template_key as string) || "";
      const tpl = catalogs?.message_templates.find((t) => t.key === tplKey);
      return tpl ? tpl.name : (tplKey || "Sem template selecionado");
    }
    case "round_robin_user":
      return "Próximo atendente disponível (menos leads)";
    default:
      return "";
  }
}

function incompleteReasonFor(
  actionType: FlowActionType,
  config: Record<string, unknown>,
): string | null {
  switch (actionType) {
    case "add_tag":
    case "remove_tag":
      if (!(config.tag_name as string)?.trim()) return "Falta selecionar tag";
      return null;
    case "move_pipeline_stage":
      // Fix mai/2026: UI nova persiste stage_id, nao stage_name.
      // Considera valido se QUALQUER um estiver preenchido (fallback
      // pra flows legacy).
      if (
        !(config.stage_id as string)?.trim() &&
        !(config.stage_name as string)?.trim()
      ) {
        return "Falta etapa de destino";
      }
      return null;
    case "trigger_notification":
      if (!(config.template_name as string)?.trim()) return "Falta template";
      return null;
    case "send_media":
      if (!(config.slug as string)?.trim()) return "Falta mídia";
      return null;
    case "transfer_to_user":
      if (!(config.user as string)?.trim()) return "Falta atendente";
      return null;
    case "transfer_to_agent":
      if (!(config.target_agent_name as string)?.trim())
        return "Falta agente de destino";
      return null;
    case "set_lead_custom_field":
      if (!(config.field_key as string)?.trim()) return "Falta campo";
      return null;
    case "send_whatsapp_message":
      if (!(config.message as string)?.trim()) return "Falta mensagem";
      return null;
    case "send_template_message":
      if (!(config.template_key as string)?.trim()) return "Falta template";
      return null;
    default:
      return null;
  }
}

interface Props {
  data: FlowActionNode["data"];
  selected?: boolean;
  id: string;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onPatch?: (data: Record<string, unknown>) => void;
  catalogs?: FlowCatalogs;
  catalogsLoading?: boolean;
}

export function ActionNodeView({
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
  const Icon = ACTION_ICONS[data.action_type] ?? Power;
  const preview = configPreview(data.action_type, data.config, catalogs);
  const incompleteReason = incompleteReasonFor(data.action_type, data.config);
  const expandedContent =
    onPatch && catalogs ? (
      <InlineFormPanel
        key={id}
        nodeType="action"
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
        className="!size-3 !bg-progress !border-2 !border-background"
      />
      <NodeShell
        icon={Icon}
        label={data.label}
        badge="Ação"
        variant="action"
        selected={selected}
        incomplete={incompleteReason !== null}
        incompleteReason={incompleteReason ?? undefined}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        expandedContent={expandedContent}
        recentlyExecuted={recentlyExecuted}
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
