"use client";

// PR-V1b: shell do modo "gerenciando cliente" agora monta os toasts
// globais de realtime (comentario novo + atribuicao). orgId vem do
// useActiveOrg() (Zustand store assinado por cookie superadmin) — NAO
// do JWT como o CRM cliente faz. Quando superadmin nao esta gerenciando
// cliente (isManagingClient=false), os hooks ficam com orgId=null e
// nao mountam canais.

import { AppSidebar } from "@/components/admin-sidebar";
import { ClientBanner } from "@/components/client-banner";
import { HeaderOrgBadge } from "@/components/header-org-badge";
import { HeaderUserMenu } from "@/components/header-user-menu";
import { clientNavigation, clientMobileItems } from "@/lib/constants/navigation";
import {
  useAssignmentToast,
  useCommentToast,
  useCurrentUser,
} from "@persia/leads-ui";
import { useActiveOrg } from "@/lib/stores/client-store";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function ClientShell({ children }: { children: React.ReactNode }) {
  // PR-V1b: realtime toasts globais — vivem enquanto o admin esta no
  // shell de cliente (qualquer rota interna). Mute global respeitado
  // pelos 2 (toggle no HeaderUserMenu).
  //   - useCommentToast: cap 60s/lead + filter assigned_to
  //   - useAssignmentToast: dispara na transicao assigned_to -> currentUser
  // Como superadmin raramente e "assigned_to" de um lead, na pratica o
  // 2o hook quase nunca dispara — mas e barato deixar montado (1 canal
  // postgres_changes filtrado por org).
  const supabase = getSupabaseBrowserClient();
  const { activeOrgId } = useActiveOrg();
  const currentUser = useCurrentUser(supabase);

  useCommentToast({
    supabase,
    orgId: activeOrgId,
    currentUserId: currentUser?.user_id ?? null,
  });
  useAssignmentToast({
    supabase,
    orgId: activeOrgId,
    currentUserId: currentUser?.user_id ?? null,
  });

  return (
    <>
      {/* Left sidebar - full CRM navigation */}
      <AppSidebar items={clientNavigation} mobileItems={clientMobileItems} brandAction="home" />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Banner when accessing client account */}
        <ClientBanner />

        {/* Header */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-0.5">
              <span className="text-sm font-bold tracking-tight text-foreground">Persia</span>
              <span className="text-sm font-bold tracking-tight text-primary">CRM</span>
            </div>
            <span className="text-[10px] text-muted-foreground">Modo conta</span>
          </div>
          <div className="flex items-center gap-3">
            <HeaderOrgBadge />
            <HeaderUserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">{children}</main>
      </div>
    </>
  );
}
