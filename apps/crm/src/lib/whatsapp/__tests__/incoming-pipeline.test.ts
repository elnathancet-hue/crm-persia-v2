import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

// ---- Module mocks (hoisted by vitest) ----
vi.mock("@/lib/flows/triggers", () => ({
  onNewLead: vi.fn(async () => {}),
  onKeyword: vi.fn(async () => false),
}));
vi.mock("@/lib/ai/message-splitter", () => ({
  parseSplitConfig: vi.fn(() => ({ enabled: false, delay_seconds: 0 })),
  splitMessage: vi.fn(async (text: string) => [text]),
}));
vi.mock("@/lib/webhooks/dispatcher", () => ({
  dispatchWebhook: vi.fn(),
}));

import { onKeyword, onNewLead } from "@/lib/flows/triggers";
import { parseSplitConfig, splitMessage } from "@/lib/ai/message-splitter";
import { dispatchWebhook } from "@/lib/webhooks/dispatcher";
import { processIncomingMessage } from "@/lib/whatsapp/incoming-pipeline";
import type { IncomingMessage, WhatsAppProvider } from "@/lib/whatsapp/provider";

function makeProvider(): WhatsAppProvider {
  const stub = vi.fn(async () => undefined);
  return {
    name: "test",
    connect: vi.fn(),
    disconnect: vi.fn(),
    logout: vi.fn(),
    reset: vi.fn(),
    getStatus: vi.fn(),
    getQRCode: vi.fn(),
    sendText: vi.fn(async () => ({ messageId: "out-1", success: true })),
    sendMedia: vi.fn(async () => ({ messageId: "out-m", success: true })),
    sendLocation: vi.fn(),
    sendButtons: vi.fn(),
    sendMenu: vi.fn(),
    sendCarousel: vi.fn(),
    sendPix: vi.fn(),
    sendContact: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    reactToMessage: vi.fn(),
    createCampaign: vi.fn(),
    listCampaigns: vi.fn(),
    clearCompletedCampaigns: vi.fn(),
    markAsRead: stub,
    setTyping: stub,
    setWebhook: vi.fn(),
    checkNumber: vi.fn(),
    downloadMedia: vi.fn(),
    syncLeadToWhatsApp: vi.fn(),
    disableChatbotFor: vi.fn(),
    enableChatbot: vi.fn(),
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    getGroupInfo: vi.fn(),
    getGroupInviteLink: vi.fn(),
    updateGroupName: vi.fn(),
    updateGroupDescription: vi.fn(),
    setGroupAnnounce: vi.fn(),
    resetGroupInviteLink: vi.fn(),
    parseWebhook: vi.fn(),
  } as unknown as WhatsAppProvider;
}

function baseMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    messageId: "wamid.X",
    phone: "5511988880000",
    pushName: "Ana",
    text: "oi",
    type: "text",
    isGroup: false,
    isFromMe: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("processIncomingMessage", () => {
  beforeEach(() => {
    vi.mocked(onKeyword).mockResolvedValue(false);
    vi.mocked(onNewLead).mockResolvedValue();
  });

  it("skips duplicate by whatsapp_msg_id", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", { data: { id: "m-existing" }, error: null });

    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider: makeProvider(),
      msg: baseMsg(),
    });

    expect(result).toEqual({ ok: true, skipped: "duplicate message" });
    expect(dispatchWebhook).not.toHaveBeenCalled();
  });

  it("skips messages with no text and no media", async () => {
    const supabase = createSupabaseMock();
    // dedup query returns nothing
    supabase.queue("messages", { data: null, error: null });

    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider: makeProvider(),
      msg: baseMsg({ text: null, mediaUrl: undefined }),
    });

    expect(result).toEqual({ ok: true, skipped: "no text or media" });
  });

  it("creates a new lead + conversation and saves the incoming message when lead is unknown", async () => {
    const supabase = createSupabaseMock();
    // 1) dedup → none
    supabase.queue("messages", { data: null, error: null });
    // 2) find lead → none
    supabase.queue("leads", { data: null, error: null });
    // 3) insert lead
    supabase.queue("leads", { data: { id: "lead-1" }, error: null });
    // 4) lead_activities insert — no await chain terminator; our builder returns {null,null} by default
    // 5) find conversation → none
    supabase.queue("conversations", { data: null, error: null });
    // 6) insert conversation (non-AI so pipeline ends early)
    supabase.queue("conversations", {
      data: { id: "conv-1", assigned_to: "human", status: "active" },
      error: null,
    });

    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider: makeProvider(),
      msg: baseMsg(),
    });

    expect(result.ok).toBe(true);
    expect(result.leadId).toBe("lead-1");
    expect(result.conversationId).toBe("conv-1");
    expect(result.handledBy).toBe("none");
    expect(dispatchWebhook).toHaveBeenCalledWith(
      "org-1",
      "lead.created",
      expect.objectContaining({ lead: expect.objectContaining({ id: "lead-1" }) }),
    );
    expect(dispatchWebhook).toHaveBeenCalledWith(
      "org-1",
      "message.received",
      expect.objectContaining({ conversationId: "conv-1", leadId: "lead-1" }),
    );
    // lead saved with expected shape — PR-A LEADFIX: phone
    // normalizado pra E.164 ("5511988880000" -> "+5511988880000")
    expect(supabase.inserts.leads?.[0]).toMatchObject({
      organization_id: "org-1",
      phone: "+5511988880000",
      source: "whatsapp",
      status: "new",
    });
    // incoming message persisted as sender=lead
    const firstMsgInsert = (supabase.inserts.messages as Array<Record<string, unknown>>)[0];
    expect(firstMsgInsert).toMatchObject({
      organization_id: "org-1",
      conversation_id: "conv-1",
      lead_id: "lead-1",
      sender: "lead",
      type: "text",
    });
  });

  it("early-returns when a keyword flow handles the message", async () => {
    vi.mocked(onKeyword).mockResolvedValue(true);
    const supabase = createSupabaseMock();
    supabase.queue("messages", { data: null, error: null }); // dedup
    supabase.queue("leads", { data: { id: "lead-2" }, error: null }); // existing lead
    supabase.queue("conversations", {
      data: { id: "conv-2", assigned_to: "ai", status: "active" },
      error: null,
    }); // existing conversation

    const provider = makeProvider();
    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider,
      msg: baseMsg({ text: "menu" }),
    });

    expect(result.handledBy).toBe("flow");
    // No AI/provider send attempt since flow handled it
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it("does not call AI when conversation is assigned to a human", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-3" }, error: null });
    supabase.queue("conversations", {
      data: { id: "conv-3", assigned_to: "user-42", status: "active" },
      error: null,
    });

    const provider = makeProvider();
    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider,
      msg: baseMsg(),
    });

    expect(result.handledBy).toBe("none");
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it("runs the n8n branch end-to-end, splits the response and sends each part", async () => {
    vi.mocked(parseSplitConfig).mockReturnValue({
      enabled: false,
      delay_seconds: 0,
    } as never);
    vi.mocked(splitMessage).mockResolvedValueOnce(["Part A", "Part B"]);

    const supabase = createSupabaseMock();
    // 1) dedup
    supabase.queue("messages", { data: null, error: null });
    // 2) find lead (existing)
    supabase.queue("leads", { data: { id: "lead-ai" }, error: null });
    // 3) find conversation (existing, assigned_to ai)
    supabase.queue("conversations", {
      data: { id: "conv-ai", assigned_to: "ai", status: "active" },
      error: null,
    });
    // 4) organization with n8n webhook URL
    supabase.queue("organizations", {
      data: {
        name: "Org A",
        niche: null,
        settings: { n8n_webhook_url: "https://n8n.example.com/hook" },
      },
      error: null,
    });
    // 5) Promise.all — deal, lead_tags, leads (status), ai_assistants (prompt/tone)
    supabase.queue("deals", {
      data: {
        id: "deal-1",
        value: 1500,
        pipeline_id: "pipe-1",
        pipeline_stages: { name: "Proposta" },
        pipelines: { name: "Vendas" },
      },
      error: null,
    });
    supabase.queue("lead_tags", { data: [{ tags: { name: "VIP" } }], error: null });
    supabase.queue("leads", { data: { status: "qualified" }, error: null });
    supabase.queue("ai_assistants", {
      data: { prompt: "sell gently", tone: "friendly" },
      error: null,
    });
    // 6) pipeline_stages (deal had pipeline_id → skips firstPipeline branch)
    supabase.queue("pipeline_stages", {
      data: [{ name: "Lead", description: null, sort_order: 1 }],
      error: null,
    });
    // 7) ai_assistants again — for message_splitting
    supabase.queue("ai_assistants", { data: { message_splitting: null }, error: null });

    // n8n HTTP response
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ output: "Hi there! Lets talk." }),
        text: async () => "",
      })),
    );

    const provider = makeProvider();
    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider,
      msg: baseMsg({ text: "oi" }),
    });

    expect(result.ok).toBe(true);
    expect(result.handledBy).toBe("ai_n8n");
    expect(result.conversationId).toBe("conv-ai");

    // Incoming msg (sender=lead) + two AI parts inserted
    const msgInserts = supabase.inserts.messages as Array<Record<string, unknown>>;
    expect(msgInserts).toHaveLength(3);
    expect(msgInserts[0].sender).toBe("lead");
    expect(msgInserts[1]).toMatchObject({ sender: "ai", content: "Part A" });
    expect(msgInserts[2]).toMatchObject({ sender: "ai", content: "Part B" });

    // Each part sent through the provider
    expect(provider.sendText).toHaveBeenCalledTimes(2);
    expect(provider.sendText).toHaveBeenNthCalledWith(1, {
      phone: "5511988880000",
      message: "Part A",
    });
    expect(provider.sendText).toHaveBeenNthCalledWith(2, {
      phone: "5511988880000",
      message: "Part B",
    });
    expect(provider.markAsRead).toHaveBeenCalledWith(["wamid.X"], "5511988880000");
  });

  it("skips AI when n8n responds with empty object", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-4" }, error: null });
    supabase.queue("conversations", {
      data: { id: "conv-4", assigned_to: "ai", status: "active" },
      error: null,
    });
    supabase.queue("organizations", {
      data: {
        settings: { n8n_webhook_url: "https://n8n/flow" },
      },
      error: null,
    });
    // Promise.all stubs — all empty
    supabase.queue("deals", { data: null, error: null });
    supabase.queue("lead_tags", { data: [], error: null });
    supabase.queue("leads", { data: null, error: null });
    supabase.queue("ai_assistants", { data: null, error: null });
    // firstPipeline branch (no deal pipelineId)
    supabase.queue("pipelines", { data: null, error: null });
    // OpenAI fallback fetches assistant — queue null so the branch exits
    supabase.queue("ai_assistants", { data: null, error: null });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}), // empty object => pipeline treats as no response
        text: async () => "",
      })),
    );

    const provider = makeProvider();
    const result = await processIncomingMessage({
      supabase: supabase as never,
      orgId: "org-1",
      provider,
      msg: baseMsg(),
    });

    // Without OPENAI_API_KEY the OpenAI fallback is skipped too → handledBy "none"
    expect(result.handledBy).toBe("none");
    expect(provider.sendText).not.toHaveBeenCalled();
  });
});
