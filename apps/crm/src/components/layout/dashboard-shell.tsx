"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { useCurrentOrgId } from "@/lib/realtime/use-current-org-id";
import {
  useAssignmentToast,
  useCommentToast,
  useCurrentUser,
} from "@persia/leads-ui";
import { createClient } from "@/lib/supabase/client";

const SOUND_KEY = "persia:chat:sound-enabled";
const DESKTOP_KEY = "persia:chat:desktop-notifications-enabled";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isChatPage = pathname === "/chat" || pathname === "/groups" || pathname.startsWith("/groups/");

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

  // Notificacao global de mensagens WhatsApp — ativa em qualquer rota
  // do dashboard (nao so /chat). Le preferencias do localStorage em
  // tempo real para respeitar o toggle do sino da conversation-list.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`global-msgs-notify:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${orgId}`,
        },
        async (payload: { new: Record<string, unknown> }) => {
          const msg = payload.new;
          if (msg.sender !== "lead") return;

          const soundOn = window.localStorage.getItem(SOUND_KEY) !== "false";
          const desktopOn = window.localStorage.getItem(DESKTOP_KEY) !== "false";

          if (soundOn) {
            try {
              const audio = new Audio("/sounds/notification.wav");
              audio.volume = 0.5;
              audio.play().catch(() => {});
            } catch {}
          }

          if (!desktopOn) return;

          let leadName = "Lead";
          try {
            const { data } = await supabase
              .from("conversations")
              .select("leads(name)")
              .eq("id", msg.conversation_id as string)
              .maybeSingle();
            const leads = data?.leads as { name?: string | null } | null;
            if (leads?.name) leadName = leads.name;
          } catch {}

          toast.info(`${leadName} lhe enviou uma mensagem`, {
            description: (msg.content as string | null)?.slice(0, 80) || "Mídia recebida",
            duration: 5000,
            action: msg.conversation_id
              ? {
                  label: "Abrir",
                  onClick: () => router.push(`/chat?conversationId=${msg.conversation_id}`),
                }
              : undefined,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, supabase, router]);

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
        <main id="main-content" className={`flex-1 ${isChatPage ? "overflow-hidden p-0" : "overflow-y-auto p-6 pb-[calc(1.5rem+4rem)] md:pb-6"}`}>
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
