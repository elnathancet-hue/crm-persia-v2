import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/whatsapp/providers", () => ({
  createProvider: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(),
        remove: vi.fn(),
        upload: vi.fn(),
      })),
      listBuckets: vi.fn(),
      createBucket: vi.fn(),
    },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { createProvider } from "@/lib/whatsapp/providers";
import { getMessages, sendMessage, sendMessageViaWhatsApp } from "@/actions/messages";

function stubAuth(supabase: MockSupabase) {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: "org-1",
    userId: "user-1",
    role: "agent",
  } as never);
}

describe("getMessages", () => {
  it("returns messages in chronological order and bubbles errors", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("messages", {
      data: [
        { id: "m3", created_at: "2026-04-20T12:02:00Z" },
        { id: "m2", created_at: "2026-04-20T12:01:00Z" },
        { id: "m1", created_at: "2026-04-20T12:00:00Z" },
      ],
      error: null,
    });

    const res = await getMessages("conv-1");
    expect(res.error).toBeNull();
    expect(res.data?.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("returns error when supabase fails", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("messages", { data: null, error: { message: "db down" } });

    const res = await getMessages("conv-1");
    expect(res.data).toBeNull();
    expect(res.error).toBe("db down");
  });
});

describe("sendMessage", () => {
  it("returns error when conversation does not belong to org", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", { data: null, error: { message: "not found" } });

    const res = await sendMessage("conv-x", { content: "hi" });
    expect(res.error).toBe("Conversa nao encontrada");
    expect(res.data).toBeNull();
  });

  it("inserts an agent message with correct shape and updates conversation", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", {
      data: { lead_id: "lead-1", organization_id: "org-1" },
      error: null,
    });
    supabase.queue("messages", {
      data: { id: "m-new", sender: "agent" },
      error: null,
    });

    const res = await sendMessage("conv-1", { content: "oi", type: "text" });
    expect(res.error).toBeNull();
    expect(res.data?.id).toBe("m-new");
    const insert = (supabase.inserts.messages as Array<Record<string, unknown>>)[0];
    expect(insert).toMatchObject({
      conversation_id: "conv-1",
      organization_id: "org-1",
      lead_id: "lead-1",
      sender: "agent",
      sender_user_id: "user-1",
      content: "oi",
      type: "text",
      status: "sent",
    });
    expect(supabase.updates.conversations?.[0]).toMatchObject({ unread_count: 0 });
  });
});

describe("sendMessageViaWhatsApp", () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
  });

  it("saves agent message and forwards to provider when WhatsApp connection exists", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", {
      data: {
        id: "conv-1",
        lead_id: "lead-1",
        organization_id: "org-1",
        channel: "whatsapp",
        leads: { id: "lead-1", phone: "5511988880000" },
      },
      error: null,
    });
    supabase.queue("messages", {
      data: { id: "msg-1", sender: "agent" },
      error: null,
    });
    supabase.queue("whatsapp_connections", {
      data: {
        provider: "uazapi",
        instance_url: "https://uaz",
        instance_token: "tok",
        phone_number_id: null,
        waba_id: null,
        access_token: null,
        webhook_verify_token: null,
      },
      error: null,
    });

    const sendText = vi.fn(async () => ({ messageId: "uaz-ext-1", success: true }));
    vi.mocked(createProvider).mockReturnValue({
      sendText,
    } as never);

    const res = await sendMessageViaWhatsApp("conv-1", "hello");

    expect(res.error).toBeUndefined();
    expect(res.data?.id).toBe("msg-1");
    expect(sendText).toHaveBeenCalledWith({ phone: "5511988880000", message: "hello" });
    // whatsapp_msg_id update applied after provider returns
    const update = (supabase.updates.messages as Array<Record<string, unknown>>)[0];
    expect(update).toMatchObject({ whatsapp_msg_id: "uaz-ext-1" });
  });

  it("skips WhatsApp send when channel is not whatsapp but still persists the message", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", {
      data: {
        id: "conv-1",
        lead_id: "lead-1",
        organization_id: "org-1",
        channel: "email",
        leads: { id: "lead-1", phone: "5511988880000" },
      },
      error: null,
    });
    supabase.queue("messages", {
      data: { id: "msg-2", sender: "agent" },
      error: null,
    });

    const res = await sendMessageViaWhatsApp("conv-1", "hi");

    expect(res.data?.id).toBe("msg-2");
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("marks the message as failed and surfaces the provider error", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("conversations", {
      data: {
        id: "conv-1",
        lead_id: "lead-1",
        organization_id: "org-1",
        channel: "whatsapp",
        leads: { id: "lead-1", phone: "5511988880000" },
      },
      error: null,
    });
    supabase.queue("messages", {
      data: { id: "msg-3", sender: "agent" },
      error: null,
    });
    supabase.queue("whatsapp_connections", {
      data: {
        provider: "uazapi",
        instance_url: "https://uaz",
        instance_token: "tok",
      },
      error: null,
    });

    vi.mocked(createProvider).mockReturnValue({
      sendText: vi.fn(async () => {
        throw new Error("UAZAPI down");
      }),
    } as never);

    const res = await sendMessageViaWhatsApp("conv-1", "hi");

    // Message is saved, status flipped to "failed", and the error is surfaced to the UI.
    expect(res.data?.id).toBe("msg-3");
    expect(res.data?.status).toBe("failed");
    expect(res.error).toBe("UAZAPI down");
    // The status=failed patch was applied to the message row
    const failedUpdate = (supabase.updates.messages as Array<Record<string, unknown>>).find(
      (u) => u.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
  });
});
