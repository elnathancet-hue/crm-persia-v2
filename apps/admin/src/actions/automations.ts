"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import {
  getAssistants as _getAssistants,
  createAssistant as _createAssistant,
  updateAssistant as _updateAssistant,
  toggleAssistant as _toggleAssistant,
  deleteAssistant as _deleteAssistant,
} from "@/actions/settings";

// Delegate to settings.ts (single source of truth for assistant CRUD)
// No orgId param — reads from cookie context
export async function getAssistants() { return _getAssistants(); }
export async function createAssistant(data: Parameters<typeof _createAssistant>[0]) { return _createAssistant(data); }
export async function updateAssistant(id: string, data: Record<string, unknown>) { return _updateAssistant(id, data); }
export async function toggleAssistant(id: string, isActive: boolean) { return _toggleAssistant(id, isActive); }
export async function deleteAssistant(id: string) { return _deleteAssistant(id); }

// ---- Webhooks (automation context) ----

export async function getWebhookConfigs() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin.from("webhooks").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
  return data || [];
}

// ---- Tools ----

export async function getTools() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin.from("integrations").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
  return data || [];
}
