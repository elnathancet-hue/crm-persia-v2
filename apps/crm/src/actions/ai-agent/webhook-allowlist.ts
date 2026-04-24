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
import { agentPaths, requireAgentRole } from "./utils";

export async function listAllowedDomains(): Promise<string[]> {
  const { db, orgId } = await requireAgentRole("admin");
  const settings = await loadOrgSettings(db, orgId);
  return getWebhookAllowlistDomains(settings);
}

export async function addAllowedDomain(input: AddAllowedDomainInput): Promise<string[]> {
  const { db, orgId } = await requireAgentRole("admin");
  const settings = await loadOrgSettings(db, orgId);
  const domain = normalizeAllowedDomain(input.domain);
  await resolvePublicIps(domain);

  const domains = Array.from(
    new Set([...getWebhookAllowlistDomains(settings), domain]),
  ).sort();

  await saveAllowedDomains(db, orgId, settings, domains);
  return domains;
}

export async function removeAllowedDomain(domain: string): Promise<string[]> {
  const { db, orgId } = await requireAgentRole("admin");
  const settings = await loadOrgSettings(db, orgId);
  const normalized = normalizeAllowedDomain(domain);
  const domains = getWebhookAllowlistDomains(settings).filter((entry) => entry !== normalized);

  await saveAllowedDomains(db, orgId, settings, domains);
  return domains;
}

async function loadOrgSettings(
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
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
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
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
      settings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) throw new Error(error.message);

  revalidatePath("/settings");
  for (const path of agentPaths()) revalidatePath(path);
}
