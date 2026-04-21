import { CrmSettingsClient } from "./crm-settings-client";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function CrmSettingsPage() {
  const { supabase, orgId } = await requireAdminPageAccess();
  if (!orgId) return null;

  // Fetch all pipelines
  const { data: pipelines } = await supabase
    .from("pipelines")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  // Fetch all stages for all pipelines
  const pipelineIds = (pipelines || []).map((p: { id: string }) => p.id);
  let stages: { id: string; pipeline_id: string; name: string; color: string | null; sort_order: number }[] = [];

  if (pipelineIds.length > 0) {
    const { data: stagesData } = await supabase
      .from("pipeline_stages")
      .select("*")
      .in("pipeline_id", pipelineIds)
      .order("sort_order", { ascending: true });
    stages = stagesData || [];
  }

  return (
    <div className="space-y-6">
      <CrmSettingsClient
        pipelines={pipelines || []}
        stages={stages as never}
      />
    </div>
  );
}
