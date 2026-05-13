"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useCurrentOrgId } from "@/lib/realtime/use-current-org-id";
import {
  useAssignmentToast,
  useCommentToast,
  useCurrentUser,
} from "@persia/leads-ui";
import { createClient } from "@/lib/supabase/client";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChatPage = pathname === "/chat";

  // PR-P/Q: 2 toasts globais. Listeners vivem enquanto o user esta no
  // dashboard (qualquer rota). Mute global (PR-Q) respeitado pelos 2.
  //   - useCommentToast: cap 60s/lead + filter assigned_to
  //   - useAssignmentToast: dispara na transicao assigned_to -> currentUser
  const orgId = useCurrentOrgId();
  // PR-U2: useCurrentUser agora vem do @persia/leads-ui (DI supabase).
  const supabase = createClient();
  const currentUser = useCurrentUser(supabase);
  // PR-V1a: hooks agora vivem em @persia/leads-ui e recebem supabase
  // via DI. Mesmo client usado pelo useCurrentUser acima.
  useCommentToast({
    supabase,
    orgId,
    currentUserId: currentUser?.user_id ?? null,
  });
  useAssignmentToast({
    supabase,
    orgId,
    currentUserId: currentUser?.user_id ?? null,
  });

  return (
    <div className="flex h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md focus:text-sm"
      >
        Pular para o conteúdo
      </a>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main id="main-content" className={`flex-1 overflow-y-auto ${isChatPage ? "p-0" : "p-6"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
