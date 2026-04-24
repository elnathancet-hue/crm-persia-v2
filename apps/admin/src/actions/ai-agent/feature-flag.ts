"use server";

import { NATIVE_AGENT_FEATURE_FLAG } from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { mergeJsonObject } from "@/lib/ai-agent/db";
import {
  agentPaths,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

export async function isNativeAgentEnabled(orgId: string): Promise<boolean> {
  const { db } = await requireAdminAgentOrg(orgId);
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data || !data.settings || typeof data.settings !== "object") return false;
  const features =
    "features" in data.settings &&
    data.settings.features &&
    typeof data.settings.features === "object"
      ? (data.settings.features as Record<string, unknown>)
      : {};
  return features[NATIVE_AGENT_FEATURE_FLAG] === true;
}

export async function setNativeAgentEnabled(orgId: string, enabled: boolean): Promise<boolean> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const { data: org, error: loadError } = await db
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);

    const settings = mergeJsonObject(org?.settings, {
      features: {
        ...(
          org?.settings &&
          typeof org.settings === "object" &&
          !Array.isArray(org.settings) &&
          "features" in org.settings &&
          typeof (org.settings as Record<string, unknown>).features === "object" &&
          (org.settings as Record<string, unknown>).features !== null
            ? ((org.settings as Record<string, unknown>).features as Record<string, unknown>)
            : {}
        ),
        native_agent_enabled: enabled,
      },
    });

    const { error } = await db
      .from("organizations")
      .update({ settings: settings as never, updated_at: new Date().toISOString() })
      .eq("id", orgId);

    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_feature_flag_set",
      entityType: "organization",
      entityId: orgId,
      metadata: { native_agent_enabled: enabled },
    });

    for (const path of agentPaths()) revalidatePath(path);
    return enabled;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_feature_flag_set",
      entityType: "organization",
      entityId: orgId,
      metadata: { native_agent_enabled: enabled },
      error,
    });
    throw error;
  }
}
