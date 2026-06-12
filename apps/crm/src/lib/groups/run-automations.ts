import { createAdminClient } from "@/lib/supabase/admin";

export type GroupAutomationTrigger =
  | "member_joined"
  | "member_left"
  | "lead_identified"
  | "message_received";

// Fire-and-forget — chamado pelo webhook via group-join-pipeline.
// Vive em lib/ (não em actions/) para NÃO virar endpoint de server action público.
export async function runGroupAutomations(
  orgId: string,
  groupId: string,
  trigger: GroupAutomationTrigger,
  eventKey: string,
  context: { leadId?: string; phone?: string; jid?: string },
): Promise<void> {
  const adminDb = createAdminClient() as any;

  const { data: automations } = await adminDb
    .from("group_automations")
    .select("id, action_type, action_payload")
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .eq("trigger", trigger)
    .eq("is_active", true);

  if (!automations || automations.length === 0) return;

  await Promise.allSettled(
    automations.map(async (auto: any) => {
      // Idempotency: try to insert log; if UNIQUE violation → already ran → skip
      const { error: logErr } = await adminDb
        .from("group_automation_logs")
        .insert({ automation_id: auto.id, event_key: eventKey });
      if (logErr) return; // duplicate key = skip

      if (auto.action_type === "add_tag" && context.leadId && auto.action_payload?.tag_id) {
        const { addTagToLead } = await import("@persia/shared/crm");
        await addTagToLead({ db: adminDb, orgId }, context.leadId, auto.action_payload.tag_id);
      }
    }),
  );
}
