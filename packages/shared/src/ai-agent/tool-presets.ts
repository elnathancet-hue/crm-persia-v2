// AI Agent — native tool presets.
//
// Canonical catalog of built-in tools. UI renders the Decision Intelligence
// modal from this list; Runtime uses each entry as a template when inserting
// an `agent_tools` row. The `handler` field must match a native_handler slug
// from NATIVE_HANDLERS, and the `input_schema` MUST mirror what the TS
// handler validates at runtime.
//
// Shipping gate: each preset declares `shipped_in_pr`. UI renders all presets
// but disables "Adicionar" for handlers whose PR has not merged yet, so the
// Decision Intelligence modal matches the roadmap in-product.

import type { JSONSchemaObject, NativeHandlerName } from "./types";

export type ToolCategory =
  | "handoff"
  | "transfer"
  | "tag"
  | "assignment"
  | "routing"
  | "notification"
  | "audio"
  | "scheduling";

export interface NativeToolPreset {
  handler: NativeHandlerName;
  name: string;                 // DB tool.name (also exposed to LLM)
  display_name: string;         // UI label (PT-BR)
  description: string;          // LLM-facing description (EN)
  ui_description: string;       // UI description (PT-BR, short)
  icon_name: string;            // lucide-react icon name; UI maps to component
  category: ToolCategory;
  input_schema: JSONSchemaObject;
  shipped_in_pr: "PR1" | "PR3" | "PR5" | "PR7";
}

export const NATIVE_TOOL_PRESETS: readonly NativeToolPreset[] = [
  // PR1 — handoff
  {
    handler: "stop_agent",
    name: "stop_agent",
    display_name: "Interromper agente",
    description:
      "Pause the native agent for this conversation and hand the next reply to a human.",
    ui_description: "Pausa o agente e transfere a conversa para um atendente humano.",
    icon_name: "PowerOff",
    category: "handoff",
    shipped_in_pr: "PR1",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for the handoff (optional).",
        },
      },
    },
  },

  // PR3 — transfer + tagging
  {
    handler: "transfer_to_user",
    name: "transfer_to_user",
    display_name: "Transferir para usuario",
    description:
      "Reassign the current lead to a specific team member. The user must already belong to the organization.",
    ui_description: "Atribui o lead a um atendente especifico da equipe.",
    icon_name: "UserCheck",
    category: "transfer",
    shipped_in_pr: "PR3",
    input_schema: {
      type: "object",
      required: ["user_id"],
      properties: {
        user_id: {
          type: "string",
          format: "uuid",
          description: "UUID of the organization member to assign the lead to.",
        },
        reason: {
          type: "string",
          description: "Optional short justification for the transfer.",
        },
      },
    },
  },
  {
    handler: "transfer_to_stage",
    name: "transfer_to_stage",
    display_name: "Avancar etapa do agente",
    description:
      "Advance the agent conversation to a different stage in the same agent configuration.",
    ui_description: "Move a conversa para outra etapa do mesmo agente.",
    icon_name: "ArrowRightCircle",
    category: "transfer",
    shipped_in_pr: "PR3",
    input_schema: {
      type: "object",
      required: ["stage_id"],
      properties: {
        stage_id: {
          type: "string",
          format: "uuid",
          description:
            "UUID of the target stage. Must belong to the same agent config.",
        },
        reason: { type: "string" },
      },
    },
  },
  {
    handler: "transfer_to_agent",
    name: "transfer_to_agent",
    display_name: "Transferir para outro agente",
    description:
      "Hand the conversation to a different agent configuration (for example, from Recepcao to Vendas).",
    ui_description: "Passa a conversa para outro agente IA (ex: Recepcao -> Vendas).",
    icon_name: "Bot",
    category: "transfer",
    shipped_in_pr: "PR3",
    input_schema: {
      type: "object",
      required: ["agent_config_id"],
      properties: {
        agent_config_id: {
          type: "string",
          format: "uuid",
          description:
            "UUID of the destination agent_config. Must belong to the same organization and be status='active'.",
        },
        reason: { type: "string" },
      },
    },
  },
  {
    handler: "add_tag",
    name: "add_tag",
    display_name: "Adicionar tag",
    description:
      "Attach a tag to the current lead. If the tag name does not exist in the organization, it is created.",
    ui_description: "Adiciona uma tag ao lead para segmentar e automatizar depois.",
    icon_name: "Tag",
    category: "tag",
    shipped_in_pr: "PR3",
    input_schema: {
      type: "object",
      required: ["tag_name"],
      properties: {
        tag_name: {
          type: "string",
          description:
            "Human-friendly tag label (e.g. 'qualificado'). Looked up or created scoped to the organization.",
        },
      },
    },
  },

  // Later PRs — metadata-only placeholders so UI can render disabled cards
  {
    handler: "assign_source",
    name: "assign_source",
    display_name: "Atribuir fonte",
    description:
      "Set the lead's source (origem) to the configured value. Useful for attribution reports.",
    ui_description: "Define a fonte/origem do lead.",
    icon_name: "FolderInput",
    category: "assignment",
    shipped_in_pr: "PR5",
    input_schema: {
      type: "object",
      required: ["source"],
      properties: {
        source: { type: "string" },
      },
    },
  },
  {
    handler: "assign_product",
    name: "assign_product",
    display_name: "Vincular produto",
    description: "Attach a product or offering to the current lead.",
    ui_description: "Associa um produto ao lead para a proposta.",
    icon_name: "Package",
    category: "assignment",
    shipped_in_pr: "PR5",
    input_schema: {
      type: "object",
      required: ["product_id"],
      properties: {
        product_id: { type: "string", format: "uuid" },
      },
    },
  },
  {
    handler: "assign_department",
    name: "assign_department",
    display_name: "Atribuir departamento",
    description: "Assign the lead to a specific department.",
    ui_description: "Define o departamento responsavel pelo lead.",
    icon_name: "Building2",
    category: "assignment",
    shipped_in_pr: "PR5",
    input_schema: {
      type: "object",
      required: ["department_id"],
      properties: {
        department_id: { type: "string", format: "uuid" },
      },
    },
  },
  {
    handler: "round_robin_user",
    name: "round_robin_user",
    display_name: "Rodizio de usuarios",
    description:
      "Distribute the lead across active users via round-robin to balance workload.",
    ui_description: "Distribui o lead entre atendentes disponiveis no rodizio.",
    icon_name: "Shuffle",
    category: "routing",
    shipped_in_pr: "PR5",
    input_schema: {
      type: "object",
      properties: {
        department_id: { type: "string", format: "uuid" },
      },
    },
  },
  {
    handler: "round_robin_agent",
    name: "round_robin_agent",
    display_name: "Rodizio de agentes",
    description: "Route the conversation across multiple agent configs via round-robin.",
    ui_description: "Distribui a conversa entre agentes IA configurados.",
    icon_name: "Repeat",
    category: "routing",
    shipped_in_pr: "PR5",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    handler: "send_audio",
    name: "send_audio",
    display_name: "Enviar em audio",
    description:
      "Send the assistant reply as an audio note (TTS) instead of plain text.",
    ui_description: "Responde com audio em vez de texto (TTS).",
    icon_name: "AudioLines",
    category: "audio",
    shipped_in_pr: "PR5",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
    },
  },
  {
    handler: "trigger_notification",
    name: "trigger_notification",
    display_name: "Disparar notificacao",
    description:
      "Send a WhatsApp notification template to configured recipients when the agent decides.",
    ui_description: "Dispara um template WhatsApp para destinatarios configurados.",
    icon_name: "BellRing",
    category: "notification",
    shipped_in_pr: "PR7",
    input_schema: {
      type: "object",
      required: ["notification_id"],
      properties: {
        notification_id: { type: "string", format: "uuid" },
        variables: {
          type: "object",
          properties: {},
        },
      },
    },
  },
  {
    handler: "schedule_event",
    name: "schedule_event",
    display_name: "Agendar reuniao",
    description: "Create a calendar event for the current lead.",
    ui_description: "Marca uma reuniao/call no calendario integrado.",
    icon_name: "CalendarPlus",
    category: "scheduling",
    shipped_in_pr: "PR7",
    input_schema: {
      type: "object",
      required: ["start_at", "duration_minutes"],
      properties: {
        start_at: { type: "string", description: "ISO-8601 datetime" },
        duration_minutes: { type: "integer", minimum: 10, maximum: 240 },
        notes: { type: "string" },
      },
    },
  },
];

export function getPreset(handler: NativeHandlerName): NativeToolPreset | undefined {
  return NATIVE_TOOL_PRESETS.find((preset) => preset.handler === handler);
}

export function getPresetsShippedInOrBefore(
  currentPr: NativeToolPreset["shipped_in_pr"],
): NativeToolPreset[] {
  const order: NativeToolPreset["shipped_in_pr"][] = ["PR1", "PR3", "PR5", "PR7"];
  const cutoff = order.indexOf(currentPr);
  return NATIVE_TOOL_PRESETS.filter(
    (preset) => order.indexOf(preset.shipped_in_pr) <= cutoff,
  );
}
