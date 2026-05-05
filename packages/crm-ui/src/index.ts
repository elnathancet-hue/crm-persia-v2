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
  ReorderStageInput,
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
// PR-CRMCFG: PipelineConfigDrawer foi REMOVIDO. Configuracao de funis
// agora vive em /settings/crm (CRM) e /crm/configurar (admin), via
// PipelineSettingsClient. Se voce esta lendo isto procurando uma forma
// de embedar config de funis num modal, NAO recrie — leve o usuario pra
// rota dedicada (regra: 1 lugar so pra configurar).
export {
  PipelineSettingsClient,
  type PipelineSettingsClientProps,
} from "./components/PipelineSettingsClient";
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
