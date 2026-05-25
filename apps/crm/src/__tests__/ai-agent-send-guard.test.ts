import { describe, expect, it, vi } from "vitest";
import { normalizeHumanizationConfig } from "@persia/shared/ai-agent";
import { createRealtimeProvider } from "@/lib/ai-agent/flow/realtime-provider";
import { canAiSendNow } from "@/lib/ai-agent/send-guard";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

function queueGuardRows(
  supabase: ReturnType<typeof createSupabaseMock>,
  overrides: {
    assigned_to?: string | null;
    status?: string | null;
    human_handoff_at?: string | null;
    ai_control_epoch?: number | null;
  } = {},
) {
  supabase.queue("conversations", {
    data: {
      assigned_to: overrides.assigned_to ?? "ai",
      status: overrides.status ?? "active",
    },
    error: null,
  });
  supabase.queue("agent_conversations", {
    data: {
      human_handoff_at: overrides.human_handoff_at ?? null,
      ai_control_epoch: overrides.ai_control_epoch ?? 1,
    },
    error: null,
  });
}

function makeWhatsAppProvider() {
  return {
    name: "uazapi",
    sendText: vi.fn(async () => ({ success: true, messageId: "msg-out" })),
    setTyping: vi.fn(async () => undefined),
  };
}

describe("AI outbound send guard", () => {
  it("allows sends only while the conversation still belongs to the same AI epoch", async () => {
    const supabase = createSupabaseMock();
    queueGuardRows(supabase);

    await expect(
      canAiSendNow({
        db: supabase as never,
        organizationId: "org-a",
        conversationId: "conv-a",
        agentConversationId: "agent-conv-a",
        expectedControlEpoch: 1,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("blocks stale runs when the epoch changed before send", async () => {
    const supabase = createSupabaseMock();
    queueGuardRows(supabase, { ai_control_epoch: 2 });
    const provider = makeWhatsAppProvider();
    const realtime = createRealtimeProvider({
      db: supabase as never,
      provider: provider as never,
      leadPhone: "+5511999999999",
      leadId: "lead-a",
      conversationId: "conv-a",
      organizationId: "org-a",
      humanization: normalizeHumanizationConfig({ split_enabled: false }),
      sendGuard: {
        db: supabase as never,
        organizationId: "org-a",
        conversationId: "conv-a",
        agentConversationId: "agent-conv-a",
        expectedControlEpoch: 1,
      },
    });

    realtime.emit({ kind: "send_text", payload: { message: "Oi!" } });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(provider.sendText).not.toHaveBeenCalled();
    expect(realtime.getEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skipped",
          payload: expect.objectContaining({
            reason: "ai_send_blocked",
            block_reason: "stale_ai_control_epoch:2:1",
          }),
        }),
      ]),
    );
  });
});
