import { requireAdminPageAccess } from "@/lib/guards/require-admin";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPageAccess();
  return <SettingsNav>{children}</SettingsNav>;
}
