export const metadata = { title: "CRM" };
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ensureDefaultPipeline } from "@/actions/crm";
import { listPipelines, listDeals } from "@persia/shared/crm";
import { CrmClient } from "./crm-client";

export default async function CrmPage() {
  // Usa o helper centralizado em vez de query direta com `.single()` —
  // .single() throwa quando o user e membro de >1 org (caso real do
  // superadmin testando varias contas), o que disparava redirect pra
  // /login mesmo com sessao valida.
  const { supabase, orgId } = await getAuthContext();
  if (!orgId) redirect("/login");

  // Garante que existe pelo menos um pipeline (cria com stages padrao
  // na primeira visita). Reusa a logica shared em @persia/shared/crm.
  // HOTFIX: try/catch em volta pra nao crashar a pagina se o ensure
  // falhar (ex: RLS bloqueando insert; admin nao logado).
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
          CRM - Funil de Vendas
        </h1>
        <p className="text-muted-foreground">
          Nenhum funil disponivel. Acesse{" "}
          <a href="/crm/settings" className="text-primary underline">
            /crm/settings
          </a>{" "}
          pra configurar, ou recarregue a pagina.
        </p>
      </div>
    );
  }

  // Carrega dados em paralelo. HOTFIX: cada query tem try/catch proprio —
  // antes era um Promise.all unico que crashava o page inteiro se UMA
  // query falhasse (ex: tabela faltando, RLS, FK ausente). Agora a
  // pagina sempre renderiza, com fallback `[]` pros dados que faltarem.
  // Erros vao pro log do servidor pra diagnostico.

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

  const [stages, deals, leads, tags, members] = await Promise.all([
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
      "leads",
      () =>
        supabase
          .from("leads")
          .select("id, name, phone, email")
          .eq("organization_id", orgId)
          .order("name", { ascending: true }),
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
  ]);

  // Resolve full_name dos profiles em query separada (defensiva — se
  // RLS bloquear, retorna [] ao inves de quebrar a pagina).
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight font-heading">
          CRM - Funil de Vendas
        </h1>
      </div>
      <CrmClient
        pipelines={pipelines as never}
        stages={stages as never}
        deals={deals as never}
        leads={leads as never}
        tags={tags as never}
        assignees={assignees}
      />
    </div>
  );
}
