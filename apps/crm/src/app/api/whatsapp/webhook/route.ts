import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage, getRequestId, logError, logInfo, logWarn } from "@/lib/observability";
import { createProvider } from "@/lib/whatsapp/providers";
import { tryNativeAgent } from "@/lib/ai-agent/executor";
import { processIncomingMessage } from "@/lib/whatsapp/incoming-pipeline";
import {
  extractUazapiOwnerPhone,
  extractUazapiWebhookToken,
  getUazapiConnectionMatchMethod,
  isUazapiOwnerPhoneFallbackAllowed,
  logUazapiWebhookDiagnostics,
} from "@/lib/whatsapp/uazapi-webhook-diagnostics";
import { validateUazapiWebhookSignature } from "@/lib/whatsapp/uazapi-webhook-verifier";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * UAZAPI webhook handler.
 *
 * Payload (UAZAPI v2): { owner, token, message: {...}, BaseUrl, EventType, chat }.
 * The message is NESTED in body.message; provider.parseWebhook tolerates both.
 *
 * Pipeline after matching the connection and parsing the message is shared with
 * the Meta webhook via processIncomingMessage — the only UAZAPI-specific step
 * here is the media download (UAZAPI does not include fileURL in the payload).
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  try {
    const supabase = getSupabase();
    const rawBody = await request.text();
    const signature = validateUazapiWebhookSignature({
      rawBody,
      headers: request.headers,
      secret: process.env.UAZAPI_WEBHOOK_SIGNATURE_SECRET,
      mode: process.env.UAZAPI_WEBHOOK_SIGNATURE_MODE,
    });

    if (signature.configured && signature.mode !== "off" && !signature.valid) {
      const log = signature.mode === "enforce" ? logWarn : logInfo;
      log("uazapi_webhook_signature_failed", {
        organization_id: null,
        request_id: requestId,
        provider: "uazapi",
        route: "/api/whatsapp/webhook",
        mode: signature.mode,
        present: signature.present,
        headerName: signature.headerName,
      });
    }
    if (!signature.accepted) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as Record<string, unknown>;

    // 1. Match org by owner phone OR instance token.
    const ownerPhone = extractUazapiOwnerPhone(body);
    const webhookToken = extractUazapiWebhookToken(body);
    const allowOwnerPhoneFallback = isUazapiOwnerPhoneFallbackAllowed(
      process.env.UAZAPI_WEBHOOK_ALLOW_OWNER_PHONE_FALLBACK,
    );

    const { data: connections } = await supabase
      .from("whatsapp_connections")
      .select(
        "organization_id, provider, instance_url, instance_token, phone_number, phone_number_id, waba_id, access_token, webhook_verify_token",
      )
      .eq("status", "connected")
      .eq("provider", "uazapi");

    let matchedBy: ReturnType<typeof getUazapiConnectionMatchMethod> = "none";
    const matchedConn = connections?.find((c) => {
      const method = getUazapiConnectionMatchMethod(c, {
        ownerPhone,
        webhookToken,
        allowOwnerPhoneFallback,
      });
      if (method === "none") return false;
      matchedBy = method;
      return true;
    });

    logUazapiWebhookDiagnostics({
      body,
      headers: request.headers,
      matchedBy,
      organizationId: matchedConn?.organization_id ?? null,
      requestId,
    });

    if (!matchedConn) {
      logWarn("uazapi_webhook_unknown_instance", {
        organization_id: null,
        request_id: requestId,
        provider: "uazapi",
        route: "/api/whatsapp/webhook",
        matched_by: matchedBy,
        has_owner_phone: Boolean(ownerPhone),
        has_webhook_token: Boolean(webhookToken),
        owner_phone_fallback: allowOwnerPhoneFallback,
      });
      // Return 200 to stop UAZAPI retries but do not echo owner back
      return NextResponse.json({ ok: true, skipped: "unknown instance" });
    }

    // 2. Normalize payload.
    const provider = createProvider(matchedConn);
    const msg = provider.parseWebhook(body.message || body);
    if (!msg) {
      logInfo("uazapi_webhook_skipped_payload", {
        organization_id: matchedConn.organization_id,
        request_id: requestId,
        provider: provider.name,
        route: "/api/whatsapp/webhook",
        matched_by: matchedBy,
        skipped: "no processable message",
      });
      return NextResponse.json({ ok: true, skipped: "no processable message" });
    }

    // 3. UAZAPI-specific: fetch media URL via POST /message/download.
    //    (UAZAPI does not include fileURL in the webhook for media messages.)
    const isMediaType = msg.type !== "text" && msg.type !== "sticker";
    if (isMediaType && !msg.mediaUrl && msg.messageId) {
      try {
        const isAudio = msg.type === "audio";
        const download = await provider.downloadMedia(msg.messageId, {
          transcribe: isAudio, // Whisper transcription for audio
          generateMp3: isAudio,
        });
        if (download.fileURL) msg.mediaUrl = download.fileURL;
        if (download.mimetype) msg.mediaMimeType = download.mimetype;
        if (isAudio && download.transcription) msg.text = download.transcription;
      } catch (err: unknown) {
        logError("uazapi_webhook_media_download_failed", {
          organization_id: matchedConn.organization_id,
          request_id: requestId,
          provider: provider.name,
          route: "/api/whatsapp/webhook",
          message_type: msg.type,
          error: errorMessage(err),
        });
      }
    }

    // 4. Native AI Agent router. Any miss or failure falls through to legacy.
    const nativeOutcome = await tryNativeAgent({
      supabase,
      orgId: matchedConn.organization_id,
      provider,
      msg,
      requestId,
    });

    if (nativeOutcome.handled) {
      logInfo("uazapi_webhook_processed_message", {
        organization_id: matchedConn.organization_id,
        request_id: requestId,
        provider: provider.name,
        route: "/api/whatsapp/webhook",
        matched_by: matchedBy,
        ok: nativeOutcome.response.ok ?? true,
        skipped: nativeOutcome.response.skipped ?? null,
        handled_by: nativeOutcome.response.handledBy ?? "ai_native",
        lead_id: nativeOutcome.response.leadId ?? null,
        conversation_id: nativeOutcome.response.conversationId ?? null,
        native_status: nativeOutcome.response.status ?? null,
        run_id: nativeOutcome.response.runId ?? null,
      });
      return NextResponse.json(nativeOutcome.response);
    }

    // 5. Shared pipeline: dedup + lead + flows + conversation + msg + IA.
    const result = await processIncomingMessage({
      supabase,
      orgId: matchedConn.organization_id,
      provider,
      msg,
      requestId,
    });

    logInfo("uazapi_webhook_processed_message", {
      organization_id: matchedConn.organization_id,
      request_id: requestId,
      provider: provider.name,
      route: "/api/whatsapp/webhook",
      matched_by: matchedBy,
      ok: result.ok,
      skipped: result.skipped ?? null,
      handled_by: result.handledBy ?? null,
      lead_id: result.leadId ?? null,
      conversation_id: result.conversationId ?? null,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    // Log internally; do not expose internals to the caller
    logError("uazapi_webhook_error", {
      organization_id: null,
      request_id: requestId,
      provider: "uazapi",
      route: "/api/whatsapp/webhook",
      error: errorMessage(error),
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "active", service: "crm-persia" });
}
