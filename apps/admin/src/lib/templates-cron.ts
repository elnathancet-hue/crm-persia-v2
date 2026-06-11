// Cron helper — no "use server" here so this function cannot be called
// directly from the browser as a server action.
import { withAdmin, type AdminClient } from "@/lib/supabase-admin";
import { createProvider } from "@/lib/whatsapp/providers";
import { hasTemplates, type RemoteTemplate } from "@/lib/whatsapp/provider";
import { parseTemplateParams, type MetaComponent } from "@/lib/whatsapp/template-parser";

export async function syncAllMetaTemplatesForCron(): Promise<{
  checked: number;
  synced: number;
  errors: number;
}> {
  return withAdmin("cron_sync_meta_templates", async (admin) => {
    const summary = { checked: 0, synced: 0, errors: 0 };

    const { data: conns } = await admin
      .from("whatsapp_connections")
      .select("id, organization_id, provider, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("provider", "meta_cloud")
      .eq("status", "connected");

    for (const conn of conns ?? []) {
      summary.checked++;
      try {
        const provider = createProvider(conn);
        if (!hasTemplates(provider)) continue;
        const remote = await provider.listRemoteTemplates();
        summary.synced += await upsertTemplates(admin, conn.organization_id, conn.id, remote);
      } catch (err) {
        summary.errors++;
        console.error(
          `[templates cron] org=${conn.organization_id} sync failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return summary;
  });
}

async function upsertTemplates(
  admin: AdminClient,
  orgId: string,
  connectionId: string,
  remote: RemoteTemplate[],
): Promise<number> {
  if (remote.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = remote.map((t) => {
    const components = (t.components ?? []) as unknown as MetaComponent[];
    const params_schema = parseTemplateParams(components);
    return {
      organization_id: orgId,
      connection_id: connectionId,
      meta_template_id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components,
      params_schema,
      last_synced_at: now,
      updated_at: now,
    };
  });

  const { error } = await admin
    .from("wa_templates")
    .upsert(rows as never, { onConflict: "connection_id,name,language" });

  if (error) {
    console.error("[templates] upsert error", {
      organization_id: orgId,
      action: "upsert_templates",
      connection_id: connectionId,
      error: error.message,
    });
    throw new Error(error.message);
  }
  return rows.length;
}
