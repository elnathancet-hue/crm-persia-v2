import { createClient } from "@/lib/supabase-server";
import { getAdmin } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";
import { readAdminContext } from "@/lib/admin-context";
import { ShellSwitcher } from "@/components/shell-switcher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Verify superadmin
  const admin = getAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_superadmin) redirect("/login");

  // Read signed admin context cookie to determine shell mode
  const adminContext = await readAdminContext();
  const shellMode = adminContext ? "client" : "admin";

  // Fetch client org name when in client mode
  let clientOrgId: string | null = null;
  let clientOrgName: string | null = null;
  if (adminContext) {
    clientOrgId = adminContext.orgId;
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", adminContext.orgId)
      .single();
    clientOrgName = org?.name || null;
  }

  return (
    <div className="flex h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-2 focus:left-2 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm">
        Pular para o conteudo
      </a>

      <ShellSwitcher mode={shellMode} clientOrgId={clientOrgId} clientOrgName={clientOrgName}>
        {children}
      </ShellSwitcher>
    </div>
  );
}
