"use client";

import { useState } from "react";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { useOrganization } from "@/lib/hooks/use-organization";
import { Loader2 } from "lucide-react";

interface ChatPageClientProps {
  initialConversationId?: string | null;
}

export function ChatPageClient({ initialConversationId = null }: ChatPageClientProps) {
  const { organization, loading } = useOrganization();
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(initialConversationId);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Organização não encontrada
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[color:var(--chat-bg)]">
      {/* Left panel: Conversation List */}
      <div
        className={
          selectedConversationId
            ? "hidden h-full shrink-0 overflow-hidden border-r border-[color:var(--chat-sidebar-divider)] md:flex md:w-[380px] md:flex-col xl:w-[420px]"
            : "h-full w-full shrink-0 overflow-hidden border-r border-[color:var(--chat-sidebar-divider)] md:flex md:w-[380px] md:flex-col xl:w-[420px]"
        }
      >
        <ConversationList
          orgId={organization.id}
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
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
          orgId={organization.id}
          onBack={() => setSelectedConversationId(null)}
        />
      </div>
    </div>
  );
}
