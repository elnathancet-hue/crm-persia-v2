import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage, getRequestId, logError, logInfo, logWarn } from "@/lib/observability";
import { createProvider } from "@/lib/whatsapp/providers";
import { processIncomingMessage } from "@/lib/whatsapp/incoming-pipeline";
import { validateMetaChallenge, validateMetaSignature } from "@/lib/whatsapp/webhook-verifier";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function loadMetaConnection(phone_number_id: string) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("whatsapp_connections")
    .select(
      "organization_id, provider, phone_number_id, waba_id, access_token, webhook_verify_token, phone_number",
    )
    .eq("provider", "meta_cloud")
    .eq("phone_number_id", phone_number_id)
    .limit(1)
    .maybeSingle();
  return data;
}

// ============ GET: webhook verification challenge ============
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone_number_id: string }> },
) {
  const { phone_number_id } = await params;
  const conn = await loadMetaConnection(phone_number_id);
  if (!conn?.webhook_verify_token) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const searchParams = req.nextUrl.searchParams;
  const challenge = validateMetaChallenge(
    {
      mode: searchParams.get("hub.mode"),
      token: searchParams.get("hub.verify_token"),
      challenge: searchParams.get("hub.challenge"),
    },
    conn.webhook_verify_token,
  );

  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

// ============ POST: incoming messages + status events ============
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ phone_number_id: string }> },
) {
  const { phone_number_id } = await params;
  const requestId = getRequestId(req.headers);
  const rawBody = await req.text();

  const conn = await loadMetaConnection(phone_number_id);
  if (!conn) {
    logWarn("meta_webhook_unknown_phone_number", {
      organization_id: null,
      request_id: requestId,
      provider: "meta_cloud",
      route: "/api/whatsapp/webhook/meta/[phone_number_id]",
      phone_number_id,
    });
    // 200 for unknown numbers — avoids Meta retries.
    return NextResponse.json({ ok: true, skipped: "unknown phone_number_id" });
  }

  // HMAC: Meta signs with the App Secret (same for every number under one App).
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    logError("meta_webhook_missing_app_secret", {
      organization_id: conn.organization_id,
      request_id: requestId,
      provider: "meta_cloud",
      route: "/api/whatsapp/webhook/meta/[phone_number_id]",
      phone_number_id,
    });
    return new NextResponse("Server misconfigured", { status: 500 });
  }
  const signatureOk = validateMetaSignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
    appSecret,
  );
  if (!signatureOk) {
    logWarn("meta_webhook_invalid_signature", {
      organization_id: conn.organization_id,
      request_id: requestId,
      provider: "meta_cloud",
      route: "/api/whatsapp/webhook/meta/[phone_number_id]",
      phone_number_id,
    });
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const supabase = getSupabase();
  const provider = createProvider(conn);
  const orgId = conn.organization_id;

  const envelope = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: unknown[];
          statuses?: Array<{ id: string; status: string; timestamp: string }>;
          contacts?: Array<{ profile?: { name?: string } }>;
        };
      }>;
    }>;
  };

  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // --- incoming messages ---
      for (const raw of value.messages ?? []) {
        const msg = provider.parseWebhook({
          ...(raw as Record<string, unknown>),
          // Attach contact name so parseWebhook can use it.
          _contactName: value.contacts?.[0]?.profile?.name,
        });
        if (!msg) continue;

        // Meta returns a temporary signed URL via GET /{media_id}.
        if (msg.type !== "text" && msg.type !== "sticker" && msg.messageId && !msg.mediaUrl) {
          try {
            const media = await provider.downloadMedia(msg.messageId);
            if (media.fileURL) msg.mediaUrl = media.fileURL;
            if (media.mimetype) msg.mediaMimeType = media.mimetype;
          } catch (err) {
            logError("meta_webhook_media_download_failed", {
              organization_id: orgId,
              request_id: requestId,
              provider: provider.name,
              route: "/api/whatsapp/webhook/meta/[phone_number_id]",
              phone_number_id,
              message_type: msg.type,
              error: errorMessage(err),
            });
          }
        }

        const result = await processIncomingMessage({ supabase, orgId, provider, msg, requestId });
        logInfo("meta_webhook_processed_message", {
          organization_id: orgId,
          request_id: requestId,
          provider: provider.name,
          route: "/api/whatsapp/webhook/meta/[phone_number_id]",
          phone_number_id,
          ok: result.ok,
          skipped: result.skipped ?? null,
          handled_by: result.handledBy ?? null,
          lead_id: result.leadId ?? null,
          conversation_id: result.conversationId ?? null,
        });
      }

      // --- delivery / read / failed statuses ---
      for (const status of value.statuses ?? []) {
        await updateStatusByWamid(supabase, status.id, status.status);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

async function updateStatusByWamid(
  supabase: ReturnType<typeof getSupabase>,
  wamid: string,
  metaStatus: string,
) {
  const status = ["sent", "delivered", "read", "failed"].includes(metaStatus) ? metaStatus : "sent";
  await supabase.from("messages").update({ status }).eq("whatsapp_msg_id", wamid);
}
