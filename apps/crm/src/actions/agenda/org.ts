"use server";

import { requireRole } from "@/lib/auth";

/**
 * Retorna metadata minima da org (slug + nome) usado pelos componentes
 * de Booking Pages pra montar URLs publicas (`/agendar/{org_slug}/{slug}`).
 *
 * O org_slug ja eh garantido UNIQUE NOT NULL desde a migration 001.
 */
export async function getOrgMeta(): Promise<{ id: string; slug: string; name: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
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
