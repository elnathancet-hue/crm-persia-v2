import { UazapiClient, phoneToJid } from "./uazapi-client";
import type { UazapiGroupInfo } from "./uazapi-client";
import { buildUazapiWebhookConfig } from "./uazapi-webhook-config";
import type {
  ConnectionResult,
  CreateCampaignOptions,
  GroupInfo,
  GroupParticipant,
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
  SendLocationButtonOptions,
  SendPaymentRequestOptions,
  SendPresenceOptions,
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
      replyid: opts.replyTo,
    });
    const id = result.messageId || result.MessageId || (result as Record<string, string>).messageid || (result as Record<string, string>).id || "";
    return { messageId: String(id), success: true };
  }

  async sendMedia(opts: SendMediaOptions): Promise<MessageResult> {
    try {
      const result = await this.client.sendMediaV2({
        number: opts.phone,
        file: opts.media,
        type: opts.type as "image" | "audio" | "video" | "document",
        caption: opts.caption,
        docName: opts.type === "document" ? (opts.fileName || "arquivo") : undefined,
        replyid: opts.replyTo,
      });
      const id = result.messageId || result.MessageId || (result as Record<string, string>).messageid || (result as Record<string, string>).id || "";
      return { messageId: String(id), success: true };
    } catch {
      if (opts.type === "ptt") {
        // PTT (voice note) — no legacy fallback, re-throw
        throw new Error("PTT send failed and no legacy fallback available");
      }
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

  async sendLocationButton(opts: SendLocationButtonOptions): Promise<MessageResult> {
    const result = await this.client.sendLocationButton({
      number: opts.phone,
      text: opts.text,
    });
    const id = result.messageId || result.MessageId || "";
    return { messageId: String(id), success: true };
  }

  async sendPaymentRequest(opts: SendPaymentRequestOptions): Promise<MessageResult> {
    const result = await this.client.sendRequestPayment({
      number: opts.phone,
      amount: opts.amount,
      pixKey: opts.pixKey,
      pixType: opts.pixType,
      title: opts.title,
      text: opts.text,
      footer: opts.footer,
      itemName: opts.itemName,
      invoiceNumber: opts.invoiceNumber,
      pixName: opts.pixName,
      paymentLink: opts.paymentLink,
      fileUrl: opts.fileUrl,
      fileName: opts.fileName,
      boletoCode: opts.boletoCode,
    });
    const id = result.messageId || result.MessageId || "";
    return { messageId: String(id), success: true };
  }

  async sendPresence(opts: SendPresenceOptions): Promise<void> {
    await this.client.sendPresence({
      number: opts.phone,
      presence: opts.presence,
    });
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

  async markChatRead(chatPhone: string): Promise<void> {
    await this.client.markChatRead(chatPhone).catch(() => {});
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

  /**
   * Bug A fix (mai/2026): busca URL da foto de perfil via /chat/details.
   * UAZAPI retorna ~60 campos no response — o de foto varia entre
   * versões (`wa_profilePicURL`, `imagePreview`, `image`).
   * Tentamos os 3 em ordem de prioridade e retornamos a primeira
   * URL não-vazia encontrada.
   * Retorna null em qualquer falha (não tem foto pública, contato
   * fora do WhatsApp, rate limit, erro de rede) — caller no-op.
   */
  async getContactProfilePic(phone: string): Promise<string | null> {
    return this.getChatImageUrl(phone, { preview: true });
  }

  async getChatImageUrl(chatId: string, opts?: { preview?: boolean }): Promise<string | null> {
    try {
      // UAZAPI /chat/details rejeita números com + e sufixos de JID de usuário.
      // Strip para contatos (JIDs de grupo como "120363...@g.us" passam sem modificação).
      let normalizedId = chatId.startsWith("+") ? chatId.slice(1) : chatId;
      normalizedId = normalizedId.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "");

      const details = await this.client.getChatDetails(normalizedId, { preview: opts?.preview ?? true });
      // Procura URL em campos conhecidos (ordem de prioridade pela
      // qualidade típica: profilePicURL > imagePreview > image).
      const candidates = [
        details.wa_profilePicURL,
        details.wa_profilePicUrl,
        details.imagePreview,
        details.image,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate.trim();
        }
      }
      return null;
    } catch {
      return null;
    }
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

    if (raw.fromMe === true) return null;

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
      groupJid: raw.isGroup === true ? chatid : undefined,
      isFromMe: raw.fromMe === true,
      timestamp: Number(raw.messageTimestamp) || Date.now(),
      mediaUrl: String(raw.fileURL || "") || undefined,
      mediaMimeType: undefined,
      caption: undefined,
    };
  }

  // ---- Groups ----

  private mapGroupInfo(g: UazapiGroupInfo): GroupInfo {
    const rawParticipants = Array.isArray(g.Participants)
      ? g.Participants
      : Array.isArray((g as { participants?: unknown }).participants)
        ? ((g as { participants: UazapiGroupInfo["Participants"] }).participants ?? [])
        : [];
    const participants: GroupParticipant[] = rawParticipants
      .map((p) => {
        const row = p as {
          JID?: string;
          jid?: string;
          Jid?: string;
          PhoneNumber?: string;
          phoneNumber?: string;
          Phone?: string;
          phone?: string;
          IsAdmin?: boolean;
          isAdmin?: boolean;
          IsSuperAdmin?: boolean;
          isSuperAdmin?: boolean;
        };
        const jidCandidate = row.JID || row.jid || row.Jid || "";
        const phoneCandidate =
          row.PhoneNumber || row.phoneNumber || row.Phone || row.phone || "";
        const jid = jidCandidate.endsWith("@lid")
          ? phoneCandidate || jidCandidate
          : jidCandidate || phoneCandidate;
        return {
          jid,
          isAdmin: row.IsAdmin === true || row.isAdmin === true,
          isSuperAdmin: row.IsSuperAdmin === true || row.isSuperAdmin === true,
        };
      })
      .filter((p) => p.jid.length > 0);
    // Etapa 5: foto do grupo — vários candidatos de campo (payload UAZAPI varia)
    const raw = g as Record<string, unknown>;
    const imageUrl: string | null =
      (typeof raw.Picture === "string" && raw.Picture) ||
      (typeof raw.picture === "string" && raw.picture) ||
      (typeof raw.ProfilePicture === "string" && raw.ProfilePicture) ||
      (typeof raw.profilePicture === "string" && raw.profilePicture) ||
      (typeof raw.profilePicURL === "string" && raw.profilePicURL) ||
      (typeof raw.profilePicUrl === "string" && raw.profilePicUrl) ||
      (typeof raw.wa_profilePicURL === "string" && raw.wa_profilePicURL) ||
      (typeof raw.wa_profilePicUrl === "string" && raw.wa_profilePicUrl) ||
      (typeof raw.imagePreview === "string" && raw.imagePreview) ||
      (typeof raw.image === "string" && raw.image) ||
      null;

    return {
      jid: g.JID || "",
      name: g.Name || "",
      description: g.Topic || "",
      participantCount: participants.length,
      participants,
      announce: g.IsAnnounce === true,
      locked: g.IsLocked === true,
      joinApprovalRequired: g.IsJoinApprovalRequired === true,
      memberAddMode: (g.MemberAddMode as "admin_add" | "all_member_add") || "admin_add",
      inviteLink: g.invite_link || null,
      ephemeralDuration: g.DisappearingTimer || 0,
      ownerJid: g.OwnerJID || null,
      createdAt: g.GroupCreated || null,
      imageUrl,
    };
  }

  async listGroups(opts?: { noParticipants?: boolean }): Promise<GroupInfo[]> {
    const result = await this.client.listGroups({ noParticipants: opts?.noParticipants });
    return (result.groups || []).map(g => this.mapGroupInfo(g));
  }

  async listGroupsPaged(opts?: { limit?: number; offset?: number; search?: string; noParticipants?: boolean }): Promise<{ groups: GroupInfo[]; total?: number }> {
    const result = await this.client.listGroupsPaged(opts);
    return {
      groups: (result.groups || []).map(g => this.mapGroupInfo(g)),
      total: result.pagination?.totalRecords,
    };
  }

  async createGroup(name: string, participants: string[]): Promise<GroupInfo> {
    const g = await this.client.createGroup(name, participants);
    return this.mapGroupInfo(g);
  }

  async getGroupInfo(jid: string, opts?: { getInviteLink?: boolean; force?: boolean }): Promise<GroupInfo> {
    const g = await this.client.getGroupInfo(jid, {
      getInviteLink: opts?.getInviteLink,
      force: opts?.force,
    });
    return this.mapGroupInfo(g);
  }

  async getGroupInviteInfo(invitecode: string): Promise<GroupInfo> {
    const g = await this.client.getGroupInviteInfo(invitecode);
    return this.mapGroupInfo(g);
  }

  async joinGroup(invitecode: string): Promise<GroupInfo> {
    const result = await this.client.joinGroup(invitecode);
    return this.mapGroupInfo(result.group);
  }

  async leaveGroup(jid: string): Promise<void> {
    await this.client.leaveGroup(jid);
  }

  async updateGroupName(jid: string, name: string): Promise<void> {
    await this.client.updateGroupName(jid, name);
  }

  async updateGroupDescription(jid: string, description: string): Promise<void> {
    await this.client.updateGroupDescription(jid, description);
  }

  async updateGroupImage(jid: string, image: string): Promise<void> {
    await this.client.updateGroupImage(jid, image);
  }

  async setGroupAnnounce(jid: string, announce: boolean): Promise<void> {
    await this.client.updateGroupAnnounce(jid, announce);
  }

  async setGroupLocked(jid: string, locked: boolean): Promise<void> {
    await this.client.updateGroupLocked(jid, locked);
  }

  async setGroupJoinApproval(jid: string, required: boolean): Promise<void> {
    await this.client.updateGroupJoinApproval(jid, required);
  }

  async setGroupMemberAddMode(jid: string, mode: "admin_add" | "all_member_add"): Promise<void> {
    await this.client.updateGroupMemberAddMode(jid, mode);
  }

  async setGroupEphemeral(jid: string, duration: "0" | "off" | "1d" | "7d" | "90d"): Promise<void> {
    await this.client.updateGroupEphemeral(jid, duration);
  }

  async updateGroupParticipants(jid: string, action: "add" | "remove" | "promote" | "demote" | "approve" | "reject", participants: string[]): Promise<Array<{ jid: string; ok: boolean }>> {
    const result = await this.client.updateGroupParticipants(jid, action, participants);
    return (result.groupUpdated || []).map(p => ({
      jid: p.JID || "",
      ok: p.Error === 0,
    }));
  }

  async resetGroupInviteLink(jid: string): Promise<string> {
    const result = await this.client.resetGroupInviteCode(jid);
    return result.InviteLink || "";
  }
}
