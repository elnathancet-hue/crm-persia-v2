"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useAssignmentToast,
  useCommentToast,
  useCurrentUser,
} from "@persia/leads-ui";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useCurrentOrgId } from "@/lib/realtime/use-current-org-id";
import { createClient } from "@/lib/supabase/client";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isChatPage = pathname === "/chat";

  // PR-P/Q + PR-S2: 2 toasts globais. Hooks vivem em @persia/leads-ui;
  // injetamos supabase + onNavigate aqui. Mute global respeitado.
  // org/user resolution sao CRM-specific (useCurrentOrgId le de
  // organization_members; admin le de cookie).
  const supabase = createClient();
  const orgId = useCurrentOrgId();
  const currentUser = useCurrentUser(supabase);
  const navigateToLead = (leadId: string) =>
    router.push(`/crm?tab=leads&leadId=${encodeURIComponent(leadId)}`);
  useCommentToast({
    supabase,
    orgId,
    currentUserId: currentUser?.user_id ?? null,
    onNavigate: navigateToLead,
  });
  useAssignmentToast({
    supabase,
    orgId,
    currentUserId: currentUser?.user_id ?? null,
    onNavigate: navigateToLead,
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
