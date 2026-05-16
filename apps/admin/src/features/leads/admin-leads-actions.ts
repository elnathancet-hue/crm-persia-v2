// Admin-side LeadsActions wiring.
//
// requireSuperadminForOrg() le orgId do cookie assinado (admin context)
// e devolve o admin (service-role) client. As actions abaixo embrulham
// o shape historico do admin (`{ data, error, count }`) no contrato
// canonico do @persia/leads-ui (`PaginatedLeadsResult`).

import type { LeadsActions, OrgTag } from "@persia/leads-ui";
import { createLead, getLeads } from "@/actions/leads";
import { getTags } from "@/actions/tags";
import {
  createLeadComment,
  deleteLeadComment,
  getLeadComments,
  updateLeadComment,
} from "@/actions/lead-comments";
import {
  addTagToLeadForDrawer,
  deleteLeadForDrawer,
  findOrCreateConversationByLead,
  getLeadAgentHandoffStateForDrawer,
  getLeadCustomFields,
  getLeadDealsList,
  getLeadForDrawer,
  getLeadStats,
  reactivateLeadAgentForDrawer,
  removeTagFromLeadForDrawer,
  setLeadCustomFieldValue,
  updateLeadForDrawer,
} from "@/actions/lead-detail-actions";
// PR-K-CENTRIC cleanup (mai/2026): admin agora opera lead-centric
// (igual ao CRM). Substitui getLeadOpenDealWithStages + updateDealStage
// (legacy) por getLeadStageContext + moveLeadStage + listPipelinesForLead
// + listStagesForPipeline + moveLeadToPipeline.
import {
  getLeadStageContext,
  listPipelinesForLead,
  listStagesForPipeline,
  moveLeadStage,
  moveLeadToPipeline,
} from "@/actions/leads-kanban";

export const adminLeadsActions: LeadsActions = {
  listLeads: async (filters) => {
    const result = await getLeads(filters);
    if (result.error) throw new Error(result.error);
    const total = result.count ?? 0;
    const limit = filters.limit ?? 20;
    return {
      leads: result.data ?? [],
      total,
      page: filters.page ?? 1,
      totalPages: Math.ceil(total / limit),
    };
  },
  createLead: async (formData) => {
    // Admin's createLead aceita objeto, nao FormData. Extrai os campos
    // que o LeadForm envia.
    const result = await createLead({
      name: (formData.get("name") as string) || "",
      phone: (formData.get("phone") as string) || undefined,
      email: (formData.get("email") as string) || undefined,
      source: (formData.get("source") as string) || undefined,
    });
    if (result.error) throw new Error(result.error);
    return result.data ? { id: result.data.id } : undefined;
  },
  getOrgTags: async () => {
    const tags = await getTags();
    return tags as OrgTag[];
  },
  // PR-S1: comentarios colaborativos — wire admin actions com
  // requireSuperadminForOrg. Service-role bypassa RLS; ainda checamos
  // organization_id manualmente como defesa em camada.
  getLeadComments,
  createLeadComment,
  updateLeadComment,
  deleteLeadComment,
  // PR-U1: drawer actions. Todas usam requireSuperadminForOrg +
  // service-role, com check explicito de organization_id como defesa
  // em camadas (alem do RLS que o service-role bypassa).
  getLead: getLeadForDrawer,
  updateLead: updateLeadForDrawer,
  deleteLead: deleteLeadForDrawer,
  getLeadStats,
  getLeadDealsList,
  // PR-K-CENTRIC cleanup (mai/2026): lead-centric stage/pipeline ops.
  getLeadStageContext,
  listPipelines: listPipelinesForLead,
  listStagesForPipeline,
  moveLeadStage: async (leadId, stageId, sortOrder) => {
    try {
      await moveLeadStage(leadId, stageId, sortOrder);
      return { data: undefined };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Erro ao mover etapa" };
    }
  },
  moveLeadToPipeline: async (leadId, pipelineId, stageId) => {
    try {
      await moveLeadToPipeline(leadId, pipelineId, stageId);
      return { data: undefined };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Erro ao trocar funil" };
    }
  },
  addTagToLead: addTagToLeadForDrawer,
  removeTagFromLead: removeTagFromLeadForDrawer,
  getLeadCustomFields,
  setLeadCustomFieldValue,
  findOrCreateConversationByLead,
  getLeadAgentHandoffState: getLeadAgentHandoffStateForDrawer,
  reactivateLeadAgent: reactivateLeadAgentForDrawer,
};
