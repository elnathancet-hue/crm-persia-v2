"use server";

import { requireRole } from "@/lib/auth";
import { revalidateLeadCaches } from "@/lib/cache/lead-revalidation";
import type {
  LeadActivity,
  LeadDetail,
  LeadFilters,
  LeadWithTags,
  UpdateLeadInput,
} from "@persia/shared/crm";
import {
  addTagToLead as addTagToLeadShared,
  createLead as createLeadShared,
  deleteLead as deleteLeadShared,
  fetchLead,
  listLeads,
  listOrgActivities,
  listTags,
  removeTagFromLead as removeTagFromLeadShared,
  updateLead as updateLeadShared,
  type ListOrgActivitiesOptions,
} from "@persia/shared/crm";
import { phoneBROptional, emailOptional } from "@persia/shared/validation";

// Re-exporta tipos canônicos. Fonte da verdade: @persia/shared/crm.
export type { LeadActivity, LeadDetail, LeadFilters, LeadWithTags };

// Helper: callback fire-and-forget que sincroniza o lead com UAZAPI
// apos qualquer mudanca. Carregado dinamicamente pra nao puxar o
// modulo de sync no bundle das paginas que so leem leads.
function makeOnLeadChanged(orgId: string) {
  return (leadId: string) => {
    import("@/lib/whatsapp/sync")
      .then(({ syncLeadToUazapi }) => syncLeadToUazapi(orgId, leadId))
      .catch((err) => console.error("[lead-action] sync error:", err));
  };
}

// ============================================================================
// Queries (read-only) — thin wrappers em volta de @persia/shared/crm
// ============================================================================

export async function getLeads(filters: LeadFilters = {}) {
  const { supabase, orgId } = await requireRole("agent");
  return listLeads({ db: supabase, orgId }, filters);
}

export async function getLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");
  return fetchLead({ db: supabase, orgId }, id);
}

export async function getOrgTags() {
  const { supabase, orgId } = await requireRole("agent");
  return listTags({ db: supabase, orgId }, { orderBy: "name" });
}

/**
 * PR-K7: timeline global de activities da org pra tab "Atividades"
 * do CRM. Aceita filtros por tipo + lead + paginacao.
 */
export async function getOrgActivities(
  options: ListOrgActivitiesOptions = {},
) {
  const { supabase, orgId } = await requireRole("agent");
  return listOrgActivities({ db: supabase, orgId }, options);
}

/**
 * PR-D: stats agregados do lead pro header rico do LeadInfoDrawer.
 * Retorna 3 cards de info "de uma olhada":
 *   - Negocios: count + valor total + status do mais recente
 *   - Conversas: count + ultima mensagem
 *   - Atividades: count + descricao da ultima
 *
 * Multi-tenant: o lead e buscado scoped por orgId; queries de stats
 * tambem filtram por organization_id (defesa em camadas — RLS ja
 * deveria proteger, mas explicitos pra ficar claro).
 *
 * Performance: 4 queries paralelas (lead lookup + 3 stats). Cada
 * stat eh COUNT agregado + 1 LIMIT 1 pra "mais recente". Nao busca
 * dados completos — so o suficiente pros cards.
 */
export interface LeadStats {
  deals: {
    count: number;
    total_value: number;
    latest_status: string | null;
  };
  conversations: {
    count: number;
    last_message_at: string | null;
  };
  activities: {
    count: number;
    latest_description: string | null;
    latest_at: string | null;
  };
}

export async function getLeadStats(leadId: string): Promise<LeadStats> {
  const { supabase, orgId } = await requireRole("agent");

  // Defesa multi-tenant: confirma lead pertence ao org
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) {
    return {
      deals: { count: 0, total_value: 0, latest_status: null },
      conversations: { count: 0, last_message_at: null },
      activities: { count: 0, latest_description: null, latest_at: null },
    };
  }

  // 3 queries paralelas (deals + conversations + activities)
  const [dealsRes, convsRes, activitiesRes] = await Promise.all([
    supabase
      .from("deals")
      .select("value, status, created_at")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversations")
      .select("id, last_message_at", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from("lead_activities")
      .select("description, created_at", { count: "exact" })
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const deals = dealsRes.data ?? [];
  const dealsCount = deals.length;
  const dealsTotal = deals.reduce(
    (sum, d) => sum + ((d as { value?: number }).value ?? 0),
    0,
  );
  const latestDealStatus =
    dealsCount > 0
      ? ((deals[0] as { status?: string }).status ?? null)
      : null;

  const convsCount = convsRes.count ?? 0;
  const lastMsgAt =
    convsRes.data && convsRes.data.length > 0
      ? ((convsRes.data[0] as { last_message_at?: string | null })
          .last_message_at ?? null)
      : null;

  const activitiesCount = activitiesRes.count ?? 0;
  const latestActivity =
    activitiesRes.data && activitiesRes.data.length > 0
      ? (activitiesRes.data[0] as {
          description?: string | null;
          created_at?: string | null;
        })
      : null;

  return {
    deals: {
      count: dealsCount,
      total_value: dealsTotal,
      latest_status: latestDealStatus,
    },
    conversations: {
      count: convsCount,
      last_message_at: lastMsgAt,
    },
    activities: {
      count: activitiesCount,
      latest_description: latestActivity?.description ?? null,
      latest_at: latestActivity?.created_at ?? null,
    },
  };
}

// ============================================================================
// Mutations — thin wrappers que injetam onLeadChanged + revalidatePath
// ============================================================================

// Helper: extrai valor do FormData distinguindo "campo não enviado"
// (`undefined`) de "campo enviado vazio" (`null`). FormData.get sempre
// retorna `null` pra keys ausentes, o que perde essa distincao — usamos
// `has` antes pra preservar a semantica do PATCH (so altera campos
// efetivamente enviados).
function fdField(formData: FormData, key: string): string | null | undefined {
  if (!formData.has(key)) return undefined;
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

/**
 * Cria um lead.
 *
 * PR-A LEADFIX: o auto-deal (que vivia aqui em PR-CRMOPS4) virou
 * trigger de DB (`lead_auto_deal` em migration 035). A garantia
 * "todo lead tem deal no Kanban" agora e invariante de banco —
 * vale pra qualquer caminho de criacao (action, webhook, n8n,
 * booking publico, importacao CSV, futuras integracoes).
 *
 * Aqui ficou apenas: requireRole + createLeadShared (UPSERT por
 * phone) + revalidatePath. O trigger faz o resto.
 */
export async function createLead(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) };

  // PR-A LEADFIX: normaliza phone (E.164) e email (lowercase trim)
  // ANTES do createLeadShared. Isso garante que o lookup de
  // duplicidade por phone funciona corretamente — sem isso, lead
  // criado pelo webhook UAZAPI ("+5511987654321") nao casa com lead
  // do form ("(11) 98765-4321") e vira duplicado.
  const rawPhone = fdField(formData, "phone");
  const rawEmail = fdField(formData, "email");

  const phoneResult = phoneBROptional.safeParse(rawPhone ?? undefined);
  if (!phoneResult.success) {
    throw new Error(phoneResult.error.issues[0]?.message ?? "Telefone inválido");
  }
  const emailResult = emailOptional.safeParse(rawEmail ?? undefined);
  if (!emailResult.success) {
    throw new Error("Email inválido");
  }

  const lead = await createLeadShared(ctx, {
    name: fdField(formData, "name"),
    phone: phoneResult.data ?? null,
    email: emailResult.data ?? null,
    source: (fdField(formData, "source") as string) || undefined,
    status: (fdField(formData, "status") as string) || undefined,
    channel: (fdField(formData, "channel") as string) || undefined,
  });

  // PR-K LEAD-SYNC: helper centralizado (substitui revalidatePath
  // espalhado). Padroniza paths invalidados em todas mutations.
  await revalidateLeadCaches(lead.id);
  return lead;
}

/**
 * Atualiza um lead. Aceita FormData (form basico do /leads/[id]/edit)
 * OU um objeto `UpdateLeadInput` (drawer "Informações do lead", Fase 2,
 * com endereço/notas/responsável/website).
 */
export async function updateLead(
  id: string,
  data: FormData | UpdateLeadInput,
) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) };

  const input: UpdateLeadInput =
    data instanceof FormData
      ? {
          name: fdField(data, "name"),
          phone: fdField(data, "phone"),
          email: fdField(data, "email"),
          source: (fdField(data, "source") as string) || undefined,
          status: (fdField(data, "status") as string) || undefined,
          channel: (fdField(data, "channel") as string) || undefined,
        }
      : data;

  const updated = await updateLeadShared(ctx, id, input);
  // PR-K LEAD-SYNC: helper centralizado
  await revalidateLeadCaches(id);
  return updated;
}

export async function deleteLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");
  await deleteLeadShared({ db: supabase, orgId }, id);
  // PR-K LEAD-SYNC: helper centralizado (lead deletado sai da lista
  // e do Kanban — invalida tudo, nao precisa /leads/:id pois rota
  // deixa de existir)
  await revalidateLeadCaches();
  return { success: true };
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await addTagToLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    leadId,
    tagId,
  );
  // PR-K LEAD-SYNC: helper centralizado
  await revalidateLeadCaches(leadId);
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await removeTagFromLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    leadId,
    tagId,
  );
  // PR-K LEAD-SYNC: helper centralizado
  await revalidateLeadCaches(leadId);
}

/**
 * PR-C: atribui um lead a um membro da org (responsável). Aceita
 * `userId` ou `null` (desatribuir). Wrapper fino em volta do
 * `updateLeadShared` que ja aceita `assigned_to` no UpdateLeadInput.
 *
 * Usado pelo card do Kanban (pill "Responsavel" virou dropdown).
 * Defesa multi-tenant + sync UAZAPI ja vem do shared.
 */
export async function assignLead(leadId: string, userId: string | null) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) };

  await updateLeadShared(ctx, leadId, {
    assigned_to: userId,
  });

  // PR-K LEAD-SYNC: helper centralizado (atribuicao reflete em
  // /crm Kanban + /leads lista + /leads/:id drawer)
  await revalidateLeadCaches(leadId);
  return { success: true };
}
