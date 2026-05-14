"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@persia/ui";
import type { LeadFilters, LeadWithTags } from "@persia/shared/crm";
import {
  createLead as createLeadShared,
  deleteLead as deleteLeadShared,
  fetchLead,
  fetchLeadActivities,
  listLeads,
  updateLead as updateLeadShared,
} from "@persia/shared/crm";

// Re-exporta tipos canônicos. Admin não usa whatsapp_id/opt_in/metadata
// (são opcionais no tipo shared), então as queries existentes continuam
// compatíveis.
export type { LeadFilters, LeadWithTags };

function asErrorMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// `getLeads`, `getLeadDetail` e `getLeadActivities` sao thin wrappers
// em volta das queries compartilhadas. Auth via requireSuperadminForOrg;
// adaptamos o shape da resposta pro contrato historico do admin
// (`{ data, error, count }` em vez de throw).
export async function getLeads(filters: LeadFilters = {}) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const result = await listLeads({ db: admin, orgId }, filters);
    return { data: result.leads, error: null, count: result.total };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro desconhecido",
      count: 0,
    };
  }
}

export async function getLeadDetail(leadId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const { lead } = await fetchLead({ db: admin, orgId }, leadId);
    return { data: lead, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}

export async function createLead(data: { name: string; phone?: string; email?: string; source?: string }) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const lead = await createLeadShared({ db: admin, orgId }, {
      name: data.name,
      phone: data.phone,
      email: data.email,
      source: data.source,
      // Admin sempre criava com status="new" e channel="whatsapp" mesmo
      // se o input nao trazia — preserva esse comportamento aqui.
      status: "new",
      channel: "whatsapp",
    });
    revalidatePath("/leads");
    return { data: lead, error: null };
  } catch (err) {
    return { data: null, error: asErrorMessage(err) };
  }
}

// Sprint 3b: updateLead/deleteLead migram pra ActionResult canonico.
// Antes retornavam { error: null } | { error: string }.
export async function updateLead(
  leadId: string,
  updates: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateLeadShared({ db: admin, orgId }, leadId, updates as Record<string, never>);
    revalidatePath("/leads");
    return { data: { id: leadId } };
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível atualizar o lead.") };
  }
}

export async function deleteLead(
  leadId: string,
): Promise<ActionResult<{ success: true }>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deleteLeadShared({ db: admin, orgId }, leadId);
    revalidatePath("/leads");
    return { data: { success: true as const } };
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível excluir o lead.") };
  }
}

export async function getLeadActivities(leadId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const data = await fetchLeadActivities(
      { db: admin, orgId },
      leadId,
      { limit: 50 },
    );
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}
