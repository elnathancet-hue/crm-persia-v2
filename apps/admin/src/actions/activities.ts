"use server";

// PR-T4: admin action pra timeline global de activities da org.
// Espelha apps/crm/src/actions/leads.ts:getOrgActivities mas com auth
// admin (requireSuperadminForOrg + service-role).
//
// Reusa a query pura `listOrgActivities` de @persia/shared/crm — mesma
// logica de pagination/filter/tenant que o CRM cliente usa. So muda
// quem injeta o supabase client.

import {
  listOrgActivities,
  type ListOrgActivitiesOptions,
} from "@persia/shared/crm";
import { requireSuperadminForOrg } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getOrgActivities(
  options: ListOrgActivitiesOptions = {},
) {
  const { admin, orgId } = await requireSuperadminForOrg();
  return listOrgActivities(
    { db: admin as unknown as SupabaseClient, orgId },
    options,
  );
}
