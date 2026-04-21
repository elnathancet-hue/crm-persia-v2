/**
 * UAZAPI Client - WhatsApp API Integration (v2)
 * Full coverage of UAZAPI OpenAPI specification
 * Docs: https://docs.uazapi.com
 */

// ============ CONFIG ============

interface UazapiConfig {
  baseUrl: string;      // Ex: https://inst.uazapi.com
  token: string;        // Instance token
  adminToken?: string;  // Admin token for instance management
}

// ============ COMMON OPTIONAL FIELDS ============

/** Common optional fields present on ALL /send/* endpoints */
interface SendCommonOptions {
  delay?: number;           // ms - shows typing indicator before sending
  readchat?: boolean;       // mark chat as read before sending
  readmessages?: boolean;   // mark messages as read before sending
  replyid?: string;         // message ID to reply to
  mentions?: string;        // mentioned JIDs
  track_source?: string;    // tracking source
  track_id?: string;        // tracking ID
  async?: boolean;          // send asynchronously
}

// ============ SEND PARAMS ============

interface SendTextParams extends SendCommonOptions {
  number: string;
  text: string;
  linkPreview?: boolean;
}

interface SendMediaParams extends SendCommonOptions {
  number: string;
  file: string;             // URL or base64
  type: "image" | "video" | "audio" | "document";
  caption?: string;
  docName?: string;         // file name for documents
}

interface SendContactParams extends SendCommonOptions {
  number: string;
  fullName: string;
  phoneNumber: string;
  organization?: string;
  email?: string;
}

interface SendLocationParams extends SendCommonOptions {
  number: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

interface SendMenuParams extends SendCommonOptions {
  number: string;
  text: string;
  footerText?: string;
  buttonText?: string;
  choices: string[];
}

interface SendCarouselParams extends SendCommonOptions {
  number: string;
  text: string;
  footerText?: string;
  choices: string[];
}

interface SendPixButtonParams extends SendCommonOptions {
  number: string;
  pixType: "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "EVP";
  pixKey: string;
  pixName?: string;
}

interface SendRequestPaymentParams extends SendCommonOptions {
  number: string;
  amount: number;
  currency?: string;
  description?: string;
}

interface SendStatusParams {
  type: string;
  text?: string;
  file?: string;
  caption?: string;
}

// ============ TEMPLATE (legacy v1 compat) ============

interface SendTemplateParams {
  phone: string;
  content: string;
  footer?: string;
  buttons: Array<{
    displayText: string;
    type: "quickreply" | "url" | "call";
    url?: string;
    phoneNumber?: string;
  }>;
}

// ============ MESSAGE ACTION PARAMS ============

interface ReactParams {
  number: string;
  messageId: string;
  reaction: string;   // emoji
}

interface DeleteMessageParams {
  number: string;
  messageId: string;
}

interface EditMessageParams {
  number: string;
  messageId: string;
  text: string;
}

interface MarkReadParams {
  number: string;
  messageIds: string[];
}

interface PresenceParams {
  number: string;
  presence: "composing" | "recording" | "paused";
}

interface FindMessagesParams {
  chatId: string;
  limit?: number;
  offset?: number;
}

interface DownloadMediaParams {
  messageId: string;
}

// ============ SENDER (MASS MESSAGING) ============

interface SenderSimpleParams {
  numbers: string[];
  type: string;
  text?: string;
  file?: string;
  delayMin: number;
  delayMax: number;
  scheduled_for?: string;
  folder?: string;
}

interface SenderAdvancedParams extends SenderSimpleParams {
  [key: string]: unknown;  // additional advanced options
}

interface SenderEditParams {
  [key: string]: unknown;
}

// ============ CHAT MANAGEMENT ============

interface ChatBlockParams {
  number: string;
}

interface ChatLabelsSetParams {
  chatId: string;
  labelIds: string[];
}

interface ChatDeleteParams {
  chatId: string;
}

// ============ INSTANCE MANAGEMENT ============

interface InstanceCreateResult {
  id: string;
  token: string;
  qrcode: string;
}

interface InstanceInfo {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

// ============ LEGACY PARAMS (v1 compat) ============

interface LegacySendTextParams {
  phone: string;
  body: string;
  linkPreview?: boolean;
  replyTo?: { stanzaId: string; participant: string };
}

interface LegacySendImageParams {
  phone: string;
  image: string;
  caption?: string;
}

interface LegacySendAudioParams {
  phone: string;
  audio: string;
}

interface LegacySendDocumentParams {
  phone: string;
  document: string;
  fileName: string;
}

interface LegacySendVideoParams {
  phone: string;
  video: string;
  caption?: string;
}

interface LegacySendLocationParams {
  phone: string;
  latitude: number;
  longitude: number;
  name?: string;
}

// ============ SESSION / WEBHOOK ============

interface WebhookConfig {
  webhookURL: string;
}

interface SessionStatus {
  connected: boolean;
  loggedIn: boolean;
  // Legacy PascalCase support
  Connected?: boolean;
  LoggedIn?: boolean;
}

interface QRCodeResponse {
  QRCode: string;
}

// ============ RESPONSE TYPES ============

interface MessageIdResponse {
  messageId?: string;
  MessageId?: string;
  [key: string]: unknown;
}

interface SenderResponse {
  folderId?: string;
  count?: number;
  [key: string]: unknown;
}

// ============ CLIENT ============

export class UazapiClient {
  private baseUrl: string;
  private token: string;
  private adminToken?: string;

  constructor(config: UazapiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.adminToken = config.adminToken;
  }

  // ---------- Internal HTTP ----------

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      token: this.token,
      "Content-Type": "application/json",
    };

    const options: RequestInit = { method, headers };
    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`UAZAPI ${method} ${path} failed (${res.status}): ${errorText}`);
    }

    return res.json() as Promise<T>;
  }

  private async adminRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    if (!this.adminToken) {
      throw new Error("Admin token is required for instance management endpoints");
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      admintoken: this.adminToken,
      "Content-Type": "application/json",
    };

    const options: RequestInit = { method, headers };
    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`UAZAPI Admin ${method} ${path} failed (${res.status}): ${errorText}`);
    }

    return res.json() as Promise<T>;
  }

  // ============ INSTANCE MANAGEMENT (admin endpoints) ============

  async createInstance(name: string): Promise<InstanceCreateResult> {
    return this.adminRequest("POST", "/instance/create", { name });
  }

  async listInstances(): Promise<InstanceInfo[]> {
    return this.adminRequest("GET", "/instance/all");
  }

  async disconnectInstance(): Promise<void> {
    await this.adminRequest("POST", "/instance/disconnect");
  }

  async resetInstance(): Promise<void> {
    await this.adminRequest("POST", "/instance/reset");
  }

  async getInstanceStatus(): Promise<Record<string, unknown>> {
    return this.adminRequest("GET", "/instance/status");
  }

  async deleteInstance(): Promise<void> {
    await this.adminRequest("DELETE", "/instance");
  }

  // ============ INSTANCE / SESSION ============

  async connect(): Promise<{ qrcode?: string; status?: { connected: boolean; loggedIn: boolean } }> {
    const result: any = await this.request("POST", "/instance/connect");
    // UAZAPI v2: QR can be in root "qrcode" OR in "instance.qrcode"
    const qrcode = result.qrcode || result.instance?.qrcode || undefined;
    return {
      qrcode,
      status: result.status || { connected: result.connected ?? false, loggedIn: result.loggedIn ?? false },
    };
  }

  async disconnect(): Promise<void> {
    await this.request("POST", "/instance/disconnect");
  }

  async logout(): Promise<void> {
    // UAZAPI v2 uses /instance/disconnect for logout
    await this.request("POST", "/instance/disconnect");
  }

  async getStatus(): Promise<SessionStatus> {
    const result: any = await this.request("GET", "/instance/status");
    // UAZAPI v2 returns { instance: {...}, status: { connected, loggedIn } }
    const s = result.status || result;
    return {
      connected: s.connected ?? s.Connected ?? false,
      loggedIn: s.loggedIn ?? s.LoggedIn ?? false,
    };
  }

  async getQRCode(): Promise<string | null> {
    // UAZAPI v2: QR comes from /instance/connect
    const result: any = await this.request("POST", "/instance/connect");
    return result.qrcode || result.instance?.qrcode || null;
  }

  async reset(): Promise<void> {
    await this.request("POST", "/instance/reset");
  }

  // ============ WEBHOOK ============

  async setWebhook(config: WebhookConfig): Promise<void> {
    await this.request("POST", "/webhook", config as unknown as Record<string, unknown>);
  }

  async getWebhook(): Promise<{ webhookURL: string; events: string[] }> {
    return this.request("GET", "/webhook");
  }

  // ============ SEND v2 ENDPOINTS ============

  async sendTextV2(params: SendTextParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/text", params as unknown as Record<string, unknown>);
  }

  async sendMediaV2(params: SendMediaParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/media", params as unknown as Record<string, unknown>);
  }

  async sendContactV2(params: SendContactParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/contact", params as unknown as Record<string, unknown>);
  }

  async sendLocationV2(params: SendLocationParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/location", params as unknown as Record<string, unknown>);
  }

  async sendMenu(params: SendMenuParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/menu", params as unknown as Record<string, unknown>);
  }

  async sendCarousel(params: SendCarouselParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/carousel", params as unknown as Record<string, unknown>);
  }

  async sendPixButton(params: SendPixButtonParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/pix-button", params as unknown as Record<string, unknown>);
  }

  async sendRequestPayment(params: SendRequestPaymentParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/request-payment", params as unknown as Record<string, unknown>);
  }

  async sendStatusPost(params: SendStatusParams): Promise<MessageIdResponse> {
    return this.request("POST", "/send/status", params as unknown as Record<string, unknown>);
  }

  // ============ MESSAGE ACTIONS ============

  async reactToMessage(params: ReactParams): Promise<void> {
    await this.request("POST", "/message/react", {
      number: params.number,
      messageId: params.messageId,
      reaction: params.reaction,
    });
  }

  async deleteMessage(params: DeleteMessageParams): Promise<void> {
    await this.request("POST", "/message/delete", {
      number: params.number,
      messageId: params.messageId,
    });
  }

  async editMessage(params: EditMessageParams): Promise<void> {
    await this.request("POST", "/message/edit", {
      number: params.number,
      messageId: params.messageId,
      text: params.text,
    });
  }

  /**
   * Download media from a message - POST /message/download
   * UAZAPI does NOT send fileURL in webhook. You must call this to get the file.
   */
  async downloadMedia(params: {
    id: string;
    return_base64?: boolean;
    return_link?: boolean;
    generate_mp3?: boolean;
    transcribe?: boolean;
    openai_apikey?: string;
    download_quoted?: boolean;
  }): Promise<{
    fileURL?: string;
    mimetype?: string;
    base64Data?: string;
    transcription?: string;
  }> {
    return this.request("POST", "/message/download", {
      id: params.id,
      return_base64: params.return_base64 ?? false,
      return_link: params.return_link ?? true,
      generate_mp3: params.generate_mp3 ?? true,
      transcribe: params.transcribe ?? false,
      openai_apikey: params.openai_apikey,
      download_quoted: params.download_quoted ?? false,
    });
  }

  async markReadV2(params: MarkReadParams): Promise<void> {
    await this.request("POST", "/message/markread", {
      number: params.number,
      messageIds: params.messageIds,
    });
  }

  async setPresence(params: PresenceParams): Promise<void> {
    await this.request("POST", "/message/presence", {
      number: params.number,
      presence: params.presence,
    });
  }

  async findMessages(params: FindMessagesParams): Promise<unknown[]> {
    return this.request("POST", "/message/find", {
      chatId: params.chatId,
      limit: params.limit,
      offset: params.offset,
    });
  }

  // ============ SENDER (MASS MESSAGING) ============

  async senderSimple(params: SenderSimpleParams): Promise<SenderResponse> {
    return this.request("POST", "/sender/simple", params as unknown as Record<string, unknown>);
  }

  async senderAdvanced(params: SenderAdvancedParams): Promise<SenderResponse> {
    return this.request("POST", "/sender/advanced", params as unknown as Record<string, unknown>);
  }

  async senderEdit(params: SenderEditParams): Promise<void> {
    await this.request("POST", "/sender/edit", params as Record<string, unknown>);
  }

  async senderClearDone(): Promise<void> {
    await this.request("POST", "/sender/cleardone");
  }

  async senderClearAll(): Promise<void> {
    await this.request("POST", "/sender/clearall");
  }

  async senderListFolders(): Promise<unknown[]> {
    return this.request("GET", "/sender/listfolders");
  }

  async senderListMessages(): Promise<unknown[]> {
    return this.request("GET", "/sender/listmessages");
  }

  // ============ CHAT MANAGEMENT ============

  async blockContact(params: ChatBlockParams): Promise<void> {
    await this.request("POST", "/chat/block", { number: params.number });
  }

  async getBlockList(): Promise<unknown[]> {
    return this.request("GET", "/chat/blocklist");
  }

  async getLabels(): Promise<unknown[]> {
    return this.request("GET", "/chat/labels");
  }

  async setLabels(params: ChatLabelsSetParams): Promise<void> {
    await this.request("POST", "/chat/labels", {
      chatId: params.chatId,
      labelIds: params.labelIds,
    });
  }

  async deleteChat(params: ChatDeleteParams): Promise<void> {
    await this.request("POST", "/chat/delete", { chatId: params.chatId });
  }

  // ============ LEGACY v1 ENDPOINTS (backward compat) ============

  async sendText(params: LegacySendTextParams): Promise<{ MessageId: string }> {
    const body: Record<string, unknown> = {
      Phone: params.phone,
      Body: params.body,
      LinkPreview: params.linkPreview ?? true,
    };
    if (params.replyTo) {
      body.ContextInfo = {
        StanzaId: params.replyTo.stanzaId,
        Participant: params.replyTo.participant,
      };
    }
    return this.request("POST", "/chat/send/text", body);
  }

  async sendImage(params: LegacySendImageParams): Promise<{ MessageId: string }> {
    return this.request("POST", "/chat/send/image", {
      Phone: params.phone,
      Image: params.image,
      Caption: params.caption || "",
    });
  }

  async sendAudio(params: LegacySendAudioParams): Promise<{ MessageId: string }> {
    return this.request("POST", "/chat/send/audio", {
      Phone: params.phone,
      Audio: params.audio,
    });
  }

  async sendVideo(params: LegacySendVideoParams): Promise<{ MessageId: string }> {
    return this.request("POST", "/chat/send/video", {
      Phone: params.phone,
      Video: params.video,
      Caption: params.caption || "",
    });
  }

  async sendDocument(params: LegacySendDocumentParams): Promise<{ MessageId: string }> {
    return this.request("POST", "/chat/send/document", {
      Phone: params.phone,
      Document: params.document,
      FileName: params.fileName,
    });
  }

  async sendLocation(params: LegacySendLocationParams): Promise<{ MessageId: string }> {
    return this.request("POST", "/chat/send/location", {
      Phone: params.phone,
      Latitude: params.latitude,
      Longitude: params.longitude,
      Name: params.name || "",
    });
  }

  async sendTemplate(params: SendTemplateParams): Promise<{ MessageId: string }> {
    return this.request("POST", "/chat/send/template", {
      Phone: params.phone,
      Content: params.content,
      Footer: params.footer || "",
      Buttons: params.buttons.map((b) => ({
        DisplayText: b.displayText,
        Type: b.type,
        Url: b.url || "",
        PhoneNumber: b.phoneNumber || "",
      })),
    });
  }

  // ============ LEGACY CHAT ACTIONS ============

  async markAsRead(messageIds: string[], chatPhone: string): Promise<void> {
    await this.request("POST", "/chat/markread", {
      Id: messageIds,
      ChatPhone: chatPhone,
    });
  }

  async sendReaction(phone: string, messageId: string, emoji: string): Promise<void> {
    await this.request("POST", "/chat/react", {
      Phone: phone,
      Body: emoji,
      Id: messageId,
    });
  }

  async setChatPresence(phone: string, state: "composing" | "paused"): Promise<void> {
    await this.request("POST", "/chat/presence", {
      Phone: phone,
      State: state,
      Media: "",
    });
  }

  // ============ USER INFO ============

  async checkUser(phones: string[]): Promise<Record<string, boolean>> {
    return this.request("POST", "/user/check", { Phone: phones });
  }

  async getUserInfo(phones: string[]): Promise<Record<string, unknown>> {
    return this.request("POST", "/user/info", { Phone: phones });
  }

  async getContacts(): Promise<Array<{ Jid: string; Name: string }>> {
    return this.request("GET", "/user/contacts");
  }

  // ============ GROUPS ============

  async listGroups(): Promise<unknown[]> {
    return this.request("GET", "/group/list");
  }

  async createGroup(name: string, participants: string[]): Promise<{ GroupJID: string }> {
    return this.request("POST", "/group/create", { name, participants });
  }

  async getGroupInfo(groupJid: string): Promise<unknown> {
    return this.request("GET", "/group/info", { GroupJID: groupJid });
  }

  async getGroupInviteLink(groupJid: string): Promise<{ InviteLink: string }> {
    return this.request("GET", "/group/invitelink", { GroupJID: groupJid });
  }

  async updateGroupName(groupJid: string, name: string): Promise<unknown> {
    return this.request("POST", "/group/updateName", { groupjid: groupJid, name });
  }

  async updateGroupDescription(groupJid: string, description: string): Promise<unknown> {
    return this.request("POST", "/group/updateDescription", { groupjid: groupJid, description });
  }

  async updateGroupAnnounce(groupJid: string, announce: boolean): Promise<unknown> {
    return this.request("POST", "/group/updateAnnounce", { groupjid: groupJid, announce });
  }

  async resetGroupInviteCode(groupJid: string): Promise<unknown> {
    return this.request("POST", "/group/resetInviteCode", { groupjid: groupJid });
  }

  // ============ CRM SYNC ============

  async updateFieldsMap(fields: Record<string, string>): Promise<unknown> {
    return this.request("POST", "/instance/updateFieldsMap", fields as Record<string, unknown>);
  }

  async editLead(params: {
    id: string; // chatid: "5511999@s.whatsapp.net"
    lead_name?: string;
    lead_fullName?: string;
    lead_email?: string;
    lead_personalid?: string;
    lead_status?: string;
    lead_tags?: string[];
    lead_notes?: string;
    lead_isTicketOpen?: boolean;
    lead_assignedAttendant_id?: string;
    lead_kanbanOrder?: number;
    chatbot_disableUntil?: number;
    [key: string]: unknown; // lead_field01-20
  }): Promise<unknown> {
    return this.request("POST", "/chat/editLead", params as Record<string, unknown>);
  }
}

// ============ FACTORY ============

export function createUazapiClient(baseUrl: string, token: string, adminToken?: string): UazapiClient {
  return new UazapiClient({ baseUrl, token, adminToken });
}

// ============ WEBHOOK TYPES ============

export interface UazapiWebhookMessage {
  event: "Message" | "ReadReceipt" | "ChatPresence" | "HistorySync";
  token: string;
  data: {
    Info: {
      MessageSource: {
        Chat: string;
        Sender: string;
        IsFromMe: boolean;
        IsGroup: boolean;
      };
      ID: string;
      PushName: string;
      Timestamp: string;
      Type: string;
    };
    Message?: {
      Conversation?: string;
      ExtendedTextMessage?: { Text: string };
      ImageMessage?: {
        Caption?: string;
        Url: string;
        Mimetype: string;
        FileSHA256: string;
        FileLength: number;
        MediaKey: string;
        FileEncSHA256: string;
      };
      AudioMessage?: {
        Url: string;
        Mimetype: string;
        FileSHA256: string;
        FileLength: number;
        MediaKey: string;
        FileEncSHA256: string;
        Ptt: boolean;
      };
      VideoMessage?: {
        Caption?: string;
        Url: string;
        Mimetype: string;
        FileSHA256: string;
        FileLength: number;
        MediaKey: string;
        FileEncSHA256: string;
      };
      DocumentMessage?: {
        Title?: string;
        FileName?: string;
        Url: string;
        Mimetype: string;
        FileSHA256: string;
        FileLength: number;
        MediaKey: string;
        FileEncSHA256: string;
      };
      LocationMessage?: {
        DegreesLatitude: number;
        DegreesLongitude: number;
        Name?: string;
      };
      ContactMessage?: {
        DisplayName: string;
        Vcard: string;
      };
    };
  };
}

/**
 * Extracts the text content from a webhook message
 */
export function extractMessageText(msg: UazapiWebhookMessage): string | null {
  const m = msg.data.Message;
  if (!m) return null;
  if (m.Conversation) return m.Conversation;
  if (m.ExtendedTextMessage?.Text) return m.ExtendedTextMessage.Text;
  if (m.ImageMessage?.Caption) return m.ImageMessage.Caption;
  if (m.VideoMessage?.Caption) return m.VideoMessage.Caption;
  return null;
}

/**
 * Extracts the phone number (without @s.whatsapp.net) from a JID
 */
export function jidToPhone(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, "").replace(/@g\.us$/, "");
}

/**
 * Converts phone to JID format
 */
export function phoneToJid(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `${clean}@s.whatsapp.net`;
}
