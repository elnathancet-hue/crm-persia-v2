import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function GroupsLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPageAccess();
  return <>{children}</>;
}
