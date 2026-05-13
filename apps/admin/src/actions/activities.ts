"use server";

// PR-V1c: action server-side pra timeline global de activities do org.
// Wrapper sobre listOrgActivities (query compartilhada) com auth
// requireSuperadminForOrg — admin = service-role bypassa RLS, mas
// listOrgActivities filtra organization_id explicito (defesa em
// camadas).
//
// Diferente do CRM (que faz `throw` direto), aqui adaptamos a falha pro
// shape de retorno compativel com o componente ActivitiesTab do
// @persia/crm-ui — que espera ActivitiesPage e propaga erros via
// catch + toast. Logo, mantemos o throw natural pra alinhar o contrato.

import { requireSuperadminForOrg } from "@/lib/auth";
import {
  listOrgActivities,
  type ListOrgActivitiesOptions,
  type OrgActivitiesResult,
} from "@persia/shared/crm";

export async function getOrgActivities(
  options: ListOrgActivitiesOptions = {},
): Promise<OrgActivitiesResult> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return listOrgActivities({ db: admin, orgId }, options);
}
