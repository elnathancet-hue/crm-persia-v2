export const metadata = { title: "CRM" };
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ensureDefaultPipeline } from "@/actions/crm";
import {
  getLeads,
  getLeadsListStats,
  getOrgActivities,
  type LeadListItemStats,
} from "@/actions/leads";
import { getTagsWithCount } from "@/actions/tags";
import { getSegments } from "@/actions/segments";
import { listPipelines, listDeals } from "@persia/shared/crm";
import { PageTitle } from "@persia/ui/typography";
import { CrmShell } from "./crm-shell";

interface CrmPageProps {
  // PR-CRMOPS3: o page lê ?segment={id} pra filtrar a tab Leads
  // (botao "Ver leads" do segment card aponta pra ca).
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const params = await searchParams;
  const segmentIdFilter = typeof params.segment === "string" ? params.segment : null;

  // Usa o helper centralizado em vez de query direta com `.single()` —
  // .single() throwa quando o user e membro de >1 org (caso real do
  // superadmin testando varias contas), o que disparava redirect pra
  // /login mesmo com sessao valida.
  const { supabase, orgId } = await getAuthContext();
  if (!orgId) redirect("/login");

  // Garante que existe pelo menos um pipeline (cria com stages padrao
  // na primeira visita). HOTFIX (#100): try/catch defensivo.
  let pipelines: Awaited<ReturnType<typeof listPipelines>> = [];
  try {
    pipelines = await listPipelines({ db: supabase, orgId });
    if (pipelines.length === 0) {
      try {
        await ensureDefaultPipeline();
        pipelines = await listPipelines({ db: supabase, orgId });
      } catch (err) {
        console.error("[/crm page] ensureDefaultPipeline falhou:", err);
      }
    }
  } catch (err) {
    console.error("[/crm page] listPipelines falhou:", err);
  }

  // PR-CRMOPS: ja garantimos pipeline default acima. Se ainda chega
  // aqui sem nenhum, mostra empty state direto.
  if (pipelines.length === 0) {
    return (
      <div className="space-y-6">
        <PageTitle size="compact">CRM</PageTitle>
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center">
          <h2 className="text-base font-semibold">Nenhum funil disponivel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tente recarregar a pagina. Se persistir, contate o suporte.
          </p>
        </div>
      </div>
    );
  }

  // Carrega TUDO em paralelo (pipeline data + leads list + tags + assignees)
  // pro CrmShell distribuir entre as 4 tabs. Cada query isolada em try/catch
  // pra nao crashar o page se uma falhar (PR #100 hardening).
  async function safeQuery<T>(
    name: string,
    fn: () => PromiseLike<{ data: T[] | null }>,
  ): Promise<T[]> {
    try {
      const r = await fn();
      return r.data ?? [];
    } catch (err) {
      console.error(`[/crm page] query "${name}" falhou:`, err);
      return [];
    }
  }

  const [
    stages,
    deals,
    pipelineLeads,
    tags,
    members,
    leadsListResult,
    activitiesResult,
    segmentsResult,
    tagsWithCountResult,
  ] = await Promise.all([
    safeQuery<{ id: string; pipeline_id: string; name: string; color: string | null; sort_order: number }>(
      "pipeline_stages",
      () =>
        supabase
          .from("pipeline_stages")
          .select("*")
          .eq("organization_id", orgId)
          .order("sort_order", { ascending: true }),
    ),
    (async () => {
      try {
        return await listDeals({ db: supabase, orgId });
      } catch (err) {
        console.error("[/crm page] listDeals falhou:", err);
        return [];
      }
    })(),
    safeQuery<{ id: string; name: string | null; phone: string | null; email: string | null }>(
      "leads_for_picker",
      () =>
        supabase
          .from("leads")
          .select("id, name, phone, email")
          .eq("organization_id", orgId)
          .order("name", { ascending: true })
          // PR-AUD4: cap defensivo. O picker de "Atribuir lead" no
          // dialog de criar/editar deal nao precisa carregar 5k+ leads
          // de orgs grandes — degrada page load + memory bloat.
          // Cap em 500 cobre 99% dos casos; pra orgs maiores cabe um
          // search async no futuro.
          .limit(500),
    ),
    safeQuery<{ id: string; name: string; color: string | null }>(
      "tags",
      () =>
        supabase
          .from("tags")
          .select("id, name, color")
          .eq("organization_id", orgId)
          .order("name", { ascending: true }),
    ),
    safeQuery<{ user_id: string | null }>(
      "organization_members",
      () =>
        supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", orgId)
          .eq("is_active", true),
    ),
    // PR-K5: lista paginada pra alimentar a tab "Leads"
    // PR-CRMOPS3: aplica filtro de segmento quando ?segment={id} na URL
    (async () => {
      try {
        return await getLeads({
          page: 1,
          limit: 20,
          ...(segmentIdFilter ? { segmentId: segmentIdFilter } : {}),
        });
      } catch (err) {
        console.error("[/crm page] getLeads (tab Leads) falhou:", err);
        return { leads: [], total: 0, page: 1, totalPages: 0 };
      }
    })(),
    // PR-K7: timeline pra alimentar a tab "Atividades"
    (async () => {
      try {
        return await getOrgActivities({ page: 1, limit: 30 });
      } catch (err) {
        console.error("[/crm page] getOrgActivities falhou:", err);
        return { activities: [], total: 0, page: 1, totalPages: 0 };
      }
    })(),
    // PR-CRMOPS: tab "Segmentação" — embed do SegmentList que vivia em
    // /segments. Reusa a action getSegments existente (regra 11: nao
    // criar logica paralela).
    (async () => {
      try {
        return await getSegments();
      } catch (err) {
        console.error("[/crm page] getSegments falhou:", err);
        return [] as unknown[];
      }
    })(),
    // PR-CRMOPS: tab "Tags" — embed do TagsPageClient que vivia em /tags.
    // Reusa getTagsWithCount.
    (async () => {
      try {
        return await getTagsWithCount();
      } catch (err) {
        console.error("[/crm page] getTagsWithCount falhou:", err);
        return [] as unknown[];
      }
    })(),
  ]);

  // PR-L3: stats em batch pra Tab Leads enriquecida (Responsavel +
  // Negocios + Etapa + Atividades). Usa leadIds da lista paginada
  // ja carregada (max 20 ids -> 3 queries paralelas, sem N+1).
  // Defensive try/catch — falha em stats nao quebra a tab.
  let leadsListStats = new Map<string, LeadListItemStats>();
  try {
    const leadIds = (leadsListResult.leads ?? []).map(
      (l: { id: string }) => l.id,
    );
    if (leadIds.length > 0) {
      leadsListStats = await getLeadsListStats(leadIds);
    }
  } catch (err) {
    console.error("[/crm page] getLeadsListStats falhou:", err);
    // leadsListStats fica vazio — UI degrada mostrando colunas vazias
  }

  // Resolve nomes dos responsaveis em query separada (RLS pode bloquear —
  // try/catch defensivo).
  const memberUserIds = members
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id));

  let assignees: { id: string; name: string }[] = [];
  if (memberUserIds.length > 0) {
    try {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberUserIds);
      assignees = ((profilesData ?? []) as { id: string; full_name: string | null }[])
        .map((p) => ({ id: p.id, name: p.full_name || "Sem nome" }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    } catch (err) {
      console.error("[/crm page] profiles falhou:", err);
    }
  }

  // PR-CRMOPS3: nome do segmento ativo pra mostrar no hint da tab Leads
  // ("Filtrado por: <nome> · Limpar"). Resolve do array ja carregado em
  // segmentsResult, sem query extra.
  const activeSegmentName =
    segmentIdFilter && Array.isArray(segmentsResult)
      ? ((segmentsResult as { id: string; name: string }[])
          .find((s) => s.id === segmentIdFilter)?.name ?? null)
      : null;

  return (
    <CrmShell
      pipelines={pipelines as never}
      stages={stages as never}
      deals={deals as never}
      pipelineLeads={pipelineLeads as never}
      tags={tags as never}
      assignees={assignees}
      leadsListData={{
        initialLeads: leadsListResult.leads as never,
        initialTotal: leadsListResult.total,
        initialPage: leadsListResult.page,
        initialTotalPages: leadsListResult.totalPages,
        // PR-L3: stats enriquecidas pras 4 colunas novas
        // (Responsavel/Negocios/Etapa/Atividades)
        initialStats: leadsListStats,
      }}
      activeSegment={
        segmentIdFilter && activeSegmentName
          ? { id: segmentIdFilter, name: activeSegmentName }
          : null
      }
      activitiesData={{
        initialActivities: activitiesResult.activities as never,
        initialTotal: activitiesResult.total,
        initialPage: activitiesResult.page,
        initialTotalPages: activitiesResult.totalPages,
      }}
      // PR-CRMOPS: dados pras tabs novas (Segmentação + Tags)
      segments={segmentsResult as never}
      tagsList={tagsWithCountResult as never}
      leadCount={leadsListResult.total}
      dealCount={deals.length}
      activityCount={activitiesResult.total}
      segmentCount={(segmentsResult as unknown[]).length}
      tagCount={(tagsWithCountResult as unknown[]).length}
    />
  );
}
