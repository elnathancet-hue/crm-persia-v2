import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, insertLeadActivity, successResult, trimReason } from "./shared";

const transferToUserSchema = z.object({
  user_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const transferToUserHandler: NativeHandler = async (context, input) => {
  const parsed = transferToUserSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "agent_requested_transfer");
  const { data: member, error: memberError } = await db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", context.organization_id)
    .eq("user_id", parsed.data.user_id)
    .eq("is_active", true)
    .maybeSingle();

  if (memberError) return failureResult(memberError.message);
  if (!member) return failureResult("target user does not belong to this organization");

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", parsed.data.user_id)
    .maybeSingle();

  const displayName =
    typeof profile?.full_name === "string" && profile.full_name.trim()
      ? profile.full_name.trim()
      : `user:${parsed.data.user_id.slice(0, 8)}`;

  if (context.dry_run) {
    return successResult(
      {
        user_id: parsed.data.user_id,
        assigned_to: parsed.data.user_id,
        assignee_name: displayName,
        reason,
      },
      [`would assign lead to ${displayName}`],
    );
  }

  const { error: leadError } = await db
    .from("leads")
    .update({
      assigned_to: parsed.data.user_id,
      updated_at: nowIso(),
    })
    .eq("id", context.lead_id)
    .eq("organization_id", context.organization_id);

  if (leadError) return failureResult(leadError.message);

  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "assigned",
    description: `Nota interna do agente: lead transferido para ${displayName}. Motivo: ${reason}`,
    metadata: {
      conversation_id: context.crm_conversation_id,
      agent_conversation_id: context.agent_conversation_id,
      assigned_to: parsed.data.user_id,
      run_id: context.run_id,
    },
  });

  return successResult(
    {
      user_id: parsed.data.user_id,
      assigned_to: parsed.data.user_id,
      assignee_name: displayName,
      reason,
    },
    [`assigned lead to ${displayName}`, "added internal lead activity note"],
  );
};

