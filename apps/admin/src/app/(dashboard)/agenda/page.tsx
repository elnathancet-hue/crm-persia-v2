// PR-T1: rota /agenda do admin em modo cliente.
//
// Diferenca vs /clients/[id]/agenda:
//   - Nao recebe `params` — le orgId do cookie admin-context
//   - Nao chama setAdminContext (cookie ja existe quando admin entrou
//     em modo cliente via /clients/[id])
//   - NoContextFallback quando nao ha contexto ativo (admin puro
//     navegando direto pra /agenda sem selecionar cliente antes)
//
// Reusa o mesmo AdminAgendaPageClient da rota por-cliente — single
// source of truth pra UI de agenda do admin.

import { notFound } from "next/navigation";
import { requireSuperadminForOrg } from "@/lib/auth";
import { readAdminContext } from "@/lib/admin-context";
import { getAppointments } from "@/actions/agenda/appointments";
import { getAgendaServices } from "@/actions/agenda/services";
import { getOrgMeta } from "@/actions/agenda/org";
import { AdminAgendaPageClient } from "../clients/[id]/agenda/agenda-page-client";
import { NoContextFallback } from "@/components/no-context-fallback";

export const metadata = { title: "Agenda" };

function defaultRange() {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default async function AdminAgendaPage() {
  // Verifica se admin esta em modo cliente (cookie admin-context setado).
  const ctxCookie = await readAdminContext();
  if (!ctxCookie) {
    // Admin puro navegando direto pra /agenda sem contexto. Renderiza
    // fallback pedindo pra selecionar um cliente em /clients.
    return <NoContextFallback />;
  }

  // Cookie existe — valida superadmin + le orgId do proprio cookie.
  let ctx;
  try {
    ctx = await requireSuperadminForOrg();
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
        orgId={ctx.orgId}
        currentUserId={ctx.userId}
        orgSlug={org.slug}
        services={services}
        initialAppointments={initialAppointments}
        initialRange={range}
      />
    </div>
  );
}
