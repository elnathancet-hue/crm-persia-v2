import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function FlowsLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPageAccess();
  return <>{children}</>;
}
