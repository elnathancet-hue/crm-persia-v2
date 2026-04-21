"use server";

import { requireRole } from "@/lib/auth";
import { createProvider } from "@/lib/whatsapp/providers";
import { hasTemplates } from "@/lib/whatsapp/provider";
import {
  buildTemplateComponents,
  type ParamsSchema,
  type TemplateVariableValues,
} from "@/lib/whatsapp/template-parser";
import type { Json } from "@/types/database";

// ============ Types ============

export interface ApprovedTemplate {
  id: string;
  connection_id: string;
  name: string;
  language: string;
  category: string;
  components: unknown;
  params_schema: ParamsSchema;
}

export interface ConversationWindow {
  provider: string | null;          // "uazapi" | "meta_cloud" | null (sem conn)
  last_inbound_at: string | null;
  inWindow: boolean;                 // sempre true para UAZAPI; calculado para Meta
  hoursSinceInbound: number | null;
  hoursLeft: number;                 // 0 se fora da janela ou sem inbound
}

export interface SendTemplateInput {
  conversationId: string;
  templateId: string;
  variables: TemplateVariableValues;
}

export interface SendTemplateResult {
  ok: boolean;
  messageId?: string;
  wamid?: string;
  error?: string;
}

// ============ List APPROVED templates for the active org ============

export async function listApprovedTemplates(): Promise<ApprovedTemplate[]> {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("wa_templates")
    .select("id, connection_id, name, language, category, components, params_schema")
    .eq("organization_id", orgId)
    .eq("status", "APPROVED")
    .order("name", { ascending: true });

  if (error) {
    console.error("[templates] listApprovedTemplates:", error.message);
    return [];
  }
  return (data ?? []) as unknown as ApprovedTemplate[];
}

// ============ Conversation window info (24h) ============

export async function getConversationWindow(conversationId: string): Promise<ConversationWindow> {
  const { supabase, orgId } = await requireRole("agent");

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, last_inbound_at, organization_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  const { data: conn } = await supabase
    .from("whatsapp_connections")
    .select("provider")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();

  const provider = (conn as { provider?: string } | null)?.provider ?? null;
  const last = (conv as { last_inbound_at?: string } | null)?.last_inbound_at ?? null;

  // UAZAPI não tem janela (não é oficial). Tratamos como sempre "dentro da janela".
  if (provider !== "meta_cloud") {
    return {
      provider,
      last_inbound_at: last,
      inWindow: true,
      hoursSinceInbound: last ? hoursSince(last) : null,
      hoursLeft: 24,
    };
  }

  if (!last) {
    // Meta sem inbound: fora da janela — só da pra iniciar com template.
    return {
      provider,
      last_inbound_at: null,
      inWindow: false,
      hoursSinceInbound: null,
      hoursLeft: 0,
    };
  }

  const since = hoursSince(last);
  return {
    provider,
    last_inbound_at: last,
    inWindow: since < 24,
    hoursSinceInbound: since,
    hoursLeft: Math.max(0, 24 - since),
  };
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

// ============ Send template ============

export async function sendTemplateMessage(input: SendTemplateInput): Promise<SendTemplateResult> {
  const { supabase, orgId, userId } = await requireRole("agent");

  // 1. Validate conversation + get phone
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, lead_id, organization_id, channel, leads (id, phone)")
    .eq("id", input.conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conversation) return { ok: false, error: "Conversa nao encontrada" };
  const lead = (conversation as Record<string, unknown>).leads as { id: string; phone?: string } | null;
  const phone = lead?.phone;
  if (!phone) return { ok: false, error: "Lead sem telefone" };

  // 2. Load template (must be APPROVED + same org)
  const { data: tpl } = await supabase
    .from("wa_templates")
    .select("id, connection_id, name, language, status, params_schema, components")
    .eq("id", input.templateId)
    .eq("organization_id", orgId)
    .single();

  if (!tpl) return { ok: false, error: "Template nao encontrado" };
  const t = tpl as Record<string, unknown>;
  if (t.status !== "APPROVED") {
    return { ok: false, error: `Template nao esta aprovado (status=${t.status})` };
  }

  // 3. Load connection (must be meta_cloud — templates only exist there)
  const { data: conn } = await supabase
    .from("whatsapp_connections")
    .select("id, provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("id", t.connection_id as string)
    .eq("organization_id", orgId)
    .single();

  if (!conn) return { ok: false, error: "Conexao WhatsApp nao encontrada" };
  if ((conn as { provider?: string }).provider !== "meta_cloud") {
    return { ok: false, error: "Templates so podem ser enviados via Meta Cloud" };
  }

  const provider = createProvider(conn);
  if (!hasTemplates(provider)) {
    return { ok: false, error: "Provider nao suporta envio de template" };
  }

  // 4. Build Graph API components from variables
  const schema = t.params_schema as unknown as ParamsSchema;
  const components = buildTemplateComponents(schema, input.variables);

  // 5. Insert wa_template_sends row (queued)
  const { data: sendRow, error: sendErr } = await supabase
    .from("wa_template_sends")
    .insert({
      organization_id: orgId,
      template_id: input.templateId,
      lead_id: lead.id,
      conversation_id: input.conversationId,
      variables: input.variables as unknown as Json,
      status: "queued",
    })
    .select("id")
    .single();
  if (sendErr) return { ok: false, error: sendErr.message };

  // 6. Send via Graph API
  try {
    const result = await provider.sendTemplate({
      phone,
      templateName: t.name as string,
      language: t.language as string,
      components,
    });

    const wamid = result.messageId;
    const now = new Date().toISOString();

    // 7. Insert message + link to template_send + update send row
    const preview = renderPreview(t.components as unknown, input.variables);
    const { data: message } = await supabase
      .from("messages")
      .insert({
        organization_id: orgId,
        conversation_id: input.conversationId,
        lead_id: lead.id,
        sender: "agent",
        sender_user_id: userId,
        content: preview,
        type: "template",
        status: "sent",
        whatsapp_msg_id: wamid,
        template_send_id: sendRow?.id ?? null,
        metadata: {
          template_id: input.templateId,
          template_name: t.name,
          template_language: t.language,
          variables: input.variables as unknown as Json,
        } as unknown as Json,
      })
      .select("id")
      .single();

    await supabase
      .from("wa_template_sends")
      .update({
        status: "sent",
        wamid,
        sent_at: now,
        message_id: message?.id ?? null,
      })
      .eq("id", sendRow?.id);

    await supabase
      .from("conversations")
      .update({ last_message_at: now, unread_count: 0, updated_at: now })
      .eq("id", input.conversationId);

    return { ok: true, messageId: message?.id, wamid };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[templates] sendTemplate failed:", msg);
    await supabase
      .from("wa_template_sends")
      .update({ status: "failed", error_detail: msg })
      .eq("id", sendRow?.id);
    return { ok: false, error: msg };
  }
}

// ============ preview render (substitui {{N}}/{{nome}} pelo valor) ============

function renderPreview(components: unknown, values: TemplateVariableValues): string {
  const comps = (components ?? []) as Array<{ type: string; text?: string }>;
  const body = comps.find((c) => c.type === "BODY");
  if (!body?.text) return "";

  const v = values.body;
  return body.text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (!v) return `{{${key}}}`;
    if (Array.isArray(v)) {
      const idx = Number(key);
      return Number.isFinite(idx) ? (v[idx - 1] ?? `{{${key}}}`) : `{{${key}}}`;
    }
    return (v as Record<string, string>)[key] ?? `{{${key}}}`;
  });
}
