// Contexto que toda query/mutation da Agenda aceita.
//
// Mesmo padrao do crm/queries/context: cada app (apps/crm anon-key+RLS,
// apps/admin service-role) injeta `db` + `orgId`. Defesa em profundidade
// — mesmo no admin (sem RLS), todas as queries fazem
// `.eq("organization_id", orgId)` EXPLICITO.
//
// Mutations adicionalmente recebem `userId` pra carimbar
// `appointment_history.performed_by_user_id` (rastreabilidade).

export interface AgendaQueryDb {
  from: (table: string) => any;
}

export interface AgendaQueryContext {
  db: AgendaQueryDb;
  orgId: string;
}

export interface AgendaMutationContext extends AgendaQueryContext {
  /** auth.uid() do usuario que disparou a acao. Null = automacao/cron. */
  userId: string | null;
  /** 'agent'|'admin'|'owner'|'lead'|'system'. Default 'agent' nas actions. */
  performedByRole?: "agent" | "admin" | "owner" | "lead" | "system";
}
