"use client";

import { useState } from "react";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { useOrganization } from "@/lib/hooks/use-organization";
import { Loader2 } from "lucide-react";

export function ChatPageClient() {
  const { organization, loading } = useOrganization();
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

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
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left panel: Conversation List */}
      <div
        className={
          selectedConversationId
            ? "hidden w-80 shrink-0 h-full overflow-hidden md:flex md:flex-col border-r"
            : "w-full shrink-0 h-full overflow-hidden md:flex md:flex-col md:w-80 border-r"
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
