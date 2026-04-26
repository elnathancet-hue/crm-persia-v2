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
  | "scheduling"
  | "kanban";

export interface NativeToolPreset {
  handler: NativeHandlerName;
  name: string;                 // DB tool.name (also exposed to LLM)
  display_name: string;         // UI label (PT-BR)
  description: string;          // LLM-facing description (EN)
  ui_description: string;       // UI description (PT-BR, short)
  icon_name: string;            // lucide-react icon name; UI maps to component
  category: ToolCategory;
  input_schema: JSONSchemaObject;
  shipped_in_pr: "PR1" | "PR3" | "PR5" | "PR7" | "PR8";
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
    display_name: "Disparar notificação",
    description:
      "Send a WhatsApp notification template to the configured team recipient (phone or group). Use for events the team must know about: lead qualified, booking confirmed, payment received, etc.",
    ui_description:
      "Dispara um template WhatsApp pra equipe quando o agente decidir.",
    icon_name: "BellRing",
    category: "notification",
    shipped_in_pr: "PR7",
    input_schema: {
      type: "object",
      required: ["template_name"],
      properties: {
        template_name: {
          type: "string",
          description:
            "Nome do template configurado (case-insensitive). Resolva pela lista visivel ao agente.",
        },
        custom: {
          type: "object",
          description:
            "Variaveis customizadas que substituem {{custom.<chave>}} no template. Opcional. Use chaves curtas (ate 40 chars) e valores curtos (ate 200 chars).",
        },
      },
    },
  },
  {
    handler: "schedule_event",
    name: "schedule_event",
    display_name: "Calendario (Google)",
    description:
      "Manage Google Calendar events for the current lead. Use action='list' to check availability, action='create' to book a meeting, action='cancel' to cancel by event_id. The agent must have a calendar connection assigned.",
    ui_description:
      "Lista, cria e cancela eventos no Google Calendar conectado.",
    icon_name: "CalendarPlus",
    category: "scheduling",
    shipped_in_pr: "PR7",
    input_schema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          description: "list | create | cancel",
        },
        event_summary: {
          type: "string",
          description: "Titulo do evento (so action=create)",
        },
        event_description: {
          type: "string",
          description: "Detalhes do evento (so action=create)",
        },
        start_time: {
          type: "string",
          description: "ISO 8601 (so action=create)",
        },
        duration_minutes: {
          type: "integer",
          minimum: 5,
          maximum: 480,
          description: "Duracao em minutos (so action=create)",
        },
        attendee_email: {
          type: "string",
          description:
            "Email do participante alem do dono do calendario (so action=create)",
        },
        time_min: {
          type: "string",
          description: "ISO 8601 limite inferior (action=list)",
        },
        time_max: {
          type: "string",
          description: "ISO 8601 limite superior (action=list)",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Quantos eventos retornar (action=list, default 10)",
        },
        event_id: {
          type: "string",
          description: "ID do evento Google (so action=cancel)",
        },
      },
    },
  },

  // PR8 — Kanban control (move lead between pipeline stages)
  {
    handler: "move_pipeline_stage",
    name: "move_pipeline_stage",
    display_name: "Mover etapa no CRM",
    description:
      "Move the lead's deal to a different pipeline stage in the CRM Kanban. Use when the conversation reveals the lead has progressed (e.g., 'Novo' -> 'Qualificado' -> 'Negociacao'). The target stage must belong to the same pipeline as the lead's active deal.",
    ui_description:
      "Move o lead para outra etapa do funil de vendas no CRM (Kanban).",
    icon_name: "Columns3",
    category: "kanban",
    shipped_in_pr: "PR8",
    input_schema: {
      type: "object",
      required: ["stage_id"],
      properties: {
        stage_id: {
          type: "string",
          format: "uuid",
          description:
            "UUID da pipeline_stage de destino. Precisa pertencer ao mesmo funil do deal ativo do lead.",
        },
        pipeline_id: {
          type: "string",
          format: "uuid",
          description:
            "UUID do funil. Opcional — usa o funil do deal ativo do lead se omitido. Necessario se o lead tem deals ativos em mais de um funil.",
        },
        reason: {
          type: "string",
          description: "Justificativa curta da movimentacao (logada no historico do lead).",
        },
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
  const order: NativeToolPreset["shipped_in_pr"][] = ["PR1", "PR3", "PR5", "PR7", "PR8"];
  const cutoff = order.indexOf(currentPr);
  return NATIVE_TOOL_PRESETS.filter(
    (preset) => order.indexOf(preset.shipped_in_pr) <= cutoff,
  );
}
