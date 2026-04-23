"use server";

import { revalidatePath } from "next/cache";
import { isNativeAgentEnabled as readNativeAgentEnabled } from "@/lib/ai-agent/feature-flag";
import { mergeJsonObject } from "@/lib/ai-agent/db";
import { agentPaths, requireAgentRole } from "./utils";

export async function isNativeAgentEnabled(): Promise<boolean> {
  const { db, orgId } = await requireAgentRole("agent");
  return readNativeAgentEnabled(orgId, db);
}

export async function setNativeAgentEnabled(enabled: boolean): Promise<boolean> {
  const { db, orgId } = await requireAgentRole("admin");
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
    .update({ settings, updated_at: new Date().toISOString() })
    .eq("id", orgId);

  if (error) throw new Error(error.message);
  for (const path of agentPaths()) revalidatePath(path);
  return enabled;
}

