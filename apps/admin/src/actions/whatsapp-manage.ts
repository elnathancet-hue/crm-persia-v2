"use server";

import { randomBytes } from "node:crypto";
import { requireSuperadminForOrg } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
import { configureUazapiWebhook, createProvider } from "@/lib/whatsapp/providers";
import { MetaCloudAdapter } from "@/lib/whatsapp/providers/meta-cloud";


/** Fetches connection for the org in the active admin context (cookie). */
async function getConnection() {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("id, provider, instance_url, instance_token, phone_number, status")
    .eq("organization_id", orgId)
    .limit(1)
    .single();

  if (!connection) return null;
  return { admin, connection, orgId, userId };
}

const UAZAPI_SERVER = process.env.UAZAPI_SERVER_URL!;
const UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN!;

// CRM client webhook URL — ALWAYS point to the CRM app, never the admin panel
// Uses CRM_CLIENT_BASE_URL env var (e.g. https://crm.funilpersia.top)
function getCrmWebhookUrl(): string {
  const base = process.env.CRM_CLIENT_BASE_URL;
  if (!base) throw new Error("CRM_CLIENT_BASE_URL não configurada. Defina no .env para apontar para o CRM client.");
  return `${base.replace(/\/$/, "")}/api/whatsapp/webhook`;
}

/**
 * Auto-provision: creates instance on UAZAPI server, saves to DB, and returns QR.
 * orgId comes from the signed admin-context cookie (NOT from frontend).
 *
 * UAZAPI endpoints used:
 *   POST /instance/create (admintoken) — creates new instance
 *   POST /webhook (token) — configures webhook URL
 *   POST /instance/updatechatbotsettings (token) — ignores groups
 *   POST /instance/updateDelaySettings (token) — typing delay
 *   POST /instance/presence (token) — sets presence
 *   POST /instance/connect (token) — generates QR code
 *   GET /instance/status (token) — checks if instance is alive
 */
export async function autoProvisionWhatsApp(): Promise<{
  status: "qr" | "connected" | "error";
  qrCode?: string;
  error?: string;
}> {
  let auditCtx: { userId: string; orgId: string } | null = null;
  try {
    const { admin, orgId, userId } = await requireSuperadminForOrg();
    auditCtx = { userId, orgId };

    // Check if connection already exists
    const { data: existing } = await admin
      .from("whatsapp_connections")
      .select("id, provider, instance_url, instance_token, status")
      .eq("organization_id", orgId)
      .limit(1)
      .single();

    let instanceUrl = existing?.instance_url;
    let instanceToken = existing?.instance_token;

    // If existing connection has credentials, test if UAZAPI instance is still alive
    if (existing && instanceUrl && instanceToken) {
      try {
        const provider = createProvider({ provider: "uazapi", instance_url: instanceUrl, instance_token: instanceToken });
        // GET /instance/status — checks connected + loggedIn
        await provider.getStatus();
        // Instance is alive — skip creation, just try to connect below
      } catch {
        // Instance is dead/unreachable — clear credentials to force re-creation
        console.warn("[WhatsApp] Existing instance unreachable, will re-provision");
        instanceUrl = null;
        instanceToken = null;
      }
    }

    // If no connection exists or instance is dead, create a new instance on UAZAPI
    if (!existing || !instanceUrl || !instanceToken) {
      const instanceName = `org-${orgId.substring(0, 8)}`;

      // POST /instance/create — requires admintoken header
      const createRes = await fetch(`${UAZAPI_SERVER}/instance/create`, {
        method: "POST",
        headers: { admintoken: UAZAPI_ADMIN_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ name: instanceName }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        throw new Error(`Erro ao criar instância: ${errText}`);
      }

      const createData = await createRes.json();
      instanceToken = createData.token || createData.instance?.token;
      instanceUrl = UAZAPI_SERVER;

      if (!instanceToken) throw new Error("Token não retornado pelo servidor");

      // Configure instance settings — await each one, fail if webhook fails
      const headers = { token: instanceToken, "Content-Type": "application/json" };

      // 1. POST /webhook — set webhook to receive messages (CRITICAL — must succeed)
      const webhookUrl = getCrmWebhookUrl();
      const webhookRes = await configureUazapiWebhook({
        baseUrl: UAZAPI_SERVER,
        token: instanceToken,
        url: webhookUrl,
      });
      if (!webhookRes.ok) {
        throw new Error("Falha ao configurar webhook. Instância não será salva sem webhook funcional.");
      }

      // 2. POST /instance/updatechatbotsettings — ignore groups (non-critical)
      const chatbotRes = await fetch(`${UAZAPI_SERVER}/instance/updatechatbotsettings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatbot_ignoreGroups: true }),
      });
      if (!chatbotRes.ok) console.warn("[WhatsApp] Chatbot settings failed (non-critical)");

      // 3. POST /instance/updateDelaySettings — typing delay (non-critical)
      const delayRes = await fetch(`${UAZAPI_SERVER}/instance/updateDelaySettings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ msg_delay_min: 1, msg_delay_max: 3 }),
      });
      if (!delayRes.ok) console.warn("[WhatsApp] Delay settings failed (non-critical)");

      // 4. POST /instance/presence — set available (non-critical)
      await fetch(`${UAZAPI_SERVER}/instance/presence`, {
        method: "POST",
        headers,
        body: JSON.stringify({ presence: "available" }),
      }).catch(() => {});

      // Save to database only after webhook is confirmed
      if (existing) {
        await admin.from("whatsapp_connections")
          .update({ instance_url: instanceUrl, instance_token: instanceToken, status: "pending", updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await admin.from("whatsapp_connections")
          .insert({ organization_id: orgId, instance_url: instanceUrl, instance_token: instanceToken, status: "pending", provider: "uazapi" });
      }
    }

    // POST /instance/connect — generates QR code or confirms already connected
    const provider = createProvider({ provider: "uazapi", instance_url: instanceUrl!, instance_token: instanceToken! });
    const result = await provider.connect();

    if (result.status === "connected") {
      await admin.from("whatsapp_connections")
        .update({ status: "connected", updated_at: new Date().toISOString() })
        .eq("organization_id", orgId);
      await auditLog({ userId, orgId, action: "whatsapp_provision", entityType: "whatsapp" });
      return { status: "connected" };
    }

    if (result.status === "qr" && result.qrCode) {
      await auditLog({ userId, orgId, action: "whatsapp_provision", entityType: "whatsapp" });
      return { status: "qr", qrCode: result.qrCode };
    }

    return { status: "error", error: "Não foi possível gerar o QR Code" };
  } catch (e: unknown) {
    console.error("[WhatsApp] Auto-provision error:", e instanceof Error ? e.message : String(e));
    if (auditCtx) {
      await auditFailure({
        userId: auditCtx.userId,
        orgId: auditCtx.orgId,
        action: "whatsapp_provision",
        entityType: "whatsapp",
        error: e,
      });
    }
    return { status: "error", error: e instanceof Error ? e.message : String(e) || "Erro ao configurar WhatsApp" };
  }
}

/**
 * Connect existing WhatsApp instance. Falls back to autoProvisionWhatsApp if unreachable.
 * orgId comes from the signed admin-context cookie.
 * UAZAPI: POST /instance/connect (token)
 */
export async function connectWhatsAppAdmin(): Promise<{
  status: "connected" | "qr" | "error";
  qrCode?: string;
  error?: string;
}> {
  try {
    const ctx = await getConnection();
    if (!ctx) return { status: "error", error: "WhatsApp nao configurado para este cliente" };

    const provider = createProvider(ctx.connection);

    try {
      const result = await provider.connect();

      if (result.status === "connected") {
        await ctx.admin
          .from("whatsapp_connections")
          .update({ status: "connected", updated_at: new Date().toISOString() })
          .eq("id", ctx.connection.id)
          .eq("organization_id", ctx.orgId);
        return { status: "connected" };
      }

      if (result.status === "qr" && result.qrCode) {
        return { status: "qr", qrCode: result.qrCode };
      }

      // connect() returned error (token invalid, instance gone) — re-provision
      console.warn("[WhatsApp] Connect error, re-provisioning:", result.error);
      return autoProvisionWhatsApp();
    } catch {
      // Instance unreachable (network/5xx) — re-provision
      console.warn("[WhatsApp] Connect threw, re-provisioning.");
      return autoProvisionWhatsApp();
    }
  } catch (e: unknown) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) || "Erro ao conectar" };
  }
}

/**
 * Get QR code for existing instance.
 * orgId comes from the signed admin-context cookie.
 * UAZAPI: POST /instance/connect (token) — v2 returns QR from connect endpoint
 */
export async function getQRCodeAdmin(): Promise<{ qrCode: string | null; error?: string }> {
  try {
    const ctx = await getConnection();
    if (!ctx) return { qrCode: null, error: "Nao configurado" };

    const provider = createProvider(ctx.connection);
    const qr = await provider.getQRCode();
    return { qrCode: qr };
  } catch (e: unknown) {
    return { qrCode: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reset instance and get a fresh QR code.
 * UAZAPI: POST /instance/reset (clears session) → POST /instance/connect (returns new QR)
 * Must be called when QR expired or previous scan failed.
 */
export async function resetAndGetQRAdmin(): Promise<{ qrCode: string | null; error?: string }> {
  try {
    const ctx = await getConnection();
    if (!ctx) return { qrCode: null, error: "Nao configurado" };

    const provider = createProvider(ctx.connection);

    // Reset session to clear stale QR / session state
    try { await provider.reset(); } catch {
      // Non-fatal — proceed to connect even if reset fails
    }

    const qr = await provider.getQRCode();
    return { qrCode: qr };
  } catch (e: unknown) {
    return { qrCode: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Disconnect WhatsApp instance.
 * orgId comes from the signed admin-context cookie.
 * UAZAPI: POST /instance/disconnect (token)
 */
export async function disconnectWhatsAppAdmin(): Promise<{ error?: string }> {
  let auditCtx: { userId: string; orgId: string } | null = null;
  try {
    const ctx = await getConnection();
    if (ctx) auditCtx = { userId: ctx.userId, orgId: ctx.orgId };
    if (!ctx) return { error: "Não configurado" };

    const provider = createProvider(ctx.connection);

    // POST /instance/disconnect — try to logout, don't fail if it errors
    try {
      await provider.logout();
    } catch {
      console.warn("[WhatsApp Admin] Provider logout failed, marking as disconnected in database");
    }

    // Always update database regardless of provider response
    await ctx.admin
      .from("whatsapp_connections")
      .update({ status: "disconnected", phone_number: null, updated_at: new Date().toISOString() })
      .eq("id", ctx.connection.id)
      .eq("organization_id", ctx.orgId);

    await auditLog({ userId: ctx.userId, orgId: ctx.orgId, action: "whatsapp_disconnect", entityType: "whatsapp" });

    return {};
  } catch (e: unknown) {
    console.error("[WhatsApp Admin] Disconnect error:", e instanceof Error ? e.message : String(e));
    if (auditCtx) {
      await auditFailure({
        userId: auditCtx.userId,
        orgId: auditCtx.orgId,
        action: "whatsapp_disconnect",
        entityType: "whatsapp",
        error: e,
      });
    }
    return { error: "Erro ao desconectar. Tente novamente." };
  }
}

/**
 * Connect WhatsApp via Meta Cloud API (official).
 *
 * Validates the access token with a probe call before persisting, generates a
 * per-connection webhook_verify_token (for GET /webhook challenge), and upserts
 * the connection with provider='meta_cloud'. orgId comes from the signed
 * admin-context cookie.
 *
 * Meta endpoints used:
 *   GET  /{phone_number_id}   — verifies token + returns display_phone_number
 */
export interface MetaConnectInput {
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  phone_number: string;  // E.164, e.g. "+5511999998888"
  display_name?: string;
}

export interface MetaConnectResult {
  status: "connected" | "error";
  error?: string;
  webhookVerifyToken?: string;
  webhookUrl?: string;
  displayPhoneNumber?: string;
}

export async function connectMetaCloudWhatsApp(input: MetaConnectInput): Promise<MetaConnectResult> {
  let auditCtx: { userId: string; orgId: string } | null = null;
  try {
    const { admin, orgId, userId } = await requireSuperadminForOrg();
    auditCtx = { userId, orgId };

    // Sanitize inputs
    const phone_number_id = input.phone_number_id.trim();
    const waba_id = input.waba_id.trim();
    const access_token = input.access_token.trim();
    const phone_number = input.phone_number.trim();
    if (!phone_number_id || !waba_id || !access_token || !phone_number) {
      return { status: "error", error: "Todos os campos sao obrigatorios" };
    }

    // Generate webhook verify token BEFORE probe so we persist a consistent value.
    const webhookVerifyToken = randomBytes(24).toString("hex");

    // Probe: authenticate token + resolve display_phone_number.
    const probe = new MetaCloudAdapter({
      phoneNumberId: phone_number_id,
      wabaId: waba_id,
      accessToken: access_token,
      verifyToken: webhookVerifyToken,
    });
    const health = await probe.getStatus();
    if (!health.connected) {
      return { status: "error", error: "Token Meta invalido ou phone_number_id inacessivel" };
    }

    // Upsert connection. Search by (org, provider, phone_number_id) to avoid dup.
    const { data: existing } = await admin
      .from("whatsapp_connections")
      .select("id")
      .eq("organization_id", orgId)
      .eq("provider", "meta_cloud")
      .eq("phone_number_id", phone_number_id)
      .limit(1)
      .single();

    const payload = {
      organization_id: orgId,
      provider: "meta_cloud",
      phone_number_id,
      waba_id,
      access_token,
      phone_number,
      display_name: input.display_name ?? health.phone ?? null,
      webhook_verify_token: webhookVerifyToken,
      status: "connected",
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      await admin.from("whatsapp_connections").update(payload).eq("id", existing.id);
    } else {
      await admin.from("whatsapp_connections").insert(payload);
    }

    await auditLog({
      userId,
      orgId,
      action: "whatsapp_connect_meta",
      entityType: "whatsapp",
      metadata: { phone_number_id, waba_id },
    });

    const baseUrl = process.env.CRM_CLIENT_BASE_URL?.replace(/\/$/, "") ?? "";
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/meta/${phone_number_id}`;

    return {
      status: "connected",
      webhookVerifyToken,
      webhookUrl,
      displayPhoneNumber: health.phone,
    };
  } catch (e: unknown) {
    console.error("[WhatsApp Admin] Meta connect error:", e instanceof Error ? e.message : String(e));
    if (auditCtx) {
      await auditFailure({
        userId: auditCtx.userId,
        orgId: auditCtx.orgId,
        action: "whatsapp_connect_meta",
        entityType: "whatsapp",
        metadata: { phone_number_id: input.phone_number_id, waba_id: input.waba_id },
        error: e,
      });
    }
    return { status: "error", error: e instanceof Error ? e.message : "Erro ao conectar Meta Cloud" };
  }
}
