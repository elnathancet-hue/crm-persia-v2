import "server-only";

import type { TesterEvent, TesterEventKind } from "@persia/shared/ai-agent";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";

// PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): provider stub que substitui
// UAZAPI/Meta no Tester. Captura TODA chamada de envio em memoria
// (`events[]`) com timestamp absoluto pra UI reconstruir a timeline.
//
// O stub implementa a interface inteira (TS exige), mas so os metodos
// chamados pelo executor + sendAssistantReply importam:
//   - sendText  → captura
//   - sendMedia → captura
//   - setTyping → captura
//   - markAsRead → noop silencioso
// Os outros lancam erro pra detectar se o pipeline esta tentando
// chamar algo nao esperado (paranoia produtiva).

export interface TesterProviderResult {
  provider: WhatsAppProvider;
  events: TesterEvent[];
}

function record(
  events: TesterEvent[],
  kind: TesterEventKind,
  payload: Record<string, unknown>,
): void {
  events.push({ ts: Date.now(), kind, payload });
}

function notImplemented(method: string): never {
  throw new Error(
    `tester provider: ${method} chamado durante Tester — pipeline tentou uma operacao nao suportada no modo de teste. Investigar handler responsavel.`,
  );
}

export function makeTesterProvider(): TesterProviderResult {
  const events: TesterEvent[] = [];

  const provider: WhatsAppProvider = {
    name: "tester-stub",

    // ----- Session (nao usado pelo executor, mas precisa existir) -----
    connect: async () => ({ status: "connected", phone: "tester" }),
    disconnect: async () => undefined,
    logout: async () => undefined,
    reset: async () => undefined,
    getStatus: async () => ({ connected: true, loggedIn: true, phone: "tester" }),
    getQRCode: async () => null,

    // ----- Messaging basico (capturado) -----
    sendText: async (opts) => {
      record(events, "send_text", {
        phone: opts.phone,
        message: opts.message,
      });
      return { messageId: `stub-${crypto.randomUUID()}`, success: true };
    },
    sendMedia: async (opts) => {
      record(events, "send_media", {
        phone: opts.phone,
        mediaUrl: opts.media,
        mediaType: opts.type,
        caption: opts.caption ?? null,
        fileName: opts.fileName ?? null,
      });
      return { messageId: `stub-${crypto.randomUUID()}`, success: true };
    },
    sendLocation: async () => notImplemented("sendLocation"),
    sendButtons: async () => notImplemented("sendButtons"),

    // ----- Messaging avancado (nao esperado) -----
    sendMenu: async () => notImplemented("sendMenu"),
    sendCarousel: async () => notImplemented("sendCarousel"),
    sendPix: async () => notImplemented("sendPix"),
    sendContact: async () => notImplemented("sendContact"),

    // ----- Message actions -----
    deleteMessage: async () => notImplemented("deleteMessage"),
    editMessage: async () => notImplemented("editMessage"),
    reactToMessage: async () => notImplemented("reactToMessage"),

    // ----- Mass sending -----
    createCampaign: async () => notImplemented("createCampaign"),
    listCampaigns: async () => [],
    clearCompletedCampaigns: async () => undefined,

    // ----- Actions -----
    markAsRead: async () => undefined, // noop, executor chama silenciosamente
    setTyping: async (_phone, typing) => {
      record(events, typing ? "set_typing_on" : "set_typing_off", {
        phone: _phone,
      });
    },

    // ----- Webhook / contacts -----
    setWebhook: async () => undefined,
    checkNumber: async () => true,

    // ----- Media download -----
    downloadMedia: async () => ({ fileURL: undefined, mimetype: undefined }),

    // ----- CRM Sync -----
    syncLeadToWhatsApp: async () => undefined,
    disableChatbotFor: async () => undefined,
    enableChatbot: async () => undefined,

    // ----- Groups -----
    listGroups: async () => [],
    createGroup: async () => notImplemented("createGroup"),
    getGroupInfo: async () => notImplemented("getGroupInfo"),
    getGroupInviteLink: async () => notImplemented("getGroupInviteLink"),
    updateGroupName: async () => notImplemented("updateGroupName"),
    updateGroupDescription: async () => notImplemented("updateGroupDescription"),
    setGroupAnnounce: async () => notImplemented("setGroupAnnounce"),
    resetGroupInviteLink: async () => notImplemented("resetGroupInviteLink"),

    // ----- Webhook parser (nao usado pelo executor) -----
    parseWebhook: () => null,
  };

  return { provider, events };
}

/**
 * Conveniencia: empurra um evento "skipped" pra timeline quando o
 * pipeline pulou antes de qualquer send (ex: pause keyword bateu).
 */
export function pushSkippedEvent(
  events: TesterEvent[],
  reason: string,
  human_message?: string,
): void {
  events.push({
    ts: Date.now(),
    kind: "skipped",
    payload: { reason, human_message: human_message ?? null },
  });
}
