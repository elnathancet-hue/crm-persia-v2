"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getWebhooks() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createWebhook(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const eventsRaw = formData.get("events") as string;
  const events = eventsRaw
    ? eventsRaw
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
    : [];

  const direction = formData.get("direction") as string;
  const token =
    direction === "inbound"
      ? crypto.randomUUID().replace(/-/g, "")
      : null;

  const { data, error } = await supabase
    .from("webhooks")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      direction: direction || "outbound",
      url: (formData.get("url") as string) || null,
      token,
      events,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/settings/webhooks");
  return data;
}

export async function toggleWebhookActive(id: string, isActive: boolean) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("webhooks")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/webhooks");
}

export async function deleteWebhook(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase.from("webhooks").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/webhooks");
}
