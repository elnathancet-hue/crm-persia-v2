"use client";

// PR-S3: monta toasts globais no admin quando esta em modo CLIENTE
// (acessando uma org especifica). Em modo ADMIN puro (lista de orgs),
// nao monta — nao ha contexto de org pra escutar.
//
// Hooks vivem em @persia/leads-ui (PR-S2). Aqui so injetamos:
//   - supabase: browser client do admin (com cookie do user)
//   - orgId: vem do useActiveOrg (cookie admin-context)
//   - currentUser: resolvido via useCurrentUser
//   - onNavigate: router.push pra rota admin equivalente
//
// Componente nao renderiza nada visual — so dispara os hooks. Vive
// dentro do <ClientShell> pra ter contexto correto.

import {
  useAssignmentToast,
  useCommentToast,
  useCurrentUser,
} from "@persia/leads-ui";
import { useRouter } from "next/navigation";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function AdminRealtimeMount() {
  const router = useRouter();
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const supabase = getSupabaseBrowserClient();
  const currentUser = useCurrentUser(
    isManagingClient ? supabase : null,
  );

  const navigateToLead = (leadId: string) => {
    // Admin nao tem rota /crm?tab=leads — vai direto pra /leads e
    // a lista abre o detalhe (setSelectedLeadId via state). V1:
    // navega pra /leads, user clica no card. Melhorias futuras
    // podem incluir deep link via query param.
    router.push(`/leads?focus=${encodeURIComponent(leadId)}`);
  };

  useCommentToast({
    supabase: isManagingClient ? supabase : null,
    orgId: isManagingClient ? activeOrgId : null,
    currentUserId: currentUser?.user_id ?? null,
    onNavigate: navigateToLead,
  });
  useAssignmentToast({
    supabase: isManagingClient ? supabase : null,
    orgId: isManagingClient ? activeOrgId : null,
    currentUserId: currentUser?.user_id ?? null,
    onNavigate: navigateToLead,
  });

  return null;
}
