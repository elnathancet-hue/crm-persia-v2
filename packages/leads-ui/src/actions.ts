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

/**
 * PR-L5: shape do match de duplicidade. UI exibe banner com nome +
 * canal que bateu (phone ou email). Definido aqui pra evitar
 * dependencia cruzada (packages/leads-ui nao importa de apps/crm).
 */
export interface DuplicateMatch {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  matched_by: "phone" | "email";
}

export interface LeadsActions {
  /** Lista paginada com filtros (search/status/tags). */
  listLeads: (filters: LeadFilters) => Promise<PaginatedLeadsResult>;
  /** Cria lead a partir do FormData do <LeadForm>. */
  createLead: (formData: FormData) => Promise<{ id: string } | void>;
  /** Tags do org (pra filtros chip). */
  getOrgTags: () => Promise<OrgTag[]>;
  /**
   * PR-L5: lookup de duplicidade ao criar lead. Opcional pra
   * retro-compat — admin pode nao implementar (degrada graciosamente,
   * banner nao aparece).
   */
  findDuplicate?: (
    phone?: string | null,
    email?: string | null,
  ) => Promise<DuplicateMatch | null>;
}
