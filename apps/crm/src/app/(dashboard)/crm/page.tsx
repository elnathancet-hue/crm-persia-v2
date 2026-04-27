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
  let pipelines = await listPipelines({ db: supabase, orgId });
  if (pipelines.length === 0) {
    await ensureDefaultPipeline();
    pipelines = await listPipelines({ db: supabase, orgId });
  }

  if (pipelines.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight font-heading">
          CRM - Funil de Vendas
        </h1>
        <p className="text-muted-foreground">Erro ao criar pipeline. Recarregue.</p>
      </div>
    );
  }

  // Carrega stages, deals e leads em paralelo. Stages usa query direta
  // pra trazer todas as stages de TODOS os pipelines do org de uma vez
  // (a UI permite trocar de pipeline no dropdown sem refetch).
  const [stagesResult, dealsResult, leadsResult] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
    listDeals({ db: supabase, orgId }),
    supabase
      .from("leads")
      .select("id, name, phone, email")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight font-heading">
          CRM - Funil de Vendas
        </h1>
      </div>
      <CrmClient
        pipelines={pipelines as never}
        stages={(stagesResult.data || []) as never}
        deals={dealsResult as never}
        leads={(leadsResult.data || []) as never}
      />
    </div>
  );
}
