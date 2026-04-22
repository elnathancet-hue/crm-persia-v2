import { UazapiClient, phoneToJid } from "./uazapi-client";
import { buildUazapiWebhookConfig } from "./uazapi-webhook-config";
import type {
  ConnectionResult,
  CreateCampaignOptions,
  IncomingMessage,
  LeadSyncData,
  MessageResult,
  SendButtonsOptions,
  SendCarouselOptions,
  SendContactOptions,
  SendLocationOptions,
  SendMediaOptions,
  SendMenuOptions,
  SendPixOptions,
  SendTextOptions,
  SessionStatus,
  WhatsAppProvider,
} from "../whatsapp";

export class UazapiAdapter implements WhatsAppProvider {
  readonly name = "uazapi";
  private client: UazapiClient;

  constructor(baseUrl: string, token: string) {
    this.client = new UazapiClient({ baseUrl, token });
  }

  async connect(): Promise<ConnectionResult> {
    try {
      const result = await this.client.connect();
      // UAZAPI v2: returns { qrcode, status: { connected, loggedIn } }
      if (result.qrcode) {
        return { status: "qr", qrCode: result.qrcode };
      }
      if (result.status?.connected && result.status?.loggedIn) {
        return { status: "connected" };
      }
      // No QR and not connected — instance may be stuck. Reset and retry once.
      console.warn("[WhatsApp provider] connect() returned no QR, resetting and retrying");
      try { await this.client.reset(); } catch { /* non-fatal */ }
      const result2 = await this.client.connect();
      if (result2.qrcode) {
        return { status: "qr", qrCode: result2.qrcode };
      }
      if (result2.status?.connected && result2.status?.loggedIn) {
        return { status: "connected" };
      }
      return { status: "error", error: "Não foi possível gerar QR Code" };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { status: "error", error: msg };
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async logout(): Promise<void> {
    await this.client.logout();
  }

  async reset(): Promise<void> {
    await this.client.reset();
  }

  async getStatus(): Promise<SessionStatus> {
    const s = await this.client.getStatus();
    return { connected: !!s.connected, loggedIn: !!s.loggedIn };
  }

  async getQRCode(): Promise<string | null> {
    try {
      const qr = await this.client.getQRCode();
      return qr || null;
    } catch {
      return null;
    }
  }

  async sendText(opts: SendTextOptions): Promise<MessageResult> {
    const result = await this.client.sendTextV2({
      number: opts.phone,
      text: opts.message,
    });
    const id = result.messageId || result.MessageId || (result as { messageid?: string }).messageid || "";
    return { messageId: String(id), success: true };
  }

  async sendMedia(opts: SendMediaOptions): Promise<MessageResult> {
    try {
      const result = await this.client.sendMediaV2({
        number: opts.phone,
        file: opts.media,
        type: opts.type,
        caption: opts.caption,
        docName: opts.type === "document" ? (opts.fileName || "arquivo") : undefined,
      });
      const id = result.messageId || result.MessageId || "";
      return { messageId: String(id), success: true };
    } catch {
      let result: { MessageId: string };
      switch (opts.type) {
        case "image":
          result = await this.client.sendImage({ phone: opts.phone, image: opts.media, caption: opts.caption });
          break;
        case "audio":
          result = await this.client.sendAudio({ phone: opts.phone, audio: opts.media });
          break;
        case "video":
          result = await this.client.sendVideo({ phone: opts.phone, video: opts.media, caption: opts.caption });
          break;
        case "document":
          result = await this.client.sendDocument({ phone: opts.phone, document: opts.media, fileName: opts.fileName || "arquivo" });
          break;
      }
      return { messageId: result!.MessageId, success: true };
    }
  }

  async sendLocation(opts: SendLocationOptions): Promise<MessageResult> {
    const result = await this.client.sendLocation({
      phone: opts.phone,
      latitude: opts.latitude,
      longitude: opts.longitude,
      name: opts.name,
    });
    return { messageId: result.MessageId, success: true };
  }

  async sendButtons(opts: SendButtonsOptions): Promise<MessageResult> {
    const result = await this.client.sendTemplate({
      phone: opts.phone,
      content: opts.content,
      footer: opts.footer,
      buttons: opts.buttons.map(b => ({
        displayText: b.text,
        type: b.type === "reply" ? "quickreply" as const : b.type === "url" ? "url" as const : "call" as const,
        url: b.type === "url" ? b.value : undefined,
        phoneNumber: b.type === "call" ? b.value : undefined,
      })),
    });
    return { messageId: result.MessageId, success: true };
  }

  async sendMenu(opts: SendMenuOptions): Promise<MessageResult> {
    const result = await this.client.sendMenu({
      number: opts.phone,
      text: opts.text,
      footerText: opts.footerText,
      buttonText: opts.buttonText,
      choices: opts.choices,
    });
    const id = result.messageId || result.MessageId || "";
    return { messageId: String(id), success: true };
  }

  async sendCarousel(opts: SendCarouselOptions): Promise<MessageResult> {
    const result = await this.client.sendCarousel({
      number: opts.phone,
      text: opts.text,
      footerText: opts.footerText,
      choices: opts.choices,
    });
    const id = result.messageId || result.MessageId || "";
    return { messageId: String(id), success: true };
  }

  async sendPix(opts: SendPixOptions): Promise<MessageResult> {
    const result = await this.client.sendPixButton({
      number: opts.phone,
      pixType: opts.pixType,
      pixKey: opts.pixKey,
      pixName: opts.pixName,
    });
    const id = result.messageId || result.MessageId || "";
    return { messageId: String(id), success: true };
  }

  async sendContact(opts: SendContactOptions): Promise<MessageResult> {
    const result = await this.client.sendContactV2({
      number: opts.phone,
      fullName: opts.fullName,
      phoneNumber: opts.phoneNumber,
      organization: opts.organization,
      email: opts.email,
    });
    const id = result.messageId || result.MessageId || "";
    return { messageId: String(id), success: true };
  }

  async deleteMessage(phone: string, messageId: string): Promise<void> {
    await this.client.deleteMessage({ number: phone, messageId });
  }

  async editMessage(phone: string, messageId: string, newText: string): Promise<void> {
    await this.client.editMessage({ number: phone, messageId, text: newText });
  }

  async reactToMessage(phone: string, messageId: string, emoji: string): Promise<void> {
    await this.client.reactToMessage({ number: phone, messageId, reaction: emoji });
  }

  async createCampaign(opts: CreateCampaignOptions): Promise<{ folderId: string; count: number }> {
    const result = await this.client.senderSimple({
      numbers: opts.numbers,
      type: opts.type,
      text: opts.text,
      file: opts.file,
      delayMin: opts.delayMin,
      delayMax: opts.delayMax,
      scheduled_for: opts.scheduled_for,
      folder: opts.folder,
    });
    return {
      folderId: String(result.folderId || ""),
      count: Number(result.count || opts.numbers.length),
    };
  }

  async listCampaigns(): Promise<unknown[]> {
    return this.client.senderListFolders();
  }

  async clearCompletedCampaigns(): Promise<void> {
    await this.client.senderClearDone();
  }

  async downloadMedia(messageId: string, opts?: {
    transcribe?: boolean;
    generateMp3?: boolean;
  }): Promise<{ fileURL?: string; mimetype?: string; transcription?: string }> {
    return this.client.downloadMedia({
      id: messageId,
      return_link: true,
      transcribe: opts?.transcribe ?? false,
      generate_mp3: opts?.generateMp3 ?? true,
    });
  }

  async markAsRead(messageIds: string[], chatPhone: string): Promise<void> {
    try {
      await this.client.markReadV2({ number: chatPhone, messageIds });
    } catch {
      await this.client.markAsRead(messageIds, chatPhone).catch(() => {});
    }
  }

  async setTyping(phone: string, typing: boolean): Promise<void> {
    try {
      await this.client.setPresence({ number: phone, presence: typing ? "composing" : "paused" });
    } catch {
      await this.client.setChatPresence(phone, typing ? "composing" : "paused").catch(() => {});
    }
  }

  async setWebhook(url: string): Promise<void> {
    await this.client.setWebhook(buildUazapiWebhookConfig({ url }));
  }

  async checkNumber(phone: string): Promise<boolean> {
    const result = await this.client.checkUser([phone]);
    return Object.values(result).some(v => v === true);
  }

  async syncLeadToWhatsApp(phone: string, data: LeadSyncData): Promise<void> {
    const chatId = phoneToJid(phone);
    const params: Record<string, unknown> = { id: chatId };

    if (data.name !== undefined) params.lead_name = data.name;
    if (data.fullName !== undefined) params.lead_fullName = data.fullName;
    if (data.email !== undefined) params.lead_email = data.email;
    if (data.personalId !== undefined) params.lead_personalid = data.personalId;
    if (data.status !== undefined) params.lead_status = data.status;
    if (data.tags !== undefined) params.lead_tags = data.tags;
    if (data.notes !== undefined) params.lead_notes = data.notes;
    if (data.isTicketOpen !== undefined) params.lead_isTicketOpen = data.isTicketOpen;
    if (data.assignedTo !== undefined) params.lead_assignedAttendant_id = data.assignedTo;
    if (data.kanbanOrder !== undefined) params.lead_kanbanOrder = data.kanbanOrder;

    if (data.customFields) {
      for (const [key, value] of Object.entries(data.customFields)) {
        params[key] = value;
      }
    }

    await this.client.editLead(params as Parameters<typeof this.client.editLead>[0]);
  }

  async disableChatbotFor(phone: string, minutes: number): Promise<void> {
    const chatId = phoneToJid(phone);
    const disableUntil = Math.floor(Date.now() / 1000) + minutes * 60;
    await this.client.editLead({ id: chatId, chatbot_disableUntil: disableUntil });
  }

  async enableChatbot(phone: string): Promise<void> {
    const chatId = phoneToJid(phone);
    await this.client.editLead({ id: chatId, chatbot_disableUntil: 0 });
  }

  parseWebhook(body: unknown): IncomingMessage | null {
    const raw = body as Record<string, unknown>;

    if (raw.fromMe === true || raw.isGroup === true) return null;

    const chatid = String(raw.chatid || "");
    const phone = chatid.replace(/@s\.whatsapp\.net$/, "").replace(/@.*$/, "");
    if (!phone) return null;

    const text = String(raw.text || "") || null;
    const messageType = String(raw.messageType || "");

    let type: IncomingMessage["type"] = "text";
    if (messageType.toLowerCase().includes("image")) type = "image";
    else if (messageType.toLowerCase().includes("audio") || messageType.toLowerCase().includes("ptt")) type = "audio";
    else if (messageType.toLowerCase().includes("video")) type = "video";
    else if (messageType.toLowerCase().includes("document")) type = "document";
    else if (messageType.toLowerCase().includes("location")) type = "location";
    else if (messageType.toLowerCase().includes("contact")) type = "contact";
    else if (messageType.toLowerCase().includes("sticker")) type = "sticker";

    return {
      messageId: String(raw.messageid || raw.id || ""),
      phone,
      pushName: String(raw.senderName || ""),
      text,
      type,
      isGroup: raw.isGroup === true,
      isFromMe: raw.fromMe === true,
      timestamp: Number(raw.messageTimestamp) || Date.now(),
      mediaUrl: String(raw.fileURL || "") || undefined,
      mediaMimeType: undefined,
      caption: undefined,
    };
  }

  // ---- Groups ----

  async listGroups(): Promise<Array<{ jid: string; name: string; participantCount: number }>> {
    const groups = await this.client.listGroups() as Array<Record<string, unknown>>;
    return (groups || []).map((g) => ({
      jid: String(g.GroupJID || g.JID || g.jid || ""),
      name: String(g.Name || g.name || g.GroupName || ""),
      participantCount: Number(g.ParticipantCount || (Array.isArray(g.Participants) ? g.Participants.length : 0)) || 0,
    }));
  }

  async createGroup(name: string): Promise<{ jid: string }> {
    const result = await this.client.createGroup(name, []);
    return { jid: result.GroupJID || "" };
  }

  async getGroupInfo(jid: string): Promise<{ name: string; description: string; participantCount: number; announce: boolean }> {
    const info = await this.client.getGroupInfo(jid) as Record<string, unknown>;
    return {
      name: String(info.Name || info.name || info.GroupName || ""),
      description: String(info.Description || info.description || info.Topic || ""),
      participantCount: Number(info.ParticipantCount || (Array.isArray(info.Participants) ? info.Participants.length : 0)) || 0,
      announce: Boolean(info.IsAnnounce || info.announce || false),
    };
  }

  async getGroupInviteLink(jid: string): Promise<string> {
    const result = await this.client.getGroupInviteLink(jid);
    return result.InviteLink || "";
  }

  async updateGroupName(jid: string, name: string): Promise<void> {
    await this.client.updateGroupName(jid, name);
  }

  async updateGroupDescription(jid: string, description: string): Promise<void> {
    await this.client.updateGroupDescription(jid, description);
  }

  async setGroupAnnounce(jid: string, announce: boolean): Promise<void> {
    await this.client.updateGroupAnnounce(jid, announce);
  }

  async resetGroupInviteLink(jid: string): Promise<string> {
    await this.client.resetGroupInviteCode(jid);
    const result = await this.client.getGroupInviteLink(jid);
    return result.InviteLink || "";
  }
}
