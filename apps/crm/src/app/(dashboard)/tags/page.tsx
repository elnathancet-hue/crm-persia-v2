// PR-K10: A pagina /tags agora vive como sub-tab de /crm/settings.
// Mantemos a rota /tags como REDIRECT pra preservar bookmarks +
// links externos.

import { redirect } from "next/navigation";

export const metadata = { title: "Etiquetas" };

export default function TagsRedirect() {
  redirect("/crm/settings?tab=etiquetas");
}
