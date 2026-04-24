"use server";

import { revalidatePath } from "next/cache";
import { fromAny } from "@/lib/ai-agent/db";
import {
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

export interface LeadAgentHandoffState {
  isPaused: boolean;
  pausedAt: string | null;
  reason: string | null;
  pausedConversationCount: number;
}

type PausedConversationRow = {
  id: string;
  human_handoff_at: string | null;
  human_handoff_reason: string | null;
};

async function loadPausedConversations(
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"],
  orgId: string,
  leadId: string,
): Promise<PausedConversationRow[]> {
  const { data, error } = await fromAny(db, "agent_conversations")
    .select("id, human_handoff_at, human_handoff_reason")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .not("human_handoff_at", "is", null)
    .order("human_handoff_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as PausedConversationRow[];
}

export async function getLeadAgentHandoffState(
  orgId: string,
  leadId: string,
): Promise<LeadAgentHandoffState> {
  const { db } = await requireAdminAgentOrg(orgId);
  const paused = await loadPausedConversations(db, orgId, leadId);
  const latest = paused[0] ?? null;

  return {
    isPaused: paused.length > 0,
    pausedAt: latest?.human_handoff_at ?? null,
    reason: latest?.human_handoff_reason ?? null,
    pausedConversationCount: paused.length,
  };
}

export async function reactivateAgent(
  orgId: string,
  leadId: string,
): Promise<{ updatedCount: number }> {
  const { db, userId } = await requireAdminAgentOrg(orgId);
  const now = new Date().toISOString();

  try {
    const { data, error } = await fromAny(db, "agent_conversations")
      .update({
        human_handoff_at: null,
        human_handoff_reason: null,
        updated_at: now,
      })
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .not("human_handoff_at", "is", null)
      .select("id");

    if (error) throw new Error(error.message);

    const updatedRows = ((data ?? []) as Array<{ id: string }>).filter((row) => row.id);
    if (updatedRows.length === 0) {
      return { updatedCount: 0 };
    }

    const { error: activityError } = await db.from("lead_activities").insert({
      organization_id: orgId,
      lead_id: leadId,
      performed_by: userId,
      type: "agent_reactivated",
      description:
        updatedRows.length === 1
          ? "Bot reativado manualmente para este lead."
          : `Bot reativado manualmente para este lead em ${updatedRows.length} conversas pausadas.`,
      metadata: {
        source: "ai_agent",
        performed_by_superadmin_id: userId,
        acting_as_org_id: orgId,
        reactivated_conversation_ids: updatedRows.map((row) => row.id),
        updated_count: updatedRows.length,
      } as never,
      created_at: now,
    });

    if (activityError) throw new Error(activityError.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_reactivate",
      entityType: "lead",
      entityId: leadId,
      metadata: {
        updated_count: updatedRows.length,
        reactivated_conversation_ids: updatedRows.map((row) => row.id),
      },
    });

    revalidatePath("/leads");
    revalidatePath("/chat");

    return { updatedCount: updatedRows.length };
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_reactivate",
      entityType: "lead",
      entityId: leadId,
      error,
    });
    throw error;
  }
}
