import { CrmSettingsClient } from "./crm-settings-client";
import { LossReasonsManager } from "@/components/crm/loss-reasons-manager";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";
import type { DealLossReason } from "@persia/shared/crm";

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

  // Fetch loss reasons (PR-K4) — listamos apenas ativos pra manager;
  // soft-deleted continuam no banco pra historico nos deals.
  // Cast `from` pra never-bypass: a tabela `deal_loss_reasons` veio na
  // migration 032 mas o Database type gerado pode estar defasado em
  // alguns ambientes. Defensivo + try/catch evita quebrar a pagina
  // /crm/settings se a migration nao tiver sido aplicada ainda.
  let lossReasonsData: unknown[] = [];
  try {
    const result = await (supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: boolean) => {
              order: (col: string, opts: { ascending: boolean }) => Promise<{
                data: unknown[] | null;
              }>;
            };
          };
        };
      };
    })
      .from("deal_loss_reasons")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    lossReasonsData = result.data ?? [];
  } catch (err) {
    console.error(
      "[/crm/settings] deal_loss_reasons query falhou (migration 032 aplicada?):",
      err,
    );
  }

  return (
    <div className="space-y-6">
      <CrmSettingsClient
        pipelines={pipelines || []}
        stages={stages as never}
      />
      <div className="max-w-3xl mx-auto">
        <LossReasonsManager
          initialReasons={lossReasonsData as DealLossReason[]}
        />
      </div>
    </div>
  );
}
