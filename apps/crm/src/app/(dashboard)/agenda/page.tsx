import { getAppointments } from "@/actions/agenda/appointments";
import { getAgendaServices } from "@/actions/agenda/services";
import { getOrgMeta } from "@/actions/agenda/org";
import { getAuthContext } from "@/lib/auth";
import { getLead } from "@/actions/leads";
import { AgendaPageClient } from "./agenda-page-client";

export const metadata = { title: "Agenda" };

// Pega 60 dias pra cobrir overview/calendar/list sem extra fetch.
function defaultRange() {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = defaultRange();
  const params = await searchParams;
  const prefillLeadId =
    typeof params.leadId === "string" ? params.leadId : null;

  const [initialAppointments, services, ctx, org] = await Promise.all([
    getAppointments({
      from: range.from,
      to: range.to,
      limit: 500,
    }),
    getAgendaServices({ is_active: true }),
    getAuthContext(),
    getOrgMeta(),
  ]);

  // PR-C4: ?leadId= vem de "Agendar" na lista de leads. Busca nome do lead
  // pra pre-preencher o drawer de criacao. Ignora erros (leadId invalido ou
  // sem permissao) — abre agenda sem pre-fill.
  let prefillLead: { id: string; name: string } | null = null;
  if (prefillLeadId) {
    try {
      const result = await getLead(prefillLeadId);
      if (result?.lead) {
        prefillLead = { id: result.lead.id, name: result.lead.name ?? "" };
      }
    } catch {
      // ignora
    }
  }

  // PR-AGENDA-VISUAL (mai/2026): header + tabs movidos pro client (paridade com
  // /crm — icone grande no header + tabs underline + sticky). Page server apenas
  // hidrata dados iniciais.
  return (
    <AgendaPageClient
      initialAppointments={initialAppointments}
      initialRange={range}
      services={services}
      currentUserId={ctx.userId}
      orgId={ctx.orgId}
      orgSlug={org.slug}
      prefillLead={prefillLead}
    />
  );
}
