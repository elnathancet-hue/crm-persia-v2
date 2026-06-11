import { getWebhooks } from "@/actions/webhooks";
import { WebhooksPageClient } from "./webhooks-client";

export const metadata = { title: "Webhooks — Configurações" };

export default async function WebhooksPage() {
  const webhooks = await getWebhooks();

  return <WebhooksPageClient initialWebhooks={(webhooks || []) as never} />;
}
