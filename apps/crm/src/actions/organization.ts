"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database";

export async function updateOrgSettings(updates: Record<string, unknown>) {
  const { supabase, orgId } = await requireRole("admin");

  // Separate org-level fields from settings JSONB
  const orgFields: Record<string, unknown> = {};
  const settingsUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === "_org_name") orgFields.name = value;
    else if (key === "_org_niche") orgFields.niche = value;
    else if (key === "_org_website") orgFields.website = value;
    else settingsUpdates[key] = value;
  }

  // Update org-level fields if any
  if (Object.keys(orgFields).length > 0) {
    orgFields.updated_at = new Date().toISOString();
    const { error } = await supabase
      .from("organizations")
      .update(orgFields as never)
      .eq("id", orgId);
    if (error) throw new Error(error.message);
  }

  // Update JSONB settings if any
  if (Object.keys(settingsUpdates).length > 0) {
    const { data: org } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .single();

    const currentSettings = (org?.settings as Record<string, unknown>) || {};
    const newSettings = { ...currentSettings, ...settingsUpdates } as Json;

    const { error } = await supabase
      .from("organizations")
      .update({ settings: newSettings, updated_at: new Date().toISOString() })
      .eq("id", orgId);

    if (error) throw new Error(error.message);
  }

  revalidatePath("/settings");
}
