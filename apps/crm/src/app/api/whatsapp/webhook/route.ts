import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage, getRequestId, logError, logInfo, logWarn } from "@/lib/observability";
import { createProvider } from "@/lib/whatsapp/providers";
import { tryEnqueueForNativeAgent } from "@/lib/ai-agent/executor";
import { processIncomingMessage } from "@/lib/whatsapp/incoming-pipeline";
import { mapUazapiStatus } from "@/lib/whatsapp/uazapi-status-mapper";
import {
  extractUazapiOwnerPhone,
  extractUazapiWebhookToken,
  getUazapiConnectionMatchMethod,
  isUazapiOwnerPhoneFallbackAllowed,
  logUazapiWebhookDiagnostics,
} from "@/lib/whatsapp/uazapi-webhook-diagnostics";
import { validateUazapiWebhookSignature } from "@/lib/whatsapp/uazapi-webhook-verifier";
import { processGroupWebhookEvent } from "@/lib/whatsapp/group-join-pipeline";

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

    // Bug B fix (mai/2026): branch pro evento `messages_update`.
    // UAZAPI envia callback quando uma msg outbound transita de status
    // (sent → delivered → read). Precisa pra UI renderizar checkmarks
    // corretos. Espelha lógica do webhook Meta (route Meta linha 212-228).
    //
    // Payload shape: UAZAPI pode ser:
    //  (a) Nested: { EventType: "messages_update", message: { messageid, status }, ... }
    //  (b) Flat: { messageid, status: "DELIVERY_ACK", fromMe: true, text: "", ... }
    //       — sem EventType, campos direto na raiz (formato documentado em v2 skill)
    //
    // Detectamos AMBOS os casos para robustez.
    const rawEventType = body.EventType ?? body.eventType;
    const isExplicitUpdate = typeof rawEventType === "string" && rawEventType.toLowerCase() === "messages_update";
    // Flat heuristic: status não-vazio + messageid presente + sem conteúdo textual
    // (distingue de mensagens recebidas normais que têm text/content)
    const flatStatus = typeof body.status === "string" ? body.status.trim() : "";
    const isFlatStatusUpdate =
      !isExplicitUpdate &&
      flatStatus !== "" &&
      mapUazapiStatus(flatStatus) !== null &&
      typeof body.messageid === "string" && body.messageid !== "";

    if (isExplicitUpdate || isFlatStatusUpdate) {
      // Tenta nested (body.message) primeiro, fallback pro root (flat).
      const msgRaw = (typeof body.message === "object" && body.message !== null
        ? body.message
        : body) as Record<string, unknown>;
      // Accept messageid (flat), messageId (camelCase), or MessageId (PascalCase)
      const messageId =
        (typeof msgRaw.messageid === "string" ? msgRaw.messageid : null) ??
        (typeof (msgRaw as Record<string, unknown>).messageId === "string" ? (msgRaw as Record<string, unknown>).messageId as string : null) ??
        (typeof body.messageid === "string" ? body.messageid : null) ??
        null;
      const rawStatus =
        (typeof msgRaw.status === "string" && msgRaw.status ? msgRaw.status : null) ??
        (flatStatus || null);
      const dbStatus = mapUazapiStatus(rawStatus);
      if (!messageId || !dbStatus) {
        // Log payload keys para diagnóstico (sem expor conteúdo de msgs).
        logWarn("uazapi_webhook_messages_update_skipped", {
          organization_id: matchedConn.organization_id,
          request_id: requestId,
          provider: "uazapi",
          route: "/api/whatsapp/webhook",
          reason: !messageId ? "missing_messageid" : "unmapped_status",
          raw_status: rawStatus,
          detected_via: isExplicitUpdate ? "EventType" : isFlatStatusUpdate ? "flat_heuristic" : "unknown",
          body_keys: Object.keys(body).sort().join(","),
          message_keys: typeof body.message === "object" && body.message ? Object.keys(body.message as Record<string, unknown>).sort().join(",") : null,
        });
        return NextResponse.json({ ok: true, skipped: "messages_update_no_op" });
      }
      const { error: updateErr } = await supabase
        .from("messages")
        .update({ status: dbStatus })
        .eq("organization_id", matchedConn.organization_id)
        .eq("whatsapp_msg_id", messageId)
        .neq("status", "deleted"); // nunca sobrescrever mensagem ja apagada
      if (updateErr) {
        logError("uazapi_webhook_messages_update_failed", {
          organization_id: matchedConn.organization_id,
          request_id: requestId,
          provider: "uazapi",
          route: "/api/whatsapp/webhook",
          message_id: messageId,
          db_status: dbStatus,
          error: errorMessage(updateErr),
        });
        return NextResponse.json({ ok: false }, { status: 500 });
      }
      logInfo("uazapi_webhook_messages_update_ok", {
        organization_id: matchedConn.organization_id,
        request_id: requestId,
        provider: "uazapi",
        route: "/api/whatsapp/webhook",
        message_id: messageId,
        db_status: dbStatus,
        detected_via: isExplicitUpdate ? "EventType" : "flat_heuristic",
      });
      return NextResponse.json({ ok: true, status: dbStatus });
    }

    // 2. Group participant event (join/leave) — UAZAPI EventType: "groups".
    //    Detectado ANTES de parseWebhook: grupos têm payload não-padrão (chatid
    //    é o JID do grupo, não de um participante), e se parseWebhook eventualmente
    //    retornasse null para esse formato, o evento seria dropado silenciosamente.
    if (typeof rawEventType === "string" && rawEventType.toLowerCase() === "groups") {
      // Fire-and-forget: best-effort, não bloqueia resposta do webhook
      processGroupWebhookEvent(supabase, matchedConn.organization_id, body).catch(() => {});
      return NextResponse.json({ ok: true, handled: "group_participant_event" });
    }

    // 3. Normalize payload.
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

    // 4. Group message branch — save to group_messages + try to link sender as member.
    if (msg.isGroup && msg.groupJid) {
      const { data: grp } = await supabase
        .from("whatsapp_groups")
        .select("id, name")
        .eq("organization_id", matchedConn.organization_id)
        .eq("group_jid", msg.groupJid)
        .maybeSingle();

      if (grp) {
        // UAZAPI v2: sender fields (sender_pn, sender) ficam dentro de body.message,
        // não no root do envelope. Usar msgRaw para capturar o nível correto.
        const msgRaw = ((body as any).message || body) as Record<string, unknown>;
        const senderJid =
          (typeof msgRaw.sender_pn === "string" && msgRaw.sender_pn ? msgRaw.sender_pn : null) ??
          (typeof msgRaw.sender === "string" && msgRaw.sender && !msgRaw.sender.endsWith("@lid") ? msgRaw.sender : null);
        const messageCreatedAt = new Date().toISOString();

        // Etapa 4: resolver avatar cached do remetente antes do insert (sem UAZAPI call)
        let senderAvatarUrl: string | null = null;
        if (senderJid) {
          const { normalizePhoneBR } = await import("@/lib/whatsapp/group-join-pipeline");
          const senderPhone = normalizePhoneBR(senderJid);
          if (senderPhone) {
            // Prioridade: lead.avatar_url > membership.avatar_url
            const { data: mem } = await supabase
              .from("group_memberships")
              .select("avatar_url, lead_id")
              .eq("group_id", grp.id as string)
              .eq("phone", senderPhone)
              .maybeSingle() as any;
            if (mem?.avatar_url) {
              senderAvatarUrl = mem.avatar_url;
            } else if (mem?.lead_id) {
              const { data: leadRow } = await supabase
                .from("leads")
                .select("avatar_url")
                .eq("id", mem.lead_id)
                .maybeSingle();
              if ((leadRow as any)?.avatar_url) senderAvatarUrl = (leadRow as any).avatar_url;
            }
          }
        }

        await supabase.from("group_messages").insert({
          organization_id: matchedConn.organization_id,
          group_id: grp.id,
          direction: "inbound",
          text: msg.text,
          sender_name: msg.pushName || null,
          sender_jid: senderJid || null,
          sender_avatar_url: senderAvatarUrl,
          whatsapp_msg_id: msg.messageId || null,
          media_type: msg.type && msg.type !== "text" ? msg.type : null,
          media_url: (msg as any).mediaUrl || null,
          created_at: messageCreatedAt,
        } as never);

        // Bug C fix (mai/2026): vincular remetente como membro do grupo.
        // Etapa 4: após vincular, buscar avatar em background se não havia cache.
        if (senderJid) {
          const { linkGroupMembership, normalizePhoneBR } = await import("@/lib/whatsapp/group-join-pipeline");
          const senderPhone = normalizePhoneBR(senderJid);
          linkGroupMembership({
            supabase,
            orgId: matchedConn.organization_id,
            groupId: grp.id as string,
            groupName: (grp.name as string) || "",
            participantJid: senderJid,
            participantName: msg.pushName || null,
            source: "webhook",
            joinedAt: messageCreatedAt,
          })
            .then(async (result) => {
              if (result.membershipId && !result.wasActiveMember) {
                await supabase.rpc("increment_group_participant_count", {
                  p_group_id: grp.id,
                });
              }
              // Buscar avatar em background se ainda sem cache e há telefone real
              if (!senderAvatarUrl && senderPhone && result.membershipId) {
                const { getAndCacheContactAvatar } = await import("@/lib/lead-avatar-cache");
                const { avatarUrl, updated } = await getAndCacheContactAvatar({
                  organizationId: matchedConn.organization_id,
                  leadId: (result as any).leadId ?? null,
                  phone: senderPhone,
                  provider,
                });
                if (avatarUrl) {
                  // Atualizar membership.avatar_url + sender_avatar_url na mensagem
                  await Promise.all([
                    supabase
                      .from("group_memberships")
                      .update({ avatar_url: avatarUrl, avatar_fetched_at: new Date().toISOString() })
                      .eq("id", result.membershipId) as any,
                    msg.messageId
                      ? supabase
                          .from("group_messages")
                          .update({ sender_avatar_url: avatarUrl })
                          .eq("whatsapp_msg_id", msg.messageId)
                          .eq("group_id", grp.id) as any
                      : Promise.resolve(),
                  ]);
                  void updated; // satisfaz TS
                }
              }
            })
            .catch(() => {});
        }
      }
      return NextResponse.json({ ok: true, skipped: "group_message_saved" });
    }

    // 4. UAZAPI-specific: fetch media URL via POST /message/download.
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

    // 5. Native AI Agent router. Any miss or failure falls through to legacy.
    const nativeOutcome = await tryEnqueueForNativeAgent({
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

    // 6. Shared pipeline: dedup + lead + flows + conversation + msg + IA.
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
