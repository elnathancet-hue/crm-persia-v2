"use server";

import { requireRole } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { configureUazapiWebhook, createProvider } from "@/lib/whatsapp/providers";

function getAdminDb() {
  return createAdminClient();
}

/** Fetches the WhatsApp connection for the caller's org using service_role (bypasses RLS). */
async function getConnectionForOrg(orgId: string) {
  const admin = getAdminDb();
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("id, provider, instance_url, instance_token, phone_number, status, organization_id")
    .eq("organization_id", orgId)
    .limit(1)
    .single();

  return connection ? { admin, connection, orgId } : null;
}

export async function getWhatsAppStatus(): Promise<{
  status: "connected" | "disconnected" | "not_configured" | "unreachable";
  phoneNumber: string | null;
}> {
  try {
    const { orgId } = await requireRole("admin");
    const ctx = await getConnectionForOrg(orgId);
    if (!ctx) return { status: "not_configured", phoneNumber: null };

    try {
      const provider = createProvider(ctx.connection);
      const realStatus = await provider.getStatus();

      if (realStatus.connected && realStatus.loggedIn) {
        if (ctx.connection.status !== "connected") {
          await ctx.admin.from("whatsapp_connections")
            .update({ status: "connected", updated_at: new Date().toISOString() })
            .eq("id", ctx.connection.id)
            .eq("organization_id", orgId);
        }
        return { status: "connected", phoneNumber: ctx.connection.phone_number || null };
      }

      if (ctx.connection.status === "connected") {
        await ctx.admin.from("whatsapp_connections")
          .update({ status: "disconnected", updated_at: new Date().toISOString() })
          .eq("id", ctx.connection.id)
          .eq("organization_id", orgId);
      }
      return { status: "disconnected", phoneNumber: null };
    } catch {
      if (ctx.connection.status === "connected") {
        return { status: "connected", phoneNumber: ctx.connection.phone_number || null };
      }
      return { status: "unreachable", phoneNumber: null };
    }
  } catch {
    return { status: "not_configured", phoneNumber: null };
  }
}

const UAZAPI_SERVER = process.env.UAZAPI_SERVER_URL || "https://persia.uazapi.com";
const UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN!;
// CRM client webhook URL ��� never point to the CRM client app, not this client
const CRM_WEBHOOK_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/whatsapp/webhook`
  : "https://crm.funilpersia.top/api/whatsapp/webhook";

export async function connectWhatsApp(): Promise<{
  status: "connected" | "qr" | "error";
  qrCode?: string;
  error?: string;
}> {
  let auditCtx: { userId: string; orgId: string; connectionId?: string } | null = null;
  try {
    const { orgId, userId } = await requireRole("admin");
    auditCtx = { orgId, userId };
    let ctx = await getConnectionForOrg(orgId);

    // If connection exists but instance is dead on UAZAPI, clean up and re-provision
    if (ctx) {
      try {
        const provider = createProvider(ctx.connection);
        await provider.getStatus();
      } catch {
        await ctx.admin.from("whatsapp_connections")
          .delete()
          .eq("id", ctx.connection.id)
          .eq("organization_id", orgId);
        ctx = null;
      }
    }

    // Auto-provision if no connection exists
    if (!ctx) {
      const instanceName = `org-${orgId.substring(0, 8)}`;
      const admin = getAdminDb();

      const createRes = await fetch(`${UAZAPI_SERVER}/instance/create`, {
        method: "POST",
        headers: { admintoken: UAZAPI_ADMIN_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ name: instanceName }),
      });

      if (!createRes.ok) {
        await auditFailure({
          userId,
          orgId,
          action: "crm_whatsapp_connect",
          entityType: "whatsapp_connection",
          metadata: { stage: "create_instance", provider: "uazapi", http_status: createRes.status },
          error: new Error("Erro ao criar instancia no servidor"),
        });
      }
      if (!createRes.ok) return { status: "error", error: "Erro ao criar instância no servidor" };

      const createData = await createRes.json();
      const instanceToken = createData.token || createData.instance?.token;
      if (!instanceToken) {
        await auditFailure({
          userId,
          orgId,
          action: "crm_whatsapp_connect",
          entityType: "whatsapp_connection",
          metadata: { stage: "create_instance", provider: "uazapi" },
          error: new Error("Token nao retornado pelo servidor"),
        });
      }
      if (!instanceToken) return { status: "error", error: "Token não retornado pelo servidor" };

      const headers = { token: instanceToken, "Content-Type": "application/json" };

      // Webhook config (critical — must succeed)
      const webhookRes = await configureUazapiWebhook({
        baseUrl: UAZAPI_SERVER,
        token: instanceToken,
        url: CRM_WEBHOOK_URL,
      });
      if (!webhookRes.ok) {
        await auditFailure({
          userId,
          orgId,
          action: "crm_whatsapp_connect",
          entityType: "whatsapp_connection",
          metadata: { stage: "configure_webhook", provider: "uazapi", http_status: webhookRes.status },
          error: new Error("Falha ao configurar webhook"),
        });
        return { status: "error", error: "Falha ao configurar webhook. Instância não salva." };
      }

      // Non-critical configs
      await fetch(`${UAZAPI_SERVER}/instance/updatechatbotsettings`, {
        method: "POST", headers,
        body: JSON.stringify({ chatbot_ignoreGroups: true }),
      }).catch(() => {});

      await fetch(`${UAZAPI_SERVER}/instance/updateDelaySettings`, {
        method: "POST", headers,
        body: JSON.stringify({ msg_delay_min: 1, msg_delay_max: 3 }),
      }).catch(() => {});

      await admin.from("whatsapp_connections").insert({
        organization_id: orgId,
        instance_url: UAZAPI_SERVER,
        instance_token: instanceToken,
        status: "pending",
        provider: "uazapi",
      });

      ctx = await getConnectionForOrg(orgId);
      if (!ctx) {
        await auditFailure({
          userId,
          orgId,
          action: "crm_whatsapp_connect",
          entityType: "whatsapp_connection",
          metadata: { stage: "save_connection", provider: "uazapi" },
          error: new Error("Erro ao salvar configuracao"),
        });
      }
      if (!ctx) return { status: "error", error: "Erro ao salvar configuração" };
    }

    auditCtx.connectionId = ctx.connection.id;
    const provider = createProvider(ctx.connection);
    const result = await provider.connect();

    if (result.status === "connected") {
      await ctx.admin
        .from("whatsapp_connections")
        .update({ status: "connected", updated_at: new Date().toISOString() })
        .eq("id", ctx.connection.id)
        .eq("organization_id", orgId);
      await auditLog({
        userId,
        orgId,
        action: "crm_whatsapp_connect",
        entityType: "whatsapp_connection",
        entityId: ctx.connection.id,
        metadata: { status: "connected", provider: ctx.connection.provider },
      });
      return { status: "connected" };
    }

    if (result.status === "qr" && result.qrCode) {
      await auditLog({
        userId,
        orgId,
        action: "crm_whatsapp_connect",
        entityType: "whatsapp_connection",
        entityId: ctx.connection.id,
        metadata: { status: "qr", provider: ctx.connection.provider },
      });
      return { status: "qr", qrCode: result.qrCode };
    }

    await auditFailure({
      userId,
      orgId,
      action: "crm_whatsapp_connect",
      entityType: "whatsapp_connection",
      entityId: ctx.connection.id,
      metadata: { stage: "provider_connect", provider: ctx.connection.provider },
      error: new Error(result.error || "Erro desconhecido"),
    });
    return { status: "error", error: result.error || "Erro desconhecido" };
  } catch (e: unknown) {
    if (auditCtx) {
      await auditFailure({
        userId: auditCtx.userId,
        orgId: auditCtx.orgId,
        action: "crm_whatsapp_connect",
        entityType: "whatsapp_connection",
        entityId: auditCtx.connectionId,
        metadata: { stage: "unexpected" },
        error: e,
      });
    }
    return { status: "error", error: e instanceof Error ? e.message : "Erro ao conectar" };
  }
}

export async function getQRCode(): Promise<{ qrCode: string | null; error?: string }> {
  try {
    const { orgId } = await requireRole("admin");
    const ctx = await getConnectionForOrg(orgId);
    if (!ctx) return { qrCode: null, error: "Nao configurado" };

    const provider = createProvider(ctx.connection);
    const qr = await provider.getQRCode();
    return { qrCode: qr };
  } catch (e: unknown) {
    return { qrCode: null, error: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

export async function disconnectWhatsApp(): Promise<{ error?: string }> {
  let auditCtx: { userId: string; orgId: string; connectionId?: string } | null = null;
  try {
    const { orgId, userId } = await requireRole("admin");
    auditCtx = { orgId, userId };
    const ctx = await getConnectionForOrg(orgId);
    if (!ctx) {
      await auditFailure({
        userId,
        orgId,
        action: "crm_whatsapp_disconnect",
        entityType: "whatsapp_connection",
        metadata: { stage: "missing_connection" },
        error: new Error("WhatsApp nao configurado"),
      });
    }
    if (!ctx) return { error: "Não configurado" };

    const provider = createProvider(ctx.connection);
    auditCtx.connectionId = ctx.connection.id;

    try {
      await provider.logout();
    } catch {
      console.warn("[WhatsApp] Provider logout failed, marking as disconnected in database");
    }

    const { error: dbError } = await ctx.admin
      .from("whatsapp_connections")
      .update({ status: "disconnected", phone_number: null, updated_at: new Date().toISOString() })
      .eq("id", ctx.connection.id)
      .eq("organization_id", orgId);

    if (dbError) {
      console.error("[WhatsApp] DB update failed:", dbError.message);
      await auditFailure({
        userId,
        orgId,
        action: "crm_whatsapp_disconnect",
        entityType: "whatsapp_connection",
        entityId: ctx.connection.id,
        metadata: { stage: "db_update", provider: ctx.connection.provider },
        error: dbError,
      });
      return { error: "Erro ao atualizar status. Tente novamente." };
    }

    await auditLog({
      userId,
      orgId,
      action: "crm_whatsapp_disconnect",
      entityType: "whatsapp_connection",
      entityId: ctx.connection.id,
      metadata: { provider: ctx.connection.provider },
    });
    return {};
  } catch (e: unknown) {
    console.error("[WhatsApp] Disconnect error:", e instanceof Error ? e.message : String(e));
    if (auditCtx) {
      await auditFailure({
        userId: auditCtx.userId,
        orgId: auditCtx.orgId,
        action: "crm_whatsapp_disconnect",
        entityType: "whatsapp_connection",
        entityId: auditCtx.connectionId,
        metadata: { stage: "unexpected" },
        error: e,
      });
    }
    return { error: "Erro ao desconectar. Tente novamente." };
  }
}
