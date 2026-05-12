// PR-T3: rota /crm do admin agora renderiza AdminCrmShell com tabs
// (Pipeline / Leads / Segmentação / Tags) — paridade com CRM cliente
// (apps/crm/src/app/(dashboard)/crm/page.tsx -> CrmShell).
//
// Antes: so renderizava CrmPage (Kanban inline, sem tabs).
// Agora: shell com 4 tabs internas + URL sync via ?tab=.

import { AdminCrmShell } from "@/components/crm/admin-crm-shell";

export const metadata = { title: "CRM" };

export default function Page() {
  return <AdminCrmShell />;
}
