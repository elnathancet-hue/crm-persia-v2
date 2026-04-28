// Dependency injection for Leads UI.
//
// Each app (crm, admin) constructs a concrete LeadsActions object pointing
// to its own server actions and passes it into <LeadsProvider>. The
// shared components never import server actions directly — they pull the
// bag through `useLeadsActions()`.

import type { LeadFilters, LeadWithTags } from "@persia/shared/crm";

export interface PaginatedLeadsResult {
  leads: LeadWithTags[];
  total: number;
  page: number;
  totalPages: number;
}

export interface OrgTag {
  id: string;
  name: string;
  color: string;
  organization_id: string;
  created_at: string;
}

export interface LeadsActions {
  /** Lista paginada com filtros (search/status/tags). */
  listLeads: (filters: LeadFilters) => Promise<PaginatedLeadsResult>;
  /** Cria lead a partir do FormData do <LeadForm>. */
  createLead: (formData: FormData) => Promise<{ id: string } | void>;
  /** Tags do org (pra filtros chip). */
  getOrgTags: () => Promise<OrgTag[]>;
}
