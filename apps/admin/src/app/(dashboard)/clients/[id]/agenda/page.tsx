import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { setAdminContext } from "@/lib/admin-context";
import { requireSuperadminForOrg } from "@/lib/auth";
import { getAppointments } from "@/actions/agenda/appointments";
import { getAgendaServices } from "@/actions/agenda/services";
import { getOrgMeta } from "@/actions/agenda/org";
import { AdminAgendaPageClient } from "./agenda-page-client";

export const metadata = { title: "Agenda do cliente" };

interface RouteProps {
  params: Promise<{ id: string }>;
}

function defaultRange() {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default async function AdminClientAgendaPage({ params }: RouteProps) {
  const { id: orgId } = await params;

  // Garante session do superadmin + sincroniza cookie admin-context pra
  // apontar pra essa org. setAdminContext valida sid+is_superadmin
  // internamente.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  try {
    await setAdminContext(orgId, user.id);
  } catch {
    notFound();
  }

  // Valida superadmin pra essa org agora que o cookie esta setado.
  let ctx;
  try {
    ctx = await requireSuperadminForOrg(orgId);
  } catch {
    notFound();
  }

  const range = defaultRange();
  const [initialAppointments, services, org] = await Promise.all([
    getAppointments({ from: range.from, to: range.to, limit: 500 }),
    getAgendaServices({ is_active: true }),
    getOrgMeta(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Agenda — {org.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visualize e gerencie compromissos como superadmin. Toda mudança fica
          registrada no audit (performed_by_role=&quot;admin&quot;).
        </p>
      </header>

      <AdminAgendaPageClient
        orgId={orgId}
        currentUserId={ctx.userId}
        orgSlug={org.slug}
        services={services}
        initialAppointments={initialAppointments}
        initialRange={range}
      />
    </div>
  );
}
