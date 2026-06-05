import type {
  ChatCapability,
  GroupCapability,
  ModuleCapabilityManifest,
} from "@persia/shared";

export const adminChatCapabilities = {
  supported: [
    "list_conversations",
    "search_conversations",
    "search_messages",
    "send_text",
    "send_media",
  ],
} satisfies ModuleCapabilityManifest<ChatCapability>;

export const adminGroupCapabilities = {
  supported: [
    "list_groups",
    "sync_groups",
    "send_text",
    "list_messages",
    "list_participants",
  ],
} satisfies ModuleCapabilityManifest<GroupCapability>;
