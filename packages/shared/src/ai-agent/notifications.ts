// AI Agent — PR7.1 notification templates contract.
//
// Templates de mensagens WhatsApp que o agente pode disparar como decisão
// (`trigger_notification` handler). Cada template é um row em
// `agent_notification_templates`: nome interno, target (telefone OU grupo),
// corpo com variáveis `{{lead_name}}`, `{{custom.<chave>}}`, etc.
//
// Diferente do handoff (que é UMA notificação fixa por agente, disparada
// só em `stop_agent`), aqui o agente escolhe qual template chamar e
// quando — o LLM decide pela `description` do tool.
//
// Schema lives em migration 023. Runtime lives em
// apps/crm/src/lib/ai-agent/handlers/trigger-notification.ts (Codex, PR7.1b).

import type {
  HandoffNotificationTargetType,
} from "./handoff";

// Reusa o tipo de target do handoff — phone | group, com a mesma semântica.
export type NotificationTargetType = HandoffNotificationTargetType;

// ============================================================================
// Limites e constantes
// ============================================================================

export const NOTIFICATION_TEMPLATE_NAME_MIN_CHARS = 3;
export const NOTIFICATION_TEMPLATE_NAME_MAX_CHARS = 60;

// Description é o que o LLM lê pra decidir disparar — pode ser maior.
export const NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS = 10;
export const NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS = 500;

export const NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH = 1500;

// Phone limits — mesmos do handoff (E.164 sem o +).
export const NOTIFICATION_PHONE_MIN_DIGITS = 10;
export const NOTIFICATION_PHONE_MAX_DIGITS = 15;

// Limite de templates por agente — guard contra spam de presets.
export const NOTIFICATION_TEMPLATES_MAX_PER_AGENT = 20;

// ============================================================================
// Variáveis fixas que o renderer sempre preenche da conversa
// ============================================================================

// Mesmo conjunto do handoff — runtime resolve da conversa atual:
//   - lead_name: nome do lead (fallback "cliente")
//   - lead_phone: telefone E.164 sem +
//   - wa_link: link de volta pro chat
//   - agent_name: agent_config.name
// Diferente do handoff: NÃO temos summary nem handoff_reason aqui (essas
// são específicas do contexto stop_agent).
export interface NotificationFixedVariables {
  lead_name: string;
  lead_phone: string;
  wa_link: string;
  agent_name: string;
}

export const NOTIFICATION_FIXED_VARIABLES: readonly (keyof NotificationFixedVariables)[] = [
  "lead_name",
  "lead_phone",
  "wa_link",
  "agent_name",
];

// ============================================================================
// Variáveis customizadas — `{{custom.foo}}` resolve do input do handler
// ============================================================================

// O LLM pode passar `custom: { key: value }` como input do tool, e o
// renderer expande `{{custom.key}}` no template. Permite, por exemplo:
//   - template: "Lead {{lead_name}} pediu {{custom.produto}} por {{custom.preco}}"
//   - LLM chama: trigger_notification({ template_name: "venda", custom: { produto: "Plano Anual", preco: "R$ 480" } })
//
// Custom keys são limitadas em quantidade e tamanho pra evitar abuso.
export const NOTIFICATION_CUSTOM_KEYS_MAX = 20;
export const NOTIFICATION_CUSTOM_KEY_MAX_CHARS = 40;
export const NOTIFICATION_CUSTOM_VALUE_MAX_CHARS = 200;

// ============================================================================
// Domain types — mirror agent_notification_templates
// ============================================================================

export type NotificationTemplateStatus = "active" | "archived";

export interface AgentNotificationTemplate {
  id: string;
  organization_id: string;
  config_id: string;
  // user-visible label, also the tool name the LLM sees (slugified server-side).
  name: string;
  // descrição pro LLM saber quando chamar. Vai pra `agent_tools.description`
  // do tool registrado pra ele.
  description: string;
  target_type: NotificationTargetType;
  target_address: string;
  body_template: string;
  status: NotificationTemplateStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Input/output das server actions
// ============================================================================

export interface CreateNotificationTemplateInput {
  config_id: string;
  name: string;
  description: string;
  target_type: NotificationTargetType;
  target_address: string;
  body_template: string;
}

export interface UpdateNotificationTemplateInput {
  name?: string;
  description?: string;
  target_type?: NotificationTargetType;
  target_address?: string;
  body_template?: string;
  status?: NotificationTemplateStatus;
}

// ============================================================================
// Handler input (o que o LLM envia pro `trigger_notification`)
// ============================================================================

export interface TriggerNotificationHandlerInput {
  // Nome do template — runtime resolve por (config_id, name).
  template_name: string;
  // Variáveis customizadas, opcionais. Substituem `{{custom.<chave>}}`.
  custom?: Record<string, string>;
}

export interface TriggerNotificationHandlerResult {
  success: boolean;
  template_id?: string;
  template_name?: string;
  target_type?: NotificationTargetType;
  // Endereço NÃO é retornado pro LLM — evita vazar telefone/JID em audit
  // visível em rastros futuros. Só fica no agent_steps.output internamente.
  message_id?: string; // ID da mensagem enviada pelo provider
  error?: string;
}

// ============================================================================
// Renderer — resolve `{{lead_name}}`, `{{custom.foo}}`, etc.
// ============================================================================

const FIXED_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const CUSTOM_VARIABLE_PATTERN = /\{\{\s*custom\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderNotificationTemplate(
  template: string,
  fixed: NotificationFixedVariables,
  custom: Record<string, string> | undefined,
): string {
  const customLookup = custom ?? {};

  // Custom resolves first — `{{custom.x}}` would also match the generic
  // pattern below as `custom`, so we have to expand them before.
  let rendered = template.replace(CUSTOM_VARIABLE_PATTERN, (_match, key: string) => {
    const value = customLookup[key];
    return typeof value === "string" ? value : "";
  });

  // Then the fixed variables. Unknown names render as empty.
  const fixedLookup = fixed as unknown as Record<string, string>;
  rendered = rendered.replace(FIXED_VARIABLE_PATTERN, (_match, key: string) => {
    // Já consumimos os `custom.X` acima, então não tem como bater aqui.
    const value = fixedLookup[key];
    return typeof value === "string" ? value : "";
  });

  return rendered;
}

// Lista placeholders presentes no template — útil pra UI destacar
// reconhecidos vs typos. Retorna pares { kind, name }:
//   - kind="fixed" pra `{{lead_name}}`
//   - kind="custom" pra `{{custom.foo}}`
export type TemplatePlaceholder =
  | { kind: "fixed"; name: string }
  | { kind: "custom"; name: string };

export function listNotificationPlaceholders(template: string): TemplatePlaceholder[] {
  const seen = new Set<string>();
  const out: TemplatePlaceholder[] = [];

  for (const match of template.matchAll(CUSTOM_VARIABLE_PATTERN)) {
    const name = match[1];
    const id = `custom.${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: "custom", name });
  }

  // Pega tudo do padrão genérico — mas só os que NÃO são `custom.*`,
  // porque o regex genérico não cobre `custom.X` (matcha `custom` mas
  // não `custom.X` por causa do `.`).
  for (const match of template.matchAll(FIXED_VARIABLE_PATTERN)) {
    const name = match[1];
    if (name === "custom") continue; // sem o `.foo` é template inválido, ignora
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ kind: "fixed", name });
  }

  return out;
}

export function isKnownFixedVariable(name: string): name is keyof NotificationFixedVariables {
  return (NOTIFICATION_FIXED_VARIABLES as readonly string[]).includes(name);
}

// ============================================================================
// Slug do tool registrado — `agent_tools.name` (visível pro LLM)
// ============================================================================

// Cada template vira um tool implícito com nome `notify_<slug-do-template>`.
// O LLM vê `notify_lead_qualificado` por exemplo, e chama com
// `template_name: "lead qualificado"`. O runtime resolve por config_id +
// nome do template (case-insensitive, depois de trim).
export const NOTIFICATION_TOOL_NAME_PREFIX = "notify_" as const;

export function buildNotificationToolName(templateName: string): string {
  const slug = templateName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "notification";
  return `${NOTIFICATION_TOOL_NAME_PREFIX}${slug}`;
}

// ============================================================================
// Audit step payloads
// ============================================================================

export interface TriggerNotificationStepInput {
  template_id: string;
  template_name: string;
  custom_keys: string[]; // só os nomes — valores ficam no rendered_body
  rendered_body_length: number;
}

export interface TriggerNotificationStepOutput {
  success: boolean;
  target_type: NotificationTargetType;
  // address é redacted pra log: keep last 4 digits / chars
  target_address_masked: string;
  message_id?: string;
  duration_ms: number;
  error?: string;
}

export function maskTargetAddress(
  type: NotificationTargetType,
  address: string,
): string {
  const trimmed = address.trim();
  if (trimmed.length <= 4) return trimmed;
  const visible = trimmed.slice(-4);
  if (type === "phone") {
    return `***${visible}`;
  }
  return `***${visible}@g.us`;
}
