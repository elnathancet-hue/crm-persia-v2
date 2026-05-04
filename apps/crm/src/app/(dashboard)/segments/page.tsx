// PR-K10: A pagina /segments agora vive como sub-tab de /crm/settings.
// Mantemos a rota /segments como REDIRECT pra preservar bookmarks +
// links externos.

import { redirect } from "next/navigation";

export const metadata = { title: "Segmentos" };

export default function SegmentsRedirect() {
  redirect("/crm/settings?tab=segmentos");
}
