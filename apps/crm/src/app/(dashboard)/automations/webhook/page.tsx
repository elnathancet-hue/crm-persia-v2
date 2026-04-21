import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WebhookClient } from "./webhook-client";

export default async function WebhookPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(settings)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) redirect("/login");

  const settings = (member as any)?.organizations?.settings as Record<string, unknown> | undefined;
  const webhookUrl = (settings?.n8n_webhook_url as string) || "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Webhook IA</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte uma IA externa via webhook para processar mensagens
        </p>
      </div>
      <WebhookClient
        orgId={(member as any).organization_id}
        initialWebhookUrl={webhookUrl}
      />
    </div>
  );
}
