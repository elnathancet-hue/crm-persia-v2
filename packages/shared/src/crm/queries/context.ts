// Contexto que toda query do CRM aceita.
//
// Cada app (apps/crm = client, apps/admin = superadmin) tem seu proprio
// fluxo de auth (requireRole vs requireSuperadminForOrg) e seu proprio
// supabase client (anon-key com RLS vs service-role sem RLS). As queries
// shared NAO sabem disso — recebem um `db` qualquer (que precisa expor
// `.from(table)`) e o `orgId` ja resolvido pelo wrapper do app.
//
// Como service-role bypassa RLS, todas as queries shared fazem
// `.eq("organization_id", orgId)` EXPLICITO em cada select. Defesa em
// profundidade que funciona pros dois caminhos de auth.

export interface CrmQueryDb {
  from: (table: string) => any;
}

export interface CrmQueryContext {
  db: CrmQueryDb;
  orgId: string;
}
