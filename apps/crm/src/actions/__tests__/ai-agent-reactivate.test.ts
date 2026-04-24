import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireRole } from "@/lib/auth";
import {
  getLeadAgentHandoffState,
  reactivateAgent,
} from "@/actions/ai-agent/reactivate";

function stubAuth(supabase: MockSupabase, role: "admin" | "agent" = "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: "org-1",
    userId: "user-1",
    role,
    memberships: [],
  } as never);
}

describe("getLeadAgentHandoffState", () => {
  it("returns the latest paused state for the lead", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase, "agent");
    supabase.queue("agent_conversations", {
      data: [
        {
          id: "conv-2",
          human_handoff_at: "2026-04-24T10:00:00.000Z",
          human_handoff_reason: "cliente pediu humano",
        },
        {
          id: "conv-1",
          human_handoff_at: "2026-04-24T09:00:00.000Z",
          human_handoff_reason: "fallback",
        },
      ],
      error: null,
    });

    const state = await getLeadAgentHandoffState("lead-1");

    expect(state).toEqual({
      isPaused: true,
      pausedAt: "2026-04-24T10:00:00.000Z",
      reason: "cliente pediu humano",
      pausedConversationCount: 2,
    });
    expect(supabase.filters.agent_conversations?.eq).toContainEqual(["organization_id", "org-1"]);
    expect(supabase.filters.agent_conversations?.eq).toContainEqual(["lead_id", "lead-1"]);
  });
});

describe("reactivateAgent", () => {
  it("clears handoff flags and records a lead activity", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase, "admin");
    supabase.queue("agent_conversations", {
      data: [{ id: "conv-1" }, { id: "conv-2" }],
      error: null,
    });
    supabase.queue("lead_activities", {
      data: null,
      error: null,
    });

    const result = await reactivateAgent("lead-1");

    expect(result).toEqual({ updatedCount: 2 });
    expect(supabase.updates.agent_conversations?.[0]).toMatchObject({
      human_handoff_at: null,
      human_handoff_reason: null,
    });
    expect(supabase.inserts.lead_activities?.[0]).toMatchObject({
      organization_id: "org-1",
      lead_id: "lead-1",
      performed_by: "user-1",
      type: "agent_reactivated",
    });
    expect(
      (supabase.inserts.lead_activities?.[0] as Record<string, unknown>).metadata,
    ).toMatchObject({
      source: "ai_agent",
      updated_count: 2,
      reactivated_conversation_ids: ["conv-1", "conv-2"],
    });
  });

  it("returns zero when there is no paused conversation", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase, "admin");
    supabase.queue("agent_conversations", {
      data: [],
      error: null,
    });

    const result = await reactivateAgent("lead-1");

    expect(result).toEqual({ updatedCount: 0 });
    expect(supabase.inserts.lead_activities).toBeUndefined();
  });
});
