export const PRODUCT_SERVICE_KEYS = [
  "chat",
  "groups",
  "crm",
  "agenda",
  "automations",
  "campaigns",
  "reports",
] as const;

export type ProductServiceKey = (typeof PRODUCT_SERVICE_KEYS)[number];
export type ProductServices = Partial<Record<ProductServiceKey, boolean>>;

export function isProductServiceEnabled(
  services: ProductServices | null | undefined,
  serviceKey: ProductServiceKey | undefined,
): boolean {
  if (!serviceKey) return true;
  return services?.[serviceKey] !== false;
}

export const CHAT_CAPABILITIES = [
  "list_conversations",
  "search_conversations",
  "search_messages",
  "send_text",
  "send_media",
  "schedule_message",
  "forward_messages",
  "bulk_actions",
  "react_message",
  "edit_message",
  "delete_message",
  "pin_message",
] as const;

export type ChatCapability = (typeof CHAT_CAPABILITIES)[number];

export const GROUP_CAPABILITIES = [
  "list_groups",
  "sync_groups",
  "send_text",
  "send_media",
  "list_messages",
  "list_participants",
  "manage_participants",
  "identify_leads",
  "create_lead",
  "react_message",
  "edit_message",
  "delete_message",
  "pin_message",
  "manage_automations",
  "bulk_add_tag",
] as const;

export type GroupCapability = (typeof GROUP_CAPABILITIES)[number];

export interface ModuleCapabilityManifest<TCapability extends string> {
  supported: readonly TCapability[];
}

export function supportsCapability<TCapability extends string>(
  manifest: ModuleCapabilityManifest<TCapability>,
  capability: TCapability,
): boolean {
  return manifest.supported.includes(capability);
}
