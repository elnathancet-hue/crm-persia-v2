// @persia/crm-ui — shared CRM Kanban UI surface.
//
// Both @persia/crm and @persia/admin consume these components via
// <KanbanProvider actions={...}>. Components pull mutations
// through useKanbanActions() so each app can wire its own server actions
// (requireRole on crm, requireSuperadminForOrg on admin).

export type {
  KanbanActions,
  CreateStageInput,
  CreateDealInput,
  UpdateDealInput,
  UpdateStageInput,
} from "./actions";
export {
  KanbanProvider,
  useKanbanActions,
  type KanbanProviderProps,
} from "./context";

export {
  KanbanBoard,
  type KanbanBoardProps,
  type KanbanLead,
  type AdvancedFilters,
  type TagLogic,
} from "./components/KanbanBoard";
export { PipelineConfigDrawer } from "./components/PipelineConfigDrawer";
export {
  MarkAsLostDialog,
  type MarkAsLostFormValues,
} from "./components/MarkAsLostDialog";
export { ExportMenu } from "./components/ExportMenu";
export {
  DialogHero,
  type DialogHeroProps,
  type DialogHeroTone,
} from "./components/DialogHero";
export {
  downloadExport,
  makeExportFilename,
  EXPORT_MAX_ROWS,
  type ExportColumn,
  type ExportFormat,
  type ExportOptions,
} from "./lib/export";
export {
  ImportLeadsWizard,
  type ImportTag,
  type ImportLeadsInput,
  type ImportLeadsResult,
  type ImportFieldMapping,
  type ImportDestination,
  type DuplicateStrategy,
} from "./components/ImportLeadsWizard";
