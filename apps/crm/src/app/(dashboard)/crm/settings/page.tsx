// PR-CRMCFG: rota legada — redireciona pra /settings/crm.
//
// Antes /crm/settings era a rota canonica de configuracao do CRM
// (atrelada visualmente ao Kanban via tab "Ajustes"). Movida pra
// /settings/crm pra unificar com /settings/* (org, equipe, etc) e
// resolver a duplicidade com o modal "Configurar funis".
//
// Mantem aqui apenas o redirect 308 pra preservar bookmarks externos
// + qualquer link interno que ainda escape. Pode ser removido em
// alguns sprints quando confirmar que nao tem trafego.
//
// Importante: preserva ?tab=funis|etiquetas|motivos|segmentos pra
// deep links continuarem funcionando.

import { redirect, permanentRedirect } from "next/navigation";

export default async function CrmSettingsLegacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : null;
  const dest = tab ? `/settings/crm?tab=${encodeURIComponent(tab)}` : "/settings/crm";
  // permanentRedirect = 308. Preserva metodo + body, ideal pra
  // bookmarks/links externos.
  permanentRedirect(dest);
  // Linha defensiva (TS ja sabe que permanentRedirect throws):
  redirect(dest);
}
