import "server-only";

import { NATIVE_AGENT_FEATURE_FLAG, type OrganizationSettings } from "@persia/shared/ai-agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { asAgentDb, asRecord, type AgentDb } from "./db";

export async function isNativeAgentEnabled(
  orgId: string,
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();

    if (error || !data) return false;

    const settings = asRecord((data as { settings?: OrganizationSettings | null }).settings);
    const features = asRecord(settings.features);
    return features[NATIVE_AGENT_FEATURE_FLAG] === true;
  } catch {
    return false;
  }
}
