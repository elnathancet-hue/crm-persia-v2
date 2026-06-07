import { requireModulePageAccess } from "@/lib/guards/require-admin";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireModulePageAccess("reports");
  return <>{children}</>;
}
