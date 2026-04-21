import { createClient } from "@supabase/supabase-js";
import { executeFlow } from "./engine";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Triggered when a new lead is created.
 * Finds all active flows with trigger_type "new_lead" and executes each.
 */
export async function onNewLead(orgId: string, leadId: string): Promise<void> {
  const supabase = getSupabase();

  const { data: flows } = await supabase
    .from("flows")
    .select("id")
    .eq("organization_id", orgId)
    .eq("trigger_type", "new_lead")
    .eq("is_active", true);

  if (!flows || flows.length === 0) return;

  for (const flow of flows) {
    try {
      await executeFlow(flow.id, leadId, orgId, { trigger: "new_lead" });
    } catch (err: any) {
      console.error(`[Triggers] onNewLead error for flow ${flow.id}:`, err.message);
    }
  }
}

/**
 * Triggered when a lead sends a message.
 * Checks active flows with trigger_type "keyword" and matches keywords from trigger_config.
 * Returns true if a flow was triggered (so caller can skip AI processing).
 */
export async function onKeyword(
  orgId: string,
  leadId: string,
  message: string
): Promise<boolean> {
  const supabase = getSupabase();

  const { data: flows } = await supabase
    .from("flows")
    .select("id, trigger_config")
    .eq("organization_id", orgId)
    .eq("trigger_type", "keyword")
    .eq("is_active", true);

  if (!flows || flows.length === 0) return false;

  const lowerMessage = message.toLowerCase().trim();
  let triggered = false;

  for (const flow of flows) {
    const config = flow.trigger_config || {};
    const keywords: string[] = config.keywords || [];

    const matched = keywords.some((kw: string) => {
      const lowerKw = kw.toLowerCase().trim();
      if (!lowerKw) return false;

      // Support exact match or contains based on config
      if (config.match_type === "exact") {
        return lowerMessage === lowerKw;
      }
      // Default: contains
      return lowerMessage.includes(lowerKw);
    });

    if (matched) {
      try {
        await executeFlow(flow.id, leadId, orgId, {
          trigger: "keyword",
          message,
          matched_keywords: keywords.filter((kw: string) =>
            lowerMessage.includes(kw.toLowerCase().trim())
          ),
        });
        triggered = true;
      } catch (err: any) {
        console.error(`[Triggers] onKeyword error for flow ${flow.id}:`, err.message);
      }
    }
  }

  return triggered;
}

/**
 * Triggered when a tag is added to a lead.
 * Finds active flows with trigger_type "tag_added" that match the tag.
 */
export async function onTagAdded(
  orgId: string,
  leadId: string,
  tagName: string
): Promise<void> {
  const supabase = getSupabase();

  const { data: flows } = await supabase
    .from("flows")
    .select("id, trigger_config")
    .eq("organization_id", orgId)
    .eq("trigger_type", "tag_added")
    .eq("is_active", true);

  if (!flows || flows.length === 0) return;

  const lowerTag = tagName.toLowerCase().trim();

  for (const flow of flows) {
    const config = flow.trigger_config || {};
    const targetTags: string[] = config.tags || [config.tag_name || ""];

    const matched = targetTags.some(
      (t: string) => t.toLowerCase().trim() === lowerTag
    );

    if (matched) {
      try {
        await executeFlow(flow.id, leadId, orgId, {
          trigger: "tag_added",
          tag_name: tagName,
        });
      } catch (err: any) {
        console.error(`[Triggers] onTagAdded error for flow ${flow.id}:`, err.message);
      }
    }
  }
}

/**
 * Triggered when a lead's deal moves to a new pipeline stage.
 * Finds active flows with trigger_type "stage_changed" that match the target stage.
 */
export async function onStageChanged(
  orgId: string,
  leadId: string,
  stageId: string
): Promise<void> {
  const supabase = getSupabase();

  const { data: flows } = await supabase
    .from("flows")
    .select("id, trigger_config")
    .eq("organization_id", orgId)
    .eq("trigger_type", "stage_changed")
    .eq("is_active", true);

  if (!flows || flows.length === 0) return;

  for (const flow of flows) {
    const config = flow.trigger_config || {};
    const targetStages: string[] = config.stage_ids || [config.stage_id || ""];

    const matched = targetStages.includes(stageId);

    if (matched) {
      try {
        await executeFlow(flow.id, leadId, orgId, {
          trigger: "stage_changed",
          stage_id: stageId,
        });
      } catch (err: any) {
        console.error(`[Triggers] onStageChanged error for flow ${flow.id}:`, err.message);
      }
    }
  }
}
