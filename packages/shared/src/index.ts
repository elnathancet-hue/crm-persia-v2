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
