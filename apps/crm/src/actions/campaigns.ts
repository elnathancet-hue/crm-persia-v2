"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getCampaigns() {
  const { supabase, orgId } = await requireRole("admin");
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return data;
}

export async function createCampaign(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const tags = formData.get("target_tags") as string;

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      message: formData.get("message") as string,
      channel: "whatsapp",
      target_tags: tags ? tags.split(",").map(t => t.trim()) : [],
      status: "draft",
      scheduled_at: formData.get("scheduled_at") as string || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/campaigns");
  return data;
}

export async function updateCampaignStatus(id: string, status: string) {
  const { supabase, orgId } = await requireRole("admin");
  await supabase.from("campaigns").update({ status }).eq("id", id).eq("organization_id", orgId);
  revalidatePath("/campaigns");
}

export async function deleteCampaign(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  await supabase.from("campaigns").delete().eq("id", id).eq("organization_id", orgId);
  revalidatePath("/campaigns");
}
