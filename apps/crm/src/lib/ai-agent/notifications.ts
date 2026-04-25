import "server-only";

import type {
  AgentNotificationTemplate,
  AgentTool,
  NotificationFixedVariables,
  NotificationTargetType,
} from "@persia/shared/ai-agent";
import {
  buildNotificationToolName,
  getPreset,
  maskTargetAddress,
  NOTIFICATION_PHONE_MAX_DIGITS,
  NOTIFICATION_PHONE_MIN_DIGITS,
  renderNotificationTemplate,
} from "@persia/shared/ai-agent";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import type { AgentDb } from "./db";

const DEFAULT_APP_URL = "https://crm.funilpersia.top";
const GROUP_TARGET_MAX_LENGTH = 128;

interface NotificationLeadRow {
  id: string;
  name: string | null;
  phone: string | null;
}

export interface DispatchNotificationTemplateParams {
  template: Pick<
    AgentNotificationTemplate,
    "id" | "name" | "target_type" | "target_address" | "body_template"
  >;
  fixed: NotificationFixedVariables;
  custom?: Record<string, string>;
  provider?: WhatsAppProvider | null;
  dryRun?: boolean;
}

export interface DispatchNotificationTemplateResult {
  messageId: string | null;
  renderedBody: string;
  targetAddressMasked: string;
  targetAddressNormalized: string;
  targetType: NotificationTargetType;
}

export function buildNotificationToolRow(
  template: Pick<
    AgentNotificationTemplate,
    "config_id" | "name" | "description" | "status"
  >,
  organizationId: string,
): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  const preset = getPreset("trigger_notification");
  if (!preset) {
    throw new Error("Preset trigger_notification ausente");
  }

  return {
    organization_id: organizationId,
    config_id: template.config_id,
    name: buildNotificationToolName(template.name),
    description: template.description,
    input_schema: preset.input_schema,
    execution_mode: "native",
    native_handler: "trigger_notification",
    webhook_url: null,
    webhook_secret: null,
    is_enabled: template.status === "active",
  };
}

export async function loadTemplateByName(
  db: AgentDb,
  organizationId: string,
  configId: string,
  name: string,
): Promise<AgentNotificationTemplate | null> {
  const normalizedName = normalizeTemplateName(name);
  if (!normalizedName) return null;

  const { data, error } = await db
    .from("agent_notification_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("config_id", configId);

  if (error) throw new Error(error.message);

  const templates = (data ?? []) as AgentNotificationTemplate[];
  return (
    templates.find(
      (template) => normalizeTemplateName(template.name) === normalizedName,
    ) ?? null
  );
}

export async function loadNotificationTemplateById(
  db: AgentDb,
  organizationId: string,
  configId: string,
  templateId: string,
): Promise<AgentNotificationTemplate | null> {
  const { data, error } = await db
    .from("agent_notification_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("config_id", configId)
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentNotificationTemplate | null) ?? null;
}

export async function loadNotificationLead(
  db: AgentDb,
  organizationId: string,
  leadId: string,
): Promise<NotificationLeadRow> {
  const { data, error } = await db
    .from("leads")
    .select("id, name, phone")
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message ?? "lead not found");
  }

  return data as NotificationLeadRow;
}

export function buildNotificationFixedVariables(params: {
  agentName: string;
  crmConversationId: string;
  lead: Pick<NotificationLeadRow, "name" | "phone">;
}): NotificationFixedVariables {
  return {
    lead_name: params.lead.name?.trim() || "cliente",
    lead_phone: normalizeLeadPhone(params.lead.phone),
    wa_link: buildNotificationWaLink(params.crmConversationId),
    agent_name: params.agentName,
  };
}

export function buildNotificationWaLink(crmConversationId: string): string {
  return `${process.env.PERSIA_APP_URL ?? DEFAULT_APP_URL}/chat/${crmConversationId}`;
}

export function normalizeNotificationTargetAddress(
  type: NotificationTargetType,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("notification target address is required");
  }

  if (type === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    if (
      digits.length < NOTIFICATION_PHONE_MIN_DIGITS ||
      digits.length > NOTIFICATION_PHONE_MAX_DIGITS
    ) {
      throw new Error("notification phone target is invalid");
    }
    return digits;
  }

  if (trimmed.length > GROUP_TARGET_MAX_LENGTH) {
    throw new Error("notification group target exceeds 128 characters");
  }

  return trimmed;
}

export async function dispatchNotificationTemplate(
  params: DispatchNotificationTemplateParams,
): Promise<DispatchNotificationTemplateResult> {
  const targetAddressNormalized = normalizeNotificationTargetAddress(
    params.template.target_type,
    params.template.target_address,
  );
  const renderedBody = renderNotificationTemplate(
    params.template.body_template,
    params.fixed,
    params.custom,
  );
  const targetAddressMasked = maskTargetAddress(
    params.template.target_type,
    targetAddressNormalized,
  );

  if (params.dryRun) {
    return {
      messageId: null,
      renderedBody,
      targetAddressMasked,
      targetAddressNormalized,
      targetType: params.template.target_type,
    };
  }

  if (!params.provider) {
    throw new Error("whatsapp provider unavailable");
  }

  const response = await params.provider.sendText({
    phone: targetAddressNormalized,
    message: renderedBody,
  });

  return {
    messageId: response.messageId ?? null,
    renderedBody,
    targetAddressMasked,
    targetAddressNormalized,
    targetType: params.template.target_type,
  };
}

function normalizeTemplateName(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function normalizeLeadPhone(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}
