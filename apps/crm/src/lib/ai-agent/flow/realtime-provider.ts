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

import OpenAI from "openai";
import type { WhatsAppProvider } from "@persia/shared/whatsapp";
import type { HumanizationConfig } from "@persia/shared/ai-agent";
import type { AgentDb } from "../db";
import { stripToolCallLeaks } from "../tool-call-sanitizer";
import type { FlowProviderStub, TesterRunEvent } from "./types";
import { canAiSendNow, type AiOutboundSendGuard } from "../send-guard";

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
  /** Humanization config normalizada — controla split + delay. PR 6
   * (mai/2026): se split_enabled, divide mensagens longas em chunks. */
  humanization: HumanizationConfig;
  /** Optional clock pra tests deterministicos. */
  clock?: () => number;
  /** Last-mile guard. Checked before every real WhatsApp send/chunk. */
  sendGuard?: AiOutboundSendGuard;
}

// ============================================================================
// Split helpers — divide msg longa em partes naturais
// ============================================================================
//
// Estratégia primária: LLM (gpt-4o-mini) com tags <MSG>...</MSG>, igual ao
// fluxo n8n de referência do cliente. Zero risco de cortar no meio de palavra
// ou frase porque o modelo entende semântica.
//
// Fallback: divisão determinística com prioridade de quebra:
//   \n\n > \n > ". " > " " > hard cut
//
// Bug histórico corrigido (jun/2026): o código anterior usava `||` com os
// resultados de `lastIndexOf`. Como `lastIndexOf` retorna -1 quando não
// encontra, e -1 é TRUTHY em JS, a cadeia `||` parava no primeiro -1
// (retornado por `lastIndexOf("\n\n")`), ignorando os outros separadores.
// Isso causava hard cut na posição thresholdChars, cortando palavras.
// Fix: loop explícito com `pos > 0` para ignorar -1 e 0.

function splitMessageDeterministic(text: string, thresholdChars: number): string[] {
  if (text.length <= thresholdChars) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > thresholdChars) {
    const win = remaining.slice(0, thresholdChars);
    let splitAt = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const pos = win.lastIndexOf(sep);
      if (pos > 0) { splitAt = pos; break; }
    }
    const cut = splitAt > thresholdChars * 0.5 ? splitAt : thresholdChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function splitMessageWithLLM(
  text: string,
  thresholdChars: number,
): Promise<string[]> {
  if (text.length <= thresholdChars) return [text];

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "Divida o texto em mensagens naturais de WhatsApp. " +
              "Retorne SOMENTE as mensagens usando o delimitador <MSG> e </MSG>. " +
              "NÃO retorne JSON. NÃO use markdown. NÃO escreva nada fora das tags. " +
              "Exemplo: <MSG>Mensagem 1</MSG><MSG>Mensagem 2</MSG>",
          },
          { role: "user", content: text },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? "";
      const matches = [...raw.matchAll(/<MSG>([\s\S]*?)<\/MSG>/g)];
      const messages = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
      if (messages.length > 0) return messages;
    } catch (err) {
      console.error("[realtime-provider] LLM split falhou, usando fallback:", err);
    }
  }

  return splitMessageDeterministic(text, thresholdChars);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  async function ensureCanSend(
    chunkIndex: number,
    sourceEventTs: number,
  ): Promise<boolean> {
    if (!opts.sendGuard) return true;
    const result = await canAiSendNow(opts.sendGuard);
    if (result.ok) return true;
    await opts.provider.setTyping(opts.leadPhone, false).catch(() => {});
    record({
      kind: "skipped",
      payload: {
        reason: "ai_send_blocked",
        block_reason: result.reason,
        source_event_ts: sourceEventTs,
        chunk_index: chunkIndex,
      },
    });
    return false;
  }

  return {
    emit(event) {
      const recorded = record(event);

      // Fire-and-forget pro I/O real. Erros viram evento `skipped`
      // em vez de propagar pro runner.
      if (event.kind === "send_text") {
        const payload = event.payload as { message?: string };
        const rawMessage = payload.message ?? "";
        if (!rawMessage) return;
        // Bug D fix (mai/2026): camada 2 de defesa. O runner.ts já
        // sanitiza antes de emitir send_text, mas se uma feature
        // futura emitir direto sem passar pelo runner (ex: handler
        // de tool que envia confirmação), garantimos aqui. Loga em
        // skipped event se houver leak — não bloqueia, só registra
        // pra alarmar caso o sanitizer do runner falhe.
        const { cleaned, leakedPatterns } = stripToolCallLeaks(rawMessage);
        if (leakedPatterns.length > 0) {
          record({
            kind: "skipped",
            payload: {
              reason: "tool_call_leak_stripped_at_provider",
              count: leakedPatterns.length,
              patterns: leakedPatterns,
            },
          });
        }
        const message = cleaned;
        if (!message) return; // tudo era tool call leak — não envia mensagem vazia
        void (async () => {
          // PR 6 (mai/2026): split de msg longa em chunks. Entre chunks,
          // setTyping(on) + delay configurável + setTyping(off) pra ritmo
          // mais humano (cliente percebe IA "digitando").
          const chunks =
            opts.humanization.split_enabled &&
            message.length > opts.humanization.split_threshold_chars
              ? await splitMessageWithLLM(message, opts.humanization.split_threshold_chars)
              : [message];
          const delayMs = Math.max(
            0,
            (opts.humanization.split_delay_seconds ?? 0) * 1000,
          );

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]!;
            try {
              if (!(await ensureCanSend(i, recorded.ts))) return;
              const result = await opts.provider.sendText({
                phone: opts.leadPhone,
                message: chunk,
              });
              try {
                await opts.db.from("messages").insert({
                  organization_id: opts.organizationId,
                  conversation_id: opts.conversationId,
                  lead_id: opts.leadId,
                  content: chunk,
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
                  chunk_index: i,
                },
              });
              return; // aborta resto dos chunks se um falhou
            }

            // Delay + setTyping entre chunks (não no último).
            if (i < chunks.length - 1 && delayMs > 0) {
              if (!(await ensureCanSend(i, recorded.ts))) return;
              await opts.provider
                .setTyping(opts.leadPhone, true)
                .catch(() => {});
              await sleep(delayMs);
              await opts.provider
                .setTyping(opts.leadPhone, false)
                .catch(() => {});
            }
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
