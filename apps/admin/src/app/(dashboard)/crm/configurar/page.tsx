import { CrmConfigClient } from "./crm-config-client";

// PR-CRMCFG: rota dedicada de configuracao de funis no admin.
//
// Substitui o modal "Configurar funis" que vivia inline na toolbar do
// KanbanBoard (removido em PR-CRMCFG porque ja existia rota equivalente
// no CRM via /settings/crm — duplicacao foi resolvida).
//
// Por que rota dedicada (vs "configurar tudo na crm-page"):
//   - Coerencia com o CRM (/settings/crm/funis).
//   - Sem competir com a UI operacional do Kanban.
//   - Reutiliza o mesmo `PipelineSettingsClient` (master-detail) do
//     @persia/crm-ui — zero divergencia visual entre apps.
//
// Auth: como toda outra rota do admin, valida via cookie assinado
// (requireSuperadminForOrg dentro das actions). O page.tsx nao precisa
// fazer loader server-side porque o admin carrega tudo via state +
// useActiveOrg (mesmo padrao da crm-page.tsx).

export default function Page() {
  return <CrmConfigClient />;
}
