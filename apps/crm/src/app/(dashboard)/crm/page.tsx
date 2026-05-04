export const metadata = { title: "CRM" };
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ensureDefaultPipeline } from "@/actions/crm";
import { getLeads, getOrgActivities } from "@/actions/leads";
import { listPipelines, listDeals } from "@persia/shared/crm";
import { CrmShell } from "./crm-shell";

export default async function CrmPage() {
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

  if (pipelines.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight font-heading">
          CRM Kanban
        </h1>
        <p className="text-muted-foreground">
          Nenhum funil disponivel. Acesse{" "}
          <a href="/crm/settings" className="text-primary underline">
            /crm/settings
          </a>{" "}
          pra configurar.
        </p>
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
    (async () => {
      try {
        return await getLeads({ page: 1, limit: 20 });
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
  ]);

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
      }}
      activitiesData={{
        initialActivities: activitiesResult.activities as never,
        initialTotal: activitiesResult.total,
        initialPage: activitiesResult.page,
        initialTotalPages: activitiesResult.totalPages,
      }}
      leadCount={leadsListResult.total}
      dealCount={deals.length}
      activityCount={activitiesResult.total}
    />
  );
}
