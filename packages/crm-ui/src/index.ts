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
// PR-CRMOPS: configuracao do Kanban voltou pra dentro do CRM via
// drawer + dialog inline (regra do briefing: usuario nao deve sair
// do CRM pra mexer em nada do CRM).
//
// Historico:
//   - PR-K10 (abr): Modal "Configurar funis" no Kanban + pagina
//     /crm/settings convivendo (duplicidade).
//   - PR-CRMCFG (mai): tentou unificar movendo tudo pra /settings/crm
//     com componente PipelineSettingsClient master-detail.
//   - PR-CRMOPS (mai, este): produto reverteu — volta tudo pro CRM,
//     drawer inline edita SO o Kanban ativo, sem master-detail.
//
// Os 3 componentes abaixo formam o fluxo completo:
//   - PipelineStagesEditor: 3 colunas por outcome, drag entre elas,
//     reorder com setas, cor + IA inline. Uso interno do drawer.
//   - CreateKanbanDialog: dialog simples (nome) -> cria + seleciona.
//   - EditKanbanStructureDrawer: Sheet 720px que abre dentro do CRM.
export {
  PipelineStagesEditor,
  type PipelineStagesEditorProps,
} from "./components/PipelineStagesEditor";
export { CreateKanbanDialog } from "./components/CreateKanbanDialog";
export { EditKanbanStructureDrawer } from "./components/EditKanbanStructureDrawer";
// PR-PIPETOOLS: drawer "Configurar funis" — gestao consolidada de
// funis (lista + criar + editar + excluir). Substitui a "biblioteca
// de funis" do PR-CRMOPS2 (cards no meio da tela), que foi removida
// por roubar foco do Kanban.
export { ManageFunisDrawer } from "./components/ManageFunisDrawer";
// PR-CRMOPS2: dialog do "+" das colunas — cria lead vinculado a deal
// na etapa selecionada (substitui o "Novo negocio" antigo).
export { CreateLeadFromKanbanDialog } from "./components/CreateLeadFromKanbanDialog";
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
// PR-T4: timeline global de activities — shared entre CRM e admin.
// Caller injeta `listActivities` (action com auth proprio do app).
export {
  ActivitiesTab,
  type ActivitiesTabProps,
  type ListActivitiesOptions,
  type ListActivitiesResult,
} from "./components/ActivitiesTab";
