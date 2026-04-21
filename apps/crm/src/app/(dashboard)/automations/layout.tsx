import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function AutomationsLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPageAccess();
  return <>{children}</>;
}
