// Contexto que toda mutation do CRM aceita.
//
// Estende `CrmQueryContext` ({ db, orgId }) com hooks pra side effects
// fire-and-forget que cada app pode querer disparar apos mudancas:
// o CRM sincroniza o lead com a UAZAPI (whatsapp), o admin nao faz nada.
// Em vez de a mutation shared importar `syncLeadToUazapi` (que so existe
// no CRM), ela aceita um callback opcional que cada app implementa.
//
// `revalidatePath` NAO entra aqui — invalidacao de cache do Next eh
// responsabilidade da camada de server action (apps/crm/src/actions/*),
// nao da mutation shared.

import type { CrmQueryContext } from "../queries/context";

export interface CrmMutationContext extends CrmQueryContext {
  /**
   * Disparado fire-and-forget apos qualquer mutation que muda dados de
   * um lead (createLead, updateLead, addTagToLead, removeTagFromLead).
   * CRM passa um callback que sincroniza o lead com a UAZAPI; admin
   * omite. Erros do callback sao logados no callback (a mutation nao
   * espera nem propaga).
   */
  onLeadChanged?: (leadId: string) => void;
}
