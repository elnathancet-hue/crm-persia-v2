import type {
  ChatCapability,
  GroupCapability,
  ModuleCapabilityManifest,
} from "@persia/shared";

export const adminChatCapabilities = {
  supported: [
    "list_conversations",
    "send_text",
    "send_media",
  ],
} satisfies ModuleCapabilityManifest<ChatCapability>;

export const adminGroupCapabilities = {
  supported: [
    "list_groups",
    "sync_groups",
    "send_text",
  ],
} satisfies ModuleCapabilityManifest<GroupCapability>;
