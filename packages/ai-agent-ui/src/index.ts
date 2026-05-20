// @persia/ai-agent-ui — shared AI Agent UI surface.
//
// Both @persia/crm and @persia/admin consume these components via
// <AgentActionsProvider actions={...}>. Components pull mutations
// through useAgentActions() so each app can wire its own server actions
// (requireRole on crm, requireSuperadminForOrg on admin).

export type { AgentActions } from "./actions";
export {
  AgentActionsProvider,
  useAgentActions,
  type AgentActionsProviderProps,
} from "./context";
export { renderToolIcon } from "./icon-map";

// Page-level components
export { AgentsList } from "./components/AgentsList";
export { AgentEditor } from "./components/AgentEditor";
export {
  AgentCreationWizard,
  type AgentCreationWizardSubmit,
} from "./components/AgentCreationWizard";
export {
  AgentSidebar,
  type AgentSidebarGroup,
  type AgentSidebarItem,
} from "./components/AgentSidebar";

// Tab components
export { RulesTab } from "./components/RulesTab";
// PR-FLOW-PIVOT (mai/2026): StagesTab + ToolsTab removidos. Substituídos
// pela aba "Fluxo" no PR 3 (canvas @xyflow/react com nodes/edges).
export { AuditTab } from "./components/AuditTab";
export { LimitsUsageTab } from "./components/LimitsUsageTab";
export { FAQTab } from "./components/FAQTab";
export { DocumentsTab } from "./components/DocumentsTab";
export { NotificationsTab } from "./components/NotificationsTab";
export { SchedulingTab } from "./components/SchedulingTab";
export { PlaceholderTab } from "./components/PlaceholderTab";

// Leaf components (pra uso direto fora dos tabs padrao)
export { AgentStatusBadge } from "./components/AgentStatusBadge";
export { ActiveLimitsProgress } from "./components/ActiveLimitsProgress";
export { CalendarConnectionsCard } from "./components/CalendarConnectionsCard";
export { CustomWebhookToolSheet } from "./components/CustomWebhookToolSheet";
export { DecisionIntelligenceModal } from "./components/DecisionIntelligenceModal";
export { HandoffNotificationCard } from "./components/HandoffNotificationCard";
export { QuickToolsCard } from "./components/QuickToolsCard";
export { EntryConditionsCard } from "./components/EntryConditionsCard";
export { IndexingStatusBadge } from "./components/IndexingStatusBadge";
export { LimitsEditor } from "./components/LimitsEditor";
export { ReactivateAgentButton } from "./components/ReactivateAgentButton";
// PR-FLOW-PIVOT: StageSheet + StageActionsEditor removidos. Editor de
// nodes individual fica dentro do FlowEditor (PR 3).
export { TesterSheet } from "./components/TesterSheet";
export { UsageChart } from "./components/UsageChart";
export { UsageStatsCards } from "./components/UsageStatsCards";
export { WebhookAllowlistSettings } from "./components/WebhookAllowlistSettings";
