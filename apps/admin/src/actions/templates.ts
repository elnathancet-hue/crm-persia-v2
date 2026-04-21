"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { getAdmin } from "@/lib/supabase-admin";
import { createProvider } from "@/lib/whatsapp/providers";
import { hasTemplates, type RemoteTemplate } from "@/lib/whatsapp/provider";
import { parseTemplateParams, type MetaComponent, type ParamsSchema } from "@/lib/whatsapp/template-parser";

// ============ Types ============

export interface TemplateRow {
  id: string;
  connection_id: string;
  meta_template_id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown;
  params_schema: ParamsSchema;
  last_synced_at: string;
  updated_at: string;
}

export interface TemplateListFilter {
  status?: string;                              // APPROVED | PENDING | ...
  category?: string;                             // MARKETING | UTILITY | AUTHENTICATION
  language?: string;                             // pt_BR
  connectionId?: string;                         // restringe a uma conn especifica
  onlyApproved?: boolean;                        // atalho para inbox UI
}

export interface SyncResult {
  ok: boolean;
  synced?: number;
  error?: string;
}

// ============ Actions ============

/** Sincroniza templates da Meta para a conexao meta_cloud da org no contexto. */
export async function syncTemplates(): Promise<SyncResult> {
  try {
    const { admin, orgId, userId } = await requireSuperadminForOrg();

    const { data: conn } = await admin
      .from("whatsapp_connections")
      .select("id, provider, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", orgId)
      .eq("provider", "meta_cloud")
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!conn) {
      return { ok: false, error: "Nenhuma conexao Meta Cloud conectada para esta organizacao" };
    }

    const provider = createProvider(conn);
    if (!hasTemplates(provider)) {
      return { ok: false, error: "Provider nao suporta templates" };
    }

    const remote = await provider.listRemoteTemplates();
    const synced = await upsertTemplates(admin, orgId, conn.id, remote);

    await auditLog({
      userId,
      orgId,
      action: "whatsapp_sync_templates",
      entityType: "whatsapp_template",
      metadata: { synced, connection_id: conn.id },
    });

    return { ok: true, synced };
  } catch (e: unknown) {
    console.error("[templates] syncTemplates error:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao sincronizar" };
  }
}

/** Lista templates da org no contexto admin (paginacao client-side por ora). */
export async function listTemplates(filter: TemplateListFilter = {}): Promise<TemplateRow[]> {
  const { admin, orgId } = await requireSuperadminForOrg();

  let query = admin
    .from("wa_templates")
    .select("id, connection_id, meta_template_id, name, language, category, status, components, params_schema, last_synced_at, updated_at")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (filter.onlyApproved) query = query.eq("status", "APPROVED");
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.language) query = query.eq("language", filter.language);
  if (filter.connectionId) query = query.eq("connection_id", filter.connectionId);

  const { data, error } = await query;
  if (error) {
    console.error("[templates] listTemplates error:", error.message);
    return [];
  }
  return (data ?? []) as unknown as TemplateRow[];
}

// ============ Cron helper (used by /api/cron/sync-templates) ============

/**
 * Service-role sync para todas as conns meta_cloud conectadas.
 * Chamado pelo cron endpoint. Nao passa por auth do usuario.
 */
export async function syncAllMetaTemplatesForCron(): Promise<{
  checked: number;
  synced: number;
  errors: number;
}> {
  const admin = getAdmin();
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
}

// ============ internals ============

async function upsertTemplates(
  admin: ReturnType<typeof getAdmin>,
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
    .upsert(rows, { onConflict: "connection_id,name,language" });

  if (error) {
    console.error("[templates] upsert error:", error.message);
    throw new Error(error.message);
  }
  return rows.length;
}
