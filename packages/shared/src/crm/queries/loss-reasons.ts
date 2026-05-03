// Query: listLossReasons (PR-K3)
//
// Lista os motivos de perda cadastrados no org. Se vier vazio, dispara
// o seed default via RPC public.seed_default_loss_reasons (idempotente).

import type { DealLossReason } from "../types";
import type { CrmQueryContext } from "./context";

/**
 * Retorna lista ordenada por sort_order. Auto-seeda defaults se a org
 * nao tem nenhum motivo cadastrado ainda (first-touch UX).
 */
export async function listLossReasons(
  ctx: CrmQueryContext,
): Promise<DealLossReason[]> {
  const { db, orgId } = ctx;

  let { data, error } = await db
    .from("deal_loss_reasons")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  // First-touch: seeda defaults se vier vazio + recarrega.
  // Cast pra any pra acessar rpc (que vive no SupabaseClient real mas
  // nao foi tipado em CrmQueryDb pra evitar dependencia de Database).
  if ((data ?? []).length === 0) {
    const dbWithRpc = db as unknown as {
      rpc: (
        fn: string,
        params?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    if (typeof dbWithRpc.rpc === "function") {
      const { error: rpcErr } = await dbWithRpc.rpc(
        "seed_default_loss_reasons",
        { p_org_id: orgId },
      );
      if (rpcErr) {
        // Nao bloqueia o fluxo — retorna vazio se seed falhar (UI cai
        // pro fallback "campo livre")
        return [];
      }
      const reload = await db
        .from("deal_loss_reasons")
        .select("*")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      data = reload.data;
    }
  }

  return (data ?? []) as DealLossReason[];
}
