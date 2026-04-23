// Public surface of @persia/shared
//
// Usage from apps:
//   import type { Database, Tables, TablesInsert } from "@persia/shared";
//   import type { WhatsAppProvider, IncomingMessage } from "@persia/shared";
//   import { hasTemplates } from "@persia/shared";

export type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
  Json,
} from "./database";

export { Constants } from "./database";

export type {
  // Options (sendXxx inputs)
  SendTextOptions,
  SendMediaOptions,
  SendLocationOptions,
  SendButtonsOptions,
  SendMenuOptions,
  SendCarouselOptions,
  SendPixOptions,
  SendContactOptions,
  SendTemplateOptions,
  CreateCampaignOptions,
  // Results
  ConnectionResult,
  SessionStatus,
  MessageResult,
  // DTOs
  IncomingMessage,
  LeadSyncData,
  RemoteTemplate,
  // Factory input
  WhatsAppConnection,
  // Contract
  WhatsAppProvider,
  TemplateCapable,
} from "./whatsapp";

export { hasTemplates } from "./whatsapp";

// Providers (factory + implementations + low-level UAZAPI client)
export {
  createProvider,
  UazapiAdapter,
  MetaCloudAdapter,
  buildUazapiWebhookConfig,
  configureUazapiWebhook,
  UAZAPI_DEFAULT_EXCLUDED_MESSAGES,
  UAZAPI_DEFAULT_WEBHOOK_EVENTS,
} from "./providers";
export type {
  BuildUazapiWebhookConfigOptions,
  ConfigureUazapiWebhookOptions,
  UazapiWebhookConfig,
  UazapiWebhookEvent,
  UazapiWebhookExcludedMessage,
} from "./providers";
export { UazapiClient, phoneToJid } from "./providers/uazapi-client";

// Template parser (Meta Cloud components <-> ParamsSchema + variable builder)
export type {
  ParamFormat,
  ParamSpec,
  HeaderSchema,
  ButtonSchema,
  ParamsSchema,
  MetaComponent,
  MetaButton,
  TemplateVariableValues,
} from "./template-parser";
export {
  parseTemplateParams,
  buildTemplateComponents,
} from "./template-parser";

export {
  CHAT_MEDIA_BUCKET,
  CHAT_MEDIA_PROVIDER_URL_TTL_SECONDS,
  CHAT_MEDIA_REF_PREFIX,
  CHAT_MEDIA_SIGNED_URL_TTL_SECONDS,
  getChatMediaPath,
  isExternalMediaUrl,
  needsChatMediaSigning,
  toChatMediaRef,
} from "./chat-media";

// AI Agent — domain types, tool-use contracts, cost calc.
// Prefer the subpath import `@persia/shared/ai-agent` for locality; this
// re-export exists for convenience on top-level imports.
export * from "./ai-agent";
