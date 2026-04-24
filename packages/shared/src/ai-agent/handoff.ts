// AI Agent — PR5.6 handoff notification contract.
//
// When `stop_agent` fires (agent decides it cannot or should not continue),
// we need the human team to actually know so they can pick up the
// conversation. Today `stop_agent` only sets `human_handoff_at` and writes a
// lead_activity note — operators find out by polling the CRM.
//
// PR5.6 adds an opt-in WhatsApp notification: a text message sent through
// the same UAZAPI/Meta connection that received the inbound, targeted at a
// phone or group configured per agent, rendered from a template with lead
// name, phone, a short summary of the conversation, and a link back to the
// CRM chat view.
//
// See CODEX_SYNC.md PR5.6 section for the runtime flow and integration.

// ============================================================================
// Configuration — flat columns on agent_configs (migration 021)
// ============================================================================

export type HandoffNotificationTargetType = "phone" | "group";

export interface HandoffNotificationTarget {
  type: HandoffNotificationTargetType;
  // phone: digits only (E.164 without the plus), e.g. "5511999999999".
  // group: UAZAPI group JID, e.g. "1203@g.us" (runtime normalizes).
  address: string;
}

export interface HandoffNotificationConfig {
  enabled: boolean;
  target: HandoffNotificationTarget | null;
  template: string; // may be empty — runtime falls back to HANDOFF_DEFAULT_TEMPLATE
}

export const HANDOFF_TEMPLATE_MAX_LENGTH = 1500;

export const HANDOFF_DEFAULT_TEMPLATE =
  "Atencao: o agente transferiu o atendimento para humano.\n\n" +
  "Lead: {{lead_name}}\n" +
  "Telefone: {{lead_phone}}\n" +
  "Motivo: {{handoff_reason}}\n\n" +
  "Resumo da conversa:\n{{summary}}\n\n" +
  "Abrir chat: {{wa_link}}";

// ============================================================================
// Template variables the renderer always fills. Unknown placeholders render
// as empty string — no runtime error. Missing keys in `vars` render as empty.
// ============================================================================

export interface HandoffNotificationVariables {
  lead_name: string;        // falls back to "cliente" when null
  lead_phone: string;       // E.164 without the plus, pre-formatted by runtime
  summary: string;          // short brief, see CODEX_SYNC.md for source rules
  wa_link: string;          // deep link to CRM conversation
  agent_name: string;       // agent_config.name
  handoff_reason: string;   // from stop_agent input; falls back to "solicitacao do agente"
}

export const HANDOFF_TEMPLATE_VARIABLES: readonly (keyof HandoffNotificationVariables)[] = [
  "lead_name",
  "lead_phone",
  "summary",
  "wa_link",
  "agent_name",
  "handoff_reason",
];

// ============================================================================
// Renderer
// ============================================================================

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderHandoffTemplate(
  template: string,
  vars: HandoffNotificationVariables,
): string {
  const source = template.trim() || HANDOFF_DEFAULT_TEMPLATE;
  const lookup = vars as unknown as Record<string, string>;
  return source.replace(VARIABLE_PATTERN, (_match, key: string) => {
    const value = lookup[key];
    return typeof value === "string" ? value : "";
  });
}

// Convenience helpers for the UI to highlight recognized placeholders vs
// typos. Does not throw on unknown keys — consistent with the renderer.
export function listTemplatePlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    found.add(match[1]);
  }
  return [...found];
}

export function isKnownTemplateVariable(name: string): name is keyof HandoffNotificationVariables {
  return (HANDOFF_TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

// ============================================================================
// Target input shape for normalization (UI form sends strings; runtime
// sanitizes). Keeps the contract explicit about what the server expects.
// ============================================================================

export interface SetHandoffTargetInput {
  type: HandoffNotificationTargetType;
  address: string;
}

export const HANDOFF_PHONE_MIN_DIGITS = 10;
export const HANDOFF_PHONE_MAX_DIGITS = 15;
