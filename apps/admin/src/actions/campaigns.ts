"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { TemplateVariableValues } from "@/lib/whatsapp/template-parser";


export async function getCampaigns() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin
    .from("campaigns")
    .select("*, template:wa_templates(id, name, language, category, status)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return data || [];
}

export async function createCampaign(data: {
  name: string;
  message?: string;                          // UAZAPI-style free text
  templateId?: string;                        // Meta template
  variablesTemplate?: TemplateVariableValues; // default values for template variables
  target_tags?: string;
  scheduled_at?: string;
  send_interval_seconds?: number;
}) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const tags = data.target_tags ? data.target_tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  if (!data.message && !data.templateId) {
    return { data: null, error: "Campanha precisa de mensagem OU template" };
  }

  // If template provided, validate it belongs to this org and is APPROVED.
  if (data.templateId) {
    const { data: tpl } = await admin
      .from("wa_templates")
      .select("id, status")
      .eq("id", data.templateId)
      .eq("organization_id", orgId)
      .single();
    if (!tpl) return { data: null, error: "Template nao encontrado nesta organizacao" };
    if ((tpl as { status?: string }).status !== "APPROVED") {
      return { data: null, error: "So e possivel criar campanhas com templates APPROVED" };
    }
  }

  const { data: campaign, error } = await admin.from("campaigns").insert({
    organization_id: orgId,
    name: data.name,
    message: data.message ?? null,
    template_id: data.templateId ?? null,
    variables_template: data.variablesTemplate ?? {},
    channel: "whatsapp",
    target_tags: tags,
    status: "draft",
    scheduled_at: data.scheduled_at || null,
    send_interval_seconds: data.send_interval_seconds ?? 30,
  } as never).select().single();

  if (error) return { data: null, error: error.message };
  revalidatePath("/campaigns");
  return { data: campaign, error: null };
}

export async function updateCampaignStatus(campaignId: string, status: string) {
  const { admin, orgId } = await requireSuperadminForOrg();

  // Resuming a campaign with a template: re-validate template is still APPROVED.
  if (status === "active" || status === "running") {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("template_id")
      .eq("id", campaignId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (campaign?.template_id) {
      const { data: tpl } = await admin
        .from("wa_templates")
        .select("status, name")
        .eq("id", campaign.template_id)
        .maybeSingle();
      if (!tpl || tpl.status !== "APPROVED") {
        return { error: `Template ${tpl?.name ?? ""} nao esta APPROVED (status atual: ${tpl?.status ?? "nao encontrado"}). Selecione outro template antes de ativar.` };
      }
    }
  }

  const { error } = await admin.from("campaigns").update({ status }).eq("id", campaignId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/campaigns");
  return { error: null };
}

export async function deleteCampaign(campaignId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  await admin.from("campaigns").delete().eq("id", campaignId).eq("organization_id", orgId);
  revalidatePath("/campaigns");
}

export async function executeCampaign(campaignId: string): Promise<{ sent: number; queued?: number; error?: string }> {
  const { admin, userId, orgId } = await requireSuperadminForOrg();

  const { data: campaign } = await admin.from("campaigns").select("*").eq("id", campaignId).eq("organization_id", orgId).single();
  if (!campaign) return { sent: 0, error: "Campanha nao encontrada nesta organizacao" };

  // Resolve target leads first (shared logic for both providers).
  const { data: leads } = await admin.from("leads").select("id, phone, name")
    .eq("organization_id", orgId)
    .not("phone", "is", null);
  if (!leads || leads.length === 0) return { sent: 0, error: "Nenhum lead com telefone" };

  let targetLeads = leads;
  if (campaign.target_tags && campaign.target_tags.length > 0) {
    const { data: taggedIds } = await admin.from("lead_tags")
      .select("lead_id, tags!inner(name)")
      .in("tags.name", campaign.target_tags);
    const leadIdSet = new Set((taggedIds || []).map((t: { lead_id: string }) => t.lead_id));
    targetLeads = leads.filter((l) => leadIdSet.has(l.id));
  }

  const validLeads = targetLeads.filter(
    (l): l is { id: string; phone: string; name: string | null } => !!l.phone
  );
  if (validLeads.length === 0) return { sent: 0, error: "Nenhum lead com telefone na segmentacao" };

  // Template-based (Meta Cloud) → enqueue em wa_template_sends. O cron envia.
  if (campaign.template_id) {
    return enqueueTemplateCampaign(admin, { orgId, userId, campaign, leads: validLeads });
  }

  // Text-based (UAZAPI) → fluxo atual: delega para /sender/simple nativo.
  return sendUazapiCampaign(admin, { orgId, userId, campaign, leads: validLeads });
}

async function sendUazapiCampaign(
  admin: Awaited<ReturnType<typeof requireSuperadminForOrg>>["admin"],
  args: {
    orgId: string;
    userId: string;
    campaign: Record<string, unknown>;
    leads: Array<{ id: string; phone: string; name?: string | null }>;
  },
): Promise<{ sent: number; error?: string }> {
  const { orgId, userId, campaign, leads } = args;

  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .single();
  if (!connection) return { sent: 0, error: "WhatsApp nao conectado" };

  const { createProvider } = await import("@/lib/whatsapp/providers");
  const provider = createProvider(connection);

  const phones = leads.map((l) => l.phone);
  try {
    await provider.createCampaign({
      numbers: phones,
      type: "text",
      text: String(campaign.message ?? ""),
      delayMin: Number(campaign.send_interval_seconds) || 5,
      delayMax: (Number(campaign.send_interval_seconds) || 5) * 2,
    });

    await admin.from("campaigns").update({
      status: "sending",
      total_sent: phones.length,
      total_target: phones.length,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", campaign.id as string).eq("organization_id", orgId);

    await auditLog({ userId, orgId, action: "execute_campaign", entityType: "campaign", entityId: campaign.id as string, metadata: { sent: phones.length, kind: "uazapi" } });

    revalidatePath("/campaigns");
    return { sent: phones.length };
  } catch (e: unknown) {
    await auditFailure({
      userId,
      orgId,
      action: "execute_campaign",
      entityType: "campaign",
      entityId: campaign.id as string,
      metadata: { kind: "uazapi" },
      error: e,
    });
    return { sent: 0, error: e instanceof Error ? e.message : String(e) || "Erro ao enviar" };
  }
}

async function enqueueTemplateCampaign(
  admin: Awaited<ReturnType<typeof requireSuperadminForOrg>>["admin"],
  args: {
    orgId: string;
    userId: string;
    campaign: Record<string, unknown>;
    leads: Array<{ id: string; phone: string; name?: string | null }>;
  },
): Promise<{ sent: number; queued: number; error?: string }> {
  const { orgId, userId, campaign, leads } = args;

  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("provider")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .single();

  if (!connection || (connection as { provider?: string }).provider !== "meta_cloud") {
    return { sent: 0, queued: 0, error: "Campanhas com template exigem conexao Meta Cloud conectada" };
  }

  const baseVars = (campaign.variables_template ?? {}) as TemplateVariableValues;

  const rows = leads.map((lead) => ({
    organization_id: orgId,
    template_id: campaign.template_id as string,
    campaign_id: campaign.id as string,
    lead_id: lead.id,
    conversation_id: null,
    variables: hydrateVariablesForLead(baseVars, lead),
    status: "queued",
  }));

  const { error } = await admin.from("wa_template_sends").insert(rows as never);
  if (error) {
    await auditFailure({
      userId,
      orgId,
      action: "execute_campaign",
      entityType: "campaign",
      entityId: campaign.id as string,
      metadata: { kind: "meta_template", queued: rows.length },
      error,
    });
    return { sent: 0, queued: 0, error: error.message };
  }

  await admin.from("campaigns").update({
    status: "sending",
    total_target: rows.length,
    total_sent: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", campaign.id as string).eq("organization_id", orgId);

  await auditLog({
    userId,
    orgId,
    action: "execute_campaign",
    entityType: "campaign",
    entityId: campaign.id as string,
    metadata: { queued: rows.length, kind: "meta_template" },
  });

  revalidatePath("/campaigns");
  return { sent: 0, queued: rows.length };
}

/**
 * Substitui `{{lead.X}}` nas strings de variables pelo valor do lead.
 * Ex: { body: { nome: "{{lead.name}}" } } + lead.name="Ana" → { body: { nome: "Ana" } }
 */
function hydrateVariablesForLead(
  base: TemplateVariableValues,
  lead: { id: string; phone: string; name?: string | null },
): TemplateVariableValues {
  const leadRecord: Record<string, unknown> = {
    name: lead.name ?? "",
    phone: lead.phone,
    id: lead.id,
  };
  const substitute = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(/\{\{lead\.(\w+)\}\}/g, (_, key) => String(leadRecord[key] ?? ""));
    }
    if (Array.isArray(v)) return v.map(substitute);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = substitute(val);
      return out;
    }
    return v;
  };
  return substitute(base) as TemplateVariableValues;
}
