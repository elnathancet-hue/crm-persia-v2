"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getFlows() {
  const { supabase, orgId } = await requireRole("admin");

  const { data: flows, error } = await supabase
    .from("flows")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (!flows || flows.length === 0) return [];

  const flowIds = flows.map((f: any) => f.id);
  const { data: executions } = await supabase
    .from("flow_executions")
    .select("flow_id")
    .in("flow_id", flowIds);

  const countMap: Record<string, number> = {};
  (executions || []).forEach((e: any) => {
    countMap[e.flow_id] = (countMap[e.flow_id] || 0) + 1;
  });

  return flows.map((flow: any) => ({
    ...flow,
    executions_count: countMap[flow.id] || 0,
  }));
}

export async function getFlow(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("flows")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createFlow(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("flows")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      trigger_type: formData.get("trigger_type") as string || "manual",
      trigger_config: {},
      nodes: [],
      edges: [],
      is_active: false,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/flows");
  return data;
}

export async function updateFlow(
  id: string,
  updates: {
    nodes?: any[];
    edges?: any[];
    name?: string;
    is_active?: boolean;
    trigger_type?: string;
    trigger_config?: any;
  }
) {
  const { supabase, orgId } = await requireRole("admin");

  const updateData: Record<string, any> = {};
  if (updates.nodes !== undefined) updateData.nodes = updates.nodes;
  if (updates.edges !== undefined) updateData.edges = updates.edges;
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.is_active !== undefined) updateData.is_active = updates.is_active;
  if (updates.trigger_type !== undefined) updateData.trigger_type = updates.trigger_type;
  if (updates.trigger_config !== undefined) updateData.trigger_config = updates.trigger_config;

  const { error } = await supabase
    .from("flows")
    .update(updateData as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/flows");
  revalidatePath(`/flows/${id}`);
}

export async function duplicateFlow(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { data: original, error: fetchError } = await supabase
    .from("flows")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !original) throw new Error("Fluxo nao encontrado");

  const { data, error } = await supabase
    .from("flows")
    .insert({
      organization_id: orgId,
      name: `${original.name} (copia)`,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      nodes: original.nodes,
      edges: original.edges,
      is_active: false,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/flows");
  return data;
}

export async function deleteFlow(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  await supabase.from("flow_executions").delete().eq("flow_id", id);
  const { error } = await supabase.from("flows").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/flows");
}
