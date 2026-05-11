// CRM-side LeadsActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/leads-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg.

import type { LeadsActions, OrgTag } from "@persia/leads-ui";
import {
  createLead,
  findLeadByPhoneOrEmail,
  getLeads,
  getOrgTags,
} from "@/actions/leads";
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
};
