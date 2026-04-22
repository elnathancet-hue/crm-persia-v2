import "server-only";

import type { TablesInsert } from "@persia/shared";
import { headers } from "next/headers";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";

export type CrmAuditAction =
  | "crm_create_team_member"
  | "crm_update_member_role"
  | "crm_toggle_member_active"
  | "crm_whatsapp_connect"
  | "crm_whatsapp_disconnect"
  | "crm_send_message"
  | "crm_send_media"
  | "crm_resend_message"
  | "crm_send_template"
  | (string & {});

type AuditInsert = TablesInsert<"admin_audit_log">;

export interface AuditLogParams {
  userId: string;
  orgId: string | null;
  action: CrmAuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  result?: "success" | "failure" | "partial";
  errorMsg?: string;
  requestId?: string;
}

async function getRequestIdFromHeaders(): Promise<string | null> {
  try {
    const headerStore = await headers();
    return headerStore.get("x-request-id") || null;
  } catch {
    return null;
  }
}

export async function auditLog(params: AuditLogParams): Promise<void> {
  try {
    const requestId = params.requestId ?? await getRequestIdFromHeaders();
    const row: AuditInsert = {
      user_id: params.userId,
      target_org_id: params.orgId,
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: (params.metadata ?? {}) as TablesInsert<"admin_audit_log">["metadata"],
      result: params.result ?? "success",
      error_msg: params.errorMsg ?? null,
      request_id: requestId,
      ip: null,
      user_agent: null,
    };

    const admin = createAdminClient();
    const { error } = await admin.from("admin_audit_log").insert(row);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("[CRM Audit] Failed to log", {
      action: params.action,
      organization_id: params.orgId,
      user_id: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function auditFailure(
  params: Omit<AuditLogParams, "result" | "errorMsg"> & { error: unknown },
): Promise<void> {
  const errorMsg = params.error instanceof Error ? params.error.message : String(params.error);
  await auditLog({ ...params, result: "failure", errorMsg });
}

export async function withAuditedAdmin<T>(
  params: Omit<AuditLogParams, "result" | "errorMsg"> & {
    reason: string;
    auditSuccess?: boolean;
  },
  fn: (admin: AdminClient) => Promise<T>,
): Promise<T> {
  if (!params.reason || params.reason.length < 3) {
    throw new Error("[withAuditedAdmin] reason is required");
  }

  const admin = createAdminClient();
  try {
    const result = await fn(admin);
    if (params.auditSuccess ?? true) {
      await auditLog(params);
    }
    return result;
  } catch (error) {
    await auditFailure({ ...params, error });
    throw error;
  }
}
