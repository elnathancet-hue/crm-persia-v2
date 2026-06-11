import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { phoneBR } from "@persia/shared/validation";
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

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function extractNestedString(source: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
}

function extractGroupSenderIdentity(msgRaw: Record<string, unknown>): {
  rawSenderJid: string | null;
  phoneSenderJid: string | null;
  identityKind: "phone" | "lid" | "unknown";
} {
  const phoneSenderJid = firstString(
    msgRaw.sender_pn,
    msgRaw.senderPn,
    msgRaw.senderPN,
    msgRaw.sender_phone,
    msgRaw.senderPhone,
    msgRaw.participant_pn,
    msgRaw.participantPn,
    msgRaw.participantPhone,
    msgRaw.phone,
    msgRaw.Phone,
    extractNestedString(msgRaw, ["key", "participant_pn"]),
    extractNestedString(msgRaw, ["key", "participantPhone"]),
    extractNestedString(msgRaw, ["message", "sender_pn"]),
  );

  const rawSenderJid = firstString(
    phoneSenderJid,
    msgRaw.sender,
    msgRaw.sender_lid,
    msgRaw.senderLid,
    msgRaw.participant,
    msgRaw.participant_lid,
    msgRaw.participantLid,
    extractNestedString(msgRaw, ["key", "participant"]),
    extractNestedString(msgRaw, ["message", "sender"]),
  );

  const identityKind: "phone" | "lid" | "unknown" =
    rawSenderJid?.endsWith("@s.whatsapp.net") || Boolean(phoneSenderJid)
      ? "phone"
      : rawSenderJid?.endsWith("@lid")
        ? "lid"
        : "unknown";

  return { rawSenderJid, phoneSenderJid, identityKind };
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
      const [{ error: updateErr }] = await Promise.all([
        supabase
          .from("messages")
          .update({ status: dbStatus })
          .eq("organization_id", matchedConn.organization_id)
          .eq("whatsapp_msg_id", messageId)
          .neq("status", "deleted"), // nunca sobrescrever mensagem ja apagada
        // Best-effort: também atualiza group_messages (grupos de WhatsApp)
        supabase
          .from("group_messages")
          .update({ status: dbStatus })
          .eq("organization_id", matchedConn.organization_id)
          .eq("whatsapp_msg_id", messageId),
      ]);
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

        // Etapa 1 (Identidade Rica): UAZAPI varia bastante os campos do
        // remetente em grupo. Preferimos o telefone real (sender_pn e aliases)
        // e preservamos @lid quando ele for a unica identidade disponivel.
        const {
          rawSenderJid,
          phoneSenderJid,
          identityKind: senderIdentityKind,
        } = extractGroupSenderIdentity(msgRaw);
        // senderJid sem @lid — usado para normalização de telefone + linkGroupMembership.
        const senderPhoneJid =
          phoneSenderJid ||
          (rawSenderJid && !rawSenderJid.endsWith("@lid") ? rawSenderJid : null);
        const messageCreatedAt = new Date().toISOString();

        // Etapa 1: resolver identidade cached do remetente antes do insert (sem UAZAPI call).
        let senderAvatarUrl: string | null = null;
        let senderPhone: string | null = null;
        let senderLeadId: string | null = null;
        let senderMembershipId: string | null = null;

        if (senderPhoneJid) {
          const { normalizePhoneBR } = await import("@/lib/whatsapp/group-join-pipeline");
          senderPhone = normalizePhoneBR(senderPhoneJid);
          if (senderPhone) {
            // Prioridade: membership cached → lead cached
            const { data: mem } = await supabase
              .from("group_memberships")
              .select("id, avatar_url, lead_id")
              .eq("group_id", grp.id as string)
              .eq("phone", senderPhone)
              .maybeSingle() as any;
            if (mem) {
              senderMembershipId = (mem.id as string) || null;
              senderLeadId = (mem.lead_id as string) || null;
              const { isCachedGroupAvatarUrl, isCachedLeadAvatarUrl } = await import("@/lib/lead-avatar-cache");
              if (mem.avatar_url && (isCachedGroupAvatarUrl(mem.avatar_url) || isCachedLeadAvatarUrl(mem.avatar_url))) {
                senderAvatarUrl = mem.avatar_url;
              } else if (mem.lead_id) {
                const { data: leadRow } = await supabase
                  .from("leads")
                  .select("avatar_url")
                  .eq("id", mem.lead_id)
                  .maybeSingle();
                if ((leadRow as any)?.avatar_url) senderAvatarUrl = (leadRow as any).avatar_url;
              }
            }
          }
        }

        // Download media for group messages — same as individual pipeline.
        // UAZAPI does not include fileURL in the webhook payload.
        const isGroupMedia = msg.type && msg.type !== "text";
        if (isGroupMedia && !msg.mediaUrl && msg.messageId) {
          try {
            const isAudio = msg.type === "audio";
            const dl = await provider.downloadMedia(msg.messageId, {
              transcribe: isAudio,
              generateMp3: isAudio,
            });
            if (dl.fileURL) msg.mediaUrl = dl.fileURL;
            if (isAudio && dl.transcription) msg.text = dl.transcription;
          } catch {
            // best-effort: message is saved without media_url
          }
        }

        // Build rich metadata for location and document messages so the UI
        // can render map links and correct filenames.
        const groupMsgMetadata: Record<string, unknown> | null =
          msg.type === "location" && (msg.latitude != null || msg.longitude != null)
            ? { latitude: msg.latitude, longitude: msg.longitude, name: msg.locationName ?? null, address: msg.locationAddress ?? null }
            : msg.type === "document" && msg.mediaFileName
              ? { file_name: msg.mediaFileName }
              : null;

        // Dedup: evita double-save se UAZAPI re-entrega o mesmo evento.
        if (msg.messageId) {
          const { count } = await supabase
            .from("group_messages")
            .select("id", { count: "exact", head: true })
            .eq("group_id", grp.id as string)
            .eq("whatsapp_msg_id", msg.messageId);
          if (count && count > 0) {
            return NextResponse.json({ ok: true, skipped: "group_duplicate" });
          }
        }

        const groupMsgDirection = msg.isFromMe ? "outbound" : "inbound";

        await supabase.from("group_messages").insert({
          organization_id: matchedConn.organization_id,
          group_id: grp.id,
          direction: groupMsgDirection,
          text: msg.text,
          sender_name: msg.pushName || null,
          sender_jid: rawSenderJid || null,
          sender_phone: senderPhone || null,
          sender_lead_id: senderLeadId || null,
          sender_membership_id: senderMembershipId || null,
          sender_identity_kind: senderIdentityKind,
          sender_avatar_url: senderAvatarUrl,
          whatsapp_msg_id: msg.messageId || null,
          media_type: msg.type && msg.type !== "text" ? msg.type : null,
          media_url: msg.mediaUrl || null,
          metadata: groupMsgMetadata,
          created_at: messageCreatedAt,
        } as never);

        // Vincular remetente como membro do grupo (fire-and-forget).
        // Após vincular, atualizar identidade na mensagem se ainda incompleta.
        // Mensagens fromMe são enviadas pelo dispositivo da org — não vincular como membro.
        if (rawSenderJid && !msg.isFromMe) {
          const { linkGroupMembership } = await import("@/lib/whatsapp/group-join-pipeline");
          linkGroupMembership({
            supabase,
            orgId: matchedConn.organization_id,
            groupId: grp.id as string,
            groupName: (grp.name as string) || "",
            participantJid: rawSenderJid,
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

              // Patch message com membership/lead recém-resolvidos (se não havia cache)
              const patchFields: Record<string, unknown> = {};
              if (result.membershipId && !senderMembershipId) {
                patchFields.sender_membership_id = result.membershipId;
              }
              const resolvedLeadId = result.lead?.id ?? null;
              if (resolvedLeadId && !senderLeadId) {
                patchFields.sender_lead_id = resolvedLeadId;
              }

              // Buscar avatar em background se ainda sem cache.
              if (!senderAvatarUrl && (senderPhone || rawSenderJid)) {
                const { cacheGroupMemberAvatarFromUrl, getAndCacheContactAvatar } = await import("@/lib/lead-avatar-cache");
                const { avatarUrl, updated } = senderPhone
                  ? await getAndCacheContactAvatar({
                    organizationId: matchedConn.organization_id,
                    leadId: resolvedLeadId,
                    groupMembershipId: result.membershipId,
                    phone: senderPhone,
                    provider,
                  })
                  : {
                    avatarUrl: result.membershipId
                      ? await cacheGroupMemberAvatarFromUrl({
                        organizationId: matchedConn.organization_id,
                        membershipId: result.membershipId,
                        remoteUrl: await provider.getChatImageUrl(rawSenderJid!, { preview: true }),
                      })
                      : null,
                    updated: false,
                  };
                if (avatarUrl) {
                  patchFields.sender_avatar_url = avatarUrl;
                  if (result.membershipId) {
                    await supabase
                      .from("group_memberships")
                      .update({ avatar_url: avatarUrl, avatar_fetched_at: new Date().toISOString() })
                      .eq("id", result.membershipId) as any;
                  }
                  void updated;
                }
              }

              if (msg.messageId && Object.keys(patchFields).length > 0) {
                await supabase
                  .from("group_messages")
                  .update(patchFields)
                  .eq("whatsapp_msg_id", msg.messageId)
                  .eq("group_id", grp.id) as any;
              }
            })
            .catch(() => {});
        }
      }
      return NextResponse.json({ ok: true, skipped: "group_message_saved" });
    }

    // 4b. Outbound message sent directly from the connected device (fromMe = true).
    //     Mirror to `messages` with sender: "agent" so agents see both sides when
    //     replying from their personal WhatsApp instead of the CRM.
    //     Skip: lead creation, keyword flows, AI routing.
    //     Dedup: CRM-sent messages are already in DB (whatsapp_msg_id set by
    //     sendMessageViaWhatsApp) — detect and skip to avoid double-saving.
    if (msg.isFromMe) {
      try {
        // Dedup: if we already have this whatsapp_msg_id, it was sent via CRM.
        if (msg.messageId) {
          const { data: existingMsg } = await supabase
            .from("messages")
            .select("id")
            .eq("organization_id", matchedConn.organization_id)
            .eq("whatsapp_msg_id", msg.messageId)
            .maybeSingle();
          if (existingMsg) {
            return NextResponse.json({ ok: true, skipped: "duplicate" });
          }
        }

        if (!msg.text && !msg.mediaUrl) {
          return NextResponse.json({ ok: true, skipped: "fromMe_no_content" });
        }

        // Normalize phone (same logic as incoming-pipeline).
        let phone = msg.phone;
        try { phone = phoneBR.parse(msg.phone); } catch { /* use raw */ }

        const { data: lead } = await supabase
          .from("leads")
          .select("id")
          .eq("organization_id", matchedConn.organization_id)
          .eq("phone", phone)
          .maybeSingle();

        if (!lead) {
          return NextResponse.json({ ok: true, skipped: "fromMe_no_lead" });
        }

        const { data: conversation } = await supabase
          .from("conversations")
          .select("id")
          .eq("organization_id", matchedConn.organization_id)
          .eq("lead_id", lead.id)
          .in("status", ["active", "waiting_human"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!conversation) {
          return NextResponse.json({ ok: true, skipped: "fromMe_no_conversation" });
        }

        const now = new Date().toISOString();
        await Promise.all([
          supabase.from("messages").insert({
            organization_id: matchedConn.organization_id,
            conversation_id: conversation.id,
            lead_id: lead.id,
            content: msg.text,
            sender: "agent",
            type: msg.type,
            whatsapp_msg_id: msg.messageId || null,
            media_url: msg.mediaUrl || null,
            media_type: msg.mediaMimeType || null,
            status: "sent",
          }),
          supabase
            .from("conversations")
            .update({ last_message_at: now })
            .eq("id", conversation.id),
        ]);
      } catch (err: unknown) {
        // Best-effort: never fail the webhook response for fromMe mirroring.
        logError("uazapi_webhook_from_me_failed", {
          organization_id: matchedConn.organization_id,
          request_id: requestId,
          provider: provider.name,
          route: "/api/whatsapp/webhook",
          error: errorMessage(err),
        });
      }
      return NextResponse.json({ ok: true, handled: "from_me" });
    }

    // 5. UAZAPI-specific: fetch media URL via POST /message/download.
    //    (UAZAPI does not include fileURL in the webhook for media messages.)
    const isMediaType = msg.type !== "text";
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

    // 6. Native AI Agent router. Any miss or failure falls through to legacy.
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

    // 7. Shared pipeline: dedup + lead + flows + conversation + msg + IA.
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
