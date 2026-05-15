import { redirect } from "next/navigation";

/**
 * Frente A (unificação): /leads/[id] virou deeplink. Tudo que antes era
 * uma pagina dedicada (LeadDetailClient) agora vive no LeadInfoDrawer,
 * aberto a partir do /crm?tab=leads&lead={id}.
 *
 * Por que:
 *   - Bug latente: a pagina antiga crashava ao clicar "Editar" (LeadsProvider
 *     missing) — fluxo da menu ⋮ → Editar quebrava em prod.
 *   - Duplicacao: ~700 linhas em LeadDetailClient que repetiam o drawer.
 *   - UX inconsistente: clicar na linha abria drawer; ⋮ → Editar
 *     navegava pra fora do CRM. Agora ambos abrem o mesmo drawer.
 *
 * `redirect` (307 / temporary) — escolhi temporary em vez de permanent
 * porque em dev o `permanentRedirect` apresentou comportamento inconsistente
 * com o middleware do CRM. Funcionalmente equivalente pra browser/usuario.
 */
type Props = {
  params: Promise<{ id: string }>;
};

export default async function LeadDetailPage({ params }: Props) {
  const { id } = await params;
  redirect(`/crm?tab=leads&lead=${id}`);
}
