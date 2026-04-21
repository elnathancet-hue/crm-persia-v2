import type {
  ConnectionResult,
  CreateCampaignOptions,
  IncomingMessage,
  LeadSyncData,
  MessageResult,
  RemoteTemplate,
  SendButtonsOptions,
  SendCarouselOptions,
  SendContactOptions,
  SendLocationOptions,
  SendMediaOptions,
  SendMenuOptions,
  SendPixOptions,
  SendTemplateOptions,
  SendTextOptions,
  SessionStatus,
  TemplateCapable,
  WhatsAppProvider,
} from "../provider";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaCloudConfig {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  verifyToken: string;
}

export class MetaCloudUnsupportedError extends Error {
  constructor(feature: string) {
    super(`Meta Cloud provider does not support: ${feature}`);
    this.name = "MetaCloudUnsupportedError";
  }
}

export class MetaCloudGraphError extends Error {
  constructor(public status: number, public body: string) {
    super(`Meta Graph API error ${status}: ${body}`);
    this.name = "MetaCloudGraphError";
  }
}

type MetaSendResponse = {
  messages?: Array<{ id: string }>;
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
};

type MetaMediaUploadResponse = { id: string };

export class MetaCloudAdapter implements WhatsAppProvider, TemplateCapable {
  readonly name = "meta_cloud";
  private phoneBase: string;

  constructor(private cfg: MetaCloudConfig) {
    this.phoneBase = `${GRAPH_BASE}/${cfg.phoneNumberId}`;
  }

  // ------------ Session (mostly no-ops for token-based Cloud API) ------------

  async connect(): Promise<ConnectionResult> {
    const status = await this.getStatus();
    return status.connected
      ? { status: "connected" }
      : { status: "error", error: "Token Meta invalido ou phone_number_id inacessivel" };
  }

  async disconnect(): Promise<void> {
    // No session to tear down. Caller should mark DB status manually.
  }

  async logout(): Promise<void> {
    // No-op: Meta Cloud uses permanent tokens.
  }

  async reset(): Promise<void> {
    // No-op: no session to reset.
  }

  async getStatus(): Promise<SessionStatus> {
    // GET /{phone_number_id} returns the number's registration state.
    try {
      const r = await fetch(this.phoneBase, {
        headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
      });
      if (!r.ok) return { connected: false, loggedIn: false };
      const data = (await r.json()) as { display_phone_number?: string; verified_name?: string };
      return { connected: true, loggedIn: true, phone: data.display_phone_number };
    } catch {
      return { connected: false, loggedIn: false };
    }
  }

  async getQRCode(): Promise<string | null> {
    // Meta Cloud does not use QR pairing.
    return null;
  }

  // ------------ Messaging ------------

  async sendText(opts: SendTextOptions): Promise<MessageResult> {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(opts.phone),
      type: "text",
      text: { body: opts.message, preview_url: false },
      ...(opts.replyTo ? { context: { message_id: opts.replyTo } } : {}),
    };
    const data = await this.graph<MetaSendResponse>("POST", "/messages", body);
    return { messageId: data.messages?.[0]?.id ?? "", success: true };
  }

  // ------------ Templates (TemplateCapable) ------------

  async listRemoteTemplates(): Promise<RemoteTemplate[]> {
    // GET /{waba_id}/message_templates?limit=200 — paginates with `paging.next`.
    const url = `${GRAPH_BASE}/${this.cfg.wabaId}/message_templates?limit=200&fields=id,name,language,category,status,components`;
    const all: RemoteTemplate[] = [];
    let next: string | null = url;

    while (next) {
      const res = await fetch(next, {
        headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
      });
      if (!res.ok) throw new MetaCloudGraphError(res.status, await res.text());
      const data = (await res.json()) as {
        data?: RemoteTemplate[];
        paging?: { next?: string };
      };
      if (data.data) all.push(...data.data);
      next = data.paging?.next ?? null;
    }

    return all;
  }

  async sendTemplate(opts: SendTemplateOptions): Promise<MessageResult> {
    const data = await this.graph<MetaSendResponse>("POST", "/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(opts.phone),
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.language },
        ...(opts.components.length > 0 ? { components: opts.components } : {}),
      },
    });
    return { messageId: data.messages?.[0]?.id ?? "", success: true };
  }

  async sendMedia(opts: SendMediaOptions): Promise<MessageResult> {
    const mediaRef = await this.resolveMediaRef(opts.media, opts.type, opts.fileName);
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(opts.phone),
      type: opts.type,
      [opts.type]: {
        ...mediaRef,
        ...(opts.caption && opts.type !== "audio" ? { caption: opts.caption } : {}),
        ...(opts.type === "document" && opts.fileName ? { filename: opts.fileName } : {}),
      },
    };
    const data = await this.graph<MetaSendResponse>("POST", "/messages", payload);
    return { messageId: data.messages?.[0]?.id ?? "", success: true };
  }

  // Resolves `media` (base64 data-URL, http URL, or raw media_id) to the Graph API shape
  // { id } or { link }. Uploads base64 → media_id first.
  private async resolveMediaRef(
    media: string,
    type: SendMediaOptions["type"],
    fileName?: string,
  ): Promise<{ id: string } | { link: string }> {
    if (media.startsWith("http://") || media.startsWith("https://")) {
      return { link: media };
    }
    if (media.startsWith("data:")) {
      const id = await this.uploadMedia(media, type, fileName);
      return { id };
    }
    // Bare string → assume already a media_id.
    return { id: media };
  }

  private async uploadMedia(dataUrl: string, type: SendMediaOptions["type"], fileName?: string): Promise<string> {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Invalid base64 data URL for Meta media upload");
    const [, mime, b64] = match;
    const bytes = Buffer.from(b64, "base64");
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", type);
    form.set(
      "file",
      new Blob([bytes], { type: mime }),
      fileName || `upload.${extensionForMime(mime)}`,
    );
    const res = await fetch(`${this.phoneBase}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
      body: form,
    });
    if (!res.ok) throw new MetaCloudGraphError(res.status, await res.text());
    const data = (await res.json()) as MetaMediaUploadResponse;
    return data.id;
  }

  // ------------ Unsupported by Meta Cloud API (throw so callers notice) ------------

  async sendLocation(_opts: SendLocationOptions): Promise<MessageResult> {
    throw new MetaCloudUnsupportedError("sendLocation — use sendText with maps URL or create a template");
  }

  async sendButtons(_opts: SendButtonsOptions): Promise<MessageResult> {
    throw new MetaCloudUnsupportedError("sendButtons — use approved interactive templates (Phase 3)");
  }

  async sendMenu(_opts: SendMenuOptions): Promise<MessageResult> {
    throw new MetaCloudUnsupportedError("sendMenu — use interactive list message (not yet implemented)");
  }

  async sendCarousel(_opts: SendCarouselOptions): Promise<MessageResult> {
    throw new MetaCloudUnsupportedError("sendCarousel");
  }

  async sendPix(_opts: SendPixOptions): Promise<MessageResult> {
    throw new MetaCloudUnsupportedError("sendPix — UAZAPI-specific");
  }

  async sendContact(_opts: SendContactOptions): Promise<MessageResult> {
    throw new MetaCloudUnsupportedError("sendContact — not yet implemented");
  }

  async deleteMessage(_phone: string, _messageId: string): Promise<void> {
    throw new MetaCloudUnsupportedError("deleteMessage — Meta does not support arbitrary deletion");
  }

  async editMessage(_phone: string, _messageId: string, _newText: string): Promise<void> {
    throw new MetaCloudUnsupportedError("editMessage — Meta does not support editing");
  }

  async reactToMessage(phone: string, messageId: string, emoji: string): Promise<void> {
    await this.graph<MetaSendResponse>("POST", "/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(phone),
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    });
  }

  async createCampaign(_opts: CreateCampaignOptions): Promise<{ folderId: string; count: number }> {
    throw new MetaCloudUnsupportedError("createCampaign — Meta has no native queue; use wa_template_sends outbox (Phase 4)");
  }

  async listCampaigns(): Promise<unknown[]> {
    return [];
  }

  async clearCompletedCampaigns(): Promise<void> {
    // No-op.
  }

  // ------------ Actions ------------

  async markAsRead(messageIds: string[], _chatPhone: string): Promise<void> {
    // Meta marks by message id, one at a time.
    for (const id of messageIds) {
      await this.graph<MetaSendResponse>("POST", "/messages", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: id,
      }).catch(() => {});
    }
  }

  async setTyping(_phone: string, _typing: boolean): Promise<void> {
    // Not supported in Cloud API (as of v21). No-op to keep callers happy.
  }

  async setWebhook(_url: string): Promise<void> {
    // Webhook is configured on the Meta App (developers.facebook.com), not per number.
    throw new MetaCloudUnsupportedError("setWebhook — configure at App level in Meta Business Manager");
  }

  async checkNumber(phone: string): Promise<boolean> {
    // Meta Cloud v21 does not expose a pre-send number validator.
    // Best-effort: return true; real validation happens on send (error 131051 if invalid).
    return !!phone.replace(/\D/g, "");
  }

  async downloadMedia(
    messageId: string,
  ): Promise<{ fileURL?: string; mimetype?: string; transcription?: string }> {
    // Meta flow: 1) GET /{media_id} → { url, mime_type }; 2) GET url (Authorization header) to download bytes.
    // Here we return the authenticated URL; the caller proxies download.
    const meta = await this.graph<{ url?: string; mime_type?: string }>("GET", `/${messageId}`, undefined, true);
    return { fileURL: meta.url, mimetype: meta.mime_type };
  }

  // ------------ CRM sync (UAZAPI-specific — no-ops for Meta) ------------

  async syncLeadToWhatsApp(_phone: string, _data: LeadSyncData): Promise<void> {
    // No-op: Meta has no per-contact CRM fields.
  }

  async disableChatbotFor(_phone: string, _minutes: number): Promise<void> {
    // No-op.
  }

  async enableChatbot(_phone: string): Promise<void> {
    // No-op.
  }

  // ------------ Groups (not in Meta Cloud API scope) ------------

  async listGroups(): Promise<Array<{ jid: string; name: string; participantCount: number }>> {
    return [];
  }

  async createGroup(_name: string): Promise<{ jid: string }> {
    throw new MetaCloudUnsupportedError("createGroup");
  }

  async getGroupInfo(_jid: string): Promise<{ name: string; description: string; participantCount: number; announce: boolean }> {
    throw new MetaCloudUnsupportedError("getGroupInfo");
  }

  async getGroupInviteLink(_jid: string): Promise<string> {
    throw new MetaCloudUnsupportedError("getGroupInviteLink");
  }

  async updateGroupName(_jid: string, _name: string): Promise<void> {
    throw new MetaCloudUnsupportedError("updateGroupName");
  }

  async updateGroupDescription(_jid: string, _description: string): Promise<void> {
    throw new MetaCloudUnsupportedError("updateGroupDescription");
  }

  async setGroupAnnounce(_jid: string, _announce: boolean): Promise<void> {
    throw new MetaCloudUnsupportedError("setGroupAnnounce");
  }

  async resetGroupInviteLink(_jid: string): Promise<string> {
    throw new MetaCloudUnsupportedError("resetGroupInviteLink");
  }

  // ------------ Webhook parsing ------------

  parseWebhook(body: unknown): IncomingMessage | null {
    // Accepts either the full webhook envelope or a single messages[] entry.
    const first = extractFirstMetaMessage(body);
    if (!first) return null;

    const msg = first.message;
    const type = mapMetaType(msg.type);
    if (!type) return null;

    const phone = String(msg.from || "").replace(/\D/g, "");
    if (!phone) return null;

    const text: string | null =
      msg.text?.body ??
      msg.image?.caption ??
      msg.video?.caption ??
      msg.document?.caption ??
      null;

    const mediaPart =
      msg.image ??
      msg.video ??
      msg.audio ??
      msg.document ??
      msg.sticker ??
      null;

    return {
      messageId: String(msg.id || ""),
      phone,
      pushName: first.contactName || "",
      text,
      type,
      isGroup: false, // Meta Cloud ignores groups
      isFromMe: false,
      timestamp: Number(msg.timestamp || 0) * 1000 || Date.now(),
      mediaUrl: undefined, // Meta requires a follow-up GET /{media_id} — filled by caller
      mediaMimeType: mediaPart?.mime_type,
      caption: text ?? undefined,
      latitude: msg.location?.latitude,
      longitude: msg.location?.longitude,
    };
  }

  // ------------ Low-level Graph fetch ------------

  private async graph<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    absolutePath = false,
  ): Promise<T> {
    const url = absolutePath ? `${GRAPH_BASE}${path}` : `${this.phoneBase}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new MetaCloudGraphError(res.status, await res.text());
    return (await res.json()) as T;
  }
}

// ============ Helpers (module-level, pure) ============

function normalizePhone(phone: string): string {
  // Meta expects digits only, country code included (no + sign).
  return phone.replace(/\D/g, "");
}

function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

interface MetaMsg {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id?: string; mime_type?: string; sha256?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

function extractFirstMetaMessage(body: unknown): { message: MetaMsg; contactName?: string } | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;

  // Case 1: single message object already peeled (from === "5511...", type === "text", etc.)
  if (typeof b.from === "string" && typeof b.type === "string") {
    return { message: b as unknown as MetaMsg };
  }

  // Case 2: full Meta envelope — body.entry[0].changes[0].value.messages[0]
  const entry = (b.entry as Array<Record<string, unknown>> | undefined)?.[0];
  const change = (entry?.changes as Array<Record<string, unknown>> | undefined)?.[0];
  const value = change?.value as Record<string, unknown> | undefined;
  const messages = value?.messages as MetaMsg[] | undefined;
  const contacts = value?.contacts as Array<{ profile?: { name?: string } }> | undefined;

  if (messages && messages[0]) {
    return { message: messages[0], contactName: contacts?.[0]?.profile?.name };
  }
  return null;
}

function mapMetaType(type: string): IncomingMessage["type"] | null {
  switch (type) {
    case "text":
    case "interactive":
    case "button":
      return "text";
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
      return "document";
    case "sticker":
      return "sticker";
    case "location":
      return "location";
    case "contacts":
      return "contact";
    default:
      return null;
  }
}
