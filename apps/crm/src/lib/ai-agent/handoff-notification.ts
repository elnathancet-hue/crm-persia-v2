import "server-only";

import { createHash } from "node:crypto";
import OpenAI from "openai";
import {
  HANDOFF_DEFAULT_TEMPLATE,
  HANDOFF_PHONE_MAX_DIGITS,
  HANDOFF_PHONE_MIN_DIGITS,
  HANDOFF_TEMPLATE_MAX_LENGTH,
  INTERNAL_MODEL,
  renderHandoffTemplate,
  type AgentConfig,
  type AgentConversation,
  type HandoffNotificationTargetType,
  type HandoffNotificationVariables,
} from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import type { AgentDb } from "./db";

const DEFAULT_APP_URL = "https://crm.funilpersia.top";
const GROUP_TARGET_MAX_LENGTH = 128;
const FALLBACK_SUMMARY = "Lead acionou o agente e pediu atendimento humano.";
const HANDOFF_SUMMARY_PROMPT =
  "Gere em 2 frases, em portugues brasileiro, o que aconteceu nessa conversa pra alguem da equipe assumir.";

export interface SendHandoffNotificationParams {
  db: AgentDb;
  orgId: string;
  runId: string;
  stepOrderIndex: number;
  config: AgentConfig;
  conversation: AgentConversation;
  leadId: string;
  handoffReason: string;
  provider: WhatsAppProvider | null;
  openaiClient: OpenAI | null;
}

export interface SendHandoffNotificationResult {
  attempted: boolean;
  sent: boolean;
  error?: string;
  audit: Record<string, unknown>;
}

interface LeadSummaryRow {
  name: string | null;
  phone: string | null;
}

interface ConversationMessageRow {
  sender: string | null;
  content: string | null;
  media_url: string | null;
}

export async function sendHandoffNotification(
  params: SendHandoffNotificationParams,
): Promise<SendHandoffNotificationResult> {
  const runtimeConfig = getRuntimeHandoffConfig(params.config);
  if (!runtimeConfig.enabled) {
    return { attempted: false, sent: false, audit: { enabled: false } };
  }
  if (!runtimeConfig.targetType || !runtimeConfig.targetAddress) {
    return {
      attempted: false,
      sent: false,
      audit: { enabled: true, skipped: "missing_target" },
    };
  }
  if (!params.provider) {
    return {
      attempted: false,
      sent: false,
      audit: {
        enabled: true,
        target_type: runtimeConfig.targetType,
        skipped: "missing_provider",
      },
    };
  }

  try {
    const targetAddress = normalizeHandoffTargetAddress(
      runtimeConfig.targetType,
      runtimeConfig.targetAddress,
    );
    const lead = await loadLead(params.db, params.orgId, params.leadId);
    const summary = await buildHandoffSummary(params);
    const waLink = buildHandoffLink(params.conversation.crm_conversation_id);
    const vars: HandoffNotificationVariables = {
      lead_name: lead.name ?? "cliente",
      lead_phone: formatLeadPhoneForDisplay(lead.phone),
      summary: summary.text,
      wa_link: waLink,
      agent_name: params.config.name,
      handoff_reason: params.handoffReason,
    };
    const message = renderHandoffTemplate(runtimeConfig.template, vars);

    await params.provider.sendText({
      phone: targetAddress,
      message,
    });

    return {
      attempted: true,
      sent: true,
      audit: buildAudit({
        stepOrderIndex: params.stepOrderIndex,
        providerName: params.provider.name,
        targetType: runtimeConfig.targetType,
        targetAddress,
        waLink,
        message,
        summarySource: summary.source,
      }),
    };
  } catch (error) {
    logError("ai_agent_handoff_notification_failed", {
      organization_id: params.orgId,
      run_id: params.runId,
      agent_conversation_id: params.conversation.id,
      error: errorMessage(error),
    });
    return {
      attempted: true,
      sent: false,
      error: errorMessage(error),
      audit: {
        target_type: runtimeConfig.targetType,
        error: errorMessage(error),
      },
    };
  }
}

export function normalizeHandoffTargetType(
  value: unknown,
): HandoffNotificationTargetType | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value === "phone" || value === "group") return value;
  throw new Error("Tipo de destino da notificacao invalido");
}

export function normalizeHandoffTargetAddress(
  type: HandoffNotificationTargetType,
  value: string,
): string {
  const raw = value.trim();
  if (!raw) {
    throw new Error("Configure o destino da notificacao antes de ativar");
  }

  if (type === "phone") {
    const digits = raw.replace(/\D/g, "");
    if (
      digits.length < HANDOFF_PHONE_MIN_DIGITS ||
      digits.length > HANDOFF_PHONE_MAX_DIGITS
    ) {
      throw new Error("Telefone da notificacao invalido");
    }
    return digits;
  }

  if (raw.length > GROUP_TARGET_MAX_LENGTH) {
    throw new Error("Destino do grupo excede o limite de 128 caracteres");
  }
  return raw;
}

export function normalizeHandoffTemplate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const template = String(value).trim();
  if (!template) return null;
  if (template.length > HANDOFF_TEMPLATE_MAX_LENGTH) {
    throw new Error("Template de handoff excede 1500 caracteres");
  }
  return template;
}

export function getRuntimeHandoffConfig(config: Pick<
  AgentConfig,
  | "handoff_notification_enabled"
  | "handoff_notification_target_type"
  | "handoff_notification_target_address"
  | "handoff_notification_template"
>): {
  enabled: boolean;
  targetType: HandoffNotificationTargetType | null;
  targetAddress: string | null;
  template: string;
} {
  return {
    enabled: Boolean(config.handoff_notification_enabled),
    targetType: config.handoff_notification_target_type ?? null,
    targetAddress: config.handoff_notification_target_address?.trim() || null,
    template: config.handoff_notification_template?.trim() || HANDOFF_DEFAULT_TEMPLATE,
  };
}

async function loadLead(db: AgentDb, orgId: string, leadId: string): Promise<LeadSummaryRow> {
  const { data, error } = await db
    .from("leads")
    .select("name, phone")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) throw new Error(error?.message || "lead not found");
  return data as LeadSummaryRow;
}

async function buildHandoffSummary(
  params: SendHandoffNotificationParams,
): Promise<{ text: string; source: "history_summary" | "openai" | "fallback_plain" }> {
  if (params.conversation.history_summary?.trim()) {
    return {
      text: params.conversation.history_summary.trim().slice(0, 500),
      source: "history_summary",
    };
  }

  if (params.openaiClient && params.conversation.crm_conversation_id) {
    try {
      const transcript = await loadConversationTranscript(
        params.db,
        params.orgId,
        params.conversation.crm_conversation_id,
      );
      if (transcript) {
        const response = await params.openaiClient.chat.completions.create({
          model: INTERNAL_MODEL,
          max_tokens: 200,
          messages: [
            {
              role: "system",
              content: HANDOFF_SUMMARY_PROMPT,
            },
            {
              role: "user",
              content: transcript,
            },
          ] as never,
        } as never) as any;

        const summary = extractText(response.choices?.[0]?.message).trim();
        if (summary) {
          return { text: summary, source: "openai" };
        }
      }
    } catch {
      // Fail-soft below.
    }
  }

  return { text: FALLBACK_SUMMARY, source: "fallback_plain" };
}

async function loadConversationTranscript(
  db: AgentDb,
  orgId: string,
  conversationId: string,
): Promise<string> {
  const { data, error } = await db
    .from("messages")
    .select("sender, content, media_url")
    .eq("organization_id", orgId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const messages = (data ?? []) as ConversationMessageRow[];

  return messages
    .map((message) => `${message.sender === "lead" ? "Lead" : "Agente"}: ${formatMessageText(message)}`)
    .filter(Boolean)
    .join("\n");
}

function formatMessageText(message: ConversationMessageRow): string {
  const text = message.content?.trim();
  if (text) return text;
  if (message.media_url) return "[midia enviada]";
  return "[mensagem sem texto]";
}

function buildHandoffLink(crmConversationId: string): string {
  return `${process.env.PERSIA_APP_URL ?? DEFAULT_APP_URL}/chat/${crmConversationId}`;
}

function formatLeadPhoneForDisplay(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : "nao informado";
}

function buildAudit(params: {
  stepOrderIndex: number;
  providerName: string;
  targetType: HandoffNotificationTargetType;
  targetAddress: string;
  waLink: string;
  message: string;
  summarySource: "history_summary" | "openai" | "fallback_plain";
}): Record<string, unknown> {
  const waLinkHost = safeHost(params.waLink);
  return {
    step_order_index: params.stepOrderIndex,
    provider: params.providerName,
    target_type: params.targetType,
    target_address_sha256: sha256Hex(params.targetAddress),
    message_sha256: sha256Hex(params.message),
    message_length: params.message.length,
    wa_link_host: waLinkHost,
    summary_source: params.summarySource,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractText(message: any): string {
  if (typeof message?.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((block: any) => {
        if (typeof block?.text === "string") return block.text;
        if (typeof block?.content === "string") return block.content;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function safeHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host;
  } catch {
    return null;
  }
}
