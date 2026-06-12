/**
 * requireService — verifica se o módulo está habilitado para a organização.
 *
 * Chama requireRole("viewer") para obter orgId + supabase autenticado,
 * depois consulta organizations.services. Se o serviço estiver explicitamente
 * desabilitado (services[key] === false), redireciona para /dashboard.
 *
 * Usar em Server Components / layouts de rota protegida por tier de produto:
 *
 *   export default async function ChatPage() {
 *     await requireService("chat");
 *     return <ChatPageClient />;
 *   }
 */

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export async function requireService(service: string): Promise<void> {
  const { supabase, orgId } = await requireRole("viewer");

  const { data: org } = await supabase
    .from("organizations")
    .select("services")
    .eq("id", orgId)
    .maybeSingle();

  const services = (org?.services ?? {}) as Record<string, boolean>;

  // Bloqueia apenas se explicitamente false — null/undefined = acesso permitido
  // (safe default: orgs sem services configurados ficam com acesso total).
  if (services[service] === false) {
    redirect("/dashboard");
  }
}
