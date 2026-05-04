// PR-K5: A pagina /leads agora vive como tab dentro de /crm.
// Mantemos a rota /leads como REDIRECT pra preservar bookmarks +
// links externos. /leads/[id] (detalhe individual) continua standalone.

import { redirect } from "next/navigation";

export const metadata = { title: "Leads" };

export default function LeadsRedirect() {
  redirect("/crm?tab=leads");
}
