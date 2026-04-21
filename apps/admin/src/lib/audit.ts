"use server";

import { getAdmin } from "@/lib/supabase-admin";

/**
 * Log a superadmin action to admin_audit_log.
 * Fire-and-forget — never fails the calling operation.
 */
export async function auditLog(params: {
  userId: string;
  orgId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = getAdmin();
    await admin.from("admin_audit_log").insert({
      user_id: params.userId,
      target_org_id: params.orgId,
      action: params.action,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      metadata: params.metadata || {},
    } as never);
  } catch (err) {
    // Never block the main operation because of audit failure
    console.error("[Audit] Failed to log:", err instanceof Error ? err.message : String(err));
  }
}
