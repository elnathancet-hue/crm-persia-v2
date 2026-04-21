export const metadata = { title: "CRM" };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CrmClient } from "./crm-client";

export default async function CrmPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) redirect("/login");
  const orgId = member.organization_id;

  // Ensure default pipeline exists
  let { data: pipelines } = await supabase
    .from("pipelines")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (!pipelines || pipelines.length === 0) {
    // Create default pipeline
    const { data: newPipeline } = await supabase
      .from("pipelines")
      .insert({ organization_id: orgId, name: "Funil Principal" })
      .select()
      .single();

    if (newPipeline) {
      const defaultStages = [
        { name: "Novo", color: "#3b82f6", position: 0 },
        { name: "Contato", color: "#f59e0b", position: 1 },
        { name: "Qualificado", color: "#8b5cf6", position: 2 },
        { name: "Proposta", color: "#ef4444", position: 3 },
        { name: "Fechado", color: "#22c55e", position: 4 },
      ];

      for (const stage of defaultStages) {
        await supabase.from("pipeline_stages").insert({
          pipeline_id: newPipeline.id,
          organization_id: orgId,
          name: stage.name,
          color: stage.color,
          sort_order: stage.position,
        });
      }

      pipelines = [newPipeline];
    }
  }

  if (!pipelines || pipelines.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight font-heading">CRM - Funil de Vendas</h1>
        <p className="text-muted-foreground">Erro ao criar pipeline. Recarregue.</p>
      </div>
    );
  }

  const activePipeline = pipelines[0];

  // Fetch stages, deals, leads
  const [stagesResult, dealsResult, leadsResult] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", activePipeline.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("deals")
      .select("*, leads(name, phone, email, lead_tags(tags(id, name, color)))")
      .eq("organization_id", orgId),
    supabase
      .from("leads")
      .select("id, name, phone, email")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight font-heading">CRM - {activePipeline.name}</h1>
      </div>
      <CrmClient
        pipelines={pipelines}
        stages={(stagesResult.data || []) as never}
        deals={(dealsResult.data || []) as never}
        leads={(leadsResult.data || []) as never}
      />
    </div>
  );
}
