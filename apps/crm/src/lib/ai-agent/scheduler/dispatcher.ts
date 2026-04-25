import "server-only";

import type {
  AgentConfig,
  AgentNotificationTemplate,
  NotificationFixedVariables,
} from "@persia/shared/ai-agent";
import { createProvider } from "@/lib/whatsapp/providers";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import type { AgentDb } from "../db";
import { buildNotificationWaLink, dispatchNotificationTemplate } from "../notifications";
import type { ResolvedScheduledLead } from "./lead-resolver";

const DEFAULT_APP_URL = "https://crm.funilpersia.top";

export interface ScheduledDispatchResult {
  leadId: string;
  success: boolean;
  messageId?: string | null;
  error?: string;
}

export async function loadSchedulerProvider(
  db: AgentDb,
  organizationId: string,
): Promise<WhatsAppProvider> {
  const { data, error } = await db
    .from("whatsapp_connections")
    .select(
      "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
    )
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message ?? "whatsapp provider unavailable");
  }

  return createProvider(data as Record<string, unknown>);
}

export async function dispatchScheduledLeadNotification(params: {
  config: Pick<AgentConfig, "name">;
  template: Pick<
    AgentNotificationTemplate,
    "id" | "name" | "target_type" | "target_address" | "body_template"
  >;
  lead: ResolvedScheduledLead;
  provider: WhatsAppProvider;
}): Promise<ScheduledDispatchResult> {
  const fixed: NotificationFixedVariables = {
    lead_name: params.lead.name?.trim() || "cliente",
    lead_phone: (params.lead.phone ?? "").replace(/\D/g, ""),
    wa_link: params.lead.crmConversationId
      ? buildNotificationWaLink(params.lead.crmConversationId)
      : `${process.env.PERSIA_APP_URL ?? DEFAULT_APP_URL}/chat`,
    agent_name: params.config.name,
  };

  const result = await dispatchNotificationTemplate({
    template: params.template,
    fixed,
    provider: params.provider,
    dryRun: false,
  });

  return {
    leadId: params.lead.id,
    success: true,
    messageId: result.messageId,
  };
}
