import { requireModulePageAccess } from "@/lib/guards/require-admin";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await requireModulePageAccess("crm");
  return <>{children}</>;
}
