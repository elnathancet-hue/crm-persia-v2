import "server-only";

import type { HumanizationConfig } from "@persia/shared/ai-agent";
import { splitMessage } from "@/lib/ai/message-splitter";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { errorMessage, logError } from "@/lib/observability";

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
}

export async function sendAssistantReply(
  params: SendAssistantReplyParams,
): Promise<void> {
  const { provider, phone, text, humanization } = params;

  // Caminho rapido: split off ou texto curto = envia inteiro.
  if (
    !humanization.split_enabled ||
    text.length < humanization.split_threshold_chars
  ) {
    await provider.sendText({ phone, message: text });
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
    await provider.sendText({ phone, message: parts[0] ?? text });
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
    await provider.sendText({ phone, message: parts[i] });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
