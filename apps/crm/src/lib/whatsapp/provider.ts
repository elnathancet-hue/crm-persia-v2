/**
 * WhatsApp Provider Contract
 *
 * Camada de abstracao que permite trocar o provider (UAZAPI, Meta Cloud API)
 * sem alterar o resto do sistema.
 *
 * - Interface e DTOs vivem aqui.
 * - Implementacoes vivem em ./providers/<name>.ts
 * - Factory para resolver por conexao vive em ./providers/index.ts
 */

// ============ INTERFACE TYPES ============

export interface SendTextOptions {
  phone: string;
  message: string;
  replyTo?: string;
}

export interface SendMediaOptions {
  phone: string;
  type: "image" | "audio" | "video" | "document";
  media: string;
  caption?: string;
  fileName?: string;
}

export interface SendLocationOptions {
  phone: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface SendButtonsOptions {
  phone: string;
  content: string;
  footer?: string;
  buttons: Array<{
    text: string;
    type: "reply" | "url" | "call";
    value?: string;
  }>;
}

export interface SendMenuOptions {
  phone: string;
  text: string;
  footerText?: string;
  buttonText?: string;
  choices: string[];
}

export interface SendCarouselOptions {
  phone: string;
  text: string;
  footerText?: string;
  choices: string[];
}

export interface SendPixOptions {
  phone: string;
  pixType: "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "EVP";
  pixKey: string;
  pixName?: string;
}

export interface SendContactOptions {
  phone: string;
  fullName: string;
  phoneNumber: string;
  organization?: string;
  email?: string;
}

export interface CreateCampaignOptions {
  numbers: string[];
  type: string;
  text?: string;
  file?: string;
  delayMin: number;
  delayMax: number;
  scheduled_for?: string;
  folder?: string;
}

export interface ConnectionResult {
  status: "connected" | "qr" | "error";
  qrCode?: string;
  phone?: string;
  error?: string;
}

export interface SessionStatus {
  connected: boolean;
  loggedIn: boolean;
  phone?: string;
}

export interface MessageResult {
  messageId: string;
  success: boolean;
}

export interface IncomingMessage {
  messageId: string;
  phone: string;
  pushName: string;
  text: string | null;
  type: "text" | "image" | "audio" | "video" | "document" | "location" | "contact" | "sticker";
  isGroup: boolean;
  isFromMe: boolean;
  timestamp: number;
  mediaUrl?: string;
  mediaMimeType?: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
}

export interface LeadSyncData {
  name?: string;
  fullName?: string;
  email?: string;
  personalId?: string;
  status?: string;
  tags?: string[];
  notes?: string;
  isTicketOpen?: boolean;
  assignedTo?: string;
  kanbanOrder?: number;
  customFields?: Record<string, string>;
}

// ============ TEMPLATE CAPABILITY ============

/** Raw shape retornado pelo GET /{waba_id}/message_templates da Meta. */
export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION" | string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | string;
  components: Array<Record<string, unknown>>;
}

export interface SendTemplateOptions {
  phone: string;
  templateName: string;
  language: string;
  /** Built via buildTemplateComponents() from template-parser.ts. */
  components: Array<Record<string, unknown>>;
}

/**
 * Capability opcional — implementada apenas por providers que suportam
 * templates aprovados (hoje: Meta Cloud API). UAZAPI nao implementa.
 * Callers devem usar o type guard `hasTemplates(provider)` antes.
 */
export interface TemplateCapable {
  listRemoteTemplates(): Promise<RemoteTemplate[]>;
  sendTemplate(opts: SendTemplateOptions): Promise<MessageResult>;
}

/** Type guard para restringir ao subset de providers com templates. */
export function hasTemplates(p: WhatsAppProvider): p is WhatsAppProvider & TemplateCapable {
  return (
    typeof (p as unknown as TemplateCapable).listRemoteTemplates === "function" &&
    typeof (p as unknown as TemplateCapable).sendTemplate === "function"
  );
}

// ============ CONNECTION ROW (factory input) ============

/**
 * Shape minimo que a factory precisa para resolver um provider.
 * Aceita campos parciais/null pois vem direto do Supabase row.
 *
 * Para UAZAPI:     instance_url + instance_token obrigatorios
 * Para Meta Cloud: phone_number_id + waba_id + access_token obrigatorios
 */
export interface WhatsAppConnection {
  provider?: string | null;
  instance_url?: string | null;
  instance_token?: string | null;
  phone_number_id?: string | null;
  waba_id?: string | null;
  access_token?: string | null;
  webhook_verify_token?: string | null;
}

// ============ THE CONTRACT ============

export interface WhatsAppProvider {
  readonly name: string;

  // Session
  connect(): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
  logout(): Promise<void>;
  reset(): Promise<void>;
  getStatus(): Promise<SessionStatus>;
  getQRCode(): Promise<string | null>;

  // Messaging - basic
  sendText(opts: SendTextOptions): Promise<MessageResult>;
  sendMedia(opts: SendMediaOptions): Promise<MessageResult>;
  sendLocation(opts: SendLocationOptions): Promise<MessageResult>;
  sendButtons(opts: SendButtonsOptions): Promise<MessageResult>;

  // Messaging - advanced
  sendMenu(opts: SendMenuOptions): Promise<MessageResult>;
  sendCarousel(opts: SendCarouselOptions): Promise<MessageResult>;
  sendPix(opts: SendPixOptions): Promise<MessageResult>;
  sendContact(opts: SendContactOptions): Promise<MessageResult>;

  // Message actions
  deleteMessage(phone: string, messageId: string): Promise<void>;
  editMessage(phone: string, messageId: string, newText: string): Promise<void>;
  reactToMessage(phone: string, messageId: string, emoji: string): Promise<void>;

  // Mass sending (native queue)
  createCampaign(opts: CreateCampaignOptions): Promise<{ folderId: string; count: number }>;
  listCampaigns(): Promise<unknown[]>;
  clearCompletedCampaigns(): Promise<void>;

  // Actions
  markAsRead(messageIds: string[], chatPhone: string): Promise<void>;
  setTyping(phone: string, typing: boolean): Promise<void>;

  // Webhook
  setWebhook(url: string): Promise<void>;

  // Contacts
  checkNumber(phone: string): Promise<boolean>;

  // Media download
  downloadMedia(messageId: string, opts?: {
    transcribe?: boolean;
    generateMp3?: boolean;
  }): Promise<{ fileURL?: string; mimetype?: string; transcription?: string }>;

  // CRM Sync
  syncLeadToWhatsApp(phone: string, data: LeadSyncData): Promise<void>;
  disableChatbotFor(phone: string, minutes: number): Promise<void>;
  enableChatbot(phone: string): Promise<void>;

  // Groups
  listGroups(): Promise<Array<{ jid: string; name: string; participantCount: number }>>;
  createGroup(name: string): Promise<{ jid: string }>;
  getGroupInfo(jid: string): Promise<{ name: string; description: string; participantCount: number; announce: boolean }>;
  getGroupInviteLink(jid: string): Promise<string>;
  updateGroupName(jid: string, name: string): Promise<void>;
  updateGroupDescription(jid: string, description: string): Promise<void>;
  setGroupAnnounce(jid: string, announce: boolean): Promise<void>;
  resetGroupInviteLink(jid: string): Promise<string>;

  // Parse incoming webhook payload into our standard format
  parseWebhook(body: unknown): IncomingMessage | null;
}
