import { ChatPageClient } from "@/components/chat/chat-page-client";
import { requireRole } from "@/lib/auth";
import { getConversations } from "@/actions/conversations";

export const metadata = {
  title: "Chat ao Vivo",
};

type Props = {
  searchParams: Promise<{ c?: string }>;
};

export default async function ChatPage({ searchParams }: Props) {
  const { c } = await searchParams;

  // Prefetch no servidor: elimina o duplo waterfall client-side
  // (useOrganization → load → ConversationList → load).
  // Se falhar (sem sessão, erro de rede), renderiza sem dados iniciais
  // e o cliente faz o load normalmente.
  try {
    const { orgId } = await requireRole("agent");
    const { data: initialConversations } = await getConversations(orgId, { filter: "all" });
    return (
      <ChatPageClient
        initialConversationId={c ?? null}
        orgId={orgId}
        initialConversations={initialConversations ?? []}
      />
    );
  } catch {
    return <ChatPageClient initialConversationId={c ?? null} />;
  }
}
