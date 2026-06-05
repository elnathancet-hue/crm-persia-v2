import {
  CHAT_CAPABILITIES,
  GROUP_CAPABILITIES,
  type ChatCapability,
  type GroupCapability,
  type ModuleCapabilityManifest,
} from "@persia/shared";

export const crmChatCapabilities = {
  supported: CHAT_CAPABILITIES,
} satisfies ModuleCapabilityManifest<ChatCapability>;

export const crmGroupCapabilities = {
  supported: GROUP_CAPABILITIES,
} satisfies ModuleCapabilityManifest<GroupCapability>;
