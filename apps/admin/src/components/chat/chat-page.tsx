"use client";

import { useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { LeadInfoPanel } from "@/components/chat/lead-info-panel";
import { Info, MessageSquare } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { ErrorBoundary } from "@/components/error-boundary";

export function ChatPage() {
  const { isManagingClient } = useActiveOrg();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [showLeadPanel, setShowLeadPanel] = useState(false);

  const handleSelectConversation = (id: string | null) => {
    setSelectedConversationId(id);
    if (!id) {
      setActiveLeadId(null);
      setShowLeadPanel(false);
    }
  };

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
            onSelect={handleSelectConversation}
          />
        </ErrorBoundary>
      </div>

      {/* Center: Chat Window */}
      <div
        className={
          selectedConversationId
            ? "flex-1 h-full overflow-hidden flex flex-col min-w-0"
            : "hidden flex-1 h-full overflow-hidden md:flex md:flex-col"
        }
      >
        {selectedConversationId ? (
          <ErrorBoundary key={selectedConversationId}>
            <div className="flex flex-col h-full relative">
              {activeLeadId && (
                <button
                  onClick={() => setShowLeadPanel((v) => !v)}
                  title="Info do lead"
                  className={[
                    "absolute top-3 right-12 z-10 size-7 flex items-center justify-center rounded-md transition-colors hidden lg:flex",
                    showLeadPanel ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  <Info className="size-4" />
                </button>
              )}
              <ChatWindow
                conversationId={selectedConversationId}
                onBack={() => handleSelectConversation(null)}
                onLeadId={(id) => setActiveLeadId(id)}
              />
            </div>
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

      {showLeadPanel && activeLeadId && (
        <div className="hidden lg:flex h-full">
          <LeadInfoPanel
            leadId={activeLeadId}
            onClose={() => setShowLeadPanel(false)}
          />
        </div>
      )}
    </div>
  );
}
