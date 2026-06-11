"use client";

import { useState } from "react";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { useOrganization } from "@/lib/hooks/use-organization";
import { Loader2 } from "lucide-react";
import type { ConversationWithLead } from "@/actions/conversations";

interface ChatPageClientProps {
  initialConversationId?: string | null;
  /** Passado pelo page.tsx SSR — elimina o spinner do useOrganization */
  orgId?: string;
  initialConversations?: ConversationWithLead[];
}

export function ChatPageClient({
  initialConversationId = null,
  orgId: propOrgId,
  initialConversations,
}: ChatPageClientProps) {
  // useOrganization ainda roda para casos sem SSR (fallback) e para ter
  // acesso ao objeto organization completo caso necessário no futuro.
  const { organization, loading } = useOrganization();

  const effectiveOrgId = propOrgId ?? organization?.id;

  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(initialConversationId);

  // Só bloqueia se não tiver orgId do servidor (fallback sem SSR).
  if (!propOrgId && loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!effectiveOrgId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Organização não encontrada
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-4rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden bg-[color:var(--chat-bg)]">
      {/* Left panel: Conversation List */}
      <div
        className={
          selectedConversationId
            ? "hidden h-full shrink-0 overflow-hidden border-r border-[color:var(--chat-sidebar-divider)] md:flex md:w-[380px] md:flex-col xl:w-[420px]"
            : "h-full w-full shrink-0 overflow-hidden border-r border-[color:var(--chat-sidebar-divider)] md:flex md:w-[380px] md:flex-col xl:w-[420px]"
        }
      >
        <ConversationList
          orgId={effectiveOrgId}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          initialConversations={initialConversations}
        />
      </div>

      {/* Right panel: Chat Window */}
      <div
        className={
          selectedConversationId
            ? "flex-1 h-full overflow-hidden flex flex-col"
            : "hidden flex-1 h-full overflow-hidden md:flex md:flex-col"
        }
      >
        <ChatWindow
          conversationId={selectedConversationId}
          orgId={effectiveOrgId}
          onBack={() => setSelectedConversationId(null)}
        />
      </div>
    </div>
  );
}
