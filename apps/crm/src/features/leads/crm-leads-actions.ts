// CRM-side LeadsActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/leads-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg.

import type { LeadsActions, OrgTag } from "@persia/leads-ui";
import {
  addTagToLead,
  createLead,
  deleteLead,
  findLeadByPhoneOrEmail,
  getLead,
  getLeadDealsList,
  getLeads,
  getLeadStats,
  getOrgTags,
  removeTagFromLead,
  updateLead,
} from "@/actions/leads";
import {
  getLeadOpenDealWithStages,
  updateDealStage,
} from "@/actions/crm";
import {
  getLeadCustomFields,
  setLeadCustomFieldValue,
} from "@/actions/custom-fields";
import { findOrCreateConversationByLead } from "@/actions/conversations";
import {
  getLeadAgentHandoffState,
  reactivateAgent,
} from "@/actions/ai-agent/reactivate";
import {
  createLeadComment,
  deleteLeadComment,
  getLeadComments,
  updateLeadComment,
} from "@/actions/lead-comments";

export const crmLeadsActions: LeadsActions = {
  listLeads: async (filters) => {
    const result = await getLeads(filters);
    return {
      leads: result.leads,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
    };
  },
  createLead: async (formData) => {
    const lead = await createLead(formData);
    return lead ? { id: lead.id } : undefined;
  },
  getOrgTags: async () => {
    const tags = await getOrgTags();
    return tags as OrgTag[];
  },
  // PR-L5: lookup de duplicidade. Multi-tenant ja vem do
  // requireRole("agent") da action (orgId scoping).
  findDuplicate: (phone, email) => findLeadByPhoneOrEmail(phone, email),
  // PR-S1: comentarios colaborativos — server actions ja existem
  // (PR-M) com requireRole("agent") + RLS. Apenas re-exportadas.
  getLeadComments,
  createLeadComment,
  updateLeadComment,
  deleteLeadComment,
  // PR-U1: actions usadas pelo LeadInfoDrawer (extracao em PR-U2).
  // Todas com requireRole("agent") + multi-tenant via orgId.
  getLead,
  updateLead: async (leadId, data) => {
    const updated = await updateLead(leadId, data);
    return updated ? { id: updated.id } : undefined;
  },
  deleteLead,
  getLeadStats,
  getLeadDealsList,
  getLeadOpenDealWithStages,
  updateDealStage: async (dealId, stageId) => {
    // CRM action retorna mais data (UAZAPI sync etc); aqui devolve void
    // pra alinhar com a interface (caller so precisa saber que rodou).
    await updateDealStage(dealId, stageId);
  },
  addTagToLead,
  removeTagFromLead,
  getLeadCustomFields,
  setLeadCustomFieldValue,
  findOrCreateConversationByLead,
  getLeadAgentHandoffState,
  reactivateLeadAgent: reactivateAgent,
};
