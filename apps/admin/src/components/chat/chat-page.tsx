"use client";

import { useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { MessageSquare } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { ErrorBoundary } from "@/components/error-boundary";

export function ChatPage() {
  const { isManagingClient } = useActiveOrg();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-3rem)] overflow-hidden -m-6">
      {/* Left: Conversation List */}
      <div
        className={
          selectedConversationId
            ? "hidden w-80 shrink-0 h-full overflow-hidden md:flex md:flex-col border-r border-border"
            : "w-full shrink-0 h-full overflow-hidden md:flex md:flex-col md:w-80 border-r border-border"
        }
      >
        <ErrorBoundary>
          <ConversationList
            selectedId={selectedConversationId}
            onSelect={setSelectedConversationId}
          />
        </ErrorBoundary>
      </div>

      {/* Right: Chat Window */}
      <div
        className={
          selectedConversationId
            ? "flex-1 h-full overflow-hidden flex flex-col"
            : "hidden flex-1 h-full overflow-hidden md:flex md:flex-col"
        }
      >
        {selectedConversationId ? (
          <ErrorBoundary
            key={selectedConversationId}
          >
            <ChatWindow
              conversationId={selectedConversationId}
              onBack={() => setSelectedConversationId(null)}
            />
          </ErrorBoundary>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/60">
            <div className="text-center space-y-2">
              <MessageSquare className="size-10 mx-auto text-muted-foreground/30" />
              <p>Selecione uma conversa</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
