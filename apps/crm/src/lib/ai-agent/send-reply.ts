import "server-only";

import type { HumanizationConfig } from "@persia/shared/ai-agent";
import { splitMessage } from "@/lib/ai/message-splitter";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { errorMessage, logError } from "@/lib/observability";
import { type AgentDb, nowIso } from "./db";

// PR-AI-AGENT-HUMAN-B (mai/2026): envia resposta do agente nativo
// respeitando o split_enabled da humanization_config. Quando enabled e
// texto >= threshold, pede ao GPT (via splitMessage) pra cortar em
// mensagens menores e envia uma por vez com setTyping + delay.
//
// Fallback gracioso: se splitMessage falhar internamente (sempre retorna
// pelo menos [originalText]), o loop manda o texto inteiro como 1
// mensagem. Erros do provider.sendText propagam pra cima.
//
// Por que nao no executor: extraido pra modulo proprio porque vai ser
// reusado pela tool send_media (PR D) e por outros executores no futuro.
// Tambem facilita teste isolado.

export interface SendAssistantReplyParams {
  provider: WhatsAppProvider;
  phone: string;
  text: string;
  humanization: HumanizationConfig;
  // Logging context. orgId + conversationId ajudam a rastrear quando
  // split falha (cai pro single send) ou quando provider.sendText quebra
  // numa das partes intermediarias.
  orgId: string;
  conversationId: string;
  // PR1 #2 (mai/2026): quando setado, persiste cada parte enviada como
  // row em `messages` (sender='ai'). Caller decide se quer persistir —
  // dryRun do Tester e fluxos com IDs sinteticos (leadId='tester') NAO
  // devem passar `persist` pra evitar lixo no DB.
  persist?: {
    db: AgentDb;
    leadId: string;
  };
}

export async function sendAssistantReply(
  params: SendAssistantReplyParams,
): Promise<void> {
  const { provider, phone, text, humanization, persist } = params;

  // Caminho rapido: split off ou texto curto = envia inteiro.
  if (
    !humanization.split_enabled ||
    text.length < humanization.split_threshold_chars
  ) {
    const result = await provider.sendText({ phone, message: text });
    await persistAiMessage(params, text, result?.messageId ?? null);
    return;
  }

  // splitMessage usa GPT pra decidir cortes naturais; retorna sempre
  // pelo menos [text] em caso de erro interno.
  const parts = await splitMessage(text, {
    enabled: true,
    threshold: humanization.split_threshold_chars,
    delay_seconds: humanization.split_delay_seconds,
  });

  // Defensivo: se splitMessage retornou 1 (fallback ou texto curto pos-
  // GPT), evita o overhead de loop + setTyping.
  if (parts.length <= 1) {
    const onlyPart = parts[0] ?? text;
    const result = await provider.sendText({ phone, message: onlyPart });
    await persistAiMessage(params, onlyPart, result?.messageId ?? null);
    return;
  }

  const delayMs = Math.max(0, humanization.split_delay_seconds) * 1000;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && delayMs > 0) {
      // setTyping e cosmetico — ignora erro pra nao quebrar envio se
      // provider nao suportar (ex: Meta Cloud em features futuras).
      try {
        await provider.setTyping(phone, true);
      } catch (err: unknown) {
        logError("send_assistant_reply_set_typing_failed", {
          organization_id: params.orgId,
          conversation_id: params.conversationId,
          part_index: i,
          error: errorMessage(err),
        });
      }
      await sleep(delayMs);
    }
    // Persistir DENTRO do loop: cada bolha enviada vira 1 row, espelhando
    // o que o cliente recebe no WhatsApp. Insert e fire-and-await por
    // parte — falha de insert em uma nao bloqueia as outras (log + segue).
    const result = await provider.sendText({ phone, message: parts[i] });
    await persistAiMessage(params, parts[i], result?.messageId ?? null);
  }
}

// PR1 #2: INSERT em `messages` quando caller pediu persistencia.
// Shape espelhado de tools/send-media.ts:173 (unico INSERT existente no
// modulo). Sem `persist` (dryRun Tester, fluxos sinteticos), no-op.
//
// Erros de DB sao logados mas NAO propagam — a bolha ja foi enviada ao
// cliente; persistir e best-effort pra dashboards/historico. Bloquear
// o fluxo seria pior que ter um gap no historico.
async function persistAiMessage(
  params: SendAssistantReplyParams,
  content: string,
  whatsappMessageId: string | null,
): Promise<void> {
  if (!params.persist) return;
  const { db, leadId } = params.persist;
  try {
    const { error } = await db.from("messages").insert({
      organization_id: params.orgId,
      conversation_id: params.conversationId,
      lead_id: leadId,
      content,
      sender: "ai",
      type: "text",
      whatsapp_msg_id: whatsappMessageId,
      status: "sent",
      created_at: nowIso(),
    });
    if (error) {
      logError("send_assistant_reply_persist_failed", {
        organization_id: params.orgId,
        conversation_id: params.conversationId,
        lead_id: leadId,
        error: error.message,
      });
    }
  } catch (err: unknown) {
    logError("send_assistant_reply_persist_failed", {
      organization_id: params.orgId,
      conversation_id: params.conversationId,
      lead_id: leadId,
      error: errorMessage(err),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
