// Conversation status taxonomy shared by CRM, WhatsApp webhooks and AI Agent.
//
// Source of truth:
// - `closed` means historical/finished and can coexist with newer conversations.
// - everything below is considered "open" for lookup/reuse purposes.
//
// Legacy values `human_handling` and `ai_handling` are kept here defensively:
// older rows or partially migrated DBs must still be found by webhooks instead
// of causing a second active conversation for the same lead.

export const OPEN_CONVERSATION_STATUSES = [
  "active",
  "waiting_human",
  "assigned",
  "human_handling",
  "ai_handling",
] as const;

export type OpenConversationStatus = (typeof OPEN_CONVERSATION_STATUSES)[number];

