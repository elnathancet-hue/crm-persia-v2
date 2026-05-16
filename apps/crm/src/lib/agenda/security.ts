// Helpers de seguranca multi-tenant da Agenda.
//
// PR-AGENDA-SEC (mai/2026): extraidos pra modulo proprio porque server
// actions (`"use server"`) so podem exportar funcoes async — testar
// helper sincrono inline ficaria impossivel.

/**
 * Recusa que agent/viewer criem ou reagendem appointment atribuindo a
 * outro responsavel (user_id != caller). Admin/owner podem delegar
 * livre.
 *
 * Por que: antes do fix, qualquer agent podia passar `user_id` no
 * `createAppointment` ou `new_user_id` no `rescheduleAppointment` e
 * o sistema aceitava — criava appointment com outro agente como dono,
 * roubando agenda alheia.
 *
 * Comportamento:
 *   - inputUserId undefined ou null → permite (default = caller)
 *   - inputUserId === currentUserId → permite
 *   - role "admin" ou "owner" → permite qualquer user_id (delegacao)
 *   - role "agent" ou "viewer" com user_id diferente → throw
 *
 * Throw em vez de retornar boolean pra forcar caller a tratar o erro
 * — silencioso seria pior que loud.
 */
export function ensureCanActOnUser(
  inputUserId: string | undefined | null,
  currentUserId: string,
  role: string,
): void {
  if (!inputUserId || inputUserId === currentUserId) return;
  if (role === "admin" || role === "owner") return;
  throw new Error(
    "Apenas admin ou dono podem agendar/reagendar para outro responsavel.",
  );
}
