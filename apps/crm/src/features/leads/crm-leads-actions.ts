// CRM-side LeadsActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/leads-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg.

import type { LeadsActions, OrgTag } from "@persia/leads-ui";
import { createLead, getLeads, getOrgTags } from "@/actions/leads";

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
};
