"use server";

import { getAdmin } from "@/lib/supabase-admin";
import type { TablesInsert } from "@persia/shared";

/**
 * Canonical actions logged by the admin panel. Add new values here as
 * features evolve — keeping the list typed prevents typos like
 * "switch_contxt" silently slipping into the audit log.
 */
export type AuditAction =
  // context
  | "switch_context"
  | "clear_context"
  // organization
  | "create_organization"
  | "update_organization"
  | "delete_organization"
  | "update_org_settings"
  // members & superadmin
  | "create_team_member"
  | "update_member_role"
  | "toggle_member_active"
  | "add_superadmin"
  | "remove_superadmin"
  // messaging
  | "send_message"
  | "send_media"
  | "resend_message"
  | "execute_campaign"
  | "schedule_campaign"
  // whatsapp
  | "whatsapp_provision"
  | "whatsapp_disconnect"
  | "whatsapp_reconnect"
  // templates
  | "create_template"
  | "update_template"
  | "delete_template"
  // escape hatch — always allowed but discouraged
  | (string & {});

/**
 * Columns added by migration 012 that may not yet be present in the
 * generated Database types. Marked optional so the type is a no-op
 * once `supabase gen types` is rerun.
 */
type AuditExtras = {
  result?: "success" | "failure" | "partial" | null;
  error_msg?: string | null;
  request_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
};

type AuditInsert = TablesInsert<"admin_audit_log"> & AuditExtras;

export interface AuditLogParams {
  userId: string;
  orgId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  result?: "success" | "failure" | "partial";
  errorMsg?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Log a superadmin action to admin_audit_log.
 *
 * Fire-and-forget: never throws — audit failure must not break the calling
 * operation. We log to console so the failure shows up in EasyPanel logs.
 *
 * Never include secrets in `metadata` (passwords, tokens, full auth tokens).
 * The CRM admin panel UI displays metadata raw to other superadmins.
 */
export async function auditLog(params: AuditLogParams): Promise<void> {
  try {
    const admin = getAdmin();
    const row: AuditInsert = {
      user_id: params.userId,
      target_org_id: params.orgId,
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: (params.metadata ?? {}) as TablesInsert<"admin_audit_log">["metadata"],
      result: params.result ?? "success",
      error_msg: params.errorMsg ?? null,
      request_id: params.requestId ?? null,
      ip: params.ip ?? null,
      user_agent: params.userAgent ?? null,
    };
    await admin.from("admin_audit_log").insert(row);
  } catch (err) {
    console.error(
      "[Audit] Failed to log:",
      err instanceof Error ? err.message : String(err),
      { action: params.action, userId: params.userId, orgId: params.orgId }
    );
  }
}

/**
 * Convenience wrapper: log a failure with the error attached.
 * Use in catch blocks of admin actions to record what was attempted.
 */
export async function auditFailure(
  params: Omit<AuditLogParams, "result"> & { error: unknown }
): Promise<void> {
  const errorMsg = params.error instanceof Error ? params.error.message : String(params.error);
  await auditLog({ ...params, result: "failure", errorMsg });
}
