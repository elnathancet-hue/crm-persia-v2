"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getQueues() {
  const { supabase, orgId } = await requireRole("admin");

  const { data: queues, error } = await supabase
    .from("queues")
    .select("id, name, description, distribution_type, is_active, set_lead_owner, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (!queues || queues.length === 0) return [];

  const queueIds = queues.map((q: any) => q.id);
  const { data: members } = await supabase
    .from("queue_members")
    .select("queue_id")
    .in("queue_id", queueIds);

  const countMap: Record<string, number> = {};
  (members || []).forEach((m: any) => {
    countMap[m.queue_id] = (countMap[m.queue_id] || 0) + 1;
  });

  return queues.map((queue: any) => ({
    ...queue,
    member_count: countMap[queue.id] || 0,
  }));
}

export async function createQueue(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("queues")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      distribution_type: (formData.get("distribution_type") as string) || "round_robin",
      description: (formData.get("description") as string) || null,
      is_active: formData.get("is_active") !== "false",
      set_lead_owner: formData.get("set_lead_owner") !== "false",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/settings/queues");
  return data;
}

export async function updateQueue(id: string, formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const updateData: Record<string, any> = {};
  const name = formData.get("name") as string;
  const distributionType = formData.get("distribution_type") as string;
  const description = formData.get("description") as string;
  const isActive = formData.get("is_active");
  const setLeadOwner = formData.get("set_lead_owner");

  if (name !== undefined && name.trim() === "") throw new Error("Nome é obrigatório");
  if (name) updateData.name = name.trim();
  if (distributionType) updateData.distribution_type = distributionType;
  if (description !== null) updateData.description = description;
  if (isActive !== null) updateData.is_active = isActive !== "false";
  if (setLeadOwner !== null) updateData.set_lead_owner = setLeadOwner !== "false";

  const { error } = await supabase.from("queues").update(updateData as never).eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/queues");
}

export async function deleteQueue(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  await supabase.from("queue_members").delete().eq("queue_id", id).eq("organization_id", orgId);
  const { error } = await supabase.from("queues").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/queues");
}
