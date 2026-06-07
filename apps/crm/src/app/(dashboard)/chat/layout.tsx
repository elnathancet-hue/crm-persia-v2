import { requireModulePageAccess } from "@/lib/guards/require-admin";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  await requireModulePageAccess("chat");
  return <>{children}</>;
}
