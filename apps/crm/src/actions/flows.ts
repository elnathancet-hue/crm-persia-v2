"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getFlows() {
  const { supabase, orgId } = await requireRole("admin");

  // Busca flows + contagem de execuções numa query só via embedded count
  // do PostgREST — elimina o segundo SELECT de flow_executions.
  const { data: flows, error } = await supabase
    .from("flows")
    .select("*, flow_executions(count)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (!flows || flows.length === 0) return [];

  return (flows as any[]).map((flow) => ({
    ...flow,
    executions_count: (flow.flow_executions as [{ count: number }] | null)?.[0]?.count ?? 0,
    flow_executions: undefined,
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
    .eq("organization_id", orgId)
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

  // Validate ownership before touching any data.
  const { data: flow } = await supabase.from("flows").select("id").eq("id", id).eq("organization_id", orgId).single();
  if (!flow) throw new Error("Fluxo nao encontrado");

  await supabase.from("flow_executions").delete().eq("flow_id", id).eq("organization_id", orgId);
  const { error } = await supabase.from("flows").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/flows");
}
