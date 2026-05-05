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

export default function CrmSettingsLegacyPage({
  searchParams: _searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Mapeia tabs legadas pra estrutura nova:
  //   ?tab=funis      → /crm (Pipeline tab) — usuario edita via "Editar estrutura"
  //   ?tab=etiquetas  → /crm?tab=tags
  //   ?tab=segmentos  → /crm?tab=segmentos
  //   ?tab=motivos    → /crm (motivos foram removidos)
  // Por simplicidade, redireciona TUDO pra /crm na raiz; quem
  // precisar de uma sub-tab especifica chega la 1 clique depois.
  void _searchParams;
  permanentRedirect("/crm");
}
