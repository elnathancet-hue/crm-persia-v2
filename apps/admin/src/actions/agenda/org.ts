"use server";

import { requireSuperadminForOrg } from "@/lib/auth";

/**
 * Retorna metadata da org corrente (slug + nome).
 * Usado pelos componentes de Booking Pages pra montar URLs publicas.
 */
export async function getOrgMeta(): Promise<{
  id: string;
  slug: string;
  name: string;
}> {
  const { admin, orgId } = await requireSuperadminForOrg();

  const { data, error } = await admin
    .from("organizations")
    .select("id, slug, name")
    .eq("id", orgId)
    .single();

  if (error || !data) {
    throw new Error(`getOrgMeta: ${error?.message ?? "org não encontrada"}`);
  }
  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
  };
}
