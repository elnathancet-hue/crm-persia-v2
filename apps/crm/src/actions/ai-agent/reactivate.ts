"use server";

import { asAgentDb, type AgentDb } from "@/lib/ai-agent/db";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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
  db: AgentDb,
  orgId: string,
  leadId: string,
): Promise<PausedConversationRow[]> {
  const { data, error } = await db
    .from("agent_conversations")
    .select("id, human_handoff_at, human_handoff_reason")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .not("human_handoff_at", "is", null)
    .order("human_handoff_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as PausedConversationRow[];
}

export async function getLeadAgentHandoffState(
  leadId: string,
): Promise<LeadAgentHandoffState> {
  const { supabase, orgId } = await requireRole("agent");
  const db = asAgentDb(supabase as never);
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
  leadId: string,
): Promise<{ updatedCount: number }> {
  const { supabase, orgId, userId } = await requireRole("admin");
  const db = asAgentDb(supabase as never);
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("agent_conversations")
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
      reactivated_conversation_ids: updatedRows.map((row) => row.id),
      updated_count: updatedRows.length,
    },
    created_at: now,
  });

  if (activityError) throw new Error(activityError.message);

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/chat");

  return { updatedCount: updatedRows.length };
}
