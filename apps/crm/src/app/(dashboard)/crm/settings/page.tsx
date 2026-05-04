import { requireAdminPageAccess } from "@/lib/guards/require-admin";
import { getTagsWithCount } from "@/actions/tags";
import { getSegments } from "@/actions/segments";
import type { DealLossReason } from "@persia/shared/crm";
import { SettingsShell } from "./settings-shell";

export default async function CrmSettingsPage() {
  const { supabase, orgId } = await requireAdminPageAccess();
  if (!orgId) return null;

  // PR-K10: tudo em paralelo. Cada bloco em try/catch defensivo
  // (segue padrao do PR-100 hardening) — uma falha nao crasha a pagina.
  const safe = async <T,>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[/crm/settings] ${name} falhou:`, err);
      return fallback;
    }
  };

  const [
    pipelinesResult,
    lossReasonsData,
    tagsData,
    segmentsData,
  ] = await Promise.all([
    safe(
      "pipelines",
      async () => {
        const { data } = await supabase
          .from("pipelines")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: true });
        return data ?? [];
      },
      [] as unknown[],
    ),
    safe(
      "deal_loss_reasons",
      async () => {
        // Cast pra bypass do Database type (migration 032 pode estar
        // defasada em ambientes). Defensivo.
        const result = await (
          supabase as unknown as {
            from: (t: string) => {
              select: (s: string) => {
                eq: (col: string, val: string) => {
                  eq: (col: string, val: boolean) => {
                    order: (
                      col: string,
                      opts: { ascending: boolean },
                    ) => Promise<{ data: unknown[] | null }>;
                  };
                };
              };
            };
          }
        )
          .from("deal_loss_reasons")
          .select("*")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true });
        return (result.data ?? []) as DealLossReason[];
      },
      [] as DealLossReason[],
    ),
    safe(
      "tags",
      () => getTagsWithCount(),
      [] as unknown[],
    ),
    safe(
      "segments",
      () => getSegments(),
      [] as unknown[],
    ),
  ]);

  // Stages dos pipelines (depende de pipelines, query subsequente)
  const pipelineIds = (pipelinesResult as { id: string }[]).map((p) => p.id);
  let stages: unknown[] = [];
  if (pipelineIds.length > 0) {
    try {
      const { data: stagesData } = await supabase
        .from("pipeline_stages")
        .select("*")
        .in("pipeline_id", pipelineIds)
        .order("sort_order", { ascending: true });
      stages = stagesData || [];
    } catch (err) {
      console.error("[/crm/settings] pipeline_stages falhou:", err);
    }
  }

  return (
    <SettingsShell
      pipelines={pipelinesResult as never}
      stages={stages as never}
      lossReasons={lossReasonsData}
      tags={tagsData as never}
      segments={segmentsData as never}
    />
  );
}
