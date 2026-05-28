// @persia/shared/ai-agent — barrel export.
//
// Consumers can import from either:
//   import { NATIVE_HANDLERS } from "@persia/shared/ai-agent";
//   import { NATIVE_HANDLERS } from "@persia/shared";
//
// After this PR merges, this module is read-only for runtime agents (Codex).
// Contract changes go through a dedicated PR; see CODEX_SYNC.md.

export * from "./types";
export * from "./tool-schema";
export * from "./tool-presets";
export * from "./cost";
export * from "./limits";
export * from "./debounce";
export * from "./summarization";
export * from "./handoff";
export * from "./rag";
export * from "./notifications";
export * from "./scheduled-jobs";
export * from "./calendar";
export * from "./agent-templates";
export * from "./followups";
export * from "./humanization";
export * from "./entry-conditions";
export * from "./lead-status";
export * from "./flow";
export * from "./flow-validation";
// Backlog #5 Auditoria (mai/2026): paridade Admin/CRM no template seed.
export * from "./template-materializer";
// Backlog #10 Auditoria (mai/2026): threshold de knowledge em TOKENS, nao bytes.
export * from "./token-estimate";
