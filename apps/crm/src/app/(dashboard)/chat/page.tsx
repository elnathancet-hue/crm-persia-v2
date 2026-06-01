import { ChatPageClient } from "@/components/chat/chat-page-client";

export const metadata = {
  title: "Chat ao Vivo",
};

type Props = {
  searchParams: Promise<{ c?: string }>;
};

export default async function ChatPage({ searchParams }: Props) {
  const { c } = await searchParams;
  return <ChatPageClient initialConversationId={c ?? null} />;
}
