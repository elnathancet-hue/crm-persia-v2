// PR-CRMOPS: rota legada — redireciona pra /crm.
//
// /crm/settings era a rota canonica de configuracao do CRM antes do
// PR-CRMCFG (que moveu pra /settings/crm). Agora o produto reverteu
// a direcao: configuracao volta pra dentro do CRM (drawer inline +
// tabs Segmentacao/Tags). Nao ha mais rota dedicada de config CRM.
//
// Mantem aqui apenas o redirect 308 pra preservar bookmarks externos
// que ainda apontem pra /crm/settings ou /crm/settings?tab=*.
//
// Pode ser removido em alguns sprints quando confirmar que nao tem
// trafego (ver Logs Explorer).

import { permanentRedirect } from "next/navigation";

export const metadata = { title: "Configurações do Funil" };

export default async function CrmSettingsLegacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Mapeia tabs legadas pra estrutura nova:
  //   ?tab=funis      → /crm
  //   ?tab=etiquetas  → /crm?tab=tags
  //   ?tab=segmentos  → /crm?tab=segmentos
  //   ?tab=motivos    → /crm (motivos foram removidos)
  const params = await searchParams;
  const legacyTab = typeof params.tab === "string" ? params.tab : null;
  const tabMap: Record<string, string> = {
    etiquetas: "tags",
    segmentos: "segmentos",
    atividades: "atividades",
    leads: "leads",
  };
  const newTab = legacyTab ? tabMap[legacyTab] : null;
  permanentRedirect(newTab ? `/crm?tab=${newTab}` : "/crm");
}
