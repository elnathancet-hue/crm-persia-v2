"use server";

import type { AddAllowedDomainInput } from "@persia/shared/ai-agent";
import { WEBHOOK_ALLOWLIST_KEY } from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import {
  getWebhookAllowlistDomains,
  normalizeAllowedDomain,
  resolvePublicIps,
} from "@/lib/ai-agent/webhook-caller";
import { asRecord, mergeJsonObject } from "@/lib/ai-agent/db";
import {
  agentPaths,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

export async function listAllowedDomains(orgId: string): Promise<string[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  const settings = await loadOrgSettings(db, orgId);
  return getWebhookAllowlistDomains(settings);
}

export async function addAllowedDomain(
  orgId: string,
  input: AddAllowedDomainInput,
): Promise<string[]> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const settings = await loadOrgSettings(db, orgId);
    const domain = normalizeAllowedDomain(input.domain);
    await resolvePublicIps(domain);

    const domains = Array.from(
      new Set([...getWebhookAllowlistDomains(settings), domain]),
    ).sort();

    await saveAllowedDomains(db, orgId, settings, domains);
    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_allowlist_add",
      entityType: "organization",
      entityId: orgId,
      metadata: { domain },
    });
    return domains;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_allowlist_add",
      entityType: "organization",
      entityId: orgId,
      metadata: { domain: input.domain },
      error,
    });
    throw error;
  }
}

export async function removeAllowedDomain(orgId: string, domain: string): Promise<string[]> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const settings = await loadOrgSettings(db, orgId);
    const normalized = normalizeAllowedDomain(domain);
    const domains = getWebhookAllowlistDomains(settings).filter((entry) => entry !== normalized);

    await saveAllowedDomains(db, orgId, settings, domains);
    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_allowlist_remove",
      entityType: "organization",
      entityId: orgId,
      metadata: { domain: normalized },
    });
    return domains;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_allowlist_remove",
      entityType: "organization",
      entityId: orgId,
      metadata: { domain },
      error,
    });
    throw error;
  }
}

async function loadOrgSettings(
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"],
  orgId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return asRecord(data?.settings);
}

async function saveAllowedDomains(
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"],
  orgId: string,
  currentSettings: Record<string, unknown>,
  domains: string[],
): Promise<void> {
  const existingAllowlist = asRecord(currentSettings[WEBHOOK_ALLOWLIST_KEY]);
  const settings = mergeJsonObject(currentSettings, {
    [WEBHOOK_ALLOWLIST_KEY]: {
      ...existingAllowlist,
      domains,
    },
  });

  const { error } = await db
    .from("organizations")
    .update({
      settings: settings as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  for (const path of agentPaths()) revalidatePath(path);
}
