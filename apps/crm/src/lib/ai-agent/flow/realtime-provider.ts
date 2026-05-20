// AI Agent — provider adapter pra MODO PRODUÇÃO (webhook real).
//
// PR-FLOW-PIVOT PR 2b (mai/2026): irmão do `tester-provider.ts` (que
// captura eventos em memória pro Tester). Esse aqui DELEGA pro
// WhatsAppProvider real (UAZAPI ou Meta Cloud), enviando mensagem de
// verdade pro lead.
//
// Também persiste a mensagem em `messages` (canonical do CRM) com
// sender='ai' pra aparecer no chat — paridade com mensagem manual
// enviada por humano. Falhas de DB são best-effort (log + segue) —
// o WhatsApp já foi entregue, perder o registro local é o menor mal.

import type { WhatsAppProvider } from "@persia/shared/whatsapp";
import type { AgentDb } from "../db";
import type { FlowProviderStub, TesterRunEvent } from "./types";

export interface CreateRealtimeProviderOptions {
  db: AgentDb;
  /** WhatsAppProvider construído via createProvider(whatsapp_connection). */
  provider: WhatsAppProvider;
  /** Phone do destinatário (lead). */
  leadPhone: string;
  /** Lead UUID (pra persistir em messages.lead_id). */
  leadId: string;
  /** Conversation UUID (pra persistir em messages.conversation_id). */
  conversationId: string;
  organizationId: string;
  /** Optional clock pra tests deterministicos. */
  clock?: () => number;
}

/**
 * Cria um provider que:
 *   1. Captura todos os eventos (igual ao stub do Tester) — usado por
 *      audit em agent_steps no PR 6.
 *   2. Quando o runner emite `send_text`, dispara `provider.sendText`
 *      assincronamente. Erro é capturado e vira evento `skipped`.
 *   3. Quando emite `set_typing_on/off`, dispara `provider.setTyping`
 *      (best-effort — tolera falha silenciosa).
 *   4. Insere msg outbound em `messages` (sender='ai') pra aparecer
 *      no chat-window CRM.
 *
 * IMPORTANTE: as chamadas async são `await`-adas DENTRO do emit. Como
 * o runner faz `provider.emit(...)` síncronamente, o IO real fica
 * "fire and forget" do ponto de vista do runner. Isso reduz latência
 * percebida pelo lead — runner segue pra próxima ação enquanto WhatsApp
 * ainda está processando. Trade-off: se sendText falhar, perdemos o
 * erro síncrono (vira evento `skipped`).
 */
export function createRealtimeProvider(
  opts: CreateRealtimeProviderOptions,
): FlowProviderStub {
  const clock = opts.clock ?? (() => Date.now());
  const events: TesterRunEvent[] = [];

  function record(event: Omit<TesterRunEvent, "ts">): TesterRunEvent {
    const full = { ts: clock(), ...event };
    events.push(full);
    return full;
  }

  return {
    emit(event) {
      const recorded = record(event);

      // Fire-and-forget pro I/O real. Erros viram evento `skipped`
      // em vez de propagar pro runner.
      if (event.kind === "send_text") {
        const payload = event.payload as { message?: string };
        const message = payload.message ?? "";
        if (!message) return;
        void (async () => {
          try {
            const result = await opts.provider.sendText({
              phone: opts.leadPhone,
              message,
            });
            // Insere outbound message em `messages` pra aparecer no chat.
            // Best-effort — falha aqui só perde o registro local.
            try {
              await opts.db.from("messages").insert({
                organization_id: opts.organizationId,
                conversation_id: opts.conversationId,
                lead_id: opts.leadId,
                content: message,
                sender: "ai",
                type: "text",
                whatsapp_msg_id: result?.messageId ?? null,
                status: result?.success === false ? "failed" : "sent",
              });
            } catch (insertErr) {
              console.error(
                "[realtime-provider] insert outbound message failed:",
                insertErr,
              );
            }
          } catch (err) {
            record({
              kind: "skipped",
              payload: {
                reason: "provider_send_failed",
                error: err instanceof Error ? err.message : String(err),
                source_event_ts: recorded.ts,
              },
            });
          }
        })();
        return;
      }

      if (event.kind === "set_typing_on" || event.kind === "set_typing_off") {
        const typing = event.kind === "set_typing_on";
        void opts.provider.setTyping(opts.leadPhone, typing).catch(() => {
          // setTyping é cosmético — falha silenciosa.
        });
        return;
      }

      // Outros eventos (node_entered, tool_call, etc) ficam só no
      // array em memória — audit em agent_steps no PR 6.
    },
    getEvents() {
      return events.slice();
    },
  };
}
