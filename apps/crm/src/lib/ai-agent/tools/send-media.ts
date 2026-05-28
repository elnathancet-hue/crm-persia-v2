import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import {
  failureResult,
  getHandlerConversation,
  getHandlerDb,
  getHandlerProvider,
  insertLeadActivity,
  successResult,
} from "./shared";

// PR-AI-AGENT-HUMAN-D (mai/2026): handler nativo `send_media`. Agente
// chama com `{ slug, caption? }` e o runtime:
//   1. Resolve slug -> automation_tools row (org-scoped, is_active=true)
//   2. Mapeia category -> SendMediaOptions.type (image | video | audio |
//      document)
//   3. Chama provider.sendMedia({ phone, type, media: file_url, caption })
//   4. Insere mensagem em messages com sender=ai + type apropriado + media_url
//   5. Retorna sucesso com slug + file metadata (LLM tem contexto pro
//      proximo turno)
//
// Por que slug e nao id: cliente leigo nao ve UUID. Slug e human-readable
// e o agente nao precisa de "tabela mental" — o system prompt vai listar
// nomes amigaveis + slugs. Se o LLM errar o slug, lookup falha gracioso.

const sendMediaSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  caption: z.string().trim().max(500).nullish(),
});

// Mapeia category guardado em automation_tools.category pra type aceito
// pelo SendMediaOptions. Defaults pra 'document' quando categoria nao
// reconhecida (PDFs, arquivos genericos).
function categoryToMediaType(
  category: string | null,
  fileType: string | null,
): "image" | "video" | "audio" | "document" {
  const norm = (category ?? "").toLowerCase();
  if (norm === "imagem" || norm === "image") return "image";
  if (norm === "video" || norm === "vídeo") return "video";
  if (norm === "audio" || norm === "áudio") return "audio";
  // Sub-fallback: olha o mime type se categoria ambigua.
  const mime = (fileType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

// Mapeia type -> CRM message.type (text/image/video/audio/document/file).
// Esquema em `messages.type` ja aceita esses valores via CHECK constraint
// (migration 005).
function mediaTypeToMessageType(
  type: "image" | "video" | "audio" | "document",
): "image" | "video" | "audio" | "document" {
  return type;
}

export const sendMediaHandler: NativeHandler = async (context, input) => {
  const parsed = sendMediaSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const provider = getHandlerProvider(context);
  // Sem provider nao tem como enviar (dry_run respeitado abaixo).
  if (!provider && !context.dry_run) {
    return failureResult("provider context missing");
  }

  const slug = parsed.data.slug.trim().toLowerCase();
  const caption = parsed.data.caption?.trim() || null;

  // 1. Resolve slug -> automation_tools row.
  // ilike pra case-insensitive (slug normalizado para lowercase, mas
  // tabela pode ter mix).
  const { data: tool, error: toolError } = await db
    .from("automation_tools")
    .select("id, name, slug, category, file_url, file_name, file_type, is_active")
    .eq("organization_id", context.organization_id)
    .ilike("slug", slug)
    .maybeSingle();

  if (toolError) return failureResult(toolError.message);
  if (!tool) {
    return failureResult(`media not found for slug "${slug}"`, {
      slug,
      hint: "verifique a lista de mídias disponíveis no contexto",
    });
  }

  const isActive = (tool as { is_active?: boolean }).is_active;
  if (isActive === false) {
    return failureResult(`media "${slug}" is inactive`, { slug });
  }

  const fileUrl = (tool as { file_url?: string | null }).file_url;
  if (!fileUrl) {
    return failureResult(`media "${slug}" has no file_url`, { slug });
  }

  const mediaType = categoryToMediaType(
    (tool as { category?: string | null }).category ?? null,
    (tool as { file_type?: string | null }).file_type ?? null,
  );
  const messageType = mediaTypeToMessageType(mediaType);

  if (context.dry_run) {
    return successResult(
      {
        slug,
        name: (tool as { name?: string }).name ?? null,
        file_url: fileUrl,
        media_type: mediaType,
        caption,
      },
      [
        `would send ${mediaType} "${(tool as { name?: string }).name ?? slug}"${
          caption ? ` with caption` : ""
        } to lead`,
      ],
    );
  }

  // 2. Resolve lead phone (context nao carrega phone diretamente).
  if (!provider) {
    return failureResult("provider context missing");
  }
  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("phone")
    .eq("id", context.lead_id)
    .eq("organization_id", context.organization_id)
    .maybeSingle();
  if (leadError) return failureResult(leadError.message);
  const leadPhone = (leadRow as { phone?: string | null } | null)?.phone;
  if (!leadPhone) {
    return failureResult("lead has no phone", { lead_id: context.lead_id });
  }

  // 3. Send via provider. Erro de envio propaga como failureResult pro
  // executor decidir (handoff humano).
  let providerMessageId: string | null = null;
  try {
    const result = await provider.sendMedia({
      phone: leadPhone,
      type: mediaType,
      media: fileUrl,
      caption: caption ?? undefined,
      fileName:
        (tool as { file_name?: string | null }).file_name ?? undefined,
    });
    providerMessageId = result.messageId ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "failed to send media";
    return failureResult(message, { slug, file_url: fileUrl });
  }

  // 3. Insere mensagem no DB (sender=ai). agent_conversation tracking
  // ja eh feito pelo executor; aqui so persistimos a linha de chat.
  const conversation = getHandlerConversation(context);
  const crmConversationId =
    (conversation as { crm_conversation_id?: string } | null)
      ?.crm_conversation_id ?? null;

  if (crmConversationId) {
    await db.from("messages").insert({
      organization_id: context.organization_id,
      conversation_id: crmConversationId,
      lead_id: context.lead_id,
      content: caption,
      sender: "ai",
      type: messageType,
      whatsapp_msg_id: providerMessageId,
      media_url: fileUrl,
      media_type:
        (tool as { file_type?: string | null }).file_type ?? null,
      status: "sent",
      created_at: nowIso(),
    });
  }

  // PR-AGENT-INTEGRATION-1: log no historico do lead.
  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "media_sent",
    description: `IA enviou ${mediaType} "${
      (tool as { name?: string }).name ?? slug
    }"${caption ? " com legenda" : ""}`,
    metadata: {
      slug,
      media_type: mediaType,
      file_url: fileUrl,
      caption: caption ?? null,
    },
  });

  return successResult(
    {
      slug,
      name: (tool as { name?: string }).name ?? null,
      file_url: fileUrl,
      media_type: mediaType,
      caption,
      provider_message_id: providerMessageId,
    },
    [
      `sent ${mediaType} "${(tool as { name?: string }).name ?? slug}"${
        caption ? ` with caption` : ""
      } to lead`,
    ],
  );
};
