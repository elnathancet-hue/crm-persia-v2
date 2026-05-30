// AI Agent — catálogo de tarefas (cards arrastáveis do FlowSidebar).
//
// PR-FLOW-PIVOT PR 3 (mai/2026): vocabulário PT-BR sem jargão de runtime
// (sem "trigger", "on_tool_success", "auto_action"). Cliente arrasta um
// card → FlowCanvas instancia o node correspondente no canvas.
//
// Organizado em 3 categorias (Entrada / Ações / Segmentações) que viram
// accordion no sidebar. Cada item tem chave única `task_key` usada pra
// derivar tipo do node + payload inicial do data.

import type { FlowActionType, FlowConditionType } from "@persia/shared/ai-agent";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  BadgeCheck,
  Calendar,
  Filter,
  Hash,
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
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
} from "lucide-react";

export type FlowSidebarCategory =
  | "entrada"
  | "atendimento"
  | "acoes"
  | "segmentacoes";

export interface FlowSidebarItem {
  task_key: string;
  category: FlowSidebarCategory;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tipo de node criado quando o item é arrastado pro canvas. */
  node_type: "entry" | "ai_agent" | "action" | "condition";
  /** Payload inicial pra node.data quando o item é instanciado. */
  default_data: Record<string, unknown>;
}

// ============================================================================
// Entrada (1 só por enquanto, V1)
// ============================================================================

const ENTRY_ITEMS: FlowSidebarItem[] = [
  {
    task_key: "entry.conversation_started",
    category: "entrada",
    label: "Conversa iniciada",
    description:
      "Dispara o fluxo em qualquer mensagem do lead. Padrão pra agentes de atendimento.",
    icon: MessageSquare,
    node_type: "entry",
    default_data: {
      label: "Conversa iniciada",
      trigger: "conversation_started",
      config: {},
    },
  },
  {
    task_key: "entry.keyword_match",
    category: "entrada",
    label: "Palavra-chave recebida",
    description:
      "Dispara só quando o lead manda uma palavra específica (ex: \"comprar\", \"agendar\"). Útil pra fluxos especializados.",
    icon: Hash,
    node_type: "entry",
    default_data: {
      label: "Palavra-chave",
      trigger: "keyword_match",
      config: { keywords: [] as string[] },
    },
  },
  {
    task_key: "entry.segment_entered",
    category: "entrada",
    label: "Entrou em segmentação",
    description:
      "Dispara quando o lead começa a casar com as regras de uma segmentação salva (após criar lead, mudar tags ou campos). Use ações proativas (Enviar mensagem WhatsApp) já que não há msg do lead pra IA reagir.",
    icon: Users,
    node_type: "entry",
    default_data: {
      label: "Entrou em segmentação",
      trigger: "segment_entered",
      config: { segment_id: "" },
    },
  },
  {
    task_key: "entry.pipeline_stage_entered",
    category: "entrada",
    label: "Entrou em etapa do funil",
    description:
      "Dispara quando o lead/deal entra numa etapa específica do Kanban — seja por drag manual ou por outro agente. Use ações proativas (Enviar mensagem WhatsApp) já que não há msg do lead pra IA reagir.",
    icon: TrendingUp,
    node_type: "entry",
    default_data: {
      label: "Entrou em etapa do funil",
      trigger: "pipeline_stage_entered",
      config: { stage_id: "" },
    },
  },
];

// ============================================================================
// Ações (IA + ações determinísticas)
// ============================================================================

const ACTION_ITEMS: FlowSidebarItem[] = [
  {
    task_key: "ai_agent.default",
    category: "atendimento",
    label: "Conversar com IA",
    description:
      "A IA conversa com o lead. Você define o que ela deve fazer aqui (qualificar, apresentar, agendar). Pode chamar ferramentas como criar agendamento, adicionar tag, etc.",
    icon: BadgeCheck,
    node_type: "ai_agent",
    default_data: {
      label: "Conversar com IA",
      system_prompt: "",
      instructions: [],
    },
  },
  {
    task_key: "action.add_tag",
    category: "acoes",
    label: "Adicionar tag",
    description: "Marca o lead com uma tag existente no CRM.",
    icon: TagIcon,
    node_type: "action",
    default_data: {
      label: "Adicionar tag",
      action_type: "add_tag" satisfies FlowActionType,
      config: { tag_name: "" },
    },
  },
  {
    task_key: "action.remove_tag",
    category: "acoes",
    label: "Remover tag",
    description: "Remove uma tag específica do lead.",
    icon: TagsIcon,
    node_type: "action",
    default_data: {
      label: "Remover tag",
      action_type: "remove_tag" satisfies FlowActionType,
      config: { tag_name: "" },
    },
  },
  {
    task_key: "action.move_pipeline_stage",
    category: "acoes",
    label: "Mover etapa do funil",
    description: "Move o lead para outra etapa do Kanban.",
    icon: ArrowRightLeft,
    node_type: "action",
    default_data: {
      label: "Mover etapa do funil",
      action_type: "move_pipeline_stage" satisfies FlowActionType,
      config: { pipeline_id: "", stage_id: "" },
    },
  },
  {
    task_key: "action.create_appointment",
    category: "acoes",
    label: "Criar agendamento",
    description:
      "Cria uma reunião na Agenda Persia. Use depois que IA confirmou tipo + data + hora + e-mail do lead.",
    icon: Calendar,
    node_type: "action",
    default_data: {
      label: "Criar agendamento",
      action_type: "create_appointment" satisfies FlowActionType,
      config: {},
    },
  },
  {
    task_key: "action.trigger_notification",
    category: "acoes",
    label: "Avisar equipe",
    description:
      "Envia uma notificação interna pra equipe (WhatsApp ou grupo). Útil pra alertar que um lead virou qualificado, agendou reunião, etc.",
    icon: ListChecks,
    node_type: "action",
    default_data: {
      label: "Avisar equipe",
      action_type: "trigger_notification" satisfies FlowActionType,
      config: { template_name: "" },
    },
  },
  {
    task_key: "action.send_media",
    category: "acoes",
    label: "Enviar mídia",
    description:
      "Envia imagem/PDF/vídeo da Biblioteca de mídia pro lead. Use slug do arquivo.",
    icon: ImageIcon,
    node_type: "action",
    default_data: {
      label: "Enviar mídia",
      action_type: "send_media" satisfies FlowActionType,
      config: { slug: "" },
    },
  },
  {
    task_key: "action.transfer_to_user",
    category: "acoes",
    label: "Transferir pra humano",
    description: "Escala o atendimento pra um membro específico da equipe.",
    icon: UserCheck,
    node_type: "action",
    default_data: {
      label: "Transferir pra humano",
      action_type: "transfer_to_user" satisfies FlowActionType,
      config: { user: "" },
    },
  },
  {
    task_key: "action.round_robin_user",
    category: "acoes",
    label: "Distribuir lead (rodízio)",
    description:
      "Atribui o lead ao atendente com MENOS leads ativos no momento (algoritmo least-loaded). Pausa o agente IA automaticamente. Use quando não importa QUEM atende, só que a fila gire.",
    icon: Shuffle,
    node_type: "action",
    default_data: {
      label: "Distribuir lead (rodízio)",
      action_type: "round_robin_user" satisfies FlowActionType,
      config: {},
    },
  },
  {
    task_key: "action.transfer_to_agent",
    category: "acoes",
    label: "Transferir pra outro agente",
    description:
      "Passa a conversa pra outro agente IA da mesma org (ex: Recepção → Vendas).",
    icon: UserCog,
    node_type: "action",
    default_data: {
      label: "Transferir pra outro agente",
      action_type: "transfer_to_agent" satisfies FlowActionType,
      config: { target_agent_name: "" },
    },
  },
  {
    task_key: "action.stop_agent",
    category: "acoes",
    label: "Encerrar atendimento",
    description:
      "Termina a sessão da IA. Usar quando o lead pede humano, está fora de escopo ou reclamação séria.",
    icon: StopCircle,
    node_type: "action",
    default_data: {
      label: "Encerrar atendimento",
      action_type: "stop_agent" satisfies FlowActionType,
      config: {},
    },
  },
  {
    task_key: "action.set_lead_custom_field",
    category: "acoes",
    label: "Salvar dado do lead",
    description:
      "Grava um campo personalizado no perfil do lead (idade, CPF, profissão, etc). O campo precisa estar cadastrado em CRM → Campos personalizados.",
    icon: Pencil,
    node_type: "action",
    default_data: {
      label: "Salvar dado do lead",
      action_type: "set_lead_custom_field" satisfies FlowActionType,
      config: { field_key: "", value: "" },
    },
  },
  {
    task_key: "action.send_whatsapp_message",
    category: "acoes",
    label: "Enviar mensagem WhatsApp",
    description:
      "Envia um texto literal pro lead via WhatsApp, SEM passar pela IA. Aceita placeholders {{lead.name}}, {{lead.phone}}, {{lead.email}}. Use pra boas-vindas, lembretes ou avisos padrão.",
    icon: MessageCircle,
    node_type: "action",
    default_data: {
      label: "Enviar mensagem WhatsApp",
      action_type: "send_whatsapp_message" satisfies FlowActionType,
      config: { message: "" },
    },
  },
];

// ============================================================================
// Segmentações (V1 ainda não executáveis no runtime — placeholder visual)
// ============================================================================

const SEGMENTATION_ITEMS: FlowSidebarItem[] = [
  {
    task_key: "condition.has_tag",
    category: "segmentacoes",
    label: "Verificar tag",
    description:
      "Verifica se o lead está marcado com uma tag específica. Ramifica o fluxo em Sim / Não.",
    icon: Filter,
    node_type: "condition",
    default_data: {
      label: "Verificar tag",
      condition_type: "has_tag" satisfies FlowConditionType,
      config: { tag_name: "" },
    },
  },
  {
    task_key: "condition.lead_custom_field_equals",
    category: "segmentacoes",
    label: "Verificar campo personalizado",
    description:
      "Compara um campo customizado do lead com um valor esperado. Ramifica em Sim / Não.",
    icon: Filter,
    node_type: "condition",
    default_data: {
      label: "Verificar campo personalizado",
      condition_type: "lead_custom_field_equals" satisfies FlowConditionType,
      config: { field_name: "", value: "" },
    },
  },
  {
    task_key: "condition.in_segment",
    category: "segmentacoes",
    label: "Verificar segmentação",
    description:
      "Verifica se o lead está incluído em uma segmentação salva do CRM.",
    icon: Filter,
    node_type: "condition",
    default_data: {
      label: "Verificar segmentação",
      condition_type: "in_segment" satisfies FlowConditionType,
      config: { segment_id: "" },
    },
  },
];

export const FLOW_SIDEBAR_CATEGORIES: ReadonlyArray<{
  id: FlowSidebarCategory;
  label: string;
  items: ReadonlyArray<FlowSidebarItem>;
}> = [
  {
    id: "atendimento",
    label: "Atendimento",
    items: ACTION_ITEMS.filter((item) => item.category === "atendimento"),
  },
  {
    id: "acoes",
    label: "Ações",
    items: ACTION_ITEMS.filter((item) => item.category === "acoes"),
  },
  { id: "segmentacoes", label: "Segmentações", items: SEGMENTATION_ITEMS },
];

export function findSidebarItem(taskKey: string): FlowSidebarItem | null {
  const entry = ENTRY_ITEMS.find((i) => i.task_key === taskKey);
  if (entry) return entry;
  for (const cat of FLOW_SIDEBAR_CATEGORIES) {
    const found = cat.items.find((i) => i.task_key === taskKey);
    if (found) return found;
  }
  return null;
}
