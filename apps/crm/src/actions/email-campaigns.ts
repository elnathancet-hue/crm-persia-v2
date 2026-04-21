"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getEmailCampaigns() {
  const { supabase, orgId } = await requireRole("admin");

  const { data: campaigns, error } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (!campaigns || campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c: any) => c.id);
  const { data: sends } = await supabase
    .from("email_sends")
    .select("campaign_id, status")
    .in("campaign_id", campaignIds);

  const statsMap: Record<string, { sent: number; opened: number; clicked: number }> = {};
  (sends || []).forEach((s: any) => {
    if (!statsMap[s.campaign_id]) {
      statsMap[s.campaign_id] = { sent: 0, opened: 0, clicked: 0 };
    }
    statsMap[s.campaign_id].sent += 1;
    if (s.status === "opened") statsMap[s.campaign_id].opened += 1;
    if (s.status === "clicked") statsMap[s.campaign_id].clicked += 1;
  });

  return campaigns.map((campaign: any) => ({
    ...campaign,
    total_sent: statsMap[campaign.id]?.sent || 0,
    total_opened: statsMap[campaign.id]?.opened || 0,
    total_clicked: statsMap[campaign.id]?.clicked || 0,
    open_rate:
      statsMap[campaign.id]?.sent > 0
        ? Math.round(
            (statsMap[campaign.id].opened / statsMap[campaign.id].sent) * 100
          )
        : 0,
  }));
}

export async function createEmailCampaign(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("email_campaigns")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      subject: formData.get("subject") as string,
      html_content: (formData.get("content") as string) || "",
      segment_id: (formData.get("segment_id") as string) || null,
      status: "draft",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/email");
  return data;
}

export async function updateEmailCampaignStatus(id: string, status: string) {
  const { supabase, orgId } = await requireRole("admin");
  await supabase.from("email_campaigns").update({ status }).eq("id", id).eq("organization_id", orgId);
  revalidatePath("/email");
}

export async function deleteEmailCampaign(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  await supabase.from("email_sends").delete().eq("campaign_id", id);
  const { error } = await supabase.from("email_campaigns").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/email");
}
