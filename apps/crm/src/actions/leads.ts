"use server";

import { requireRole } from "@/lib/auth";
import { revalidateLeadCaches } from "@/lib/cache/lead-revalidation";
import type { ActionResult } from "@persia/ui";
import type {
  LeadFilters,
  LeadWithTags,
  UpdateLeadInput,
} from "@persia/shared/crm";
import {
  addTagToLead as addTagToLeadShared,
  createLead as createLeadShared,
  deleteLead as deleteLeadShared,
  fetchLead,
  fetchLeadDealsList,
  fetchLeadStats,
  listLeads,
  listOrgActivities,
  listTags,
  removeTagFromLead as removeTagFromLeadShared,
  updateLead as updateLeadShared,
  type LeadDealItem,
  type LeadStats,
  type ListOrgActivitiesOptions,
} from "@persia/shared/crm";
import { phoneBROptional, emailOptional } from "@persia/shared/validation";

// Re-export de tipos REMOVIDO (mai/2026): Turbopack em arquivos
// "use server" trata todo export como server action — types geram
// "Export X doesn't exist" no actions.js compilado. Tipos canônicos
// estão em @persia/shared/crm; consumir direto de lá.

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

function asErrorMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ============================================================================
// Queries (read-only) — thin wrappers em volta de @persia/shared/crm
// ============================================================================

export async function getLeads(filters: LeadFilters = {}) {
  const { supabase, orgId } = await requireRole("agent");
  return listLeads({ db: supabase, orgId }, filters);
}

// ============================================================================
// Exportacao com filtros (PR Export+Filters)
// ============================================================================

/**
 * Conta quantos leads bateriam nos filtros — usado pra preview no Dialog
 * "Exportar leads" antes do download. Sem limit = count sobre o universo
 * todo (ate o cap do DB de 1M+).
 */
export async function countLeadsForExport(filters: LeadFilters = {}): Promise<number> {
  const { supabase, orgId } = await requireRole("agent");
  // Reutiliza listLeads forçando limit=1 page=1 — usamos so o `total`
  // (count exato vem do { count: "exact" } da query)
  const { total } = await listLeads(
    { db: supabase, orgId },
    { ...filters, page: 1, limit: 1 },
  );
  return total;
}

/**
 * Busca TODOS os leads que batem nos filtros, paginando em chunks de 1000.
 * Usado pelo Dialog Exportar quando o usuario confirma. Sem cap fixo —
 * em prod, expectativa eh ate ~10k leads por org. Loop interno protege
 * contra paginas vazias.
 *
 * Retorna array completo de LeadWithTags (caller transforma em CSV/XLSX
 * client-side via @persia/crm-ui ExportMenu / xlsx lib).
 */
export async function fetchLeadsForExport(
  filters: LeadFilters = {},
): Promise<LeadWithTags[]> {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId };
  const PAGE_SIZE = 1000;
  const all: LeadWithTags[] = [];
  let page = 1;
  // Hard cap defensivo: 100 paginas = 100k leads. Improvavel atingir,
  // mas evita loop infinito por bug.
  const MAX_PAGES = 100;
  while (page <= MAX_PAGES) {
    const result = await listLeads(ctx, {
      ...filters,
      page,
      limit: PAGE_SIZE,
    });
    all.push(...result.leads);
    if (result.leads.length < PAGE_SIZE) break;
    page += 1;
  }
  return all;
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
 * PR-L5: lookup async pra detectar duplicidade de lead na criacao.
 *
 * Usado pelo LeadForm quando agente preenche phone OU email — busca
 * lead existente na MESMA org com match exato. Se encontra, UI mostra
 * banner "Lead ja existe: ... [Reutilizar] [Criar mesmo assim]".
 *
 * NORMALIZACAO:
 *   - phone: phoneBROptional.safeParse normaliza pra E.164 antes da query
 *     (resolve "11987654321" vs "+5511987654321" — mesma fonte de verdade
 *     do PR-A LEADFIX)
 *   - email: emailOptional normaliza lowercase + trim
 *
 * MATCH:
 *   - Exato (eq, nao ilike). Parcial vira PR proprio se user pedir.
 *   - Tenta phone primeiro (mais comum em WhatsApp), depois email.
 *   - Retorna o PRIMEIRO encontrado (limit 1).
 *   - null se nenhum match OU se ambos vierem vazios/invalidos.
 *
 * MULTI-TENANT:
 *   - requireRole("agent") + .eq("organization_id", orgId)
 *   - Privacidade: agente VE leads da propria org (RLS ja garante).
 *     Banner com nome NAO vaza pra outras orgs.
 *
 * RETRO-COMPAT: action nova, nao quebra nada existente.
 */
export interface DuplicateMatch {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Em qual canal o match foi feito — pra UI mostrar "phone igual" ou "email igual". */
  matched_by: "phone" | "email";
}

export async function findLeadByPhoneOrEmail(
  phone?: string | null,
  email?: string | null,
): Promise<DuplicateMatch | null> {
  // Early return se ambos vazios — nao gasta query
  const phoneTrimmed = (phone ?? "").trim();
  const emailTrimmed = (email ?? "").trim();
  if (!phoneTrimmed && !emailTrimmed) return null;

  const { supabase, orgId } = await requireRole("agent");

  // Tenta PHONE primeiro (mais discriminante em CRM WhatsApp-first)
  if (phoneTrimmed) {
    const phoneResult = phoneBROptional.safeParse(phoneTrimmed);
    const normalizedPhone = phoneResult.success ? phoneResult.data : undefined;
    if (normalizedPhone) {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, email")
        .eq("organization_id", orgId)
        .eq("phone", normalizedPhone)
        .limit(1)
        .maybeSingle();
      if (data) {
        return {
          id: data.id as string,
          name: (data.name as string | null) ?? null,
          phone: (data.phone as string | null) ?? null,
          email: (data.email as string | null) ?? null,
          matched_by: "phone",
        };
      }
    }
  }

  // Fallback: tenta EMAIL
  if (emailTrimmed) {
    const emailResult = emailOptional.safeParse(emailTrimmed);
    const normalizedEmail = emailResult.success ? emailResult.data : undefined;
    if (normalizedEmail) {
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, email")
        .eq("organization_id", orgId)
        .eq("email", normalizedEmail)
        .limit(1)
        .maybeSingle();
      if (data) {
        return {
          id: data.id as string,
          name: (data.name as string | null) ?? null,
          phone: (data.phone as string | null) ?? null,
          email: (data.email as string | null) ?? null,
          matched_by: "email",
        };
      }
    }
  }

  return null;
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
 *
 * PR-S5: implementacao movida pra packages/shared/src/crm/queries/
 * lead-stats.ts. Aqui so wrappa requireRole + ctx.
 */
// (export type { LeadStats, LeadDealItem } removido — Turbopack em
// "use server" tenta exportar types como server action e quebra.
// Consumidores devem importar de @persia/shared/crm direto.)
export async function getLeadStats(leadId: string): Promise<LeadStats> {
  const { supabase, orgId } = await requireRole("agent");
  return fetchLeadStats({ db: supabase, orgId }, leadId);
}

/**
 * PR-L2: lista de deals do lead pra tab Negocios do drawer.
 * PR-S5: implementacao em packages/shared/src/crm/queries/lead-stats.ts.
 */
export async function getLeadDealsList(
  leadId: string,
): Promise<LeadDealItem[]> {
  const { supabase, orgId } = await requireRole("agent");
  return fetchLeadDealsList({ db: supabase, orgId }, leadId);
}

/**
 * PR-L3: stats em BATCH pra Tab Leads enriquecida.
 *
 * Recebe lista de leadIds (paginados, normalmente 20 por vez) e
 * retorna um Map<leadId, LeadListItemStats> com 4 categorias de
 * dados por linha:
 *   - Deals: count abertos + valor total dos abertos + etapa do
 *     deal aberto mais recente (com nome + cor + outcome)
 *   - Activities: count + descricao da ultima
 *   - Conversations: count + ultima mensagem
 *   - Assignee: ja vem no LeadWithTags (campo assignee no embed)
 *
 * PERFORMANCE (briefing user — "nao pode falhar"):
 *   - 3 queries em PARALELO (Promise.all)
 *   - Cada query usa .in("lead_id", leadIds) — uma chamada por
 *     categoria, nao N por linha (evita N+1 explicito)
 *   - Aggregation client-side via Map<leadId, ...>
 *   - Cap defensivo: se leadIds.length > 200, abandona stats e
 *     retorna Map vazio (lista degrada graciosamente — sem stats
 *     mas continua renderizando)
 *
 * MULTI-TENANT:
 *   - Todas as 3 queries filtram por organization_id = orgId
 *   - Lead lookup nao precisa (leadIds ja vem da prop dos leads
 *     visiveis pro caller, scoped pelo org)
 *
 * UPGRADE FUTURO:
 *   - Quando tiver coluna "Conversas" na lista, adicionar
 *     conversations no shape (ja preparado, so descomentar)
 *   - Quando tiver flag "AI ativo/pausado" por lead, adicionar
 *     query de agent_runs ou conversations.assigned_to
 */
export interface LeadListItemStats {
  deals: {
    open_count: number;
    open_total_value: number;
    /** Etapa do deal aberto mais recente (created_at DESC). null se 0 abertos. */
    latest_open_stage: {
      id: string;
      name: string;
      color: string;
    } | null;
  };
  activities: {
    count: number;
    /** Descricao da ultima activity (truncada client-side). */
    latest_description: string | null;
  };
  conversations: {
    count: number;
    /** Ultimo last_message_at (ISO). Pra futuro: "ha 2h". */
    last_message_at: string | null;
  };
}

export async function getLeadsListStats(
  leadIds: string[],
): Promise<Map<string, LeadListItemStats>> {
  const result = new Map<string, LeadListItemStats>();
  if (leadIds.length === 0) return result;

  // Cap defensivo — paginacao default e 20, mas alguns callers podem
  // mandar mais. Se vier muito alem, degrada (lista renderiza sem
  // stats — melhor que travar query).
  if (leadIds.length > 200) {
    console.warn(
      "[getLeadsListStats] leadIds.length > 200, skipping stats batch",
    );
    return result;
  }

  const { supabase, orgId } = await requireRole("agent");

  // Defesa: inicializa shape vazio pra todos leadIds (UI pode
  // assumir que toda key existe mesmo se nao houver registros)
  for (const id of leadIds) {
    result.set(id, {
      deals: {
        open_count: 0,
        open_total_value: 0,
        latest_open_stage: null,
      },
      activities: { count: 0, latest_description: null },
      conversations: { count: 0, last_message_at: null },
    });
  }

  // 3 queries em paralelo (Promise.all). Cada uma traz so o suficiente.
  const [dealsRes, activitiesRes, conversationsRes] = await Promise.all([
    // DEALS abertos com etapa info
    supabase
      .from("deals")
      .select(
        "lead_id, value, status, created_at, " +
          "pipeline_stages!inner(id, name, color)",
      )
      .eq("organization_id", orgId)
      .eq("status", "open")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false }),
    // ACTIVITIES (todas, agrupa client-side)
    supabase
      .from("lead_activities")
      .select("lead_id, description, created_at")
      .eq("organization_id", orgId)
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false }),
    // CONVERSATIONS (todas, agrupa client-side)
    supabase
      .from("conversations")
      .select("lead_id, last_message_at")
      .eq("organization_id", orgId)
      .in("lead_id", leadIds)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
  ]);

  // Agrupa deals por lead_id (1 lead pode ter N deals abertos)
  type DealRow = {
    lead_id: string;
    value: number;
    status: string;
    created_at: string;
    pipeline_stages: { id: string; name: string; color: string | null } | null;
  };
  const dealsRows = (dealsRes.data ?? []) as unknown as DealRow[];
  for (const row of dealsRows) {
    const stat = result.get(row.lead_id);
    if (!stat) continue;
    stat.deals.open_count += 1;
    stat.deals.open_total_value += Number(row.value ?? 0);
    // Primeiro encontrado = mais recente (query ordenada DESC)
    if (!stat.deals.latest_open_stage && row.pipeline_stages) {
      stat.deals.latest_open_stage = {
        id: row.pipeline_stages.id,
        name: row.pipeline_stages.name,
        color: row.pipeline_stages.color ?? "#888",
      };
    }
  }

  // Agrupa activities (count + ultima descricao)
  type ActivityRow = {
    lead_id: string;
    description: string | null;
    created_at: string;
  };
  const actRows = (activitiesRes.data ?? []) as unknown as ActivityRow[];
  for (const row of actRows) {
    const stat = result.get(row.lead_id);
    if (!stat) continue;
    stat.activities.count += 1;
    if (!stat.activities.latest_description && row.description) {
      stat.activities.latest_description = row.description;
    }
  }

  // Agrupa conversations (count + ultima msg)
  type ConvRow = { lead_id: string; last_message_at: string | null };
  const convRows = (conversationsRes.data ?? []) as unknown as ConvRow[];
  for (const row of convRows) {
    const stat = result.get(row.lead_id);
    if (!stat) continue;
    stat.conversations.count += 1;
    if (!stat.conversations.last_message_at && row.last_message_at) {
      stat.conversations.last_message_at = row.last_message_at;
    }
  }

  return result;
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
// Sprint 3b: updateLead/deleteLead migram pra ActionResult.
// Antes lancavam exception em erro (causando "Application error" digest
// em tela branca quando a UI nao tinha try/catch). Agora retornam
// { error: PT-BR } padronizado.
export async function updateLead(
  id: string,
  data: FormData | UpdateLeadInput,
): Promise<ActionResult<{ id: string }>> {
  try {
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
    return { data: { id: (updated as { id: string }).id } };
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível atualizar o lead.") };
  }
}

export async function deleteLead(
  id: string,
): Promise<ActionResult<{ success: true }>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    await deleteLeadShared({ db: supabase, orgId }, id);
    // PR-K LEAD-SYNC: helper centralizado (lead deletado sai da lista
    // e do Kanban — invalida tudo, nao precisa /leads/:id pois rota
    // deixa de existir)
    await revalidateLeadCaches();
    return { data: { success: true as const } };
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível excluir o lead.") };
  }
}

// Sprint 3d: addTagToLead/removeTagFromLead migram pra ActionResult.
export async function addTagToLead(
  leadId: string,
  tagId: string,
): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    await addTagToLeadShared(
      { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
      leadId,
      tagId,
    );
    // PR-K LEAD-SYNC: helper centralizado
    await revalidateLeadCaches(leadId);
    return;
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível adicionar a tag.") };
  }
}

export async function removeTagFromLead(
  leadId: string,
  tagId: string,
): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    await removeTagFromLeadShared(
      { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
      leadId,
      tagId,
    );
    // PR-K LEAD-SYNC: helper centralizado
    await revalidateLeadCaches(leadId);
    return;
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível remover a tag.") };
  }
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

// ============================================================================
// PR-L4: Bulk operations (atribuir / deletar em massa)
// ----------------------------------------------------------------------------
// Cap defensivo BULK_LEAD_CAP=200 (alinhado com BULK_CAP do KanbanBoard).
// Multi-tenant em camadas:
//   - requireRole("agent")
//   - .eq("organization_id", orgId) no UPDATE/DELETE
//   - Se userId fornecido (assign), valida que e membro ATIVO da org
//
// Sem activity log per-lead (overhead em massa). Activity unica
// agregada pode ser feature futura se user pedir.
//
// revalidate via helper centralizado (PR-K) — invalida /crm + /leads.
// ============================================================================

const BULK_LEAD_CAP = 200;

/**
 * PR-L4: atribui um responsavel (ou desatribui com null) pra
 * multiplos leads de uma vez. Cap 200 por chamada.
 *
 * Validacoes:
 *   - leadIds.length > 0 e <= BULK_LEAD_CAP
 *   - Se userId nao for null, valida que e membro ATIVO da org
 *     (defesa contra atribuir lead a user de outra org)
 *
 * Performance: 1 UPDATE com `.in("id", leadIds)` — sem N+1.
 * Retorna count de leads atualizados (server-side).
 */
export async function bulkAssignLeads(
  leadIds: string[],
  userId: string | null,
): Promise<{ updated_count: number }> {
  const { supabase, orgId } = await requireRole("agent");

  if (leadIds.length === 0) return { updated_count: 0 };
  if (leadIds.length > BULK_LEAD_CAP) {
    throw new Error(
      `Máximo ${BULK_LEAD_CAP} leads por operação em massa.`,
    );
  }

  // Defesa: se userId fornecido, valida membership na org
  if (userId !== null) {
    const { data: member } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) {
      throw new Error(
        "Usuário não é membro ativo desta organização",
      );
    }
  }

  // Bulk UPDATE — `.eq("organization_id", orgId)` garante que so
  // leads da org do caller sao tocados (defesa em camadas, mesmo
  // que leadIds venha "envenenado" do client)
  const { data, error } = await supabase
    .from("leads")
    .update({
      assigned_to: userId,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("organization_id", orgId)
    .in("id", leadIds)
    .select("id");

  if (error) throw new Error(error.message);

  await revalidateLeadCaches();
  return { updated_count: data?.length ?? 0 };
}

/**
 * PR-L4: deleta multiplos leads de uma vez. Cap 200 por chamada.
 *
 * IMPORTANTE: deletar lead CASCADE deleta deals/activities/conversations
 * vinculados (FK ON DELETE CASCADE). UI deve confirmar via AlertDialog
 * antes de chamar (caller responsibility — actions sao "burras").
 *
 * Performance: 1 DELETE com `.in("id", leadIds)`.
 */
export async function bulkDeleteLeads(
  leadIds: string[],
): Promise<{ deleted_count: number }> {
  const { supabase, orgId } = await requireRole("agent");

  if (leadIds.length === 0) return { deleted_count: 0 };
  if (leadIds.length > BULK_LEAD_CAP) {
    throw new Error(
      `Máximo ${BULK_LEAD_CAP} leads por operação em massa.`,
    );
  }

  const { data, error } = await supabase
    .from("leads")
    .delete()
    .eq("organization_id", orgId)
    .in("id", leadIds)
    .select("id");

  if (error) throw new Error(error.message);

  await revalidateLeadCaches();
  return { deleted_count: data?.length ?? 0 };
}
